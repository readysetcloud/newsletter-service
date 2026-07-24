import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError, hash } from '../utils/helpers.mjs';
import { normalizeUrl } from '../utils/url-normalizer.mjs';
import { publishEvent, EVENT_TYPES } from '../utils/event-publisher.mjs';

const ddb = new DynamoDBClient();

const MAX_LINKS_PER_REQUEST = 10;
const MAX_URL_LENGTH = 2048;
const MAX_ANCHOR_TEXT_LENGTH = 300;
const MAX_POST_TEXT_LENGTH = 2000;
const MAX_AUTHOR_LENGTH = 200;
const CANDIDATE_TTL_DAYS = 90;
const VALID_SOURCES = new Set(['linkedin', 'manual', 'other']);

/**
 * Accepts content candidates captured in the wild (e.g. by the LinkedIn Chrome
 * extension) and stores them for asynchronous vetting. Each link is normalized
 * and deduped per tenant; new candidates emit a Content Candidate Submitted
 * event that triggers the vetting function.
 */
export const handler = async (event) => {
  const tenantId = event.requestContext?.authorizer?.tenantId;
  if (!tenantId) {
    return formatAuthError();
  }

  if (!event.body) {
    return formatResponse(400, 'Missing request body');
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return formatResponse(400, 'Invalid JSON body');
  }

  const { links, source, post } = body;

  if (!Array.isArray(links) || links.length === 0) {
    return formatResponse(400, 'links must be a non-empty array');
  }
  if (links.length > MAX_LINKS_PER_REQUEST) {
    return formatResponse(400, `links cannot contain more than ${MAX_LINKS_PER_REQUEST} entries`);
  }
  if (source !== undefined && !VALID_SOURCES.has(source)) {
    return formatResponse(400, `source must be one of: ${[...VALID_SOURCES].join(', ')}`);
  }
  if (post !== undefined && (typeof post !== 'object' || post === null || Array.isArray(post))) {
    return formatResponse(400, 'post must be an object when provided');
  }

  const postContext = sanitizePost(post);
  const submittedAt = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + CANDIDATE_TTL_DAYS * 24 * 60 * 60;

  const accepted = [];
  const duplicates = [];
  const invalid = [];

  for (const link of links) {
    const url = typeof link === 'string' ? link : link?.url;
    if (!url || typeof url !== 'string' || url.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(url)) {
      invalid.push(typeof url === 'string' ? url : String(url));
      continue;
    }

    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      invalid.push(url);
      continue;
    }

    const anchorText = typeof link?.anchorText === 'string'
      ? link.anchorText.trim().slice(0, MAX_ANCHOR_TEXT_LENGTH)
      : undefined;

    const urlHash = hash(normalizedUrl);
    const item = {
      pk: `${tenantId}#content-candidate#${urlHash}`,
      sk: 'candidate',
      GSI1PK: `${tenantId}#content-candidates`,
      GSI1SK: `${submittedAt}#${urlHash}`,
      tenantId,
      urlHash,
      url: normalizedUrl,
      originalUrl: url,
      ...anchorText && { anchorText },
      source: source ?? 'other',
      ...postContext && { post: postContext },
      status: 'pending',
      submittedAt,
      ttl
    };

    try {
      await ddb.send(new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(pk)'
      }));
      accepted.push({ url: normalizedUrl, urlHash });
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        duplicates.push(normalizedUrl);
        continue;
      }
      throw err;
    }
  }

  await Promise.all(accepted.map(candidate => publishEvent(
    'newsletter-service',
    EVENT_TYPES.CONTENT_CANDIDATE_SUBMITTED,
    { tenantId, urlHash: candidate.urlHash }
  )));

  const statusCode = accepted.length ? 201 : 200;
  return formatResponse(statusCode, { accepted, duplicates, invalid });
};

const sanitizePost = (post) => {
  if (!post) {
    return undefined;
  }

  const author = typeof post.author === 'string' ? post.author.trim().slice(0, MAX_AUTHOR_LENGTH) : undefined;
  const text = typeof post.text === 'string' ? post.text.trim().slice(0, MAX_POST_TEXT_LENGTH) : undefined;
  const url = typeof post.url === 'string' && /^https?:\/\//i.test(post.url) && post.url.length <= MAX_URL_LENGTH
    ? post.url
    : undefined;

  if (!author && !text && !url) {
    return undefined;
  }

  return {
    ...author && { author },
    ...text && { text },
    ...url && { url }
  };
};
