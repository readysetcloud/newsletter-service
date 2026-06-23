import Handlebars from 'handlebars';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import monthlyReportTemplate from '../templates/monthly-report.hbs';

const eventbridge = new EventBridgeClient();
const ddb = new DynamoDBClient();
const template = Handlebars.compile(monthlyReportTemplate);

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

Handlebars.registerHelper('num', (value) => n(value).toLocaleString('en-US'));
Handlebars.registerHelper('pct', (value) => `${n(value).toFixed(2)}%`);
Handlebars.registerHelper('signed', (value) => `${n(value) >= 0 ? '+' : ''}${n(value).toLocaleString('en-US')}`);

const severityColor = (severity) => {
  if (severity === 'action') return '#dc3545';
  if (severity === 'watch') return '#f0ad4e';
  return '#28a745';
};

const rankBadge = (index) => (index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`);

/**
 * Persists the finished monthly report so the dashboard can retrieve it later,
 * then renders the report email and publishes a Send Email v2 event.
 *
 * Input: { tenant: { id, email }, month, monthLabel, periodStart, periodEnd, reportData, insights }
 */
export const handler = async (event) => {
  const { tenant, month, monthLabel, periodStart, periodEnd, reportData, insights } = event;
  const tenantId = tenant.id;
  const generatedAt = new Date().toISOString();

  const report = { ...reportData, insights: Array.isArray(insights) ? insights : [] };

  // 1. Persist the report for the dashboard (pk = `${tenantId}#report`, sk = `monthly#${month}`).
  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({
      pk: `${tenantId}#report`,
      sk: `monthly#${month}`,
      GSI1PK: `${tenantId}#report`,
      GSI1SK: `monthly#${month}`,
      reportType: 'monthly',
      month,
      monthLabel,
      periodStart,
      periodEnd,
      generatedAt,
      report
    }, { removeUndefinedValues: true })
  }));

  // 2. Render the email.
  const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL || process.env.ORIGIN || '';
  const normalizedBase = dashboardBaseUrl ? dashboardBaseUrl.replace(/\/+$/, '') : '';
  const reportUrl = normalizedBase ? `${normalizedBase}/reports/${month}` : null;

  const { summary, subscriberGrowth, topLinks, issues, bestIssue, abTests = [] } = report;

  const templateData = {
    monthLabel,
    reportUrl,
    generatedDate: new Date(generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    summaryStats: [
      { label: 'Issues sent', value: n(summary.issuesSent).toLocaleString('en-US') },
      { label: 'Emails delivered', value: n(summary.totalDelivered).toLocaleString('en-US') },
      { label: 'Total clicks', value: n(summary.totalClicks).toLocaleString('en-US') },
      { label: 'Avg. open rate', value: `${n(summary.avgOpenRate).toFixed(2)}%` },
      { label: 'Avg. click rate', value: `${n(summary.avgClickRate).toFixed(2)}%` },
      { label: 'Avg. click-to-open', value: `${n(summary.avgClickToOpenRate).toFixed(2)}%` },
      { label: 'Avg. bounce rate', value: `${n(summary.avgBounceRate).toFixed(2)}%` }
    ],
    subscriberGrowth: {
      startCount: n(subscriberGrowth.startCount).toLocaleString('en-US'),
      endCount: n(subscriberGrowth.endCount).toLocaleString('en-US'),
      netChange: `${n(subscriberGrowth.netChange) >= 0 ? '+' : ''}${n(subscriberGrowth.netChange).toLocaleString('en-US')}`,
      growthRate: `${n(subscriberGrowth.growthRate) >= 0 ? '+' : ''}${n(subscriberGrowth.growthRate).toFixed(2)}%`,
      color: n(subscriberGrowth.netChange) >= 0 ? '#28a745' : '#dc3545'
    },
    topLinks: topLinks.map((link, index) => ({
      rank: rankBadge(index),
      label: link.label,
      url: link.url,
      clicks: n(link.clicks).toLocaleString('en-US'),
      issueCount: Array.isArray(link.issues) ? link.issues.length : 0
    })),
    hasTopLinks: topLinks.length > 0,
    issues: issues.map((issue) => ({
      issueNumber: issue.issueNumber,
      subject: issue.subject,
      openRate: `${n(issue.openRate).toFixed(2)}%`,
      clickRate: `${n(issue.clickRate).toFixed(2)}%`,
      clicks: n(issue.clicks).toLocaleString('en-US')
    })),
    bestIssue: {
      openSubject: bestIssue.byOpenRate.subject,
      openValue: `${n(bestIssue.byOpenRate.value).toFixed(2)}%`,
      clickSubject: bestIssue.byClickRate.subject,
      clickValue: `${n(bestIssue.byClickRate.value).toFixed(2)}%`,
      clicksSubject: bestIssue.byClicks.subject,
      clicksValue: n(bestIssue.byClicks.value).toLocaleString('en-US')
    },
    insights: report.insights.map((insight) => ({
      ...insight,
      color: severityColor(insight.severity)
    })),
    hasInsights: report.insights.length > 0,
    abTests: abTests.map((test) => ({
      issueNumber: test.issueNumber,
      subject: test.subject,
      dimensionLabel: test.dimension === 'sendTime' ? 'Send time' : 'Subject line',
      winMetricLabel: test.winMetric === 'clickRate' ? 'click rate' : 'open rate',
      outcome:
        test.status === 'inconclusive'
          ? 'Inconclusive'
          : test.winnerVariantId
            ? `Variant ${test.winnerVariantId.toUpperCase()} won`
            : 'In progress',
      significanceText:
        test.status === 'inconclusive'
          ? 'No significant difference — control was sent'
          : test.significant
            ? `Significant${test.confidence != null ? ` at ${Math.round(n(test.confidence) * 100)}% confidence` : ''}`
            : 'Not yet significant',
      liftText: test.lift != null ? `${n(test.lift) >= 0 ? '+' : ''}${n(test.lift).toFixed(2)} pts` : '—',
      variants: (test.variants || []).map((v) => ({
        variantId: String(v.variantId).toUpperCase(),
        label: v.label,
        openRate: `${n(v.openRate).toFixed(2)}%`,
        clickRate: `${n(v.clickRate).toFixed(2)}%`,
        isWinner: Boolean(v.isWinner)
      }))
    })),
    hasAbTests: abTests.length > 0
  };

  const html = template(templateData);

  // 3. Send the report email to the tenant owner (if we have an address).
  const recipient = tenant.email;
  if (recipient) {
    await eventbridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'newsletter-service',
        DetailType: 'Send Email v2',
        Detail: JSON.stringify({
          subject: `📊 Your ${monthLabel} newsletter report`,
          to: { email: recipient },
          html,
          tenantId
        })
      }]
    }));
  } else {
    console.warn(`[MONTHLY-REPORT] No recipient email for tenant ${tenantId}; report persisted but email skipped`);
  }

  return { success: true, month, emailed: Boolean(recipient) };
};
