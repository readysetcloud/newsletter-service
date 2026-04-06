import { DynamoDBClient, QueryCommand, UpdateItemCommand, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { z } from 'zod';
import { converse } from './utils/agents.mjs';

const ddb = new DynamoDBClient();

const TABLE_NAME = process.env.TABLE_NAME;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID;

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// Utility Functions (Task 7.2)
// ---------------------------------------------------------------------------

/**
 * Format metrics for human-readable display in outreach emails.
 * - subscriberCount: thousands separators (e.g., 5,000)
 * - rate: percentage with 1 decimal (e.g., 48.3%)
 * - price: USD with 2 decimals (e.g., $150.00)
 */
export function formatMetrics(subscriberCount, rate, price) {
  const formattedSubscribers = Number(subscriberCount).toLocaleString('en-US');
  const formattedRate = `${(rate * 100).toFixed(1)}%`;
  const formattedPrice = `$${Number(price).toFixed(2)}`;
  return { formattedSubscribers, formattedRate, formattedPrice };
}

/**
 * Compute the next 3 publication dates from cadence settings.
 * - Weekly: 7-day spacing
 * - Biweekly: 14-day spacing
 * - Monthly: 28-day spacing
 * Returns empty array if interval is "Irregular" or not set.
 */
export function computeNextPublicationDates(dayOfWeek, interval, referenceDate = new Date()) {
  if (!dayOfWeek || !interval || interval === 'Irregular') {
    return [];
  }

  const targetDayIndex = DAYS_OF_WEEK.indexOf(dayOfWeek);
  if (targetDayIndex === -1) return [];

  const intervalDays = { Weekly: 7, Biweekly: 14, Monthly: 28 };
  const spacing = intervalDays[interval];
  if (!spacing) return [];

  const ref = new Date(referenceDate);
  // Find the next occurrence of the target day of week
  let next = new Date(ref);
  next.setHours(0, 0, 0, 0);
  const currentDay = next.getDay();
  let daysUntilTarget = (targetDayIndex - currentDay + 7) % 7;
  // If today is the target day, move to next week
  if (daysUntilTarget === 0) daysUntilTarget = 7;
  next.setDate(next.getDate() + daysUntilTarget);

  const dates = [];
  for (let i = 0; i < 3; i++) {
    dates.push(new Date(next));
    next.setDate(next.getDate() + spacing);
  }

  return dates;
}

/**
 * Build a template-based fallback email when LLM is unavailable.
 * Uses the design spec template format.
 */
export function buildTemplateFallback(sponsor, pricing, history, cadence) {
  const { formattedSubscribers, formattedRate, formattedPrice } = formatMetrics(
    pricing.metrics?.subscriberCount || pricing.subscriberCount || 0,
    pricing.metrics?.avgOpenRate || pricing.openRate || 0,
    pricing.recommendedPrice || 0
  );

  const contactName = sponsor.contactName || 'there';
  const sponsorName = sponsor.sponsorName || 'Sponsor';
  const fulfilledCount = history.filter(e => e.status === 'fulfilled').length;
  const hasSponsorHistory = fulfilledCount > 0;

  const upcomingDates = cadence
    ? computeNextPublicationDates(cadence.publishingDayOfWeek, cadence.publishingInterval)
    : [];
  const hasUpcomingDates = upcomingDates.length > 0;

  const subject = `Sponsorship Opportunity — Newsletter`;

  const bodyLines = [
    `Hi ${contactName},`,
    '',
    `I wanted to reach out about a sponsorship opportunity with our newsletter.`,
    '',
    `Our newsletter reaches ${formattedSubscribers} subscribers with a ${formattedRate} open rate.`
  ];

  if (hasSponsorHistory) {
    bodyLines.push(`You've previously sponsored ${fulfilledCount} issue(s) with us, and we'd love to continue the partnership.`);
  }

  bodyLines.push('');
  bodyLines.push(`Our current recommended sponsorship rate is ${formattedPrice} per issue.`);

  if (hasUpcomingDates) {
    const dateStrings = upcomingDates.map(d => d.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }));
    bodyLines.push(`Our next likely publication dates are: ${dateStrings.join(', ')}.`);
  }

  bodyLines.push('');
  bodyLines.push('Would you be interested in discussing a sponsorship for an upcoming issue?');
  bodyLines.push('');
  bodyLines.push('Best regards');

  return { subject, body: bodyLines.join('\n') };
}

/**
 * Compute click totals for sponsor-owned links from link records.
 * Aggregates total and unique clicks across all sponsor link IDs.
 */
export async function computeClickTotals(sponsorLinkIds, issueKey) {
  if (!sponsorLinkIds || sponsorLinkIds.length === 0 || !issueKey) {
    return { totalClicks: 0, uniqueClicks: 0 };
  }

  let totalClicks = 0;
  const allUniqueHashes = new Set();

  for (const linkId of sponsorLinkIds) {
    // Read the link record to get total clicks
    try {
      const linkResult = await ddb.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ pk: issueKey, sk: `link#${linkId}` }),
        ProjectionExpression: 'clicks_total'
      }));

      if (linkResult.Item) {
        const linkData = unmarshall(linkResult.Item);
        totalClicks += linkData.clicks_total || 0;
      }
    } catch (err) {
      console.warn(`[OUTREACH] Failed to read link record for ${linkId}:`, err.message);
    }

    // Query click events for unique subscriber hashes
    try {
      let lastKey;
      do {
        const clickResult = await ddb.send(new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          FilterExpression: 'contains(sk, :linkId)',
          ExpressionAttributeValues: marshall({
            ':pk': issueKey,
            ':skPrefix': 'click#',
            ':linkId': linkId
          }),
          ProjectionExpression: 'subscriberEmailHash',
          ...(lastKey && { ExclusiveStartKey: lastKey })
        }));

        if (clickResult.Items) {
          for (const item of clickResult.Items) {
            const event = unmarshall(item);
            if (event.subscriberEmailHash && event.subscriberEmailHash !== 'unknown') {
              allUniqueHashes.add(event.subscriberEmailHash);
            }
          }
        }
        lastKey = clickResult.LastEvaluatedKey;
      } while (lastKey);
    } catch (err) {
      console.warn(`[OUTREACH] Failed to query click events for ${linkId}:`, err.message);
    }
  }

  return { totalClicks, uniqueClicks: allUniqueHashes.size };
}

/**
 * Compute total revenue from fulfilled sponsorship entries.
 */
export function computeTotalRevenue(entries) {
  return entries
    .filter(e => e.status === 'fulfilled')
    .reduce((sum, e) => sum + (e.amountCharged || 0), 0);
}

// ---------------------------------------------------------------------------
// DynamoDB Loaders
// ---------------------------------------------------------------------------

async function loadSponsorRecord(tenantId, sponsorId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK = :sk',
    ExpressionAttributeValues: marshall({ ':pk': tenantId, ':sk': sponsorId })
  }));
  if (!result.Items || result.Items.length === 0) return null;
  return unmarshall(result.Items[0]);
}

async function loadLatestPricingRecord(tenantId) {
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

async function loadFulfilledSponsorships(tenantId, sponsorId) {
  const entries = [];
  let lastKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: '#status = :fulfilled',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({
        ':pk': tenantId,
        ':skPrefix': `sponsorship#${sponsorId}#`,
        ':fulfilled': 'fulfilled'
      }),
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));
    if (result.Items) {
      entries.push(...result.Items.map(item => unmarshall(item)));
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return entries;
}

async function loadPublishingCadence(tenantId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk = :sk',
    ExpressionAttributeValues: marshall({ ':pk': tenantId, ':sk': 'pricing-questionnaire' })
  }));
  if (!result.Items || result.Items.length === 0) return null;
  const record = unmarshall(result.Items[0]);
  const responses = record.responses || {};
  if (!responses.publishingDayOfWeek && !responses.publishingInterval) return null;
  return {
    publishingDayOfWeek: responses.publishingDayOfWeek || null,
    publishingInterval: responses.publishingInterval || null
  };
}

// ---------------------------------------------------------------------------
// Click Totals from Fulfilled Entries
// ---------------------------------------------------------------------------

async function computeSponsorClickTotals(fulfilledEntries) {
  let totalClicks = 0;
  let uniqueClicks = 0;

  for (const entry of fulfilledEntries) {
    if (!entry.sponsorLinkIds || entry.sponsorLinkIds.length === 0) continue;

    // Use cached values if available and fresh
    if (entry.clickCache && entry.clickCache.computedAt) {
      const cacheAge = Date.now() - new Date(entry.clickCache.computedAt).getTime();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      if (cacheAge < twentyFourHours) {
        totalClicks += entry.clickCache.totalClicks || 0;
        uniqueClicks += entry.clickCache.uniqueClicks || 0;
        continue;
      }
    }

    // Recompute from raw events
    const issueKey = entry.issueId;
    if (!issueKey) continue;

    const clickData = await computeClickTotals(entry.sponsorLinkIds, issueKey);
    totalClicks += clickData.totalClicks;
    uniqueClicks += clickData.uniqueClicks;
  }

  return { totalClicks, uniqueClicks };
}

// ---------------------------------------------------------------------------
// LLM Prompt and Bedrock Call
// ---------------------------------------------------------------------------

function buildOutreachPrompt(sponsor, pricing, history, cadence, clickTotals) {
  const metrics = pricing.metrics || {};
  const { formattedSubscribers, formattedRate, formattedPrice } = formatMetrics(
    metrics.subscriberCount || pricing.subscriberCount || 0,
    metrics.avgOpenRate || pricing.openRate || 0,
    pricing.recommendedPrice || 0
  );

  const fulfilledEntries = history.filter(e => e.status === 'fulfilled');
  const totalRevenue = computeTotalRevenue(history);
  const hasClickData = clickTotals.totalClicks > 0;

  const lines = [
    '## Sponsor Context',
    `- Sponsor name: ${sponsor.sponsorName}`,
    `- Contact name: ${sponsor.contactName}`,
    `- Contact email: ${sponsor.contactEmail}`,
    '',
    '## Newsletter Metrics',
    `- Subscriber count: ${formattedSubscribers}`,
    `- Open rate: ${formattedRate}`,
    `- Click-through rate: ${((metrics.avgClickRate || 0) * 100).toFixed(1)}%`,
    `- Subscriber growth rate: ${((metrics.subscriberGrowthRate || 0) * 100).toFixed(1)}%`,
    '',
    '## Pricing',
    `- Recommended sponsorship rate: ${formattedPrice}`,
    `- Confidence: ${pricing.confidence || 'N/A'}`,
    ''
  ];

  if (fulfilledEntries.length > 0) {
    lines.push('## Sponsorship History');
    lines.push(`- Total fulfilled sponsorships: ${fulfilledEntries.length}`);
    lines.push(`- Total revenue from this sponsor: $${totalRevenue.toFixed(2)}`);
    const lastDate = fulfilledEntries
      .map(e => e.sponsorshipDate)
      .sort()
      .pop();
    if (lastDate) lines.push(`- Most recent sponsorship date: ${lastDate}`);
    lines.push('');
  }

  if (hasClickData) {
    lines.push('## Sponsor-Specific Click Performance');
    lines.push(`- Total clicks on sponsor links: ${clickTotals.totalClicks}`);
    lines.push(`- Unique clicks on sponsor links: ${clickTotals.uniqueClicks}`);
    lines.push('');
  }

  const upcomingDates = cadence
    ? computeNextPublicationDates(cadence.publishingDayOfWeek, cadence.publishingInterval)
    : [];

  if (upcomingDates.length > 0) {
    lines.push('## Upcoming Publication Dates');
    for (const d of upcomingDates) {
      lines.push(`- ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
    }
    lines.push('');
  }

  lines.push(
    '## Instructions',
    'Write a professional outreach email to re-engage this sponsor for a newsletter sponsorship.',
    'The email should:',
    '- Address the contact by name',
    '- Reference the newsletter\'s performance metrics (subscriber count, open rate, click-through rate)',
    hasClickData ? '- Highlight sponsor-specific click performance from their past sponsorships' : '',
    fulfilledEntries.length > 0 ? '- Reference their past sponsorship history (number of sponsorships, not internal pricing details)' : '',
    '- Present the current recommended sponsorship rate',
    upcomingDates.length > 0 ? '- Mention upcoming likely publication dates' : '',
    '- Include a clear call to action',
    '- Be professional, concise (under 300 words)',
    '- Do NOT include internal data like multipliers, baseline prices, confidence justification, bounce rates, or complaint rates',
    '',
    'Use the submit_outreach_email tool to provide the subject line and email body.'
  );

  return lines.filter(l => l !== '').join('\n');
}

const outreachEmailSchema = z.object({
  subject: z.string().describe('Email subject line'),
  body: z.string().describe('Professional email body under 300 words')
});

async function callBedrockForOutreach(prompt) {
  const maxRetries = 3;
  const backoffMs = [1000, 2000, 4000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let captured = null;
    const toolDefs = [{
      name: 'submit_outreach_email',
      description: 'Submit the generated outreach email with subject and body.',
      schema: outreachEmailSchema,
      handler: (input) => { captured = input; return { success: true }; }
    }];

    try {
      const systemPrompt = [
        'Role: You are a professional email copywriter specializing in newsletter sponsorship outreach.',
        'Instructions: Write a compelling, personalized outreach email to re-engage a sponsor.',
        'The email should be professional, concise (under 300 words), and data-driven.',
        'Do NOT include internal pricing data like multipliers, baseline prices, confidence justification, bounce rates, or complaint rates.',
        'Narrowing: Only use the submit_outreach_email tool. Do not produce free-text output.'
      ].join('\n');

      await converse(BEDROCK_MODEL_ID, systemPrompt, prompt, toolDefs);

      if (!captured) throw new Error('LLM did not call the submit_outreach_email tool');
      if (!captured.subject || !captured.body) throw new Error('LLM response missing subject or body');

      return { llmResponse: captured, isFallback: false };
    } catch (error) {
      console.warn(`[OUTREACH] Bedrock attempt ${attempt + 1}/${maxRetries} failed:`, error.message);
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoffMs[attempt]));
      }
    }
  }

  console.warn('[OUTREACH] All Bedrock retries exhausted, using template fallback');
  return { llmResponse: null, isFallback: true };
}

// ---------------------------------------------------------------------------
// Persist Outreach Record and Update Job Status
// ---------------------------------------------------------------------------

async function persistOutreachRecord(tenantId, sponsorId, emailContent, pricing, metricsSource, isFallback, clickTotals) {
  const now = new Date().toISOString();
  const sk = `outreach#${sponsorId}#${now}`;
  const metrics = pricing.metrics || {};

  const metricsSnapshot = {
    subscriberCount: metrics.subscriberCount || pricing.subscriberCount || 0,
    openRate: metrics.avgOpenRate || pricing.openRate || 0,
    clickThroughRate: metrics.avgClickRate || pricing.clickThroughRate || 0,
    growthRate: metrics.subscriberGrowthRate || 0
  };

  if (clickTotals && clickTotals.totalClicks > 0) {
    metricsSnapshot.sponsorClickTotals = {
      totalClicks: clickTotals.totalClicks,
      uniqueClicks: clickTotals.uniqueClicks
    };
  }

  const record = {
    pk: tenantId,
    sk,
    sponsorId,
    tenantId,
    generatedAt: now,
    subject: emailContent.subject,
    body: emailContent.body,
    metricsSource,
    isFallback,
    sourcePricingRecordId: pricing.sk || null,
    metricsSnapshot
  };

  await ddb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(record, { removeUndefinedValues: true })
  }));

  return sk;
}

async function updateOutreachJobStatus(tenantId, jobId, status, outreachRecordSk, error) {
  const now = new Date().toISOString();
  const updateParts = ['#status = :status', 'updatedAt = :now'];
  const exprNames = { '#status': 'status' };
  const exprValues = { ':status': status, ':now': now };

  if (outreachRecordSk) {
    updateParts.push('outreachRecordSk = :outreachRecordSk');
    exprValues[':outreachRecordSk'] = outreachRecordSk;
  }
  if (error) {
    updateParts.push('#error = :error');
    exprNames['#error'] = 'error';
    exprValues[':error'] = error;
  }

  await ddb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: tenantId, sk: `outreach-job#${jobId}` }),
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: marshall(exprValues)
  }));
}

async function updateSponsorLastOutreach(tenantId, sponsor) {
  const now = new Date().toISOString();
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk: tenantId, sk: sponsor.sk }),
      UpdateExpression: 'SET lastOutreachAt = :now, updatedAt = :now',
      ExpressionAttributeValues: marshall({ ':now': now })
    }));
  } catch (err) {
    console.warn('[OUTREACH] Failed to update sponsor lastOutreachAt:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Lambda Handler (Task 7.1)
// ---------------------------------------------------------------------------

export const handler = async (event) => {
  const executionStart = Date.now();
  const detail = event.detail || event;
  const { tenantId, sponsorId, jobId } = detail;

  console.log('[OUTREACH] Starting generation', { tenantId, sponsorId, jobId });

  if (!tenantId || !sponsorId || !jobId) {
    throw new Error('tenantId, sponsorId, and jobId are required');
  }

  try {
    // Step 1: Load all required data
    const [sponsor, pricing, fulfilledEntries, cadence] = await Promise.all([
      loadSponsorRecord(tenantId, sponsorId),
      loadLatestPricingRecord(tenantId),
      loadFulfilledSponsorships(tenantId, sponsorId),
      loadPublishingCadence(tenantId)
    ]);

    if (!sponsor) {
      throw new Error(`Sponsor not found: ${sponsorId}`);
    }
    if (!pricing) {
      throw new Error('No pricing record found. Pricing data is required before outreach can be generated.');
    }

    console.log('[OUTREACH] Data loaded', {
      sponsorName: sponsor.sponsorName,
      hasPricing: !!pricing,
      fulfilledCount: fulfilledEntries.length,
      hasCadence: !!cadence
    });

    // Step 2: Compute sponsor-specific click totals
    const clickTotals = await computeSponsorClickTotals(fulfilledEntries);
    const hasClickData = clickTotals.totalClicks > 0;
    const metricsSource = hasClickData ? 'sponsor-specific' : 'general';

    console.log('[OUTREACH] Click totals computed', {
      totalClicks: clickTotals.totalClicks,
      uniqueClicks: clickTotals.uniqueClicks,
      metricsSource
    });

    // Step 3: Build LLM prompt and call Bedrock
    const prompt = buildOutreachPrompt(sponsor, pricing, fulfilledEntries, cadence, clickTotals);
    const { llmResponse, isFallback } = await callBedrockForOutreach(prompt);

    let emailContent;
    if (!isFallback && llmResponse) {
      emailContent = { subject: llmResponse.subject, body: llmResponse.body };
    } else {
      // Template fallback
      emailContent = buildTemplateFallback(sponsor, pricing, fulfilledEntries, cadence);
    }

    console.log('[OUTREACH] Email generated', {
      isFallback,
      subjectLength: emailContent.subject.length,
      bodyLength: emailContent.body.length
    });

    // Step 4: Persist outreach record
    const outreachRecordSk = await persistOutreachRecord(
      tenantId, sponsorId, emailContent, pricing, metricsSource, isFallback, clickTotals
    );

    // Step 5: Update job status to completed
    await updateOutreachJobStatus(tenantId, jobId, 'completed', outreachRecordSk, null);

    // Step 6: Update sponsor's lastOutreachAt
    await updateSponsorLastOutreach(tenantId, sponsor);

    const duration = Date.now() - executionStart;
    console.log(`[OUTREACH] Generation complete in ${duration}ms`, {
      tenantId, sponsorId, isFallback, metricsSource, outreachRecordSk
    });

    return { success: true, tenantId, sponsorId, outreachRecordSk };
  } catch (err) {
    const duration = Date.now() - executionStart;
    console.error(`[OUTREACH] Generation failed in ${duration}ms`, {
      tenantId, sponsorId, error: err.message, stack: err.stack
    });

    if (jobId) {
      try {
        await updateOutreachJobStatus(tenantId, jobId, 'failed', null, err.message);
      } catch (statusErr) {
        console.error('[OUTREACH] Failed to update job status:', statusErr.message);
      }
    }

    throw err;
  }
};
