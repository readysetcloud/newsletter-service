import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse, getTenant } from './utils/helpers.mjs';
import { getUserContext, formatAuthError } from './auth/get-user-context.mjs';
import { corsResponse } from './utils/cors-headers.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    // Extract user context from Lambda authorizer
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return corsResponse(400, { message: 'Tenant ID is required' });
    }

    const { timeframe = '30d' } = event.queryStringParameters || {};

    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return corsResponse(404, { message: 'Tenant not found' });
    }

    // Get recent newsletter issues
    const issues = await getRecentIssues(tenantId, timeframe);

    // Get subscriber metrics
    const subscriberMetrics = await getSubscriberMetrics(tenantId, timeframe);

    // Get performance overview
    const performanceOverview = getPerformanceOverview(issues);

    return corsResponse(200, {
      tenant: {
        name: tenant.name,
        subscribers: tenant.subscribers,
        totalIssues: issues.length
      },
      issues,
      subscriberMetrics,
      performanceOverview,
      timeframe
    });

  } catch (err) {
    console.error('Dashboard data error:', err);
    return corsResponse(500, { message: 'Failed to load dashboard data' });
  }
};

const getRecentIssues = async (tenantId, timeframe) => {
  const daysBack = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const queryCommand = new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: '#pk = :pk AND #sk >= :cutoff',
    ExpressionAttributeNames: {
      '#pk': 'GSI1PK',
      '#sk': 'GSI1SK'
    },
    ExpressionAttributeValues: {
      ':pk': { S: `${tenantId}#analytics` },
      ':cutoff': { S: cutoffDate.toISOString() }
    },
    ScanIndexForward: false,
    Limit: 20
  });

  const result = await ddb.send(queryCommand);
  return result.Items?.map(item => {
    const data = unmarshall(item);
    const issueSlug = data.pk.split('#')[1];
    return {
      id: issueSlug,
      slug: issueSlug,
      title: formatIssueTitle(issueSlug),
      sentDate: data.GSI1SK,
      metrics: data.currentMetrics,
      performance: data.performance
    };
  }) || [];
};

const formatIssueTitle = (slug) => {
  if (!slug) return 'Unknown Issue';

  // Extract issue number if it exists (e.g., "issue-123" -> "Issue #123")
  const issueMatch = slug.match(/issue-(\d+)/);
  if (issueMatch) {
    return `Issue #${issueMatch[1]}`;
  }

  // Otherwise, format the slug nicely
  return slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

const getSubscriberMetrics = async (tenantId, timeframe) => {
  // This would query historical subscriber data
  // For now, return mock structure
  return {
    current: 0,
    growth: {
      '7d': 0,
      '30d': 0,
      '90d': 0
    },
    churnRate: 0,
    engagementRate: 0
  };
};

const getPerformanceOverview = (issues) => {
  if (!issues.length) {
    return {
      avgOpenRate: 0,
      avgClickRate: 0,
      avgBounceRate: 0,
      totalSent: 0,
      bestPerformingIssue: null
    };
  }

  const totals = issues.reduce((acc, issue) => {
    const metrics = issue.metrics || {};
    return {
      openRate: acc.openRate + (metrics.openRate || 0),
      clickRate: acc.clickRate + (metrics.clickThroughRate || 0),
      bounceRate: acc.bounceRate + (metrics.bounceRate || 0),
      sent: acc.sent + (metrics.delivered || 0)
    };
  }, { openRate: 0, clickRate: 0, bounceRate: 0, sent: 0 });

  return {
    avgOpenRate: parseFloat((totals.openRate / issues.length).toFixed(2)),
    avgClickRate: parseFloat((totals.clickRate / issues.length).toFixed(2)),
    avgBounceRate: parseFloat((totals.bounceRate / issues.length).toFixed(2)),
    totalSent: totals.sent,
    bestPerformingIssue: issues.reduce((best, current) =>
      (current.metrics?.openRate || 0) > (best.metrics?.openRate || 0) ? current : best
    )
  };
};
