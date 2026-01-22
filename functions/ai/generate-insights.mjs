import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient, QueryCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { createInsightsTool } from "./tools.mjs";
import { converse } from '../utils/agents.mjs';

const logger = new Logger({ serviceName: 'agents' });
const ddb = new DynamoDBClient();

export const handler = async (state) => {
  const { insightData, tenantId, issueId, subjectLine } = state;
  const historicalData = await getHistoricalData(tenantId, issueId);

  const systemPrompt = `## Role
You are an analytics assistant for the Ready, Set, Cloud newsletter. Your job is to generate concise, actionable week-over-week insights from newsletter performance JSON.

## Input
You will receive:
1) "Issue Id": identifier to provide to the createInsightsTool
2) "Subject Line": the email subject line for this issue
3) "Current Issue Data": analytics JSON for the current newsletter issue including:
   - currentMetrics: core performance metrics (open rate, CTR, CTOR, bounce rate, growth rate, etc.)
   - benchmarks: 3-week rolling averages for comparison (openRateAvg3, ctrAvg3, bounceRateAvg3, growthRateAvg3)
   - healthScore: overall health assessment with score (0-100), status (Great/OK/Needs Attention), and summary
   - contentPerformance: click distribution analysis (topLinkPct, top3Pct, longTailPct, concentration level)
   - listHealth: deliverability metrics (deliverabilityRate, bounceRateStatus, cleanedPct, healthSummary)
   - engagementQuality: deeper engagement metrics (clicksPerOpener, clicksPerSubscriber, opensFirst1hPct, opensFirst6hPct)
   - trends: historical performance over last 4 issues with rolling averages and best-in-last-4 values
4) "Historical Issues": an array of prior issues in the same (or very similar) shape

Some fields may be missing. Use what is available. Do not invent exact metric values.

## Steps
1) Parse "Current Issue Data" and analyze performance using the enhanced data structure:
   - Review healthScore for overall status and key concerns
   - Compare current metrics against benchmarks (3-week averages) to identify significant deviations
   - Analyze contentPerformance to understand engagement patterns (concentrated vs broad)
   - Check listHealth for deliverability concerns or list quality issues
   - Examine engagementQuality for subscriber behavior patterns
   - Review trends data to identify patterns over the last 4 issues
   - Consider the subject line effectiveness based on open rate performance
2) Compare "Current Issue Data" against "Historical Issues" for additional context
3) Generate 2-5 insights that are:
   - specific to the metrics provided, leveraging the new benchmark and health data
   - actionable within the next issue (subject, structure, content mix, link strategy, deliverability/list hygiene)
   - phrased as a recommendation + short rationale tied to observed data
   - prioritized based on healthScore status and benchmark deviations
4) Focus on:
   - Metrics significantly above or below benchmarks (>10% deviation)
   - Health score concerns (if status is "Needs Attention" or "OK")
   - Content performance patterns (highly concentrated vs broad distribution)
   - List health issues (bounce rate elevated/high, low deliverability)
   - Engagement quality signals (low clicks per opener, slow open velocity)
   - Trend patterns (consistent decline, improvement, volatility)
   - Subject line effectiveness (if open rate is significantly different from benchmark, consider subject line impact)
5) Avoid generic advice. Each insight must reference at least one concrete metric or comparative observation (e.g., "Open rate 15% below 3-week average" or "Top link captured 60% of clicks indicating highly concentrated engagement").
6) Do not output more than 5 insights. Do not output fewer than 2 insights unless data is severely incomplete (then output 2 best-effort insights).
7) Do not mention internal IDs like pk/sk/GSI keys. Do not include raw URLs unless the topPerformingLink is directly relevant to an insight.

## Expectation
You MUST call the tool createInsights exactly once.
The tool payload must match this schema:
{
  "issueId": string,
  "insights": string[] // 2 to 5 items
}

## Narrowing / Output Rules
- Output ONLY a createInsights tool call (no prose, no markdown, no analysis).
- Keep each insight to 1-2 sentences. Prefer direct language.
- If "Historical Issues" is empty, generate insights from "Current Issue Data" using benchmarks and health score (still actionable).
- Prioritize insights based on health score status and benchmark deviations.
- When subject line is provided and open rate deviates significantly from benchmark, consider mentioning subject line effectiveness.
`;

  const userPrompt = `## Issue Id: ${issueId}

## Subject Line: ${subjectLine || 'N/A'}

## Current Issue Data
${JSON.stringify(insightData, null, 2)}

## Historical Issues
${JSON.stringify(historicalData ?? [], null, 2)}
`;

  await converse(process.env.MODEL_ID, systemPrompt, userPrompt, [createInsightsTool], { tenantId });
  const insights = await loadInsights(tenantId, issueId);

  return {
    insights: insights || []
  };
};

const getHistoricalData = async (tenantId, issueId) => {
  const queryCommand = new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: {
      '#pk': 'GSI1PK'
    },
    ExpressionAttributeValues: {
      ':pk': { S: `${tenantId}#analytics` }
    },
    ScanIndexForward: false,
    Limit: 4
  });

  const queryResults = await ddb.send(queryCommand);

  const thisIssue = `${tenantId}#${issueId}`;
  const items = queryResults.Items ?? [];
  const historicalData = items.filter(item => item.pk.S !== thisIssue).map(item => {
    const data = unmarshall(item);
    data.deliveredDate = data.GSI1SK;
    delete data.sk;
    delete data.GSI1PK;
    delete data.GSI1SK;
    delete data.pk;

    return data;
  }).slice(0, 3);
  return historicalData;
};

const loadInsights = async (tenantId, issueId) => {
  const analytics = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: `${tenantId}#${issueId}`,
      sk: 'analytics'
    }),
    ConsistentRead: true
  }));

  if (!analytics.Item) {
    logger.warn('Analytics were not generated for this issue', { tenantId, issueId });
    return;
  }

  const data = unmarshall(analytics.Item);

  if (!data.insights || data.insights.length === 0) {
    logger.warn('Insights were not generated for this issue', { tenantId, issueId });
    return [];
  }

  return data.insights;
};
