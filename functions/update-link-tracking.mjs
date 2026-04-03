import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { hash } from './utils/helpers.mjs';
import { normalizeUrl } from './utils/url-normalizer.mjs';
import { classifyLink } from './utils/link-classifier.mjs';

const ddb = new DynamoDBClient();

const LINK_EXPIRATION_DAYS = 14;

/**
 * Extracts all markdown hyperlinks from content, returning anchor text and URL.
 * Excludes mailto: links.
 *
 * @param {string} content - Markdown content string
 * @returns {{ anchorText: string, url: string }[]} Array of extracted links
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
      links.push({ anchorText, url });
    }
  }

  return links;
}

/**
 * Classifies a link and stores Link_Metadata if not already classified.
 * Failures are logged and swallowed — classification errors must not
 * break the content pipeline.
 *
 * @param {string} originalUrl - The original URL before normalization
 * @param {string} anchorText - The link's anchor text from the markdown
 */
export async function classifyAndStoreLinkMetadata(originalUrl, anchorText) {
  try {
    const normalizedUrl = normalizeUrl(originalUrl);
    if (!normalizedUrl) {
      return;
    }

    const urlHash = hash(normalizedUrl);

    // Check for existing Link_Metadata
    const existing = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: 'LINK_META', sk: urlHash }),
      ProjectionExpression: 'primaryTopic, secondaryTopics, confidence'
    }));

    if (existing.Item) {
      return;
    }

    // Classify the link
    const classification = classifyLink(normalizedUrl, anchorText);

    if (classification.confidence < 0.5) {
      return;
    }

    // Store Link_Metadata with conditional write (idempotent)
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: 'LINK_META',
        sk: urlHash,
        originalUrl,
        normalizedUrl,
        primaryTopic: classification.primaryTopic,
        secondaryTopics: classification.secondaryTopics,
        confidence: classification.confidence,
        classifiedBy: 'heuristic',
        classifiedAt: new Date().toISOString()
      }),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      console.error('Link classification failed', { url: originalUrl, error: err.message });
    }
  }
}

export const handler = async (state) => {
  const links = extractLinks(state.content);
  let linkPosition = 0;

  let updatedContent = state.content;
  for (const { url, anchorText } of links) {
    linkPosition += 1;
    await classifyAndStoreLinkMetadata(url, anchorText);
    await initializeLinkRecord(state.tenantId, state.issueId, url, linkPosition);
    updatedContent = updatedContent.replace(
      url,
      `${process.env.REDIRECT_URL}?u=${encodeURI(url)}&cid=${encodeURIComponent(`${state.tenantId}_${state.issueId}`)}&s=__EMAIL_HASH__`
    );
  }

  return { content: updatedContent };
};

const initializeLinkRecord = async (tenantId, issueId, link, position) => {
  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: `${tenantId}#${issueId}`,
        sk: `link#${hash(link)}`,
        url: link,
        position,
        clicks_total: 0,
        byDay: {},
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
