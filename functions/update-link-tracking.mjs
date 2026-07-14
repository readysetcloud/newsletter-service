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
  const links = extractLinks(state.content);
  let linkPosition = 0;

  let updatedContent = state.content;
  const linkTasks = [];
  for (const { url, anchorText, context } of links) {
    linkPosition += 1;
    linkTasks.push({ url, anchorText, context, position: linkPosition });
    updatedContent = updatedContent.replace(
      url,
      `${process.env.REDIRECT_URL}?u=${encodeURI(url)}&cid=${encodeURIComponent(`${state.tenantId}#${state.issueId}`)}&p=${encodeURIComponent(linkPosition)}&s=__EMAIL_HASH__`
    );
  }

  await processLinks(linkTasks, state.tenantId, state.issueId);

  return { content: updatedContent };
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
