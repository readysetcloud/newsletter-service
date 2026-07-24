import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError, getTenant } from '../utils/helpers.mjs';
import { validateApiKey } from '../utils/api-key-validator.mjs';

const ddb = new DynamoDBClient();

const DEFAULT_DAYS = 7;
const MAX_DAYS = 31;
const RECOMMENDATION_ORDER = { include: 0, maybe: 1, skip: 2 };

/**
 * Serves vetted content candidates as an RSS 2.0 feed (default) or JSON.
 * Defaults to the trailing 7 days so the Friday writing session sees the whole
 * week's finds. Auth accepts the standard Authorization header or a `key`
 * query parameter for RSS readers that cannot set headers.
 */
export const handler = async (event) => {
  const apiKey = event.headers?.Authorization
    ?? event.headers?.authorization
    ?? event.queryStringParameters?.key;

  const keyContext = apiKey ? await validateApiKey(apiKey) : null;
  if (!keyContext) {
    return formatAuthError();
  }

  const { tenantId } = keyContext;
  const params = event.queryStringParameters ?? {};

  const days = parseDays(params.days);
  if (!days) {
    return formatResponse(400, `days must be an integer between 1 and ${MAX_DAYS}`);
  }

  const format = params.format ?? 'rss';
  if (!['rss', 'json'].includes(format)) {
    return formatResponse(400, 'format must be rss or json');
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const candidates = await queryCandidates(tenantId, since);

  if (format === 'json') {
    return formatResponse(200, {
      since,
      count: candidates.length,
      items: candidates.map(toJsonItem)
    });
  }

  const feedItems = candidates
    .filter(candidate => candidate.status === 'vetted' && candidate.verdict?.recommendation !== 'skip')
    .sort(byRecommendationThenScore);

  const tenantName = await getTenantName(tenantId);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
    body: buildRss(tenantName, since, feedItems)
  };
};

const parseDays = (value) => {
  if (value === undefined) {
    return DEFAULT_DAYS;
  }
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= MAX_DAYS ? days : null;
};

const queryCandidates = async (tenantId, since) => {
  const items = [];
  let exclusiveStartKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK >= :since',
      ExpressionAttributeValues: marshall({
        ':pk': `${tenantId}#content-candidates`,
        ':since': since
      }),
      ...exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }
    }));

    items.push(...(result.Items ?? []).map(item => unmarshall(item)));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

const byRecommendationThenScore = (a, b) => {
  const recommendationDiff = (RECOMMENDATION_ORDER[a.verdict?.recommendation] ?? 3)
    - (RECOMMENDATION_ORDER[b.verdict?.recommendation] ?? 3);
  if (recommendationDiff !== 0) {
    return recommendationDiff;
  }
  return (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0);
};

const toJsonItem = (candidate) => ({
  url: candidate.resolvedUrl ?? candidate.url,
  submittedUrl: candidate.url,
  urlHash: candidate.urlHash,
  status: candidate.status,
  source: candidate.source,
  submittedAt: candidate.submittedAt,
  ...candidate.vettedAt && { vettedAt: candidate.vettedAt },
  ...candidate.anchorText && { anchorText: candidate.anchorText },
  ...candidate.post && { post: candidate.post },
  ...candidate.verdict && { verdict: candidate.verdict }
});

const getTenantName = async (tenantId) => {
  try {
    const tenant = await getTenant(tenantId);
    return tenant.name || 'Newsletter';
  } catch {
    return 'Newsletter';
  }
};

const buildRss = (tenantName, since, candidates) => {
  const items = candidates.map(candidate => {
    const link = candidate.resolvedUrl ?? candidate.url;
    const verdict = candidate.verdict ?? {};
    const descriptionParts = [
      verdict.summary,
      verdict.reasons?.length ? `Why: ${verdict.reasons.join('; ')}` : null,
      `Recommendation: ${verdict.recommendation} (score ${(verdict.score ?? 0).toFixed(2)})`,
      candidate.post?.author ? `Shared by ${candidate.post.author}` : null,
      candidate.post?.url ? `Original post: ${candidate.post.url}` : null
    ].filter(Boolean);

    return [
      '    <item>',
      `      <title>${escapeXml(verdict.title || link)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(candidate.urlHash)}</guid>`,
      `      <pubDate>${new Date(candidate.submittedAt).toUTCString()}</pubDate>`,
      `      <category>${escapeXml(verdict.recommendation ?? 'unvetted')}</category>`,
      `      <description>${escapeXml(descriptionParts.join(' | '))}</description>`,
      '    </item>'
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${escapeXml(`${tenantName} - Content Candidates`)}</title>`,
    '    <link>https://www.linkedin.com/feed/</link>',
    `    <description>${escapeXml(`Vetted newsletter content candidates collected since ${since}`)}</description>`,
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    ...items,
    '  </channel>',
    '</rss>'
  ].join('\n');
};

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');
