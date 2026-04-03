/**
 * Platform-wide topic taxonomy. Fixed set of content categories.
 * Not configurable per tenant in V1.
 */
export const TOPICS = Object.freeze({
  ai:            { label: 'ai',            display: 'AI' },
  serverless:    { label: 'serverless',    display: 'Serverless' },
  eda:           { label: 'eda',           display: 'Event-Driven Architecture' },
  devops:        { label: 'devops',        display: 'DevOps' },
  security:      { label: 'security',      display: 'Security' },
  frontend:      { label: 'frontend',      display: 'Frontend' },
  databases:     { label: 'databases',     display: 'Databases' },
  career:        { label: 'career',        display: 'Career' },
  cloud:         { label: 'cloud',         display: 'Cloud' },
  apis:          { label: 'apis',          display: 'APIs' },
  testing:       { label: 'testing',       display: 'Testing' },
  observability: { label: 'observability', display: 'Observability' },
});

/** Set of valid topic labels for validation */
export const VALID_TOPICS = new Set(Object.keys(TOPICS));

/** Default auto-segment threshold */
export const AUTO_SEGMENT_THRESHOLD = 3;

/** Score increments */
export const PRIMARY_SCORE_INCREMENT = 1.0;
export const SECONDARY_SCORE_INCREMENT = 0.5;
export const MAX_SCORE_PER_CLICK = 1.5;

/**
 * Get display name for a topic label.
 * @param {string} label - Topic label (e.g., 'ai')
 * @returns {string} Display name (e.g., 'AI') or the label itself if not found
 */
export function getTopicDisplayName(label) {
  return TOPICS[label]?.display ?? label;
}
