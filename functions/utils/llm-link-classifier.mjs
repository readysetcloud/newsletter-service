import { Agent, BedrockModel } from '@strands-agents/sdk';
import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request';
import { z } from 'zod';
import { VALID_TOPICS, TOPICS, getTopicDisplayName } from './topic-taxonomy.mjs';

const MODEL_ID = process.env.MODEL_ID || 'us.amazon.nova-pro-v1:0';
const SUMMARY_MAX_LENGTH = 280;
const CONFIDENCE_THRESHOLD = 0.5;

/** Fixed taxonomy labels the model must choose from. */
const TOPIC_LABELS = Object.keys(TOPICS);

/** Structured output contract for the classification assessment. */
const classificationSchema = z.object({
  primaryTopic: z.enum(TOPIC_LABELS),
  secondaryTopics: z.array(z.enum(TOPIC_LABELS)).max(2).optional(),
  summary: z.string(),
  confidence: z.number().min(0).max(1)
});

const systemPrompt = [
  'Role: You categorize links inside a developer newsletter so readers can be auto-segmented by interest.',
  'You will be given a link URL, its anchor text, and the paragraph the author wrote around it.',
  'You may use httpRequest to inspect the URL when the provided context is ambiguous, but do not request unrelated URLs.',
  'Task:',
  `1. Choose the single best primaryTopic for the link from this fixed taxonomy (use the lowercase label): ${TOPIC_LABELS.map(t => `${t} (${getTopicDisplayName(t)})`).join(', ')}.`,
  '2. Optionally add up to 2 secondaryTopics from the same taxonomy when the link clearly spans more than one. Never repeat the primaryTopic.',
  '3. Write a one-sentence summary (max ~40 words) of what the link is about, grounded in the provided paragraph, anchor text, and any fetched page metadata.',
  '4. Set confidence between 0 and 1 reflecting how sure you are of the primaryTopic.',
  'Return only the structured classification.'
].join('\n');

const buildUserPrompt = (url, anchorText, context) => [
  `URL: ${url}`,
  `Anchor text: ${anchorText || '(none)'}`,
  `Author paragraph: ${context || '(none provided)'}`
].join('\n');

/**
 * Classifies a newsletter link against the fixed topic taxonomy using Strands.
 * The agent may use the vended HTTP request tool to inspect ambiguous links,
 * and returns validated structured output. Best-effort: returns null on any
 * model/tool/validation failure so link tracking can proceed without enrichment.
 *
 * @param {string} url - The original link URL
 * @param {string} anchorText - The link's anchor text from the markdown
 * @param {string} context - The author's paragraph surrounding the link
 * @returns {Promise<{ primaryTopic: string, secondaryTopics: string[], summary: string, confidence: number, classifiedBy: string } | null>}
 */
export async function classifyLinkWithLlm(url, anchorText, context) {
  try {
    const agent = new Agent({
      model: new BedrockModel({
        modelId: MODEL_ID,
        maxTokens: 1200,
        temperature: 0.1,
        stream: false
      }),
      systemPrompt,
      tools: [httpRequest],
      structuredOutputSchema: classificationSchema,
      toolExecutor: 'sequential',
      printer: false
    });

    const result = await agent.invoke(buildUserPrompt(url, anchorText, context), {
      structuredOutputSchema: classificationSchema,
      limits: {
        turns: 3,
        totalTokens: 6000
      },
      cancelSignal: AbortSignal.timeout(10000)
    });

    return normalizeClassification(result.structuredOutput);
  } catch (err) {
    console.error('LLM link classification failed', { url, error: err.message });
    return null;
  }
}

function normalizeClassification(output) {
  if (!output) {
    return null;
  }

  const primaryTopic = VALID_TOPICS.has(output.primaryTopic) ? output.primaryTopic : null;
  if (!primaryTopic) {
    return null;
  }

  const confidence = typeof output.confidence === 'number' ? output.confidence : 1;
  if (confidence < CONFIDENCE_THRESHOLD) {
    return null;
  }

  const secondaryTopics = (output.secondaryTopics ?? [])
    .filter(topic => VALID_TOPICS.has(topic) && topic !== primaryTopic)
    .slice(0, 2);

  const summary = typeof output.summary === 'string'
    ? output.summary.trim().slice(0, SUMMARY_MAX_LENGTH)
    : '';

  return { primaryTopic, secondaryTopics, summary, confidence, classifiedBy: 'llm' };
}
