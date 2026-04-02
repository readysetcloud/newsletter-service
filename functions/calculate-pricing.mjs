import { DynamoDBClient, QueryCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { z } from 'zod';
import { converse } from './utils/agents.mjs';
import {
  computeBaseline,
  clampMultiplier,
  applySmoothing,
  determineConfidence,
  validateLlmResponse,
  computeMetricAverages,
  computeCadenceStats,
  buildTrendSummary,
  computeSubscriberGrowthRate,
  computeWeeklyWindow,
  computeRecommendedPrice,
  computePricingChecksum
} from './utils/pricing.mjs';

const ddb = new DynamoDBClient();

const TABLE_NAME = process.env.TABLE_NAME;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID;
const LOG_MODEL_INPUTS = process.env.LOG_MODEL_INPUTS === 'true';

const DEFAULT_PRICING_CONFIG = {
  cpmRate: 5,
  multiplierMin: 0.5,
  multiplierMax: 3.0,
  clickWeight: 2.0,
  smoothingCapPct: 0.20,
  significantSubscriberChangePct: 0.25,
  significantOpenRateChangePts: 10,
  minPublishedIssues: 3,
  cadenceRegularityThreshold: 3,
  dataRecencyThresholdDays: 30,
  // Cross-industry medians from MailerLite 2025 Email Marketing Benchmarks
  // (3.6M campaigns, 181K accounts, Dec 2024 – Nov 2025)
  // Source: https://www.mailerlite.com/blog/compare-your-email-performance-metrics-industry-benchmarks
  industryAvgOpenRate: 0.4346,
  industryAvgClickRate: 0.0209,
  industryAvgUnsubscribeRate: 0.0022,
  pricingModelVersion: 'v2'
};

async function loadPricingConfig() {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk = :sk',
    ExpressionAttributeValues: marshall({ ':pk': 'system', ':sk': 'pricing-config' })
  }));
  if (!result.Items || result.Items.length === 0) {
    console.warn('[CONFIG] No pricing-config found, using defaults');
    return { ...DEFAULT_PRICING_CONFIG };
  }
  return { ...DEFAULT_PRICING_CONFIG, ...unmarshall(result.Items[0]) };
}

// ---------------------------------------------------------------------------
// Metrics Collection
// ---------------------------------------------------------------------------

async function getRecentPublishedIssues(tenantId, limit = 10) {
  const issues = [];
  let lastKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: 'statsPhase = :phase',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': `${tenantId}#issue`,
        ':phase': 'consolidated'
      }),
      ScanIndexForward: false,
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));
    if (result.Items) {
      for (const item of result.Items) {
        issues.push(unmarshall(item));
        if (issues.length >= limit) break;
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && issues.length < limit);
  return issues.slice(0, limit);
}

/**
 * Extract per-issue metrics from a consolidated stats record.
 * analytics.currentMetrics stores rates as percentages (0-100); we normalize to ratios (0-1).
 */
function extractIssueMetrics(statsRecord) {
  const cm = statsRecord.analytics?.currentMetrics;
  const publishedAt = statsRecord.publishedAt || statsRecord.createdAt || null;

  if (cm) {
    return {
      openRate: (cm.openRate ?? 0) / 100,
      clickRate: (cm.clickThroughRate ?? 0) / 100,
      bounceRate: (cm.bounceRate ?? 0) / 100,
      complaintRate: (cm.complaintRate ?? 0) / 100,
      subscribers: cm.subscribers ?? statsRecord.subscribers ?? 0,
      publishedAt
    };
  }

  const delivered = statsRecord.deliveries || statsRecord.subscribers || 1;
  return {
    openRate: delivered > 0 ? (statsRecord.opens || 0) / delivered : 0,
    clickRate: delivered > 0 ? (statsRecord.clicks || 0) / delivered : 0,
    bounceRate: delivered > 0 ? (statsRecord.bounces || 0) / delivered : 0,
    complaintRate: delivered > 0 ? (statsRecord.complaints || 0) / delivered : 0,
    subscribers: statsRecord.subscribers ?? 0,
    publishedAt
  };
}

/**
 * Load issue records, extract per-issue data, compute trends and averages.
 */
async function collectMetrics(tenantId) {
  const recentIssues = await getRecentPublishedIssues(tenantId, 10);
  if (recentIssues.length === 0) {
    throw new Error('At least one published issue with analytics is required');
  }

  const issueMetrics = recentIssues.map(extractIssueMetrics);
  const subscriberCount = issueMetrics[0].subscribers;
  if (!subscriberCount) {
    throw new Error('Subscribers are required before pricing can be calculated');
  }

  // Chronological (oldest -> newest) for trend analysis.
  const chronological = [...issueMetrics].reverse();
  const averages = computeMetricAverages(chronological);
  const trendSummary = buildTrendSummary(chronological);
  const publishedAtValues = chronological.map(m => m.publishedAt).filter(Boolean);
  const cadenceStats = computeCadenceStats(publishedAtValues);
  const latestPublishedAt = publishedAtValues.length > 0
    ? publishedAtValues[publishedAtValues.length - 1]
    : null;

  const subCounts = chronological.map(m => m.subscribers).filter(s => s > 0);
  const subscriberGrowthRate = subCounts.length >= 2
    ? computeSubscriberGrowthRate(subCounts[subCounts.length - 1], subCounts[0])
    : 0;

  return {
    subscriberCount,
    subscriberGrowthRate,
    publishedIssueCount: issueMetrics.length,
    latestPublishedAt,
    issueDataPoints: chronological,
    ...averages,
    ...trendSummary,
    ...cadenceStats
  };
}

// ---------------------------------------------------------------------------
// LLM Prompt Construction
// ---------------------------------------------------------------------------

function fmtPct(value, digits = 1) {
  return `${((value || 0) * 100).toFixed(digits)}%`;
}

function fmtSlope(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)} pts/issue`;
}

function stringifyAnswer(answer) {
  if (Array.isArray(answer)) return answer.join(', ');
  if (answer && typeof answer === 'object') return JSON.stringify(answer);
  return String(answer);
}

function sanitizeQuestionnaireResponses(responses) {
  if (!responses) return responses;
  const sanitized = {};
  for (const [key, answer] of Object.entries(responses)) {
    if (Array.isArray(answer)) sanitized[key] = `[REDACTED_ARRAY_${answer.length}]`;
    else if (answer && typeof answer === 'object') sanitized[key] = '[REDACTED_OBJECT]';
    else sanitized[key] = '[REDACTED]';
  }
  return sanitized;
}

function maybeRedactPrompt(prompt) {
  const marker = '## Creator Questionnaire Responses';
  const start = prompt.indexOf(marker);
  if (start === -1) return prompt;
  const instructionsIndex = prompt.indexOf('## Instructions', start);
  const before = prompt.slice(0, start);
  const after = instructionsIndex >= 0 ? prompt.slice(instructionsIndex) : '';
  return `${before}${marker}\n- [REDACTED FOR LOGGING]\n\n${after}`.trim();
}

function logModelRequest(label, modelId, systemPrompt, userPrompt) {
  if (!LOG_MODEL_INPUTS) return;
  console.log(`[LLM] ${label} request`, JSON.stringify({
    modelId, systemPrompt, userPrompt: maybeRedactPrompt(userPrompt)
  }));
}

/**
 * Build the LLM prompt with per-issue data points plus computed trends.
 */
export function buildPrompt(metrics, baselinePrice, questionnaireResponses, previousRecord, config) {
  const lines = [
    '## Deterministic Baseline',
    `We calculated a baseline sponsorship price of $${baselinePrice.toFixed(2)} using subscriber count, open rate, CPM, and click rate.`,
    `The baseline already includes an engagement multiplier driven by click rate with clickWeight=${config.clickWeight}.`,
    'Your job is to evaluate the context below, then provide a multiplier to adjust this baseline price up or down.',
    '',
    '## Per-Issue Data (oldest to newest)',
    'Each row is one published issue: subscribers, open rate, click rate, bounce rate, complaint rate, published date.',
    ''
  ];

  for (const dp of metrics.issueDataPoints) {
    lines.push(
      `- Subs: ${dp.subscribers} | Open: ${fmtPct(dp.openRate)} | Click: ${fmtPct(dp.clickRate)} | Bounce: ${fmtPct(dp.bounceRate)} | Complaint: ${fmtPct(dp.complaintRate, 4)} | Date: ${dp.publishedAt ?? 'unknown'}`
    );
  }

  const oldestDate = metrics.issueDataPoints[0]?.publishedAt ?? 'unknown';
  const newestDate = metrics.issueDataPoints[metrics.issueDataPoints.length - 1]?.publishedAt ?? 'unknown';

  lines.push(
    '',
    '## Summary',
    `- Data period: ${oldestDate} to ${newestDate}`,
    `- Current subscriber count: ${metrics.subscriberCount}`,
    `- Subscriber growth rate: ${fmtPct(metrics.subscriberGrowthRate)}`,
    `- Average open rate: ${fmtPct(metrics.avgOpenRate)}`,
    `- Average click rate: ${fmtPct(metrics.avgClickRate)}`,
    `- Average bounce rate: ${fmtPct(metrics.avgBounceRate)}`,
    `- Average complaint rate: ${fmtPct(metrics.avgComplaintRate, 4)}`,
    `- Published issues with analytics: ${metrics.publishedIssueCount}`,
    '',
    '## Trends',
    `- Open rate trend: ${fmtPct(metrics.recentTrend.openRate.first)} -> ${fmtPct(metrics.recentTrend.openRate.last)} (${fmtSlope(metrics.recentTrend.openRate.slopePerIssue)})`,
    `- Click rate trend: ${fmtPct(metrics.recentTrend.clickRate.first)} -> ${fmtPct(metrics.recentTrend.clickRate.last)} (${fmtSlope(metrics.recentTrend.clickRate.slopePerIssue)})`,
    `- Open rate CoV: ${fmtPct(metrics.volatility.openRateCoV, 2)}`,
    `- Click rate CoV: ${fmtPct(metrics.volatility.clickRateCoV, 2)}`,
    '',
    '## Cadence',
    `- Average days between issues: ${metrics.averageDaysBetweenIssues ?? 'unknown'}`,
    `- Median days between issues: ${metrics.medianDaysBetweenIssues ?? 'unknown'}`,
    `- Cadence standard deviation: ${metrics.cadenceStdDevDays ?? 'unknown'} days`,
    '',
    '## Market Benchmarks',
    `- Industry average open rate: ${fmtPct(config.industryAvgOpenRate)}`,
    `- Industry average click rate: ${fmtPct(config.industryAvgClickRate)}`,
    `- Industry average unsubscribe rate: ${fmtPct(config.industryAvgUnsubscribeRate)}`,
    '',
    '## Modeling Guidance',
    '- Click rate is a conversion signal and the strongest sponsor ROI indicator.',
    '- Click rate is already part of the baseline, so adjust primarily on trajectory, stability, and questionnaire context.',
    '- Reward upward trends, consistent cadence, and recent data. Penalize stale, volatile, or irregular performance.'
  );

  if (previousRecord) {
    lines.push(
      '',
      '## Previous Pricing',
      `- Previous recommended price: $${previousRecord.recommendedPrice?.toFixed(2) ?? 'N/A'}`,
      `- Previous multiplier: ${previousRecord.multiplierSmoothed ?? previousRecord.multiplierClamped ?? 'N/A'}`,
      `- Previous confidence: ${previousRecord.confidence ?? 'N/A'}`
    );
  }

  if (questionnaireResponses && Object.keys(questionnaireResponses).length > 0) {
    lines.push('', '## Creator Questionnaire Responses');
    for (const [questionId, answer] of Object.entries(questionnaireResponses)) {
      lines.push(`- ${questionId}: ${stringifyAnswer(answer)}`);
    }
  }

  lines.push(
    '',
    '## Instructions',
    'Given the baseline price above and the metrics provided, determine how the price should be adjusted.',
    'A multiplier of 1.0 means no change. Above 1.0 increases the price, below 1.0 decreases it.',
    'Use questionnaire responses as qualitative context when they exist, especially for audience quality, niche specificity, sponsorship format, and monetization goals.',
    'Use the submit_pricing_adjustment tool to provide your multiplier, confidence level, and justification.'
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Confidence & Smoothing helpers
// ---------------------------------------------------------------------------

export function selectSmoothingBaseRecord(previousRecord, currentWeekWindow) {
  return previousRecord && previousRecord.weekWindow !== currentWeekWindow
    ? previousRecord
    : null;
}

export function evaluatePricingConfidence(metrics, questionnaireResponses, usedFallback, config, now = new Date()) {
  const hasQuestionnaire = questionnaireResponses != null && Object.keys(questionnaireResponses).length > 0;
  const metricsComplete = (
    metrics.avgOpenRate != null &&
    metrics.avgClickRate != null &&
    metrics.avgBounceRate != null &&
    metrics.avgComplaintRate != null
  );
  const openRateCoV = metrics.volatility.openRateCoV;
  const dataAgeDays = metrics.latestPublishedAt
    ? (now.getTime() - new Date(metrics.latestPublishedAt).getTime()) / (24 * 60 * 60 * 1000)
    : Number.POSITIVE_INFINITY;
  const isCadenceIrregular = (metrics.cadenceStdDevDays ?? Number.POSITIVE_INFINITY) > config.cadenceRegularityThreshold;
  const isDataStale = dataAgeDays > config.dataRecencyThresholdDays;

  return {
    hasQuestionnaire,
    metricsComplete,
    isCadenceIrregular,
    isDataStale,
    confidence: determineConfidence({
      publishedIssueCount: metrics.publishedIssueCount,
      metricsComplete,
      hasQuestionnaire,
      stabilityCoV: openRateCoV,
      isFallback: usedFallback,
      isCadenceIrregular,
      isDataStale
    })
  };
}

export function computeConfidenceOverride(llmConfidence, finalConfidence) {
  if (!llmConfidence) return false;
  return llmConfidence !== finalConfidence;
}

// ---------------------------------------------------------------------------
// Bedrock LLM calls
// ---------------------------------------------------------------------------

const pricingAdjustmentSchema = z.object({
  multiplier: z.number().describe('Adjustment factor to apply to the baseline price'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level of the pricing recommendation'),
  justification: z.string().describe('Plain-language explanation referencing specific metrics')
});

const sponsorNarrativeSchema = z.object({
  narrative: z.string().describe('A short, professional paragraph (2-4 sentences) for potential sponsors describing the value of advertising in this newsletter')
});

async function callBedrock(prompt) {
  let captured = null;
  const toolDefs = [{
    name: 'submit_pricing_adjustment',
    description: 'Submit the pricing multiplier, confidence level, and justification for the newsletter sponsorship pricing calculation.',
    schema: pricingAdjustmentSchema,
    handler: (input) => { captured = input; return { success: true }; }
  }];

  try {
    const systemPrompt = [
      'Role: You are a newsletter sponsorship pricing expert with deep knowledge of digital advertising CPM models and audience valuation.',
      'Instructions: Analyze the provided newsletter metrics, historical pricing data, and any creator questionnaire responses to determine a fair sponsorship pricing adjustment.',
      'Steps: 1) Evaluate subscriber count, growth trajectory, cadence, recency, and engagement rates against the supplied benchmarks. 2) Treat click-through rate as a conversion signal and the strongest sponsor ROI indicator in the data. 3) Remember the baseline already incorporates average click rate, so adjust primarily on trajectory, stability, and questionnaire-specific context. 4) Compare against the deterministic baseline price and any previous pricing records. 5) Use the submit_pricing_adjustment tool to return your recommendation.',
      'End goal: Produce a well-calibrated pricing multiplier that reflects the newsletter\'s true sponsorship value, along with a confidence level and a justification grounded in the specific metrics provided.',
      'Narrowing: Only use the submit_pricing_adjustment tool to respond. Do not produce free-text output. The multiplier should be a positive number. Confidence must be exactly one of "low", "medium", or "high". The justification must reference specific metrics from the input.'
    ].join('\n');
    logModelRequest('pricing-adjustment', BEDROCK_MODEL_ID, systemPrompt, prompt);
    await converse(BEDROCK_MODEL_ID, systemPrompt, prompt, toolDefs);
    if (!captured) throw new Error('LLM did not call the submit_pricing_adjustment tool');
    return { llmResponse: captured, isFallback: false };
  } catch (error) {
    console.warn('[LLM] Bedrock call failed, using deterministic fallback:', error.message);
    return {
      llmResponse: {
        multiplier: 1.0,
        confidence: 'low',
        justification: 'This price is based on the deterministic baseline calculation. The AI-powered adjustment was unavailable during this calculation cycle.'
      },
      isFallback: true
    };
  }
}

async function generateSponsorNarrative(metrics) {
  let captured = null;
  const toolDefs = [{
    name: 'submit_sponsor_narrative',
    description: 'Submit the sponsor-facing value narrative paragraph.',
    schema: sponsorNarrativeSchema,
    handler: (input) => { captured = input; return { success: true }; }
  }];

  const systemPrompt = [
    'Role: You are a professional copywriter specializing in newsletter sponsorship pitches for B2B and B2C audiences.',
    'Instructions: Craft a concise, sponsor-facing value narrative based on the provided newsletter performance data. Summarize metrics qualitatively rather than citing raw numbers.',
    'Steps: 1) Assess the audience size and engagement signals. 2) Frame the newsletter\'s reach and reader loyalty as a compelling advertising opportunity. 3) Use the submit_sponsor_narrative tool to return the narrative.',
    'End goal: A polished 2-4 sentence paragraph that a sales team could use directly in sponsor outreach, conveying confidence in the newsletter\'s advertising value.',
    'Narrowing: Only use the submit_sponsor_narrative tool to respond. Do not produce free-text output. Do not include raw numbers, percentages, or pricing figures. Keep the tone confident but not hyperbolic.'
  ].join('\n');
  const userPrompt = [
    'Write a short, professional paragraph (2-4 sentences) for potential sponsors describing the value of advertising in this newsletter.',
    'Use the following data points to support the pitch. Do NOT include raw numbers or percentages - summarize them qualitatively.',
    '',
    `Subscriber count: ${metrics.subscriberCount}`,
    `Average open rate: ${(metrics.avgOpenRate * 100).toFixed(1)}%`,
    `Average click-through rate: ${(metrics.avgClickRate * 100).toFixed(1)}%`,
    `Subscriber growth rate: ${(metrics.subscriberGrowthRate * 100).toFixed(1)}%`,
    `Published issues analyzed: ${metrics.publishedIssueCount}`,
    '',
    'The tone should be confident but not hyperbolic. Focus on audience engagement and reach.'
  ].join('\n');

  logModelRequest('sponsor-narrative', BEDROCK_MODEL_ID, systemPrompt, userPrompt);
  await converse(BEDROCK_MODEL_ID, systemPrompt, userPrompt, toolDefs);
  if (!captured || !captured.narrative || captured.narrative.length < 20) {
    console.warn('[NARRATIVE] Response too short or empty');
    return null;
  }
  return captured.narrative;
}

// ---------------------------------------------------------------------------
// DynamoDB helpers
// ---------------------------------------------------------------------------

async function getPreviousPricingRecord(tenantId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: marshall({ ':pk': tenantId, ':skPrefix': 'pricing#' }),
    ScanIndexForward: false,
    Limit: 1
  }));
  if (!result.Items || result.Items.length === 0) return null;
  return unmarshall(result.Items[0]);
}

async function getExistingRecordForWindow(tenantId, weekWindow) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    FilterExpression: 'weekWindow = :weekWindow',
    ExpressionAttributeValues: marshall({ ':pk': tenantId, ':skPrefix': 'pricing#', ':weekWindow': weekWindow }),
    ScanIndexForward: false
  }));
  if (!result.Items || result.Items.length === 0) return null;
  return unmarshall(result.Items[0]);
}

async function updateJobStatus(tenantId, jobId, status, result, error) {
  const now = new Date().toISOString();
  const updateParts = ['#status = :status', 'updatedAt = :now'];
  const exprNames = { '#status': 'status' };
  const exprValues = { ':status': status, ':now': now };
  if (result) { updateParts.push('#result = :result'); exprNames['#result'] = 'result'; exprValues[':result'] = result; }
  if (error) { updateParts.push('#error = :error'); exprNames['#error'] = 'error'; exprValues[':error'] = error; }
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: tenantId, sk: `pricing-job#${jobId}` }),
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: marshall(exprValues)
  }));
}

async function storePricingRecord(tenantId, record, existingRecordSk) {
  if (existingRecordSk) {
    await ddb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({ pk: tenantId, sk: existingRecordSk, ...record }, { removeUndefinedValues: true })
    }));
    return existingRecordSk;
  }
  const sk = `pricing#${record.calculatedAt}`;
  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({ pk: tenantId, sk, ...record }, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    }));
    return sk;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn('[STORE] Record already exists for this timestamp, updating');
      await ddb.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({ pk: tenantId, sk, ...record }, { removeUndefinedValues: true })
      }));
      return sk;
    }
    throw err;
  }
}

async function loadQuestionnaireResponses(tenantId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk = :sk',
    ExpressionAttributeValues: marshall({ ':pk': tenantId, ':sk': 'pricing-questionnaire' })
  }));
  if (!result.Items || result.Items.length === 0) return null;
  return unmarshall(result.Items[0]);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (event) => {
  const executionStart = Date.now();
  const detail = event.detail || event;
  const { tenantId, questionnaireResponses: eventResponses, jobId, isWeeklyJob } = detail;

  console.log('[PRICING] Starting calculation', { tenantId, jobId, isWeeklyJob });
  if (!tenantId) throw new Error('tenantId is required');

  try {
    const config = await loadPricingConfig();
    const previousRecord = await getPreviousPricingRecord(tenantId);
    const metrics = await collectMetrics(tenantId);
    const metricsAsOf = new Date().toISOString();

    console.log('[PRICING] Metrics collected', {
      subscriberCount: metrics.subscriberCount,
      avgOpenRate: metrics.avgOpenRate,
      avgClickRate: metrics.avgClickRate,
      publishedIssueCount: metrics.publishedIssueCount
    });

    const baselinePrice = computeBaseline(
      metrics.subscriberCount, metrics.avgOpenRate, metrics.avgClickRate,
      config.cpmRate, config.clickWeight
    );

    let questionnaireResponses = eventResponses || null;
    let questionnaireVersion = null;
    if (!questionnaireResponses) {
      const qRecord = await loadQuestionnaireResponses(tenantId);
      if (qRecord) {
        questionnaireResponses = qRecord.responses || null;
        questionnaireVersion = qRecord.version || null;
      }
    }

    console.log('[PRICING] Questionnaire context', {
      hasQuestionnaire: questionnaireResponses != null && Object.keys(questionnaireResponses).length > 0,
      questionnaireVersion,
      questionnaireResponses: sanitizeQuestionnaireResponses(questionnaireResponses)
    });

    const prompt = buildPrompt(metrics, baselinePrice, questionnaireResponses, previousRecord, config);
    const { llmResponse, isFallback } = await callBedrock(prompt);

    // Step 1: Validate
    const validation = validateLlmResponse(llmResponse);
    let multiplierRaw;
    let justification;
    let usedFallback = isFallback;

    if (validation.valid) {
      multiplierRaw = llmResponse.multiplier;
      justification = llmResponse.justification;
    } else {
      console.warn('[PIPELINE] LLM response validation failed:', validation.errors);
      multiplierRaw = 1.0;
      justification = 'This price is based on the deterministic baseline calculation. The AI response did not pass validation.';
      usedFallback = true;
    }

    // Step 2: Clamp
    const multiplierClamped = clampMultiplier(multiplierRaw, config.multiplierMin, config.multiplierMax);

    // Step 3: Smooth
    const now = new Date();
    const weekWindow = computeWeeklyWindow(now);
    const weekWindowStr = `${weekWindow.start}/${weekWindow.end}`;
    const existingWindowRecord = await getExistingRecordForWindow(tenantId, weekWindowStr);
    const smoothingBaseRecord = selectSmoothingBaseRecord(previousRecord, weekWindowStr);
    const previousPrice = smoothingBaseRecord?.recommendedPrice ?? null;
    const newComputedPrice = computeRecommendedPrice(baselinePrice, multiplierClamped);

    const metricChanges = {
      subscriberChangePct: previousRecord?.metrics?.subscriberCount
        ? computeSubscriberGrowthRate(metrics.subscriberCount, previousRecord.metrics.subscriberCount)
        : undefined,
      openRateChangePts: previousRecord?.metrics?.avgOpenRate != null
        ? (metrics.avgOpenRate - previousRecord.metrics.avgOpenRate) * 100
        : undefined
    };

    const { smoothedPrice, smoothingApplied } = applySmoothing(
      previousPrice, newComputedPrice, config.smoothingCapPct, metricChanges,
      { subscriberChangePct: config.significantSubscriberChangePct, openRateChangePts: config.significantOpenRateChangePts }
    );

    const multiplierSmoothed = baselinePrice > 0 ? smoothedPrice / baselinePrice : multiplierClamped;
    const recommendedPrice = smoothedPrice;

    const { isCadenceIrregular, isDataStale, confidence: finalConfidence } =
      evaluatePricingConfidence(metrics, questionnaireResponses, usedFallback, config, now);
    const confidenceOverride = computeConfidenceOverride(llmResponse?.confidence, finalConfidence);

    if (metrics.publishedIssueCount < (config.minPublishedIssues || 3)) {
      justification = `[Reduced accuracy: only ${metrics.publishedIssueCount} published issue(s) with analytics available, minimum recommended is ${config.minPublishedIssues || 3}] ${justification}`;
    }
    if (isCadenceIrregular) justification += ' Confidence was reduced because publishing cadence is irregular.';
    if (isDataStale) justification += ` Confidence was reduced because the most recent published issue is older than ${config.dataRecencyThresholdDays} days.`;
    if (smoothingApplied) justification += ` Note: The price adjustment was limited by the weekly smoothing cap of ${(config.smoothingCapPct * 100).toFixed(0)}%.`;

    // Step 4: Store
    const calculatedAt = now.toISOString();
    const pricingRecord = {
      recommendedPrice, baselinePrice, multiplierRaw, multiplierClamped, multiplierSmoothed,
      llmConfidence: llmResponse?.confidence ?? null, confidenceOverride,
      confidence: finalConfidence, justification,
      pricingChecksum: computePricingChecksum({
        recommendedPrice, subscriberCount: metrics.subscriberCount,
        avgOpenRate: metrics.avgOpenRate, avgClickRate: metrics.avgClickRate,
        confidence: finalConfidence, weekWindow: weekWindowStr
      }),
      pricingModelVersion: config.pricingModelVersion,
      metrics: {
        subscriberCount: metrics.subscriberCount,
        avgOpenRate: metrics.avgOpenRate, avgClickRate: metrics.avgClickRate,
        avgBounceRate: metrics.avgBounceRate, avgComplaintRate: metrics.avgComplaintRate,
        subscriberGrowthRate: metrics.subscriberGrowthRate,
        publishedIssueCount: metrics.publishedIssueCount,
        recentTrend: metrics.recentTrend, volatility: metrics.volatility,
        averageDaysBetweenIssues: metrics.averageDaysBetweenIssues,
        medianDaysBetweenIssues: metrics.medianDaysBetweenIssues,
        cadenceStdDevDays: metrics.cadenceStdDevDays,
        latestPublishedAt: metrics.latestPublishedAt
      },
      weekWindow: weekWindowStr, calculatedAt, metricsAsOf,
      isFallback: usedFallback, smoothingApplied,
      ...(questionnaireVersion && { questionnaireVersion }),
      ...(questionnaireResponses && { questionnaireResponses })
    };

    const existingSk = existingWindowRecord?.sk ?? null;
    try {
      const narrative = await generateSponsorNarrative(metrics);
      if (narrative) pricingRecord.narrative = narrative;
    } catch (err) {
      console.warn('[NARRATIVE] Failed to generate narrative, skipping:', err.message);
    }

    await storePricingRecord(tenantId, pricingRecord, existingSk);
    if (jobId) await updateJobStatus(tenantId, jobId, 'completed', pricingRecord, null);

    const duration = Date.now() - executionStart;
    console.log(`[PRICING] Calculation complete in ${duration}ms`, {
      tenantId, recommendedPrice, baselinePrice, multiplierSmoothed,
      llmConfidence: llmResponse?.confidence ?? null, confidenceOverride,
      confidence: finalConfidence, isFallback: usedFallback
    });

    return { success: true, tenantId, pricingRecord };
  } catch (err) {
    const duration = Date.now() - executionStart;
    console.error(`[PRICING] Calculation failed in ${duration}ms`, { tenantId, error: err.message, stack: err.stack });
    if (jobId) {
      try {
        await updateJobStatus(tenantId, jobId, 'failed', null, err.message);
      } catch (statusErr) {
        console.error('[PRICING] Failed to update job status:', statusErr.message);
      }
    }
    throw err;
  }
};
