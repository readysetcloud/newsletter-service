import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { summarizeAtRisk } from './utils/churn-risk.mjs';

const ddb = new DynamoDBClient();

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (num, den) => (den > 0 ? Number(((n(num) / n(den)) * 100).toFixed(2)) : 0);
const round = (v) => Number(n(v).toFixed(2));

/**
 * Format an A/B variant send time (ISO) as a short, human-friendly UTC label.
 */
const formatSendAt = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return `${date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC'
  })} UTC`;
};

/**
 * Builds a monthly-report A/B entry from an issue's consolidated abTest summary
 * (written by aggregate-issue-analytics). Returns null when the issue has no test.
 */
const buildAbTestEntry = (issueNumber, subject, abTest) => {
  if (!abTest || !Array.isArray(abTest.variants) || abTest.variants.length === 0) {
    return null;
  }

  const metricKey = abTest.winMetric === 'clickRate' ? 'clickRate' : 'openRate';
  const byId = new Map(abTest.variants.map((v) => [v.variantId, v]));
  const control = byId.get('a');
  const winner = abTest.winnerVariantId ? byId.get(abTest.winnerVariantId) : null;
  const lift = winner && control ? round(n(winner[metricKey]) - n(control[metricKey])) : null;

  return {
    issueNumber: String(issueNumber),
    subject: subject || 'Untitled issue',
    dimension: abTest.dimension,
    winMetric: metricKey,
    status: abTest.status || null,
    winnerVariantId: abTest.winnerVariantId ?? null,
    significant: Boolean(abTest.evaluation?.significant),
    confidence: abTest.evaluation?.confidence ?? null,
    lift,
    variants: abTest.variants.map((v) => ({
      variantId: v.variantId,
      label: abTest.dimension === 'sendTime' ? formatSendAt(v.sendAt) : (v.subject || '—'),
      openRate: round(v.openRate),
      clickRate: round(v.clickRate),
      deliveries: n(v.deliveries),
      isWinner: abTest.winnerVariantId === v.variantId
    }))
  };
};

/**
 * Derive a short, human friendly label for a link (hostname + trimmed path).
 */
const linkLabel = (url) => {
  if (!url) return 'Unknown link';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    let path = parsed.pathname.replace(/\/$/, '');
    if (path.length > 30) path = `${path.slice(0, 27)}...`;
    return path ? `${host}${path}` : host;
  } catch {
    return url.length > 40 ? `${url.slice(0, 37)}...` : url;
  }
};

/**
 * Query every issue stats record for a tenant via GSI1 (GSI1PK = `${tenantId}#issue`).
 */
const queryTenantIssues = async (tenantId) => {
  const items = [];
  let lastEvaluatedKey;

  do {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: marshall({ ':gsi1pk': `${tenantId}#issue` }),
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    if (response.Items) {
      items.push(...response.Items.map((item) => unmarshall(item)));
    }
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
};

/**
 * Query every real subscriber record for a tenant from the subscribers table.
 * SEGMENT* rows (segment infrastructure sharing the tenant partition) are
 * filtered out. Returns [] when SUBSCRIBERS_TABLE_NAME is unset.
 */
const queryTenantSubscribers = async (tenantId) => {
  const tableName = process.env.SUBSCRIBERS_TABLE_NAME;
  if (!tableName) return [];

  const subscribers = [];
  let lastEvaluatedKey;

  do {
    const response = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'tenantId = :tid',
      ExpressionAttributeValues: marshall({ ':tid': tenantId }),
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    if (response.Items) {
      for (const raw of response.Items) {
        const item = unmarshall(raw);
        // Real subscribers never have an email starting with "SEGMENT".
        if (typeof item.email === 'string' && !item.email.startsWith('SEGMENT')) {
          subscribers.push(item);
        }
      }
    }
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return subscribers;
};

/**
 * Query the per-link click records for a single issue (sk begins_with `link#`).
 */
const queryIssueLinks = async (issueId) => {
  const links = [];
  let lastEvaluatedKey;

  do {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :linkPrefix)',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
      ExpressionAttributeValues: marshall({ ':pk': issueId, ':linkPrefix': 'link#' }),
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    if (response.Items) {
      links.push(...response.Items.map((item) => unmarshall(item)));
    }
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return links
    .map((item) => ({
      url: item.url || item.link,
      clicks: n(item.clicks_total ?? item.count)
    }))
    .filter((l) => l.url);
};

/**
 * Builds the structured monthly report data for a single tenant by reading every
 * issue published within the reporting window, aggregating their stats, the top
 * links clicked across all of them, and subscriber growth across the month.
 *
 * Input: { tenant: { id, email }, month, monthLabel, periodStart, periodEnd }
 * Output: the input echoed plus `hasIssues` and (when issues exist) `reportData`.
 */
export const handler = async (state) => {
  const { tenant, month, monthLabel, periodStart, periodEnd } = state;
  const tenantId = tenant.id;

  const allIssues = await queryTenantIssues(tenantId);

  // Keep only issues actually sent within the reporting window. publishedAt is an
  // ISO8601 (Z) timestamp so lexical comparison against the window is safe.
  const monthIssues = allIssues
    .filter((issue) => {
      const publishedAt = issue.publishedAt;
      return publishedAt && publishedAt >= periodStart && publishedAt < periodEnd;
    })
    .sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1));

  if (monthIssues.length === 0) {
    return { tenant, month, monthLabel, periodStart, periodEnd, hasIssues: false };
  }

  const linkTotals = new Map(); // url -> { url, clicks, issues:Set }
  const issues = [];
  const abTests = [];

  const summary = {
    issuesSent: monthIssues.length,
    totalDelivered: 0,
    totalSends: 0,
    totalOpens: 0,
    totalUniqueOpens: 0,
    totalClicks: 0,
    totalBounces: 0,
    totalUnsubscribes: 0
  };

  for (const issue of monthIssues) {
    const issueNumber = Number(issue.pk?.split('#')[1]) || issue.pk?.split('#')[1] || 'N/A';
    const issueLinks = await queryIssueLinks(issue.pk);

    const issueClicks = issueLinks.reduce((sum, l) => sum + l.clicks, 0);
    for (const link of issueLinks) {
      const existing = linkTotals.get(link.url) || { url: link.url, clicks: 0, issues: new Set() };
      existing.clicks += link.clicks;
      existing.issues.add(issueNumber);
      linkTotals.set(link.url, existing);
    }

    const delivered = n(issue.deliveries);
    const sends = n(issue.sends);
    const opens = n(issue.opens);
    const uniqueOpens = n(issue.analytics?.currentMetrics?.uniqueOpens) || opens;
    const clicks = n(issue.clicks_total) || issueClicks;
    const bounces = n(issue.bounces);
    const unsubscribes = n(issue.unsubscribes);
    const subscribers = n(issue.subscribers);

    summary.totalDelivered += delivered;
    summary.totalSends += sends;
    summary.totalOpens += opens;
    summary.totalUniqueOpens += uniqueOpens;
    summary.totalClicks += clicks;
    summary.totalBounces += bounces;
    summary.totalUnsubscribes += unsubscribes;

    issues.push({
      id: String(issueNumber),
      issueNumber,
      subject: issue.subject || 'Untitled issue',
      publishedAt: issue.publishedAt,
      delivered,
      opens,
      uniqueOpens,
      clicks,
      bounces,
      unsubscribes,
      subscribers,
      openRate: pct(uniqueOpens, delivered),
      clickRate: pct(clicks, delivered),
      clickToOpenRate: pct(clicks, uniqueOpens),
      bounceRate: pct(bounces, sends)
    });

    const abEntry = buildAbTestEntry(issueNumber, issue.subject, issue.analytics?.abTest);
    if (abEntry) {
      abTests.push(abEntry);
    }
  }

  summary.avgOpenRate = pct(summary.totalUniqueOpens, summary.totalDelivered);
  summary.avgClickRate = pct(summary.totalClicks, summary.totalDelivered);
  summary.avgClickToOpenRate = pct(summary.totalClicks, summary.totalUniqueOpens);
  summary.avgBounceRate = pct(summary.totalBounces, summary.totalSends);

  // Subscriber growth across the month, derived from the per-issue snapshots.
  const startCount = n(monthIssues[0].subscribers);
  const endCount = n(monthIssues[monthIssues.length - 1].subscribers);
  const netChange = endCount - startCount;
  const subscriberGrowth = {
    startCount,
    endCount,
    netChange,
    growthRate: startCount > 0 ? round(((endCount - startCount) / startCount) * 100) : 0,
    byIssue: issues.map((i) => ({ issue: i.issueNumber, date: i.publishedAt, subscribers: i.subscribers }))
  };

  const topLinks = Array.from(linkTotals.values())
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5)
    .map((l) => ({
      url: l.url,
      clicks: l.clicks,
      label: linkLabel(l.url),
      issues: Array.from(l.issues)
    }));

  const bestBy = (selector) =>
    issues.reduce((best, cur) => (selector(cur) > selector(best) ? cur : best), issues[0]);

  const bestOpen = bestBy((i) => i.openRate);
  const bestClick = bestBy((i) => i.clickRate);
  const bestClicks = bestBy((i) => i.clicks);
  const bestIssue = {
    byOpenRate: { issueNumber: bestOpen.issueNumber, subject: bestOpen.subject, value: bestOpen.openRate },
    byClickRate: { issueNumber: bestClick.issueNumber, subject: bestClick.subject, value: bestClick.clickRate },
    byClicks: { issueNumber: bestClicks.issueNumber, subject: bestClicks.subject, value: bestClicks.clicks }
  };

  // Churn-risk summary (leading indicators). Additive and best-effort — never
  // fail the monthly report if the subscriber scan or classification errors.
  // Uses the highest published issue number as the "latest issue" reference so
  // recency is measured against the tenant's actual cadence.
  let atRiskSummary = null;
  try {
    const latestIssueNumber = allIssues.reduce((max, issue) => {
      if (!issue.publishedAt) return max;
      const num = Number(issue.pk?.split('#')[1]);
      return Number.isFinite(num) && num > max ? num : max;
    }, 0);

    if (latestIssueNumber > 0) {
      const subscribers = await queryTenantSubscribers(tenantId);
      atRiskSummary = summarizeAtRisk(subscribers, latestIssueNumber);
    }
  } catch (error) {
    console.warn('[MONTHLY-REPORT] At-risk summary failed, omitting:', error.message);
  }

  const reportData = { summary, subscriberGrowth, topLinks, issues, bestIssue, abTests };
  if (atRiskSummary) {
    reportData.atRiskSummary = atRiskSummary;
  }

  return {
    tenant,
    month,
    monthLabel,
    periodStart,
    periodEnd,
    hasIssues: true,
    reportData
  };
};
