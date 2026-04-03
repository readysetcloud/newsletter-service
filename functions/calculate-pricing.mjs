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
  computePricingChecksum,
  cpmForBand,
  getValidBands,
  factorsToMultiplier,
  reconcileBandWithFactors,
  buildDeterministicClassification
} from './utils/pricing.mjs';

const ddb = new DynamoDBClient();

const TABLE_NAME = process.env.TABLE_NAME;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID;
const LOG_MODEL_INPUTS = process.env.LOG_MODEL_INPUTS === 'true';

const DEFAULT_PRICING_CONFIG = {
  clickWeight: 2.0,
  smoothingCapPct: 0.20,
  significantSubscriberChangePct: 0.25,
  significantOpenRateChangePts: 10,
  minPublishedIssues: 3,
  cadenceRegularityThreshold: 3,
  dataRecencyThresholdDays: 30,
  // Cross-industry medians from MailerLite 2025 Email Marketing Benchmarks
  // (3.6M campaigns, 181K accounts, Dec 2024 - Nov 2025)
  // Source: https://www.mailerlite.com/blog/compare-your-email-performance-metrics-industry-benchmarks
  industryAvgOpenRate: 0.4346,
  industryAvgClickRate: 0.0209,
  industryAvgUnsubscribeRate: 0.0022,
  multiplierMin: 0.5,
  multiplierMax: 2.0,
  pricingModelVersion: 'v3'
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

  const chronological = [...issueMetrics].reverse();
  const averages = computeMetricAverages(chronological);
  const trendSummary = buildTrendSummary(chronological);
  const publishedAtValues = chronological.map(m => m.publishedAt).filter(Boolean);
  const cadenceStats = computeCadenceStats(publishedAtValues);
  const latestPublishedAt = publishedAtValues.length > 0
    ? publishedAtValues[publishedAtValues.length - 1] : null;

  const subCounts = chronological.map(m => m.subscribers).filter(s => s > 0);
  const subscriberGrowthRate = subCounts.length >= 2
    ? computeSubscriberGrowthRate(subCounts[subCounts.length - 1], subCounts[0]) : 0;

  return {
    subscriberCount, subscriberGrowthRate,
    publishedIssueCount: issueMetrics.length, latestPublishedAt,
    issueDataPoints: chronological,
    ...averages, ...trendSummary, ...cadenceStats
  };
}

// ---------------------------------------------------------------------------
// LLM Prompt — asks for structured classification, not a raw multiplier
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
  const idx = prompt.indexOf('## Instructions', start);
  const before = prompt.slice(0, start);
  const after = idx >= 0 ? prompt.slice(idx) : '';
  return `${before}${marker}\n- [REDACTED FOR LOGGING]\n\n${after}`.trim();
}

function logModelRequest(label, modelId, systemPrompt, userPrompt) {
  if (!LOG_MODEL_INPUTS) return;
  console.log(`[LLM] ${label} request`, JSON.stringify({
    modelId, systemPrompt, userPrompt: maybeRedactPrompt(userPrompt)
  }));
}

export function buildPrompt(metrics, questionnaireResponses, config) {
  const lines = [
    '## Newsletter Performance Data',
    '',
    '### Per-Issue Data (oldest to newest)',
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
    '### Summary',
    `- Data period: ${oldestDate} to ${newestDate}`,
    `- Current subscriber count: ${metrics.subscriberCount}`,
    `- Subscriber growth rate: ${fmtPct(metrics.subscriberGrowthRate)}`,
    `- Average open rate: ${fmtPct(metrics.avgOpenRate)}`,
    `- Average click rate: ${fmtPct(metrics.avgClickRate)}`,
    `- Average bounce rate: ${fmtPct(metrics.avgBounceRate)}`,
    `- Average complaint rate: ${fmtPct(metrics.avgComplaintRate, 4)}`,
    `- Published issues with analytics: ${metrics.publishedIssueCount}`,
    '',
    '### Trends',
    `- Open rate trend: ${fmtPct(metrics.recentTrend.openRate.first)} -> ${fmtPct(metrics.recentTrend.openRate.last)} (${fmtSlope(metrics.recentTrend.openRate.slopePerIssue)})`,
    `- Click rate trend: ${fmtPct(metrics.recentTrend.clickRate.first)} -> ${fmtPct(metrics.recentTrend.clickRate.last)} (${fmtSlope(metrics.recentTrend.clickRate.slopePerIssue)})`,
    `- Open rate CoV: ${fmtPct(metrics.volatility.openRateCoV, 2)}`,
    `- Click rate CoV: ${fmtPct(metrics.volatility.clickRateCoV, 2)}`,
    '',
    '### Cadence',
    `- Average days between issues: ${metrics.averageDaysBetweenIssues ?? 'unknown'}`,
    `- Median days between issues: ${metrics.medianDaysBetweenIssues ?? 'unknown'}`,
    `- Cadence standard deviation: ${metrics.cadenceStdDevDays ?? 'unknown'} days`,
    '',
    '### Market Benchmarks',
    `- Industry average open rate: ${fmtPct(config.industryAvgOpenRate)}`,
    `- Industry average click rate: ${fmtPct(config.industryAvgClickRate)}`,
    `- Industry average unsubscribe rate: ${fmtPct(config.industryAvgUnsubscribeRate)}`
  );

  if (questionnaireResponses && Object.keys(questionnaireResponses).length > 0) {
    lines.push('', '## Creator Questionnaire Responses');
    for (const [qid, answer] of Object.entries(questionnaireResponses)) {
      lines.push(`- ${qid}: ${stringifyAnswer(answer)}`);
    }
  }

  lines.push(
    '',
    '## Instructions',
    'Based on the metrics and questionnaire responses above, classify this newsletter by providing structured ratings.',
    'Do NOT compute a price or multiplier. Just classify the following factors:',
    '',
    '- audienceQuality: How valuable is this audience to sponsors? (low / medium / high)',
    '- nicheSpecificity: How focused and specialized is the content niche? (low / medium / high)',
    '- cadenceHealth: How consistent and reliable is the publishing schedule? (low / medium / high)',
    '- sponsorFit: How well-suited is this newsletter for sponsorship placements? (low / medium / high)',
    `- suggestedBand: Which audience pricing band best fits? One of: ${getValidBands().join(', ')}`,
    '- justification: A brief explanation referencing specific metrics and questionnaire responses.',
    '',
    'Band selection rubric (band should be consistent with factor ratings):',
    '- broad_consumer: General interest, no specific niche. nicheSpecificity is typically low.',
    '- prosumer: Enthusiast or semi-professional audience. At least medium nicheSpecificity.',
    '- b2b_general: Business audience. audienceQuality should be at least medium.',
    '- b2b_technical: Technical professionals. nicheSpecificity should be at least medium, audienceQuality at least medium.',
    '- exec_operator: Decision-makers, founders, C-suite. audienceQuality must be high.',
    '- premium_niche: Highly specialized, high-value audience. nicheSpecificity must be high.',
    '',
    'Use the submit_pricing_classification tool to provide your assessment.'
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Confidence & Smoothing helpers
// ---------------------------------------------------------------------------

export function selectSmoothingBaseRecord(previousRecord, currentWeekWindow) {
  return previousRecord && previousRecord.weekWindow !== currentWeekWindow
    ? previousRecord : null;
}

export function evaluatePricingConfidence(metrics, questionnaireResponses, usedFallback, config, now = new Date()) {
  const hasQuestionnaire = questionnaireResponses != null && Object.keys(questionnaireResponses).length > 0;
  const metricsComplete = (
    metrics.avgOpenRate != null && metrics.avgClickRate != null &&
    metrics.avgBounceRate != null && metrics.avgComplaintRate != null
  );
  const openRateCoV = metrics.volatility.openRateCoV;
  const dataAgeDays = metrics.latestPublishedAt
    ? (now.getTime() - new Date(metrics.latestPublishedAt).getTime()) / (24 * 60 * 60 * 1000)
    : Number.POSITIVE_INFINITY;
  const isCadenceIrregular = (metrics.cadenceStdDevDays ?? Number.POSITIVE_INFINITY) > config.cadenceRegularityThreshold;
  const isDataStale = dataAgeDays > config.dataRecencyThresholdDays;

  return {
    hasQuestionnaire, metricsComplete, isCadenceIrregular, isDataStale,
    confidence: determineConfidence({
      publishedIssueCount: metrics.publishedIssueCount,
      metricsComplete, hasQuestionnaire,
      stabilityCoV: openRateCoV,
      isFallback: usedFallback,
      isCadenceIrregular, isDataStale
    })
  };
}

// ---------------------------------------------------------------------------
// Bedrock LLM calls
// ---------------------------------------------------------------------------

const classificationSchema = z.object({
  audienceQuality: z.enum(['low', 'medium', 'high']).describe('How valuable is this audience to sponsors?'),
  nicheSpecificity: z.enum(['low', 'medium', 'high']).describe('How focused is the content niche?'),
  cadenceHealth: z.enum(['low', 'medium', 'high']).describe('How consistent is the publishing schedule?'),
  sponsorFit: z.enum(['low', 'medium', 'high']).describe('How well-suited for sponsorship placements?'),
  suggestedBand: z.enum(getValidBands()).describe('Audience pricing band classification'),
  justification: z.string().describe('Brief explanation referencing specific metrics')
});

const sponsorNarrativeSchema = z.object({
  narrative: z.string().describe('A short, professional paragraph (2-4 sentences) for potential sponsors')
});

async function callBedrock(prompt) {
  let captured = null;
  const toolDefs = [{
    name: 'submit_pricing_classification',
    description: 'Submit structured pricing factor classifications for the newsletter.',
    schema: classificationSchema,
    handler: (input) => { captured = input; return { success: true }; }
  }];

  try {
    const systemPrompt = [
      'Role: You are a newsletter audience analyst who classifies newsletters for sponsorship pricing.',
      'Instructions: Analyze the provided metrics and questionnaire responses to classify this newsletter across several quality dimensions.',
      'You do NOT set prices or multipliers. You classify factors that code will use to compute a price.',
      'Steps: 1) Assess audience quality from engagement rates and questionnaire context. 2) Evaluate niche specificity from content signals and questionnaire responses. 3) Judge cadence health from publishing regularity. 4) Assess sponsor fit from format, audience, and monetization signals. 5) Suggest the best audience pricing band.',
      `Valid bands: ${getValidBands().join(', ')}. broad_consumer = general interest, prosumer = enthusiast/semi-pro, b2b_general = business audience, b2b_technical = technical professionals, exec_operator = decision-makers/founders, premium_niche = highly specialized high-value audience.`,
      'Narrowing: Only use the submit_pricing_classification tool. Do not produce free-text output.'
    ].join('\n');
    logModelRequest('pricing-classification', BEDROCK_MODEL_ID, systemPrompt, prompt);
    await converse(BEDROCK_MODEL_ID, systemPrompt, prompt, toolDefs);
    if (!captured) throw new Error('LLM did not call the submit_pricing_classification tool');
    return { llmResponse: captured, isFallback: false };
  } catch (error) {
    console.warn('[LLM] Bedrock call failed, using deterministic fallback:', error.message);
    return {
      llmResponse: null,
      isFallback: true
    };
  }
}

async function generateSponsorNarrative(metrics, classification) {
  let captured = null;
  const toolDefs = [{
    name: 'submit_sponsor_narrative',
    description: 'Submit the sponsor-facing value narrative paragraph.',
    schema: sponsorNarrativeSchema,
    handler: (input) => { captured = input; return { success: true }; }
  }];

  const systemPrompt = [
    'Role: You are a professional copywriter specializing in newsletter sponsorship pitches.',
    'Instructions: Craft a concise, sponsor-facing value narrative. Summarize metrics qualitatively.',
    'Narrowing: Only use the submit_sponsor_narrative tool. No free-text. No raw numbers or pricing figures.'
  ].join('\n');
  const userPrompt = [
    'Write a short, professional paragraph (2-4 sentences) for potential sponsors.',
    '',
    `Subscriber count: ${metrics.subscriberCount}`,
    `Average open rate: ${(metrics.avgOpenRate * 100).toFixed(1)}%`,
    `Average click rate: ${(metrics.avgClickRate * 100).toFixed(1)}%`,
    `Subscriber growth rate: ${(metrics.subscriberGrowthRate * 100).toFixed(1)}%`,
    `Published issues analyzed: ${metrics.publishedIssueCount}`,
    `Audience band: ${classification.suggestedBand}`,
    `Audience quality: ${classification.audienceQuality}`,
    `Niche specificity: ${classification.nicheSpecificity}`,
    `Sponsor fit: ${classification.sponsorFit}`
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
    ScanIndexForward: false, Limit: 1
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
        TableName: TABLE_NAME, Item: marshall({ pk: tenantId, sk, ...record }, { removeUndefinedValues: true })
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

    // Load questionnaire responses.
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

    // --- Step 1: LLM classifies structured factors ---
    const prompt = buildPrompt(metrics, questionnaireResponses, config);
    const { llmResponse, isFallback } = await callBedrock(prompt);

    let classification;
    let usedFallback = isFallback;
    let justification;

    if (!isFallback) {
      const validation = validateLlmResponse(llmResponse);
      if (validation.valid) {
        classification = llmResponse;
        justification = llmResponse.justification;
      } else {
        console.warn('[PIPELINE] LLM classification validation failed:', validation.errors);
        usedFallback = true;
      }
    }

    // Fallback: deterministic classification when LLM is unavailable or invalid
    if (usedFallback) {
      classification = buildDeterministicClassification(questionnaireResponses, metrics, config);
      justification = classification.justification;
    }

    // --- Step 2: Code determines CPM from band (with consistency check) ---
    const reconciledBand = reconcileBandWithFactors(classification);
    if (reconciledBand !== classification.suggestedBand) {
      console.log(`[PRICING] Band downgraded: ${classification.suggestedBand} -> ${reconciledBand} (factor consistency)`);
      classification.suggestedBand = reconciledBand;
    }
    const cpmRate = cpmForBand(classification.suggestedBand);

    // --- Step 3: Compute deterministic baseline ---
    const baselinePrice = computeBaseline(
      metrics.subscriberCount, metrics.avgOpenRate, metrics.avgClickRate,
      cpmRate, config.clickWeight
    );

    // --- Step 4: Code maps classification to bounded multiplier ---
    const multiplierRaw = factorsToMultiplier(classification);

    // --- Step 5: Clamp ---
    const multiplierClamped = clampMultiplier(multiplierRaw, config.multiplierMin, config.multiplierMax);

    // --- Step 6: Smooth ---
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

    // --- Confidence ---
    const { isCadenceIrregular, isDataStale, confidence: finalConfidence } =
      evaluatePricingConfidence(metrics, questionnaireResponses, usedFallback, config, now);

    if (metrics.publishedIssueCount < (config.minPublishedIssues || 3)) {
      justification = `[Reduced accuracy: only ${metrics.publishedIssueCount} published issue(s), minimum recommended is ${config.minPublishedIssues || 3}] ${justification}`;
    }
    if (isCadenceIrregular) justification += ' Confidence reduced: irregular publishing cadence.';
    if (isDataStale) justification += ` Confidence reduced: most recent issue is older than ${config.dataRecencyThresholdDays} days.`;
    if (smoothingApplied) justification += ` Price change limited by ${(config.smoothingCapPct * 100).toFixed(0)}% weekly smoothing cap.`;

    // --- Step 7: Store ---
    const calculatedAt = now.toISOString();
    const pricingRecord = {
      recommendedPrice, baselinePrice,
      audienceBand: classification.suggestedBand,
      cpmRate,
      classification: {
        audienceQuality: classification.audienceQuality,
        nicheSpecificity: classification.nicheSpecificity,
        cadenceHealth: classification.cadenceHealth,
        sponsorFit: classification.sponsorFit
      },
      multiplierRaw, multiplierClamped, multiplierSmoothed,
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
      const narrative = await generateSponsorNarrative(metrics, classification);
      if (narrative) pricingRecord.narrative = narrative;
    } catch (err) {
      console.warn('[NARRATIVE] Failed to generate narrative, skipping:', err.message);
    }

    await storePricingRecord(tenantId, pricingRecord, existingSk);
    if (jobId) await updateJobStatus(tenantId, jobId, 'completed', pricingRecord, null);

    const duration = Date.now() - executionStart;
    console.log(`[PRICING] Calculation complete in ${duration}ms`, {
      tenantId, recommendedPrice, baselinePrice, audienceBand: classification.suggestedBand,
      cpmRate, multiplierSmoothed, confidence: finalConfidence, isFallback: usedFallback
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
