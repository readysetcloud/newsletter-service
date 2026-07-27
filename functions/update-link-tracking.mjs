import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { hash } from './utils/helpers.mjs';
import { classifyLinkWithLlm } from './utils/llm-link-classifier.mjs';

const ddb = new DynamoDBClient();

// Match the click-event retention window (process-link-click writes click
// events with a 90-day TTL). Interest scoring reads topics off this record on
// click, so it must outlive the period in which clicks can still arrive.
const LINK_EXPIRATION_DAYS = 90;
const LINK_PROCESSING_CONCURRENCY = 3;
const MAX_CONTEXT_LENGTH = 600;

// How much of the surrounding document goes to the classifier as context for an
// HTML anchor. Markdown gets the author's paragraph (blank-line bounded); a
// pre-rendered master or a JSON section body has no reliable paragraph
// structure, so it gets a window instead — biased backwards, because the
// sentence that introduces a link almost always precedes it.
const HTML_CONTEXT_BEFORE = 400;
const HTML_CONTEXT_AFTER = 200;

// `<a ...>text</a>`, with the href pulled out of the attribute list separately so
// attribute order and quoting style don't matter, and a `data-href` or an
// `aria-label` containing "href" can't be mistaken for the destination.
const HTML_ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_RE = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

// Comments and style/script bodies are stripped before anchors are matched, for
// two reasons. Outlook conditional blocks (`<!--[if mso]> … <![endif]-->`) carry
// duplicate copies of the visible links, which would double-count `position`;
// and a mail master's `<style>` block would otherwise land in the classifier's
// context window as CSS. The downlevel-revealed form
// (`<!--[if !mso]><!-->visible<!--<![endif]-->`) survives correctly: the two
// comment fragments match, the content between them does not.
const HTML_NOISE_RE = /<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1>/gi;

/**
 * Extracts all markdown hyperlinks from content, returning anchor text, URL,
 * and the author's surrounding paragraph (used as classification context).
 * Excludes mailto: links.
 *
 * @param {string} content - Markdown content string
 * @returns {{ anchorText: string, url: string, context: string }[]} Array of extracted links
 */
export function extractLinks(content) {
  const linkRegex = /\[(.*?)\]\((.*?)\)/g;
  const links = [];
  let matches;

  while ((matches = linkRegex.exec(content)) !== null) {
    if (matches.index === linkRegex.lastIndex) {
      linkRegex.lastIndex++;
    }

    const anchorText = matches[1];
    const url = matches[2];

    if (url && url.indexOf('mailto:') === -1) {
      links.push({ anchorText, url, context: extractContext(content, matches.index) });
    }
  }

  return links;
}

/**
 * Extracts `<a href>` links from a chunk of HTML, in document order.
 *
 * This is what makes json and html issues trackable at all: neither carries
 * markdown, so the `[text](url)` matcher above finds nothing in them.
 *
 * @param {string} html - HTML fragment or whole document
 * @returns {{ anchorText: string, url: string, context: string }[]} Array of extracted links
 */
export function extractHtmlLinks(html) {
  const cleaned = String(html ?? '').replace(HTML_NOISE_RE, ' ');
  const links = [];
  let matches;

  HTML_ANCHOR_RE.lastIndex = 0;
  while ((matches = HTML_ANCHOR_RE.exec(cleaned)) !== null) {
    const href = matches[1].match(HREF_RE);
    if (!href) {
      continue;
    }

    const url = (href[1] ?? href[2] ?? href[3] ?? '').trim();
    if (!url || url.toLowerCase().startsWith('mailto:')) {
      continue;
    }

    links.push({
      anchorText: toText(matches[2]),
      url: decodeEntities(url),
      context: extractHtmlContext(cleaned, matches.index, matches.index + matches[0].length)
    });
  }

  return links;
}

/**
 * Extracts links from a json issue: `content` is a JSON string holding the
 * template data object, whose section bodies are HTML (see the shape
 * `parse-md-to-json` produces, which is what a json issue supplies directly).
 * Every string value is scanned for anchors, in key order, so the ordinals match
 * the order the template renders them in.
 *
 * Bare-URL fields are deliberately NOT tracked — `metadata.url`,
 * `tipOfTheWeek.url`, `sponsor.url` and `logo_url` are chrome, and their
 * markdown equivalents aren't tracked either (they come from frontmatter and the
 * sponsor record, not from a `[text](url)` in the body). Tracking them here
 * would give json issues a different link set than the same issue in markdown.
 *
 * @param {string|object} content - JSON string (or already-parsed object) of the template data
 * @returns {{ anchorText: string, url: string, context: string }[]} Array of extracted links
 */
export function extractJsonLinks(content) {
  let data;
  try {
    data = typeof content === 'string' ? JSON.parse(content) : content;
  } catch (err) {
    // Not a hard failure here: `parse-issue` runs next and throws the honest
    // error about the content being unparseable. Reporting no links is the right
    // answer for an issue that is about to fail anyway.
    console.error('Issue content is not valid JSON, extracting no links', { error: err.message });
    return [];
  }

  const links = [];
  const visit = (node) => {
    if (typeof node === 'string') {
      links.push(...extractHtmlLinks(node));
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(visit);
    }
  };
  visit(data);

  return links;
}

/**
 * Extracts an issue's links for any content type, in document order.
 *
 * Anything that is not json or html is markdown, matching `normalizeContentType`
 * in functions/parse-issue.mjs and the state machine's own content-type Choice —
 * an absent or unrecognized value has always meant markdown.
 *
 * @param {string|object} content - The issue content as authored
 * @param {string} [contentType] - 'markdown' | 'json' | 'html'
 * @returns {{ anchorText: string, url: string, context: string }[]} Array of extracted links
 */
export function extractIssueLinks(content, contentType) {
  const normalized = typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';

  if (normalized === 'html') {
    return extractHtmlLinks(content);
  }
  if (normalized === 'json') {
    return extractJsonLinks(content);
  }

  return extractLinks(String(content ?? ''));
}

/** Collapses an HTML fragment to its visible text. */
const toText = (html) =>
  decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&'); // last: an entity's own `&` must not be re-decoded

/**
 * Builds classification context for an HTML anchor from a window of the
 * surrounding markup, reduced to visible text.
 *
 * @param {string} html - Noise-stripped HTML the anchor was found in
 * @param {number} start - Index the `<a` begins at
 * @param {number} end - Index just past the `</a>`
 * @returns {string} Cleaned text, capped at MAX_CONTEXT_LENGTH
 */
const extractHtmlContext = (html, start, end) =>
  toText(html.slice(Math.max(0, start - HTML_CONTEXT_BEFORE), Math.min(html.length, end + HTML_CONTEXT_AFTER)))
    .slice(0, MAX_CONTEXT_LENGTH);

/**
 * Extracts the paragraph surrounding a link (the block bounded by blank lines),
 * stripped of markdown markers, to feed the classifier as authored context.
 *
 * @param {string} content - Full markdown content
 * @param {number} matchIndex - Index where the link match begins
 * @returns {string} Cleaned paragraph text, capped at MAX_CONTEXT_LENGTH
 */
function extractContext(content, matchIndex) {
  const prevBreak = content.lastIndexOf('\n\n', matchIndex);
  const start = prevBreak === -1 ? 0 : prevBreak + 2;
  const nextBreak = content.indexOf('\n\n', matchIndex);
  const end = nextBreak === -1 ? content.length : nextBreak;

  return content.slice(start, end)
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1') // markdown links -> anchor text
    .replace(/[#>*_`~]/g, '')             // strip common markdown markers
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTEXT_LENGTH);
}

export const handler = async (state) => {
  let linkPosition = 0;
  const linkTasks = [];
  const seen = new Set();

  // This step creates the issue's `link#<hash(url)>` records (click counts +
  // LLM topic classification). It no longer rewrites the content: web link
  // wrapping happens at site-build time in the newsletter Hugo render hook, and
  // email links are tracked by SES. Both surfaces resolve clicks back into these
  // records, so record creation stays here (server-side) while the presentation
  // wrapping moved out. See docs/github-api-cutover-spec.md.
  //
  // Extraction is per content type: markdown links for a markdown issue, `<a
  // href>` anchors for the HTML that json section bodies and an html master are
  // made of. Before Phase 4 of docs/stage-issue-simplification-plan.md this
  // matched `[text](url)` unconditionally, and since json and html issues contain
  // no markdown, they got no records at all.
  //
  // Only absolute http(s) links are tracked: the redirect only accepts http(s)
  // destinations, and for a markdown issue this is also the Hugo render hook's
  // wrapping set, which is what keeps `position` aligned with the web version.
  // Relative and mailto: links are skipped.
  //
  // `position` counts every occurrence, including repeats, because it is an
  // ordinal into the rendered issue. Enrichment runs once per distinct URL: the
  // records are keyed by `hash(url)`, so a repeat could only re-do work already
  // done — and this runs ahead of the send now, where a duplicate Bedrock call is
  // latency on the critical path. An html master repeats URLs heavily (a logo and
  // its caption, a footer link in every block), which is what makes the
  // difference worth the Set.
  for (const { url, anchorText, context } of extractIssueLinks(state.content, state.contentType)) {
    if (!url || !/^https?:\/\//i.test(url)) {
      continue;
    }

    linkPosition += 1;
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    linkTasks.push({ url, anchorText, context, position: linkPosition });
  }

  await processLinks(linkTasks, state.tenantId, state.issueId);

  // Returned for the execution history, not read by the state machine: the
  // `Success?` choice that used to test `success` through the publish Parallel's
  // `$[0]` output is gone. `Extract Links` is a sequential step now, and its
  // Catch continues to the publish path whatever happens here.
  return { success: true, linkCount: linkPosition };
};

async function processLinks(links, tenantId, issueId) {
  const workers = Array.from(
    { length: Math.min(LINK_PROCESSING_CONCURRENCY, links.length) },
    async (_, workerIndex) => {
      for (let index = workerIndex; index < links.length; index += LINK_PROCESSING_CONCURRENCY) {
        const { url, anchorText, context, position } = links[index];
        await enrichLinkRecord(tenantId, issueId, url, anchorText, context, position);
      }
    }
  );

  await Promise.all(workers);
}

/**
 * Creates the link tracking record for an issue link, enriched with an LLM
 * topic classification and summary derived from the author's paragraph.
 *
 * Skips the LLM call only when the record is already classified, so re-runs
 * and preview sends don't re-classify needlessly. Enrichment is best-effort:
 * a classification failure still creates the base tracking record so click
 * counting keeps working.
 *
 * @param {string} tenantId
 * @param {string} issueId
 * @param {string} url - The original link URL
 * @param {string} anchorText - The link's anchor text
 * @param {string} context - The author's surrounding paragraph
 * @param {number} position - 1-based ordinal of the link within the issue
 */
const enrichLinkRecord = async (tenantId, issueId, url, anchorText, context, position) => {
  const pk = `${tenantId}#${issueId}`;
  const sk = `link#${hash(url)}`;

  let existing = null;
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk }),
      ProjectionExpression: 'pk, primaryTopic'
    }));
    existing = result.Item ? unmarshall(result.Item) : null;
  } catch (err) {
    console.error('Failed to check existing link record', { pk, sk, error: err.message });
  }

  // Already classified: nothing to do and no wasted LLM call.
  if (existing?.primaryTopic) {
    return;
  }

  const classification = await classifyLinkWithLlm(url, anchorText, context);

  if (existing) {
    // Base record exists but has no topics yet. Backfill the classification
    // if we got one this time. Without topics there is nothing to write.
    if (classification) {
      await applyClassification(pk, sk, classification);
    }
    return;
  }

  await createLinkRecord(pk, sk, url, position, classification);
};

/** Creates the base link tracking record plus any classification fields. */
const createLinkRecord = async (pk, sk, url, position, classification) => {
  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk,
        sk,
        url,
        position,
        clicks_total: 0,
        byDay: {},
        ...(classification && classificationFields(classification)),
        ttl: Math.floor(Date.now() / 1000) + (LINK_EXPIRATION_DAYS * 24 * 60 * 60)
      }),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
  }
};

/** Backfills classification fields onto an existing, unclassified link record. */
const applyClassification = async (pk, sk, classification) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk }),
      UpdateExpression: 'SET primaryTopic = :primaryTopic, secondaryTopics = :secondaryTopics, summary = :summary, confidence = :confidence, classifiedBy = :classifiedBy, classifiedAt = :classifiedAt',
      ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(primaryTopic)',
      ExpressionAttributeValues: marshall({
        ':primaryTopic': classification.primaryTopic,
        ':secondaryTopics': classification.secondaryTopics,
        ':summary': classification.summary,
        ':confidence': classification.confidence,
        ':classifiedBy': classification.classifiedBy,
        ':classifiedAt': new Date().toISOString()
      })
    }));
  } catch (err) {
    // Another run classified it first (or the record vanished). That's fine.
    if (err.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
  }
};

const classificationFields = (classification) => ({
  primaryTopic: classification.primaryTopic,
  secondaryTopics: classification.secondaryTopics,
  summary: classification.summary,
  confidence: classification.confidence,
  classifiedBy: classification.classifiedBy,
  classifiedAt: new Date().toISOString()
});
