import { z } from 'zod';
import { converse } from './agents.mjs';
import { VALID_TOPICS, TOPICS, getTopicDisplayName } from './topic-taxonomy.mjs';

const MODEL_ID = process.env.MODEL_ID || 'us.amazon.nova-pro-v1:0';

/** Fixed taxonomy labels the model must choose from. */
const TOPIC_LABELS = Object.keys(TOPICS);

/** Structured output contract for the classification tool. */
const classificationSchema = z.object({
  primaryTopic: z.enum(TOPIC_LABELS),
  secondaryTopics: z.array(z.enum(TOPIC_LABELS)).max(2).optional(),
  summary: z.string(),
  confidence: z.number().min(0).max(1)
});

const SUMMARY_MAX_LENGTH = 280;

/** Minimum confidence required to store a classification (drives segmentation). */
const CONFIDENCE_THRESHOLD = 0.5;

const systemPrompt = [
  'Role: You categorize links inside a developer newsletter so readers can be auto-segmented by interest.',
  'You will be given a link URL, its anchor text, and the paragraph the author wrote around it.',
  'Task:',
  `1. Choose the single best primaryTopic for the link from this fixed taxonomy (use the lowercase label): ${TOPIC_LABELS.map(t => `${t} (${getTopicDisplayName(t)})`).join(', ')}.`,
  '2. Optionally add up to 2 secondaryTopics from the same taxonomy when the link clearly spans more than one. Never repeat the primaryTopic.',
  '3. Write a one-sentence summary (max ~40 words) of what the link is about, grounded in the provided paragraph and anchor text.',
  '4. Set confidence between 0 and 1 reflecting how sure you are of the primaryTopic.',
  'Only the listed topic labels are valid. Call the submit_link_classification tool exactly once and produce no free-text output.'
].join('\n');

const buildUserPrompt = (url, anchorText, context) => [
  `URL: ${url}`,
  `Anchor text: ${anchorText || '(none)'}`,
  `Author paragraph: ${context || '(none provided)'}`
].join('\n');

/**
 * Classifies a newsletter link against the fixed topic taxonomy using the
 * author's surrounding paragraph as context, returning the topics plus a
 * short summary. Best-effort: returns null on any model/validation failure
 * so the link-tracking pipeline can proceed without enrichment.
 *
 * @param {string} url - The original link URL
 * @param {string} anchorText - The link's anchor text from the markdown
 * @param {string} context - The author's paragraph surrounding the link
 * @returns {Promise<{ primaryTopic: string, secondaryTopics: string[], summary: string, confidence: number, classifiedBy: string } | null>}
 */
export async function classifyLinkWithLlm(url, anchorText, context) {
  let captured = null;
  const toolDefs = [{
    name: 'submit_link_classification',
    description: 'Submit the topic classification and summary for the link.',
    schema: classificationSchema,
    handler: (input) => { captured = input; return { success: true }; }
  }];

  try {
    await converse(MODEL_ID, systemPrompt, buildUserPrompt(url, anchorText, context), toolDefs);
  } catch (err) {
    console.error('LLM link classification failed', { url, error: err.message });
    return null;
  }

  if (!captured) {
    console.warn('LLM link classification returned no result', { url });
    return null;
  }

  const primaryTopic = VALID_TOPICS.has(captured.primaryTopic) ? captured.primaryTopic : null;
  if (!primaryTopic) {
    return null;
  }

  const secondaryTopics = (captured.secondaryTopics ?? [])
    .filter(topic => VALID_TOPICS.has(topic) && topic !== primaryTopic)
    .slice(0, 2);

  const summary = typeof captured.summary === 'string'
    ? captured.summary.trim().slice(0, SUMMARY_MAX_LENGTH)
    : '';

  const confidence = typeof captured.confidence === 'number' ? captured.confidence : 1;

  // Don't drive segmentation off ambiguous classifications. Mirrors the
  // bar the previous heuristic classifier used.
  if (confidence < CONFIDENCE_THRESHOLD) {
    return null;
  }

  return { primaryTopic, secondaryTopics, summary, confidence, classifiedBy: 'llm' };
}
