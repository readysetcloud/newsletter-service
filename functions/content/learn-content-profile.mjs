import { DynamoDBClient, QueryCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Agent, BedrockModel } from '@strands-agents/sdk';
import { z } from 'zod';
import {
  PROFILE_SK,
  MAX_ISSUE_DIGESTS,
  loadContentProfile,
  digestFromLinkRecords,
  mergeIssueDigests,
  buildAggregates
} from '../utils/content-profile.mjs';

const ddb = new DynamoDBClient();

const MODEL_ID = process.env.MODEL_ID || 'us.amazon.nova-pro-v1:0';
const AGENT_TIMEOUT_MS = 20000;
const MAX_PATTERNS = 5;
const MAX_PROFILE_SUMMARY_LENGTH = 600;

/** Structured output contract for the learned editorial profile. */
const editorialSchema = z.object({
  summary: z.string(),
  patterns: z.array(z.string()).max(MAX_PATTERNS)
});

/**
 * Learns a tenant's content profile from what past issues actually featured.
 *
 * Triggered by the ISSUE_PUBLISHED event after each send, and invocable
 * directly with `{ tenantId, backfill: true }` to (re)build from history.
 * Reads recent issues off GSI1, digests each issue's `link#` tracking records
 * (topic classification + click counts), merges the digests into the durable
 * profile record, and asks the model to distill the evidence into an
 * editorial summary the vetting agent can apply to new candidates.
 */
export const handler = async (event) => {
  const tenantId = event.detail?.tenantId ?? event.tenantId;
  if (!tenantId) {
    console.error('Missing tenantId in event');
    return;
  }

  const existingProfile = await loadContentProfile(tenantId) ?? {};
  const recentIssues = await getRecentIssues(tenantId);

  const freshDigests = {};
  for (const issue of recentIssues) {
    const linkRecords = await getIssueLinkRecords(tenantId, issue.issueNumber);
    const digest = digestFromLinkRecords(issue.issueNumber, issue.publishedAt, linkRecords);
    if (digest) {
      freshDigests[String(issue.issueNumber)] = digest;
    }
  }

  const issueDigests = mergeIssueDigests(existingProfile.issueDigests, freshDigests);
  if (!Object.keys(issueDigests).length) {
    console.warn('No issue link data available to learn from', { tenantId });
    return;
  }

  const { topicWeights, exemplars } = buildAggregates(issueDigests);
  const editorialProfile = await generateEditorialProfile(issueDigests, topicWeights, exemplars)
    ?? existingProfile.editorialProfile;

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({
      pk: tenantId,
      sk: PROFILE_SK,
      version: 1,
      updatedAt: new Date().toISOString(),
      issueDigests,
      topicWeights,
      exemplars,
      ...editorialProfile && { editorialProfile }
    }, { removeUndefinedValues: true })
  }));

  console.log('Content profile updated', {
    tenantId,
    issuesAnalyzed: Object.keys(issueDigests).length,
    freshIssues: Object.keys(freshDigests).length
  });
};

/**
 * Lists the most recent published issues from the stats records on GSI1
 * (GSI1PK = `<tenantId>#issue`, GSI1SK = padded issue number).
 */
const getRecentIssues = async (tenantId) => {
  const result = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: marshall({ ':pk': `${tenantId}#issue` }),
    ScanIndexForward: false,
    Limit: MAX_ISSUE_DIGESTS
  }));

  return (result.Items ?? [])
    .map(item => unmarshall(item))
    .filter(item => item.issueNumber !== undefined)
    .map(item => ({
      issueNumber: Number(item.issueNumber),
      publishedAt: item.publishedAt ?? item.createdAt ?? new Date().toISOString()
    }));
};

/** Loads an issue's `link#` tracking records (may be empty once TTL expires). */
const getIssueLinkRecords = async (tenantId, issueNumber) => {
  const items = [];
  let exclusiveStartKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: marshall({
        ':pk': `${tenantId}#${issueNumber}`,
        ':prefix': 'link#'
      }),
      ...exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }
    }));

    items.push(...(result.Items ?? []).map(item => unmarshall(item)));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

const buildLearningPrompt = (issueDigests, topicWeights, exemplars) => {
  const digests = Object.values(issueDigests).sort((a, b) => b.issueNumber - a.issueNumber);

  const topicLines = Object.entries(topicWeights)
    .sort(([, a], [, b]) => b.featured - a.featured)
    .map(([topic, weight]) => `- ${topic}: featured ${weight.featured} times, ${weight.clicks} reader clicks`);

  const exemplarLines = exemplars.map(exemplar =>
    `- ${exemplar.summary || exemplar.url} (topic: ${exemplar.primaryTopic ?? 'unknown'}, issue #${exemplar.issueNumber}, ${exemplar.clicks ?? 0} clicks)`);

  return [
    `Issues analyzed: ${digests.length} (issues #${digests[digests.length - 1].issueNumber}-#${digests[0].issueNumber})`,
    `Total links featured: ${digests.reduce((sum, digest) => sum + (digest.linkCount ?? 0), 0)}`,
    'Topic distribution:',
    ...topicLines,
    'Most-clicked featured links:',
    ...exemplarLines
  ].join('\n');
};

/**
 * Distills the aggregated evidence into an editorial profile. Best-effort:
 * returns null on failure so the previous profile summary is retained.
 */
const generateEditorialProfile = async (issueDigests, topicWeights, exemplars) => {
  try {
    const agent = new Agent({
      model: new BedrockModel({
        modelId: MODEL_ID,
        maxTokens: 1200,
        temperature: 0.2,
        stream: false
      }),
      systemPrompt: [
        'Role: You analyze what a newsletter has actually featured to describe its editorial profile.',
        'You will receive the topic distribution and most-clicked links from recent issues.',
        'Task:',
        '1. Write a 2-3 sentence summary of the kind of content this newsletter features, grounded strictly in the evidence provided. Note which topics dominate and which reader clicks favor.',
        `2. List up to ${MAX_PATTERNS} short, concrete selection patterns an editor could apply to new candidate links (e.g. "hands-on tutorials outperform announcement posts").`,
        'Do not invent topics or preferences the evidence does not support.',
        'Return only the structured profile.'
      ].join('\n'),
      structuredOutputSchema: editorialSchema,
      toolExecutor: 'sequential',
      printer: false
    });

    const result = await agent.invoke(buildLearningPrompt(issueDigests, topicWeights, exemplars), {
      structuredOutputSchema: editorialSchema,
      limits: {
        turns: 2,
        totalTokens: 8000
      },
      cancelSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS)
    });

    return normalizeEditorialProfile(result.structuredOutput, issueDigests);
  } catch (err) {
    console.error('Editorial profile generation failed', { error: err.message });
    return null;
  }
};

const normalizeEditorialProfile = (output, issueDigests) => {
  if (!output || typeof output.summary !== 'string' || !output.summary.trim()) {
    return null;
  }

  const digests = Object.values(issueDigests);
  return {
    summary: output.summary.trim().slice(0, MAX_PROFILE_SUMMARY_LENGTH),
    patterns: (output.patterns ?? [])
      .filter(pattern => typeof pattern === 'string' && pattern.trim())
      .map(pattern => pattern.trim())
      .slice(0, MAX_PATTERNS),
    generatedAt: new Date().toISOString(),
    issuesAnalyzed: digests.length,
    linksAnalyzed: digests.reduce((sum, digest) => sum + (digest.linkCount ?? 0), 0)
  };
};
