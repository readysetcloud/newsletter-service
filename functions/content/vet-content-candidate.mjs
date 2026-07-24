import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Agent, BedrockModel } from '@strands-agents/sdk';
import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request';
import { z } from 'zod';
import { getTenant } from '../utils/helpers.mjs';
import { loadContentProfile, formatProfileForPrompt } from '../utils/content-profile.mjs';

const ddb = new DynamoDBClient();

const MODEL_ID = process.env.MODEL_ID || 'us.amazon.nova-pro-v1:0';
const REDIRECT_TIMEOUT_MS = 8000;
const AGENT_TIMEOUT_MS = 25000;
const MAX_SUMMARY_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;
const MAX_REASONS = 3;

const RECOMMENDATIONS = ['include', 'maybe', 'skip'];

/** Structured output contract for the vetting assessment. */
const verdictSchema = z.object({
  recommendation: z.enum(RECOMMENDATIONS),
  score: z.number().min(0).max(1),
  title: z.string(),
  summary: z.string(),
  reasons: z.array(z.string()).max(MAX_REASONS),
  evidence: z.array(z.string()).max(MAX_REASONS).optional()
});

/**
 * Vets a submitted content candidate for newsletter inclusion. Triggered by
 * the Content Candidate Submitted event. Resolves redirect wrappers (e.g.
 * lnkd.in short links), asks the model to judge fit against the tenant's
 * newsletter focus, and stores the verdict on the candidate record.
 */
export const handler = async (event) => {
  const { tenantId, urlHash } = event.detail ?? {};
  if (!tenantId || !urlHash) {
    console.error('Missing tenantId or urlHash in event detail');
    return;
  }

  const key = {
    pk: `${tenantId}#content-candidate#${urlHash}`,
    sk: 'candidate'
  };

  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall(key)
  }));

  if (!result.Item) {
    console.warn('Content candidate not found', { tenantId, urlHash });
    return;
  }

  const candidate = unmarshall(result.Item);
  if (candidate.status !== 'pending') {
    return;
  }

  const resolvedUrl = await resolveRedirects(candidate.originalUrl ?? candidate.url);
  const [brandProfile, learnedProfile] = await Promise.all([
    getNewsletterProfile(tenantId),
    loadContentProfile(tenantId)
  ]);
  const verdict = await vetCandidate(candidate, resolvedUrl, brandProfile, learnedProfile);

  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall(key),
    UpdateExpression: 'SET #status = :status, vettedAt = :vettedAt' +
      (resolvedUrl ? ', resolvedUrl = :resolvedUrl' : '') +
      (verdict ? ', verdict = :verdict' : ''),
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: marshall({
      ':status': verdict ? 'vetted' : 'failed',
      ':vettedAt': new Date().toISOString(),
      ...resolvedUrl && { ':resolvedUrl': resolvedUrl },
      ...verdict && { ':verdict': verdict }
    }, { removeUndefinedValues: true })
  }));
};

/**
 * Follows HTTP redirects to unwrap shorteners like lnkd.in. Also handles
 * meta-refresh interstitial pages. Best-effort: returns null when the URL
 * cannot be resolved so vetting can continue on the submitted URL.
 */
const resolveRedirects = async (url) => {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsletterCurator/1.0)' }
    });

    let finalUrl = response.url || url;

    // lnkd.in sometimes serves an HTML interstitial instead of a 30x redirect
    if (new URL(finalUrl).hostname === 'lnkd.in' && (response.headers.get('content-type') || '').includes('text/html')) {
      const html = (await response.text()).slice(0, 100000);
      const metaRefresh = html.match(/http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i)
        || html.match(/data-tracking-control-name[^>]*href=["']([^"']+)["']/i);
      if (metaRefresh?.[1]) {
        finalUrl = decodeHtmlEntities(metaRefresh[1]);
      }
    }

    return finalUrl !== url ? finalUrl : null;
  } catch (err) {
    console.warn('Failed to resolve redirects', { url, error: err.message });
    return null;
  }
};

const decodeHtmlEntities = (value) => value
  .replace(/&amp;/g, '&')
  .replace(/&#x2F;/gi, '/')
  .replace(/&#47;/g, '/');

/** Loads tenant branding to ground the vetting prompt. Best-effort. */
const getNewsletterProfile = async (tenantId) => {
  try {
    const tenant = await getTenant(tenantId);
    return {
      name: tenant.name,
      description: tenant.brandDescription,
      industry: tenant.industry
    };
  } catch (err) {
    console.warn('Failed to load tenant profile for vetting', { tenantId, error: err.message });
    return {};
  }
};

const buildSystemPrompt = (profile, learnedProfileText) => [
  'Role: You vet links saved from social media as candidate content for a curated newsletter.',
  'The curator highlights great content from their community, so judge each link as a newsletter editor would.',
  profile.name ? `The newsletter is "${profile.name}".` : null,
  profile.description ? `Newsletter focus: ${profile.description}` : null,
  profile.industry ? `Industry: ${profile.industry}` : null,
  ...learnedProfileText ? [
    'Evidence of what this newsletter actually features, learned from past issues:',
    learnedProfileText,
    'Weigh this evidence above the stated focus when they disagree - it reflects real editorial decisions and reader engagement.'
  ] : [],
  'You may use httpRequest to fetch the candidate URL and inspect its content. Do not request unrelated URLs.',
  'Evaluate:',
  '1. Relevance - does the content fit the newsletter focus and interest its readers?',
  learnedProfileText
    ? '2. Track record - does it resemble content the newsletter has actually featured, especially content readers clicked?'
    : null,
  '3. Quality - is it substantive (article, video, tool, open-source project, talk) rather than engagement bait, a job post, or pure marketing?',
  '4. Freshness - prefer content that is current or evergreen.',
  'Return the structured verdict:',
  '- recommendation: "include" for strong fits, "maybe" for borderline, "skip" for poor fits.',
  '- score: 0 to 1 reflecting overall newsletter fit.',
  '- title: the content\'s actual title (fetch the page if needed; fall back to a descriptive title).',
  '- summary: 1-2 sentences (max ~60 words) a newsletter editor could adapt when featuring the link.',
  `- reasons: up to ${MAX_REASONS} short phrases explaining the recommendation.`,
  ...learnedProfileText ? [
    `- evidence: up to ${MAX_REASONS} references to the past-issue evidence supporting the verdict (e.g. "similar to <featured link summary> from issue #12"). Cite only evidence listed above; omit when nothing applies.`
  ] : []
].filter(Boolean).join('\n');

const buildUserPrompt = (candidate, resolvedUrl) => [
  `URL: ${resolvedUrl ?? candidate.url}`,
  resolvedUrl ? `Originally shared as: ${candidate.url}` : null,
  candidate.anchorText ? `Anchor text: ${candidate.anchorText}` : null,
  candidate.post?.author ? `Shared by: ${candidate.post.author}` : null,
  candidate.post?.text ? `Post text: ${candidate.post.text}` : null
].filter(Boolean).join('\n');

/**
 * Runs the vetting agent. Best-effort: returns null on any model, tool, or
 * validation failure so the candidate is marked failed rather than lost.
 */
const vetCandidate = async (candidate, resolvedUrl, profile, learnedProfile) => {
  try {
    const agent = new Agent({
      model: new BedrockModel({
        modelId: MODEL_ID,
        maxTokens: 1500,
        temperature: 0.1,
        stream: false
      }),
      systemPrompt: buildSystemPrompt(profile, formatProfileForPrompt(learnedProfile)),
      tools: [httpRequest],
      structuredOutputSchema: verdictSchema,
      toolExecutor: 'sequential',
      printer: false
    });

    const result = await agent.invoke(buildUserPrompt(candidate, resolvedUrl), {
      structuredOutputSchema: verdictSchema,
      limits: {
        turns: 4,
        totalTokens: 12000
      },
      cancelSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS)
    });

    return normalizeVerdict(result.structuredOutput);
  } catch (err) {
    console.error('Content vetting failed', { url: candidate.url, error: err.message });
    return null;
  }
};

const normalizeVerdict = (output) => {
  if (!output || !RECOMMENDATIONS.includes(output.recommendation)) {
    return null;
  }

  const evidence = (output.evidence ?? [])
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim())
    .slice(0, MAX_REASONS);

  return {
    recommendation: output.recommendation,
    score: Math.min(1, Math.max(0, typeof output.score === 'number' ? output.score : 0)),
    title: typeof output.title === 'string' ? output.title.trim().slice(0, MAX_TITLE_LENGTH) : '',
    summary: typeof output.summary === 'string' ? output.summary.trim().slice(0, MAX_SUMMARY_LENGTH) : '',
    reasons: (output.reasons ?? [])
      .filter(reason => typeof reason === 'string' && reason.trim())
      .map(reason => reason.trim())
      .slice(0, MAX_REASONS),
    ...evidence.length && { evidence }
  };
};
