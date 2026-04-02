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
  computeSubscriberGrowthRate,
  computeWeeklyWindow,
  computeRecommendedPrice,
  computePricingChecksum
} from './utils/pricing.mjs';

const ddb = new DynamoDBClient();

const TABLE_NAME = process.env.TABLE_NAME;
const SUBSCRIBERS_TABLE_NAME = process.env.SUBSCRIBERS_TABLE_NAME;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID;

/**
 * Load system pricing configuration from DynamoDB.
 */
async function loadPricingConfig() {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk = :sk',
    ExpressionAttributeValues: marshall({ ':pk': 'system', ':sk': 'pricing-config' })
  }));

  if (!result.Items || result.Items.length === 0) {
    console.warn('[CONFIG] No pricing-config found, using defaults');
    return {
      cpmRate: 5,
      multiplierMin: 0.5,
      multiplierMax: 3.0,
      smoothingCapPct: 0.20,
      significantSubscriberChangePct: 0.25,
      significantOpenRateChangePts: 10,
      minPublishedIssues: 3
    };
  }

  return unmarshall(result.Items[0]);
}

// ---------------------------------------------------------------------------
// Task 2.1 - Metrics Collection
// ---------------------------------------------------------------------------

/**
 * Count subscribers for a tenant by querying the SubscribersTable.
 */
async function getSubscriberCount(tenantId) {
  let count = 0;
  let lastKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: marshall({ ':tenantId': tenantId }),
      Select: 'COUNT',
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));

    count += result.Count || 0;
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return count;
}

/**
 * Query the most recent published issues with consolidated analytics (up to 10).
 *
 * Stats records live at pk = `{tenantId}#{issueNumber}`, sk = `stats` and are
 * indexed on GSI1 with GSI1PK = `{tenantId}#issue`, GSI1SK = padded issue number.
 * We query GSI1 in descending order, filter for statsPhase = "consolidated", and
 * extract the metrics we need.
 */
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
        const record = unmarshall(item);
        issues.push(record);
        if (issues.length >= limit) break;
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey && issues.length < limit);

  return issues.slice(0, limit);
}

/**
 * Extract metric rates from a consolidated stats record.
 *
 * After consolidation the record contains an `analytics` map with
 * `currentMetrics.openRate`, `currentMetrics.clickThroughRate`, etc.
 * If the analytics map is missing we fall back to computing rates from
 * the raw counters on the stats record itself.
 */
function extractIssueMetrics(statsRecord) {
  const cm = statsRecord.analytics?.currentMetrics;

  if (cm) {
    return {
      openRate: cm.openRate ?? 0,
      clickRate: cm.clickThroughRate ?? 0,
      bounceRate: cm.bounceRate ?? 0,
      complaintRate: cm.complaintRate ?? 0
    };
  }

  // Fallback: compute from raw counts
  const delivered = statsRecord.deliveries || statsRecord.subscribers || 1;
  return {
    openRate: delivered > 0 ? (statsRecord.opens || 0) / delivered : 0,
    clickRate: delivered > 0 ? (statsRecord.clicks || 0) / delivered : 0,
    bounceRate: delivered > 0 ? (statsRecord.bounces || 0) / delivered : 0,
    complaintRate: delivered > 0 ? (statsRecord.complaints || 0) / delivered : 0
  };
}

/**
 * Fetch the most recent Pricing_Record for a tenant.
 */
async function getPreviousPricingRecord(tenantId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: marshall({
      ':pk': tenantId,
      ':skPrefix': 'pricing#'
    }),
    ScanIndexForward: false,
    Limit: 1
  }));

  if (!result.Items || result.Items.length === 0) return null;
  return unmarshall(result.Items[0]);
}

/**
 * Collect all metrics needed for pricing calculation.
 */
async function collectMetrics(tenantId, previousRecord) {
  const [subscriberCount, recentIssues] = await Promise.all([
    getSubscriberCount(tenantId),
    getRecentPublishedIssues(tenantId, 10)
  ]);

  if (subscriberCount === 0) {
    throw new Error('Subscribers are required before pricing can be calculated');
  }

  if (recentIssues.length === 0) {
    throw new Error('At least one published issue with analytics is required');
  }

  const issueMetrics = recentIssues.map(extractIssueMetrics);
  const averages = computeMetricAverages(issueMetrics);

  const previousSubscriberCount = previousRecord?.metrics?.subscriberCount ?? null;
  const subscriberGrowthRate = computeSubscriberGrowthRate(subscriberCount, previousSubscriberCount);

  return {
    subscriberCount,
    ...averages,
    subscriberGrowthRate,
    publishedIssueCount: recentIssues.length
  };
}

// ---------------------------------------------------------------------------
// Task 2.2 - LLM Prompt Construction & Bedrock Call
// ---------------------------------------------------------------------------

/**
 * Build the LLM prompt for pricing multiplier generation.
 */
function buildPrompt(metrics, baselinePrice, questionnaireResponses, previousRecord) {
  const lines = [
    '## Deterministic Baseline',
    `We calculated a baseline sponsorship price of $${baselinePrice.toFixed(2)} using a CPM formula based on subscriber count and open rate.`,
    'Your job is to evaluate the additional metrics and context below, then provide a multiplier to adjust this baseline price up or down.',
    '',
    '## Newsletter Metrics',
    `- Subscriber count: ${metrics.subscriberCount}`,
    `- Subscriber growth rate: ${(metrics.subscriberGrowthRate * 100).toFixed(1)}%`,
    `- Average open rate: ${(metrics.avgOpenRate * 100).toFixed(1)}%`,
    `- Average bounce rate: ${(metrics.avgBounceRate * 100).toFixed(1)}%`,
    `- Average complaint rate: ${(metrics.avgComplaintRate * 100).toFixed(4)}%`,
    `- Published issues with analytics: ${metrics.publishedIssueCount}`,
    '',
    '## Qualitative Inputs',
    `- Average click-through rate: ${(metrics.avgClickRate * 100).toFixed(1)}% (not included in the baseline formula, use as a qualitative signal)`
  ];

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
      lines.push(`- ${questionId}: ${answer}`);
    }
  }

  lines.push(
    '',
    '## Instructions',
    'Given the baseline price above and the metrics provided, determine how the price should be adjusted.',
    'A multiplier of 1.0 means no change. Above 1.0 increases the price, below 1.0 decreases it.',
    'Use the submit_pricing_adjustment tool to provide your multiplier, confidence level, and justification.'
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool definitions for structured LLM output
// ---------------------------------------------------------------------------

const pricingAdjustmentSchema = z.object({
  multiplier: z.number().describe('Adjustment factor to apply to the baseline price'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level of the pricing recommendation'),
  justification: z.string().describe('Plain-language explanation referencing specific metrics')
});

const sponsorNarrativeSchema = z.object({
  narrative: z.string().describe('A short, professional paragraph (2-4 sentences) for potential sponsors describing the value of advertising in this newsletter')
});

/**
 * Call Amazon Bedrock via the converse utility with a tool definition
 * so the LLM returns structured, schema-validated output.
 *
 * Falls back to a deterministic default if the call fails.
 */
async function callBedrock(prompt) {
  let captured = null;

  const toolDefs = [{
    name: 'submit_pricing_adjustment',
    description: 'Submit the pricing multiplier, confidence level, and justification for the newsletter sponsorship pricing calculation.',
    schema: pricingAdjustmentSchema,
    handler: (input) => {
      captured = input;
      return { success: true };
    }
  }];

  try {
    const systemPrompt = [
      'Role: You are a newsletter sponsorship pricing expert with deep knowledge of digital advertising CPM models and audience valuation.',
      'Instructions: Analyze the provided newsletter metrics, historical pricing data, and any creator questionnaire responses to determine a fair sponsorship pricing adjustment.',
      'Steps: 1) Evaluate subscriber count, growth trajectory, and engagement rates against industry benchmarks. 2) Weigh qualitative signals like click-through rate and creator-provided context. 3) Compare against the deterministic baseline price and any previous pricing records. 4) Use the submit_pricing_adjustment tool to return your recommendation.',
      'End goal: Produce a well-calibrated pricing multiplier that reflects the newsletter\'s true sponsorship value, along with a confidence level and a justification grounded in the specific metrics provided.',
      'Narrowing: Only use the submit_pricing_adjustment tool to respond. Do not produce free-text output. The multiplier should be a positive number. Confidence must be exactly one of "low", "medium", or "high". The justification must reference specific metrics from the input.'
    ].join('\n');
    await converse(BEDROCK_MODEL_ID, systemPrompt, prompt, toolDefs);

    if (!captured) {
      throw new Error('LLM did not call the submit_pricing_adjustment tool');
    }

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

// ---------------------------------------------------------------------------
// Task 2.3 - 4-Step Pipeline (validate > clamp > smooth > store)
// ---------------------------------------------------------------------------

/**
 * Fetch the most recent Pricing_Record for the current week window.
 * Used for smoothing comparison and idempotency checks.
 */
async function getExistingRecordForWindow(tenantId, weekWindow) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    FilterExpression: 'weekWindow = :weekWindow',
    ExpressionAttributeValues: marshall({
      ':pk': tenantId,
      ':skPrefix': 'pricing#',
      ':weekWindow': weekWindow
    }),
    ScanIndexForward: false
  }));

  if (!result.Items || result.Items.length === 0) return null;
  return unmarshall(result.Items[0]);
}

/**
 * Update the job status record in DynamoDB.
 */
async function updateJobStatus(tenantId, jobId, status, result, error) {
  const now = new Date().toISOString();
  const updateParts = ['#status = :status', 'updatedAt = :now'];
  const exprNames = { '#status': 'status' };
  const exprValues = { ':status': status, ':now': now };

  if (result) {
    updateParts.push('#result = :result');
    exprNames['#result'] = 'result';
    exprValues[':result'] = result;
  }
  if (error) {
    updateParts.push('#error = :error');
    exprNames['#error'] = 'error';
    exprValues[':error'] = error;
  }

  await ddb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: tenantId, sk: `pricing-job#${jobId}` }),
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: marshall(exprValues)
  }));
}

/**
 * Write (or update) the Pricing_Record in DynamoDB.
 *
 * For new records within a window, uses a conditional write to prevent duplicates.
 * For on-demand recalculations where a record already exists, updates in place.
 */
async function storePricingRecord(tenantId, record, existingRecordSk) {
  if (existingRecordSk) {
    // On-demand recalculation: update existing record
    await ddb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({ pk: tenantId, sk: existingRecordSk, ...record }, { removeUndefinedValues: true })
    }));
    return existingRecordSk;
  }

  // New record: conditional write for idempotency
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

/**
 * Load questionnaire responses for a tenant (if any).
 */
async function loadQuestionnaireResponses(tenantId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk = :sk',
    ExpressionAttributeValues: marshall({
      ':pk': tenantId,
      ':sk': 'pricing-questionnaire'
    })
  }));

  if (!result.Items || result.Items.length === 0) return null;
  return unmarshall(result.Items[0]);
}

// ---------------------------------------------------------------------------
// Sponsor-facing narrative generation
// ---------------------------------------------------------------------------

/**
 * Generate a concise, sponsor-facing value narrative using the converse utility
 * with a tool definition for structured output.
 * This is a best-effort call - failures are non-fatal.
 */
async function generateSponsorNarrative(metrics) {
  let captured = null;

  const toolDefs = [{
    name: 'submit_sponsor_narrative',
    description: 'Submit the sponsor-facing value narrative paragraph.',
    schema: sponsorNarrativeSchema,
    handler: (input) => {
      captured = input;
      return { success: true };
    }
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

  await converse(BEDROCK_MODEL_ID, systemPrompt, userPrompt, toolDefs);

  if (!captured || !captured.narrative || captured.narrative.length < 20) {
    console.warn('[NARRATIVE] Response too short or empty');
    return null;
  }

  return captured.narrative;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (event) => {
  const executionStart = Date.now();

  // Support both direct invocation and EventBridge events
  const detail = event.detail || event;
  const { tenantId, questionnaireResponses: eventResponses, jobId, isWeeklyJob } = detail;

  console.log('[PRICING] Starting calculation', { tenantId, jobId, isWeeklyJob });

  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  try {
    // Load configuration
    const config = await loadPricingConfig();

    // Step 0: Collect metrics
    const previousRecord = await getPreviousPricingRecord(tenantId);
    const metrics = await collectMetrics(tenantId, previousRecord);
    const metricsAsOf = new Date().toISOString();

    console.log('[PRICING] Metrics collected', {
      subscriberCount: metrics.subscriberCount,
      avgOpenRate: metrics.avgOpenRate,
      publishedIssueCount: metrics.publishedIssueCount
    });

    // Compute baseline
    const baselinePrice = computeBaseline(metrics.subscriberCount, metrics.avgOpenRate, config.cpmRate);

    // Load questionnaire responses
    let questionnaireResponses = eventResponses || null;
    let questionnaireVersion = null;
    if (!questionnaireResponses) {
      const qRecord = await loadQuestionnaireResponses(tenantId);
      if (qRecord) {
        questionnaireResponses = qRecord.responses || null;
        questionnaireVersion = qRecord.version || null;
      }
    }

    // Build prompt and call LLM
    const prompt = buildPrompt(metrics, baselinePrice, questionnaireResponses, previousRecord);
    const { llmResponse, isFallback } = await callBedrock(prompt);

    // --- 4-Step Pipeline ---

    // Step 1: Validate LLM response
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

    // Step 2: Clamp multiplier
    const multiplierClamped = clampMultiplier(multiplierRaw, config.multiplierMin, config.multiplierMax);

    // Step 3: Apply smoothing
    const now = new Date();
    const weekWindow = computeWeeklyWindow(now);
    const weekWindowStr = `${weekWindow.start}/${weekWindow.end}`;

    // Get the most recent record for the current window for smoothing comparison
    const existingWindowRecord = await getExistingRecordForWindow(tenantId, weekWindowStr);
    const smoothingBaseRecord = existingWindowRecord || previousRecord;
    const previousPrice = smoothingBaseRecord?.recommendedPrice ?? null;

    const newComputedPrice = computeRecommendedPrice(baselinePrice, multiplierClamped);

    const previousAvgOpenRate = smoothingBaseRecord?.metrics?.avgOpenRate ?? null;
    const metricChanges = {
      subscriberChangePct: previousRecord?.metrics?.subscriberCount
        ? computeSubscriberGrowthRate(metrics.subscriberCount, previousRecord.metrics.subscriberCount)
        : undefined,
      openRateChangePts: previousAvgOpenRate != null
        ? (metrics.avgOpenRate - previousAvgOpenRate) * 100
        : undefined
    };

    const { smoothedPrice, smoothingApplied } = applySmoothing(
      previousPrice,
      newComputedPrice,
      config.smoothingCapPct,
      metricChanges,
      {
        subscriberChangePct: config.significantSubscriberChangePct,
        openRateChangePts: config.significantOpenRateChangePts
      }
    );

    // Derive the smoothed multiplier from the smoothed price
    const multiplierSmoothed = baselinePrice > 0 ? smoothedPrice / baselinePrice : multiplierClamped;
    const recommendedPrice = smoothedPrice;

    // Determine confidence deterministically
    const hasQuestionnaire = questionnaireResponses != null && Object.keys(questionnaireResponses).length > 0;
    const metricsComplete = metrics.avgOpenRate != null && metrics.avgBounceRate != null;
    // Approximate stability CoV - use 0.15 (medium) as default when we don't have 4 weeks of data
    const stabilityCoV = 0.15;
    const finalConfidence = determineConfidence(
      metrics.publishedIssueCount,
      metricsComplete,
      hasQuestionnaire,
      stabilityCoV,
      usedFallback
    );

    // Add reduced accuracy notice if fewer than minimum published issues
    if (metrics.publishedIssueCount < (config.minPublishedIssues || 3)) {
      justification = `[Reduced accuracy: only ${metrics.publishedIssueCount} published issue(s) with analytics available, minimum recommended is ${config.minPublishedIssues || 3}] ${justification}`;
    }

    // Add smoothing notice if applied
    if (smoothingApplied) {
      justification = `${justification} Note: The price adjustment was limited by the weekly smoothing cap of ${(config.smoothingCapPct * 100).toFixed(0)}%.`;
    }

    // Step 4: Store the record
    const calculatedAt = now.toISOString();
    const pricingChecksum = computePricingChecksum({
      recommendedPrice,
      subscriberCount: metrics.subscriberCount,
      avgOpenRate: metrics.avgOpenRate,
      avgClickRate: metrics.avgClickRate,
      confidence: finalConfidence,
      weekWindow: weekWindowStr
    });
    const pricingRecord = {
      recommendedPrice,
      baselinePrice,
      multiplierRaw,
      multiplierClamped,
      multiplierSmoothed,
      confidence: finalConfidence,
      justification,
      pricingChecksum,
      metrics: {
        subscriberCount: metrics.subscriberCount,
        avgOpenRate: metrics.avgOpenRate,
        avgClickRate: metrics.avgClickRate,
        avgBounceRate: metrics.avgBounceRate,
        avgComplaintRate: metrics.avgComplaintRate,
        subscriberGrowthRate: metrics.subscriberGrowthRate,
        publishedIssueCount: metrics.publishedIssueCount
      },
      weekWindow: weekWindowStr,
      calculatedAt,
      metricsAsOf,
      isFallback: usedFallback,
      smoothingApplied,
      ...(questionnaireVersion && { questionnaireVersion }),
      ...(questionnaireResponses && { questionnaireResponses })
    };

    const existingSk = existingWindowRecord?.sk ?? null;

    // Generate sponsor-facing narrative via Bedrock
    try {
      const narrative = await generateSponsorNarrative(metrics);
      if (narrative) {
        pricingRecord.narrative = narrative;
      }
    } catch (err) {
      console.warn('[NARRATIVE] Failed to generate narrative, skipping:', err.message);
    }

    await storePricingRecord(tenantId, pricingRecord, existingSk);

    // Update job status
    if (jobId) {
      await updateJobStatus(tenantId, jobId, 'completed', pricingRecord, null);
    }

    const duration = Date.now() - executionStart;
    console.log(`[PRICING] Calculation complete in ${duration}ms`, {
      tenantId,
      recommendedPrice,
      baselinePrice,
      multiplierSmoothed,
      confidence: finalConfidence,
      isFallback: usedFallback
    });

    return {
      success: true,
      tenantId,
      pricingRecord
    };
  } catch (err) {
    const duration = Date.now() - executionStart;
    console.error(`[PRICING] Calculation failed in ${duration}ms`, {
      tenantId,
      error: err.message,
      stack: err.stack
    });

    // Update job status to failed
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
