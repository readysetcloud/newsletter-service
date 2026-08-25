
import showdown from 'showdown';
import frontmatter from '@github-docs/frontmatter';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { renderWithSnippets } from './utils/render-template.mjs';
import { resolveParameters } from './utils/snippet-parameters.mjs';
import { sectionStartMarker, sectionEndMarker } from './utils/interest-assembly.mjs';
import {
  getTenantSettings,
  resolveSendInstant,
  buildSubject,
  buildIssueUrl
} from './utils/tenant-settings.mjs';

const ddb = new DynamoDBClient();
const converter = new showdown.Converter();

// Body shortcodes that are handled by their own bespoke transforms elsewhere
// (sponsor inline, social in tip-of-the-week) are NOT routed through the
// generic snippet bridge.
const RESERVED_SHORTCODES = new Set(['sponsor', 'social']);

// Hardcoded body blocks that render even when a tenant has not defined a snippet
// of the same name. A matching tenant snippet overrides these (see the decision
// doc: docs/reusable-content-components.md).
const HARDCODED_BODY_BLOCKS = new Set(['robotVoice']);

// Matches a body shortcode `{{< name attr="x" attr2="y" >}}`, capturing the
// snippet name and its (well-formed) attribute list. The name follows the same
// rule as snippet names (start with a letter; letters, digits, _ and -).
const BODY_SHORTCODE_RE =
  /\{\{<\s*([a-zA-Z][a-zA-Z0-9_-]*)((?:\s+[a-zA-Z][a-zA-Z0-9_-]*="[^"]*")*)\s*>\}\}/g;
const ATTRIBUTE_RE = /([a-zA-Z][a-zA-Z0-9_-]*)="([^"]*)"/g;

export const handler = async (state) => {
  const newsletter = frontmatter(state.content);
  const sponsor = await getSponsorDetails(newsletter.data.sponsor, newsletter.data.sponsor_description);
  const author = await getAuthor(newsletter.data.author);
  const snippets = await getSnippets(state.tenantId);
  const snippetsByName = new Map(snippets.filter(s => s.name).map(s => [s.name, s]));
  const settings = await getTenantSettings(state.tenantId);
  const issueNumber = Number(state.issueId);

  if (!Number.isFinite(issueNumber) || issueNumber < 1) {
    throw new Error('Invalid or missing issueId');
  }

  let sections = newsletter.content.split('### ');
  sections = sections.map(s => processSection(s, sponsor, snippets, snippetsByName));
  sections = sections.filter(ps => ps.header);

  if (sponsor) {
    delete sponsor.ad;
  }

  // When the issue goes out. `state.sendAt` is the instant the issue was
  // actually scheduled for, forwarded from the execution input, and it outranks
  // the frontmatter `date` because it is what the Scheduler entry fired
  // against — the frontmatter is the author's intent, the record is the
  // schedule. It is also the only source available once the workflow starts
  // early: with a lead time (see issue_send_lead_time in
  // functions/src/api/controllers/issues.rs) "now" is no longer the send
  // instant, and an issue whose frontmatter carries no date at all would
  // otherwise publish immediately.
  //
  // Either way a bare date carries no time, so it is anchored to the tenant's
  // default send time in the tenant's timezone; a value that already names a
  // time is respected as-is.
  const sendInstant = resolveSendInstant(state.sendAt || newsletter.data.date, settings);
  const formattedDate = sendInstant
    ? sendInstant.toLocaleDateString('en-US', {
      timeZone: settings.timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    : '';

  // Omitted when the tenant hasn't configured where issues live on their site
  // — the template drops the "view online" link rather than pointing every
  // tenant's subscribers at somebody else's domain.
  const issueUrl = buildIssueUrl(settings, { number: issueNumber });

  const dataTemplate = {
    metadata: {
      number: issueNumber,
      title: newsletter.data.title,
      description: newsletter.data.description,
      date: formattedDate,
      ...(issueUrl && { url: issueUrl }),
      ...(author && { author })
    },
    ...(sponsor && { sponsor }),
    content: {}
  };

  const tipOfTheWeekIndex = sections.findIndex(ps => ps.header.toLowerCase().includes('tip of the week'));
  if (tipOfTheWeekIndex >= 0) {
    let tipOfTheWeek = sections[tipOfTheWeekIndex];
    tipOfTheWeek = processTipOfTheWeek(tipOfTheWeek);
    sections.splice(tipOfTheWeekIndex, 1);
    dataTemplate.content.tipOfTheWeek = tipOfTheWeek;
  }

  const lastWordsIndex = sections.findIndex(ps => ps.header.toLowerCase().includes('last words'));
  if (lastWordsIndex >= 0) {
    let lastWords = sections[lastWordsIndex];
    sections.splice(lastWordsIndex, 1);
    lastWords = convertToHtml(lastWords.raw);

    dataTemplate.content.lastWords = lastWords;
  }

  dataTemplate.content.sections = sections.map(ps => {
    return {
      header: ps.header,
      text: ps.html
    };
  });

  // Interest-aware assembly (contentAssembly): when the issue opts in, tag each
  // generic content section with start/end markers that the template emits
  // around the whole section block (header + body). This is the injection
  // point because it is the only place that knows which blocks are the
  // reorderable middle sections — tip of the week, last words, sponsor
  // and the header/footer chrome are all rendered outside `content.sections`
  // and therefore stay fixed. The config is read from the issue record (like
  // publish-issue reads abTest) instead of being threaded through the state
  // machine, so every state-machine entry point stays unchanged. Markers carry
  // NO topic hint — topics are derived at send time from the issue's link#
  // records, which the state machine now writes before publish rather than in a
  // branch racing this render (Phase 4 of
  // docs/stage-issue-simplification-plan.md). Fail-open: any error just skips
  // marker injection.
  try {
    const contentAssembly = await getContentAssemblyConfig(state.tenantId, issueNumber);
    if (contentAssembly?.enabled === true) {
      dataTemplate.content.sections = dataTemplate.content.sections.map(section => ({
        ...section,
        markerStart: sectionStartMarker(),
        markerEnd: sectionEndMarker()
      }));
    }
  } catch (err) {
    console.error('Failed to apply content assembly markers, sending canonical order', { error: err.message });
  }

  const now = new Date();

  // Downstream jobs hang off the send instant: list cleanup three days later,
  // the stats report five.
  //
  // Clamped to now when the send instant is already past, which mirrors
  // parse-json-issue.mjs and is not hypothetical: `sendInstant` falls back to
  // the frontmatter `date` when the execution carries no `sendAt`, so an
  // immediate publish - or a resend - of an issue dated more than three days
  // ago yields `at()` expressions in the past. Scheduler rejects those with a
  // ValidationException, which is deliberately absent from the Retry on both
  // entries, so it takes the Parallel's Catch and stamps the issue `failed`
  // *after* the mail has already gone out. Both entries are relative offsets
  // from "when this issue went out", and for a send happening now, now is that
  // instant.
  const baseDate = sendInstant && sendInstant > now ? sendInstant : now;

  const listCleanupDate = new Date(baseDate);
  listCleanupDate.setDate(listCleanupDate.getDate() + 3);

  const reportStatsDate = new Date(baseDate);
  reportStatsDate.setDate(reportStatsDate.getDate() + 5);

  const sendAtDate = !sendInstant || sendInstant < now ? 'now' : sendInstant.toISOString();

  return {
    data: dataTemplate,
    sendAtDate,
    listCleanupDate: listCleanupDate.toISOString().split('.')[0],
    reportStatsDate: reportStatsDate.toISOString().split('.')[0],
    subject: buildSubject(settings, {
      // Null for GitHub imports, which have no subject of their own — those
      // fall through to the tenant's subjectTemplate. An API-created issue
      // always supplies one, and an explicit subject outranks the template.
      callerSubject: state.subject,
      title: dataTemplate.metadata.title,
      number: issueNumber,
      date: formattedDate
    })
  };
};

const processSection = (section, sponsor, snippets = [], snippetsByName = new Map()) => {
  const newlineIndex = section.indexOf('\n');
  const header = section.substring(0, newlineIndex);
  const rawContent = section.substring(newlineIndex + 1).trim().replace(/\n/g, '<br>');

  // Pull body shortcodes (`{{< name attr="x" >}}`, 0..N) out before markdown
  // conversion so inline markdown inside attribute values isn't mangled. Each is
  // swapped for an inert placeholder that survives showdown, then expanded after
  // the rest of the section converts to HTML. A separate working copy is used so
  // `raw` stays clean for callers that re-render from it (tip-of-the-week,
  // last words).
  const blocks = [];
  const working = rawContent.replace(BODY_SHORTCODE_RE, (match, name, attrString) => {
    if (RESERVED_SHORTCODES.has(name)) return match;
    if (!snippetsByName.has(name) && !HARDCODED_BODY_BLOCKS.has(name)) return match;
    const placeholder = `%%BODYBLOCK${blocks.length}%%`;
    blocks.push({ name, attrs: parseAttributes(attrString) });
    return placeholder;
  });

  let html = convertToHtml(working);
  if (html.includes('{{< sponsor >}}')) {
    html = html.replace(/\{\{< sponsor >\}\}/g, formatSponsorAd(sponsor.ad));
  }

  blocks.forEach((block, index) => {
    html = html.replace(`%%BODYBLOCK${index}%%`, renderBodyBlock(block, snippets, snippetsByName));
  });

  return {
    header,
    html: html,
    raw: rawContent
  };
};

/**
 * Parse the attribute list of a body shortcode into a `{ name: value }` map of
 * raw strings.
 * @param {string} attrString - e.g. ` text="hello" tone="dry"`.
 * @returns {Record<string, string>}
 */
const parseAttributes = (attrString) => {
  const attrs = {};
  let match;
  ATTRIBUTE_RE.lastIndex = 0;
  while ((match = ATTRIBUTE_RE.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
};

/**
 * Render a single body block. A tenant snippet whose name matches the shortcode
 * wins; its parameters are resolved (defaults / required / type coercion) and it
 * is rendered through the shared snippet renderer so the output matches the rest
 * of the pipeline. When no snippet exists, a hardcoded block (e.g. robotVoice)
 * is the fallback.
 * @param {{name: string, attrs: Record<string,string>}} block
 * @param {Array<{name?: string, content?: string, parameters?: Array}>} snippets
 * @param {Map<string, object>} snippetsByName
 * @returns {string} Rendered HTML (empty string on failure).
 */
const renderBodyBlock = (block, snippets, snippetsByName) => {
  const snippet = snippetsByName.get(block.name);
  if (snippet) {
    const { values, errors } = resolveParameters(snippet.parameters ?? [], block.attrs);
    if (errors.length) {
      console.warn(`Snippet '${block.name}' parameter issues: ${errors.map(e => e.message).join('; ')}`);
    }
    try {
      return renderWithSnippets(snippet.content ?? '', values, snippets);
    } catch (err) {
      console.error(`Failed to render snippet '${block.name}': ${err.message}`);
      return '';
    }
  }

  if (block.name === 'robotVoice') {
    return formatRobotVoice(block.attrs.text ?? '');
  }

  return '';
};

const processTipOfTheWeek = (section) => {
  const socials = section.raw.matchAll(/\{\{<\s*social\s+url="([^"]+)"(?:\s+[^>]*)?>\}\}/g);

  for (const social of socials) {
    let text = section.raw.replace(social[0], '').trim();
    text = convertToHtml(text, true);

    const socialUrl = social[1];
    return { text, url: socialUrl };
  }
};

const getSponsorDetails = async (sponsorName, description) => {
  if (!sponsorName) return null;

  const sponsor = await getSponsor(sponsorName);
  if (sponsor) {
    let sponsorAd = description ?? sponsor.description;

    return {
      name: sponsor.name,
      url: sponsor.homepage,
      logo_url: sponsor.logo_url,
      shortDescription: convertToHtml(sponsor.short_description, true),
      ad: sponsorAd,
      displayName: sponsor.displayName ?? true
    };
  }
};

const convertToHtml = (data, removeOuterParagraph = false) => {
  let html = converter.makeHtml(data).replace('</p>\n<p>', '</p><br><p>').replace('</p>\n<p>', '</p><br><p>');
  if (removeOuterParagraph) {
    html = html.replace('<p>', '').replace('</p>', '');
  }

  return html;
};

const formatRobotVoice = (text) => {
  const formattedText = convertToHtml(text, true);
  // Twin of the robotVoice shortcode in the readysetcloud/ready-set-cloud repo:
  // layouts/shortcodes/robotVoice.html. The two render byte-identical HTML -
  // change both together.
  //
  // The label and the 404 footer sit INSIDE the card. An earlier version hung
  // them on the border with negative margins ("notch" labels), which forced the
  // card background to stay white - a tint would show through the label's
  // masking chip - and needed <!--[if mso]--> fallbacks plus a Gmail
  // degradation path, since Gmail strips negative margins and Outlook's Word
  // engine applies them and clips. Keeping the labels inside is what lets the
  // card carry a fill, and it renders the same everywhere with no conditionals.
  return `<div style="margin:24px 0;border-radius:6px;overflow:hidden;background:#EEF2F6;font-family:ui-monospace,'SF Mono','Cascadia Code',Consolas,'Courier New',monospace;">
  <div style="padding:9px 16px;background:#5B6773;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#FFFFFF;">\u{1F916}&nbsp; robot voice</div>
  <div style="padding:16px;font-size:15px;line-height:1.65;color:#37424C;">
    ${formattedText}
  </div>
  <div style="padding:0 16px 13px;text-align:right;font-size:11px;letter-spacing:.03em;color:#7A838C;">404 &middot; personality not found</div>
</div>`;
};

const formatSponsorAd = (ad) => {
  const formattedAd = convertToHtml(ad, true);
  return `<div style="border-style:solid;border-width:1px;border-color:lightgray;border-radius:15px;padding:.7em;margin-bottom:1em;">
  <p>
      ${formattedAd}
  <i>Sponsored</i>
  </p>
</div>`;
};

/**
 * Loads the issue's persisted contentAssembly config (JSON string on the issue
 * record, sk 'newsletter', mirroring how abTest is stored by the API). Returns
 * null when unset, unreadable, or when no tenant is supplied.
 * @param {string} [tenantId] - Tenant identifier.
 * @param {number} issueNumber - Issue number.
 * @returns {Promise<{enabled?: boolean}|null>}
 */
const getContentAssemblyConfig = async (tenantId, issueNumber) => {
  if (!tenantId) return null;

  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: `${tenantId}#${issueNumber}`,
        sk: 'newsletter'
      }),
      ProjectionExpression: 'contentAssembly'
    }));

    if (!result?.Item) return null;

    const record = unmarshall(result.Item);
    if (!record.contentAssembly) return null;

    return typeof record.contentAssembly === 'string'
      ? JSON.parse(record.contentAssembly)
      : record.contentAssembly;
  } catch (err) {
    console.error('Failed to load contentAssembly config', { tenantId, issueNumber, error: err.message });
    return null;
  }
};

const getAuthor = async (metadataAuthor) => {
  if (!metadataAuthor) return null;

  const data = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: metadataAuthor,
      sk: 'author'
    })
  }));

  if (data?.Item) {
    const author = unmarshall(data.Item);
    return {
      name: author.name,
      twitter: author.twitter
    };
  }

  return null;
};

/**
 * Loads all snippets for a tenant via GSI1 (mirrors the read in publish-issue).
 * Returns an empty list when no tenant is supplied so the body bridge falls back
 * to hardcoded blocks only — keeping older invocations and the default template
 * path working unchanged.
 * @param {string} [tenantId] - Tenant identifier.
 * @returns {Promise<Array<{name?: string, content?: string, parameters?: Array}>>}
 */
const getSnippets = async (tenantId) => {
  if (!tenantId) return [];

  const result = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :gsi1pk',
    ExpressionAttributeValues: marshall({
      ':gsi1pk': `snippet#${tenantId}`
    })
  }));

  return (result.Items ?? []).map(item => unmarshall(item));
};

const getSponsor = async (sponsorName) => {
  let data = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: sponsorName,
      sk: 'sponsor'
    })
  }));

  if (data?.Item) {
    data = unmarshall(data.Item);
    const { pk, sk, GSI1PK, GSI1SK, ...sponsor } = data;
    return sponsor;
  }

  return null;
};
