import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { hash } from './utils/helpers.mjs';
import { classifyLinkWithLlm } from './utils/llm-link-classifier.mjs';

const ddb = new DynamoDBClient();

const LINK_EXPIRATION_DAYS = 14;
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
  for (const { url, anchorText, context } of links) {
    linkPosition += 1;
    updatedContent = updatedContent.replace(
      url,
      `${process.env.REDIRECT_URL}?u=${encodeURI(url)}&cid=${encodeURIComponent(`${state.tenantId}#${state.issueId}`)}&p=${encodeURIComponent(linkPosition)}&s=__EMAIL_HASH__`
    );
    await enrichLinkRecord(state.tenantId, state.issueId, url, anchorText, context, linkPosition);
  }

  return { content: updatedContent };
};

/**
 * Creates the link tracking record for an issue link, enriched with an LLM
 * topic classification and summary derived from the author's paragraph.
 *
 * Skips enrichment (and the LLM call) when the record already exists, so
 * re-runs and preview sends don't re-classify. Enrichment is best-effort:
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

  try {
    const existing = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk }),
      ProjectionExpression: 'pk'
    }));

    // Record already exists — don't spend another LLM call re-classifying it.
    if (existing.Item) {
      return;
    }
  } catch (err) {
    console.error('Failed to check existing link record', { pk, sk, error: err.message });
  }

  const classification = await classifyLinkWithLlm(url, anchorText, context);

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
        ...(classification && {
          primaryTopic: classification.primaryTopic,
          secondaryTopics: classification.secondaryTopics,
          summary: classification.summary,
          confidence: classification.confidence,
          classifiedBy: classification.classifiedBy,
          classifiedAt: new Date().toISOString()
        }),
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
