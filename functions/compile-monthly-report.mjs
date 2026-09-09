import Handlebars from 'handlebars';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  REPORT_STATUS,
  REPORT_TYPE,
  reportPartitionKey,
  reportSortKey
} from './utils/report-record.mjs';
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
 * Persists the finished report so the dashboard can retrieve it later, then —
 * for a scheduled report only — renders the email and publishes a Send Email
 * v2 event.
 *
 * Input: { tenant: { id, email }, reportId, reportType, deliverEmail,
 *          month, monthLabel, periodLabel, periodStart, periodEnd,
 *          reportData, insights }
 */
export const handler = async (event) => {
  const {
    tenant,
    month,
    monthLabel,
    periodStart,
    periodEnd,
    reportData,
    insights
  } = event;
  const tenantId = tenant.id;
  const generatedAt = new Date().toISOString();

  const reportType = event.reportType ?? REPORT_TYPE.MONTHLY;
  const isMonthly = reportType === REPORT_TYPE.MONTHLY;
  // A scheduled run identifies its report by the month it covers; an
  // on-demand one was given a id when it was requested.
  const reportId = event.reportId ?? month;
  const periodLabel = event.periodLabel ?? monthLabel;
  // Only the monthly job mails anything. An on-demand report is read in the
  // dashboard by the person who asked for it.
  const deliverEmail = event.deliverEmail ?? isMonthly;

  const report = { ...reportData, insights: Array.isArray(insights) ? insights : [] };

  // 1. Persist the report for the dashboard.
  //
  // An update rather than a put, for two reasons. An on-demand report already
  // exists as a `pending` row written when it was requested, and overwriting
  // it would drop who asked and when. And `createdAt` doubles as the ordering
  // key on GSI1, so it has to survive a rewrite: `if_not_exists` keeps the
  // original for a report that has one and stamps now for a scheduled report,
  // which has no earlier row.
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: reportPartitionKey(tenantId), sk: reportSortKey(reportId) }),
    UpdateExpression: [
      'SET #status = :status',
      'reportType = :reportType',
      'periodStart = :periodStart',
      'periodEnd = :periodEnd',
      'periodLabel = :periodLabel',
      'generatedAt = :generatedAt',
      'createdAt = if_not_exists(createdAt, :generatedAt)',
      'GSI1PK = :gsi1pk',
      'GSI1SK = if_not_exists(GSI1SK, :generatedAt)',
      '#report = :report',
      ...(isMonthly ? ['#month = :month', 'monthLabel = :monthLabel'] : [])
    ].join(', ')
      // A reason left by an earlier failed attempt must not outlive it.
      + ' REMOVE failureReason',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#report': 'report',
      ...(isMonthly ? { '#month': 'month' } : {})
    },
    ExpressionAttributeValues: marshall({
      ':status': REPORT_STATUS.COMPLETE,
      ':reportType': reportType,
      ':periodStart': periodStart,
      ':periodEnd': periodEnd,
      ':periodLabel': periodLabel,
      ':generatedAt': generatedAt,
      ':gsi1pk': reportPartitionKey(tenantId),
      ':report': report,
      ...(isMonthly ? { ':month': month, ':monthLabel': monthLabel } : {})
    }, { removeUndefinedValues: true })
  }));

  // 2. Send the report email to the tenant owner — scheduled reports only.
  //
  // An on-demand report is something a person asked for and is already
  // looking at; mailing it back to them is noise. The return is here, before
  // anything is rendered, because the template is the email and because a
  // report over a range with no issues in it has no figures to render at all.
  if (!deliverEmail) {
    return { success: true, reportId, reportType, emailed: false };
  }

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

  return { success: true, reportId, reportType, emailed: Boolean(recipient) };
};
