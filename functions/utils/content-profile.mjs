import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

/**
 * The content profile is the tenant's learned editorial memory: what has
 * actually been featured in past issues (topics, exemplar links) and how
 * readers responded (clicks). It is built by learn-content-profile from the
 * per-issue `link#` tracking records and consumed by content vetting, so
 * recommendations are backed by proof from past issues instead of relying
 * solely on the author-written brand description.
 *
 * Link tracking records expire after 90 days; per-issue digests stored on the
 * profile persist beyond that, so the profile accumulates history the raw
 * records lose.
 */

export const PROFILE_SK = 'content-profile';
export const MAX_ISSUE_DIGESTS = 26; // ~6 months of weekly issues
export const TOP_LINKS_PER_ISSUE = 5;
export const MAX_EXEMPLARS = 15;

/**
 * Loads a tenant's content profile. Best-effort: returns null when missing
 * or on read failure so callers can fall back to brand-only behavior.
 *
 * @param {string} tenantId
 * @returns {Promise<object | null>}
 */
export const loadContentProfile = async (tenantId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: tenantId, sk: PROFILE_SK })
    }));
    return result.Item ? unmarshall(result.Item) : null;
  } catch (err) {
    console.warn('Failed to load content profile', { tenantId, error: err.message });
    return null;
  }
};

/**
 * Builds a compact digest of one issue from its link tracking records.
 * Topics count every classified link; topLinks keep the most-clicked links
 * (falling back to issue order) so the digest stays small enough to store
 * on the profile record indefinitely.
 *
 * @param {number} issueNumber
 * @param {string} publishedAt - ISO timestamp the issue went out
 * @param {object[]} linkRecords - Unmarshalled `link#` records for the issue
 * @returns {object | null} Digest, or null when there are no usable records
 */
export const digestFromLinkRecords = (issueNumber, publishedAt, linkRecords) => {
  const usable = (linkRecords ?? []).filter(record => record?.url);
  if (!usable.length) {
    return null;
  }

  const topics = {};
  for (const record of usable) {
    if (!record.primaryTopic) {
      continue;
    }
    const topic = topics[record.primaryTopic] ?? { featured: 0, clicks: 0 };
    topic.featured += 1;
    topic.clicks += record.clicks_total ?? 0;
    topics[record.primaryTopic] = topic;
  }

  const topLinks = [...usable]
    .sort((a, b) => (b.clicks_total ?? 0) - (a.clicks_total ?? 0) || (a.position ?? 0) - (b.position ?? 0))
    .slice(0, TOP_LINKS_PER_ISSUE)
    .map(record => ({
      url: record.url,
      ...record.summary && { summary: record.summary },
      ...record.primaryTopic && { primaryTopic: record.primaryTopic },
      clicks: record.clicks_total ?? 0
    }));

  return {
    issueNumber,
    publishedAt,
    linkCount: usable.length,
    topics,
    topLinks
  };
};

/**
 * Merges freshly built digests over previously stored ones (fresh wins — it
 * carries updated click counts), keeping only the most recent
 * MAX_ISSUE_DIGESTS issues. Old digests whose link records have expired are
 * retained: that persistence is the point of the profile.
 *
 * @param {Record<string, object>} existingDigests
 * @param {Record<string, object>} freshDigests
 * @returns {Record<string, object>}
 */
export const mergeIssueDigests = (existingDigests = {}, freshDigests = {}) => {
  const merged = { ...existingDigests, ...freshDigests };
  const keep = Object.values(merged)
    .sort((a, b) => b.issueNumber - a.issueNumber)
    .slice(0, MAX_ISSUE_DIGESTS);

  return Object.fromEntries(keep.map(digest => [String(digest.issueNumber), digest]));
};

/**
 * Derives the aggregate views the vetting prompt consumes: cumulative topic
 * weights and the top exemplar links across all remembered issues.
 *
 * @param {Record<string, object>} issueDigests
 * @returns {{ topicWeights: Record<string, {featured: number, clicks: number}>, exemplars: object[] }}
 */
export const buildAggregates = (issueDigests = {}) => {
  const topicWeights = {};
  const allLinks = [];

  for (const digest of Object.values(issueDigests)) {
    for (const [topic, weight] of Object.entries(digest.topics ?? {})) {
      const aggregate = topicWeights[topic] ?? { featured: 0, clicks: 0 };
      aggregate.featured += weight.featured ?? 0;
      aggregate.clicks += weight.clicks ?? 0;
      topicWeights[topic] = aggregate;
    }

    for (const link of digest.topLinks ?? []) {
      allLinks.push({ ...link, issueNumber: digest.issueNumber });
    }
  }

  const exemplars = allLinks
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0) || b.issueNumber - a.issueNumber)
    .slice(0, MAX_EXEMPLARS);

  return { topicWeights, exemplars };
};

/**
 * Renders the profile as prompt lines for the vetting agent. Returns null
 * when the profile has no learned data yet so vetting can skip the section.
 *
 * @param {object | null} profile
 * @returns {string | null}
 */
export const formatProfileForPrompt = (profile) => {
  if (!profile) {
    return null;
  }

  const lines = [];

  if (profile.editorialProfile?.summary) {
    lines.push(`Learned editorial profile (from ${profile.editorialProfile.issuesAnalyzed ?? '?'} past issues): ${profile.editorialProfile.summary}`);
    for (const pattern of profile.editorialProfile.patterns ?? []) {
      lines.push(`- Pattern: ${pattern}`);
    }
  }

  const topics = Object.entries(profile.topicWeights ?? {})
    .sort(([, a], [, b]) => b.featured - a.featured)
    .slice(0, 10);
  if (topics.length) {
    lines.push(`Topics actually featured in past issues (times featured / reader clicks): ${topics.map(([topic, weight]) => `${topic} ${weight.featured}x/${weight.clicks} clicks`).join(', ')}`);
  }

  const exemplars = (profile.exemplars ?? []).slice(0, 10);
  if (exemplars.length) {
    lines.push('Examples of links actually featured in past issues:');
    for (const exemplar of exemplars) {
      const label = exemplar.summary || exemplar.url;
      const details = [
        exemplar.primaryTopic,
        `issue #${exemplar.issueNumber}`,
        `${exemplar.clicks ?? 0} clicks`
      ].filter(Boolean).join(', ');
      lines.push(`- ${label} (${details})`);
    }
  }

  return lines.length ? lines.join('\n') : null;
};
