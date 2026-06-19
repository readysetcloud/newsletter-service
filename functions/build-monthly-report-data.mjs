import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (num, den) => (den > 0 ? Number(((n(num) / n(den)) * 100).toFixed(2)) : 0);
const round = (v) => Number(n(v).toFixed(2));

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

  return {
    tenant,
    month,
    monthLabel,
    periodStart,
    periodEnd,
    hasIssues: true,
    reportData: { summary, subscriberGrowth, topLinks, issues, bestIssue }
  };
};
