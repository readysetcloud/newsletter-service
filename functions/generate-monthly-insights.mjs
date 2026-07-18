import { z } from 'zod';
import { converse } from './utils/agents.mjs';

const MODEL_ID = process.env.MODEL_ID || 'us.amazon.nova-pro-v1:0';

const insightSchema = z.object({
  insights: z.array(
    z.object({
      type: z.string().describe('Short category, e.g. subject_lines, link_performance, growth, deliverability, cadence, engagement'),
      severity: z.enum(['info', 'watch', 'action']).describe('info = positive/FYI, watch = monitor, action = needs attention'),
      title: z.string().describe('Concise headline for the insight'),
      detail: z.string().describe('1-2 sentence explanation grounded in the provided data'),
      recommendation: z.string().describe('A specific, actionable next step').optional()
    })
  ).min(3).max(6)
});

/**
 * Builds a compact, model-friendly summary of the month so the LLM reasons over
 * concrete numbers rather than a large nested blob.
 */
const buildUserPrompt = (reportData, monthLabel) => {
  const { summary, subscriberGrowth, topLinks, issues, bestIssue, atRiskSummary } = reportData;

  const issueLines = issues
    .map((i) => `  #${i.issueNumber} "${i.subject}" — open ${i.openRate}%, click ${i.clickRate}%, CTOR ${i.clickToOpenRate}%, clicks ${i.clicks}, bounces ${i.bounceRate}%`)
    .join('\n');

  const linkLines = topLinks.length
    ? topLinks.map((l, idx) => `  ${idx + 1}. ${l.label} — ${l.clicks} clicks (${l.url})`).join('\n')
    : '  (no tracked link clicks this month)';

  // Churn-risk block (leading indicators). Omitted entirely when unavailable so
  // the model is never handed empty/placeholder churn data.
  const churnLines = atRiskSummary && atRiskSummary.total > 0
    ? [
        '',
        'Churn risk — subscribers showing leading indicators of disengagement:',
        `  At risk: ${atRiskSummary.total} (fading ${atRiskSummary.byReason.fading}, interests gone stale ${atRiskSummary.byReason.interestStale}, streak broken ${atRiskSummary.byReason.streakBreak})`,
        ...(atRiskSummary.examples?.length
          ? ['  Examples:', ...atRiskSummary.examples.map((e) => `    - ${e}`)]
          : [])
      ]
    : [];

  return [
    `Monthly newsletter performance for ${monthLabel}.`,
    '',
    'Totals:',
    `  Issues sent: ${summary.issuesSent}`,
    `  Delivered: ${summary.totalDelivered}, Opens: ${summary.totalOpens} (unique ${summary.totalUniqueOpens}), Clicks: ${summary.totalClicks}, Bounces: ${summary.totalBounces}, Unsubscribes: ${summary.totalUnsubscribes}`,
    `  Avg open rate: ${summary.avgOpenRate}%, Avg click rate: ${summary.avgClickRate}%, Avg click-to-open: ${summary.avgClickToOpenRate}%, Avg bounce rate: ${summary.avgBounceRate}%`,
    '',
    'Subscriber growth (from published-issue snapshots):',
    `  Start: ${subscriberGrowth.startCount}, End: ${subscriberGrowth.endCount}, Net: ${subscriberGrowth.netChange} (${subscriberGrowth.growthRate}%)`,
    '',
    'Top links clicked across all issues:',
    linkLines,
    '',
    'Per-issue performance (subject lines included for tone/topic analysis):',
    issueLines,
    '',
    'Best performers:',
    `  Highest open rate: #${bestIssue.byOpenRate.issueNumber} "${bestIssue.byOpenRate.subject}" (${bestIssue.byOpenRate.value}%)`,
    `  Highest click rate: #${bestIssue.byClickRate.issueNumber} "${bestIssue.byClickRate.subject}" (${bestIssue.byClickRate.value}%)`,
    `  Most clicks: #${bestIssue.byClicks.issueNumber} "${bestIssue.byClicks.subject}" (${bestIssue.byClicks.value})`,
    ...churnLines
  ].join('\n');
};

/**
 * Deterministic fallback so the report always has useful takeaways even when the
 * model call fails or returns nothing usable.
 */
const fallbackInsights = (reportData) => {
  const { summary, subscriberGrowth, topLinks, bestIssue } = reportData;
  const insights = [];

  insights.push({
    type: 'overview',
    severity: 'info',
    title: `${summary.issuesSent} issue${summary.issuesSent === 1 ? '' : 's'} sent this month`,
    detail: `Averaged a ${summary.avgOpenRate}% open rate and ${summary.avgClickRate}% click rate across ${summary.totalDelivered} delivered emails.`,
    recommendation: 'Keep your send cadence consistent to maintain engagement.'
  });

  insights.push({
    type: 'growth',
    severity: subscriberGrowth.netChange >= 0 ? 'info' : 'action',
    title: subscriberGrowth.netChange >= 0
      ? `List grew by ${subscriberGrowth.netChange} subscribers`
      : `List shrank by ${Math.abs(subscriberGrowth.netChange)} subscribers`,
    detail: `Subscribers moved from ${subscriberGrowth.startCount} to ${subscriberGrowth.endCount} (${subscriberGrowth.growthRate}%).`,
    recommendation: subscriberGrowth.netChange >= 0
      ? 'Double down on the channels driving signups.'
      : 'Add a referral or forward-to-a-friend ask to reverse the decline.'
  });

  if (topLinks.length) {
    insights.push({
      type: 'link_performance',
      severity: 'info',
      title: `"${topLinks[0].label}" was your most clicked link`,
      detail: `It earned ${topLinks[0].clicks} clicks across the month, leading the top ${topLinks.length} links.`,
      recommendation: 'Feature similar content/links prominently in upcoming issues.'
    });
  }

  insights.push({
    type: 'subject_lines',
    severity: 'info',
    title: `"${bestIssue.byOpenRate.subject}" had the best open rate`,
    detail: `Issue #${bestIssue.byOpenRate.issueNumber} reached a ${bestIssue.byOpenRate.value}% open rate.`,
    recommendation: 'Reuse the framing/structure of this subject line in future sends.'
  });

  if (summary.avgBounceRate >= 2) {
    insights.push({
      type: 'deliverability',
      severity: 'action',
      title: `Bounce rate is elevated at ${summary.avgBounceRate}%`,
      detail: 'Sustained bounce rates above 2% can harm sender reputation.',
      recommendation: 'Run list hygiene and suppress repeatedly bouncing addresses.'
    });
  }

  return insights.slice(0, 6);
};

/**
 * Generates professional, data-grounded insights for the monthly report using
 * Amazon Bedrock (Nova) via the shared converse() tool-use helper. Always returns
 * insights — it falls back to deterministic takeaways on any failure.
 *
 * Input: { reportData, month, monthLabel, tenantId }
 * Output: { insights: [...] }
 */
export const handler = async (state) => {
  const { reportData, monthLabel } = state;

  let captured = null;
  const toolDefs = [{
    name: 'submit_monthly_insights',
    description: 'Submit the final set of monthly newsletter insights.',
    schema: insightSchema,
    handler: (input) => { captured = input; return { success: true }; }
  }];

  const systemPrompt = [
    'Role: You are a senior newsletter analytics advisor for a professional newsletter platform.',
    'Task: Review one month of newsletter performance and produce 3-6 high-value, specific insights a publisher would expect from a premium analytics service.',
    'Cover a mix of: subject-line performance, which link types/topics earned the most and least clicks, engagement trends across issues, subscriber growth, deliverability/list health, and churn risk (subscribers showing leading indicators of disengagement) when that data is provided.',
    'Be concrete and reference the actual numbers and subject lines provided. Avoid generic filler.',
    'Output: Only call the submit_monthly_insights tool exactly once. Do not produce free-text output.'
  ].join('\n');

  try {
    await converse(MODEL_ID, systemPrompt, buildUserPrompt(reportData, monthLabel), toolDefs);
    if (captured?.insights?.length) {
      return { insights: captured.insights };
    }
    console.warn('[MONTHLY-INSIGHTS] Model returned no insights, using fallback');
  } catch (error) {
    console.warn('[MONTHLY-INSIGHTS] Bedrock call failed, using fallback:', error.message);
  }

  return { insights: fallbackInsights(reportData) };
};
