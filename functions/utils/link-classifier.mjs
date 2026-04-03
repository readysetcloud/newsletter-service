/**
 * Heuristic V1 link classifier.
 * Assigns topics from the Platform_Topic_Taxonomy based on:
 *   1. Anchor text keyword matching (primary signal, highest weight)
 *   2. Domain matching (supporting signal)
 *   3. URL path keyword matching (supporting signal)
 *
 * classifiedBy is always "heuristic". Confidence is binary:
 * 1.0 if any topic matched, 0.0 otherwise.
 */

import { VALID_TOPICS, TOPICS } from './topic-taxonomy.mjs';

/** Weight for anchor text keyword matches (primary signal) */
const ANCHOR_WEIGHT = 3.0;

/** Weight for domain matches (supporting signal) */
const DOMAIN_WEIGHT = 1.5;

/** Weight for path keyword matches (supporting signal) */
const PATH_WEIGHT = 1.0;

/**
 * Keyword lists per topic for anchor text and path matching.
 * Each keyword is lowercase. Multi-word keywords use spaces.
 */
const TOPIC_KEYWORDS = {
  ai: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning', 'neural network', 'llm', 'gpt', 'chatgpt', 'generative ai', 'nlp', 'computer vision', 'bedrock', 'sagemaker'],
  serverless: ['serverless', 'lambda', 'faas', 'functions as a service', 'step functions', 'cloud functions', 'azure functions', 'event driven', 'api gateway'],
  eda: ['event-driven', 'event driven architecture', 'eda', 'eventbridge', 'event bus', 'event sourcing', 'cqrs', 'message queue', 'pub sub', 'pubsub', 'sns', 'sqs', 'kafka', 'rabbitmq'],
  devops: ['devops', 'ci/cd', 'cicd', 'continuous integration', 'continuous delivery', 'continuous deployment', 'infrastructure as code', 'iac', 'terraform', 'cloudformation', 'ansible', 'jenkins', 'github actions', 'pipeline'],
  security: ['security', 'cybersecurity', 'vulnerability', 'authentication', 'authorization', 'oauth', 'encryption', 'zero trust', 'iam', 'penetration testing', 'owasp', 'cve', 'firewall'],
  frontend: ['frontend', 'front-end', 'react', 'vue', 'angular', 'svelte', 'css', 'html', 'javascript', 'typescript', 'web components', 'ui', 'ux', 'responsive design', 'tailwind', 'nextjs', 'next.js'],
  databases: ['database', 'databases', 'sql', 'nosql', 'dynamodb', 'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'rds', 'aurora', 'cassandra', 'data modeling'],
  career: ['career', 'hiring', 'interview', 'resume', 'job', 'salary', 'promotion', 'mentorship', 'leadership', 'developer experience', 'burnout', 'remote work', 'tech lead'],
  cloud: ['cloud', 'aws', 'azure', 'gcp', 'cloud computing', 'multi-cloud', 'hybrid cloud', 'cloud native', 'cloud migration', 'ec2', 's3', 'cloud architecture'],
  apis: ['api', 'apis', 'rest', 'restful', 'graphql', 'grpc', 'openapi', 'swagger', 'webhook', 'webhooks', 'api design', 'api gateway', 'endpoint'],
  testing: ['testing', 'test', 'unit test', 'integration test', 'e2e', 'end to end', 'tdd', 'bdd', 'test driven', 'jest', 'cypress', 'playwright', 'property based testing', 'qa'],
  observability: ['observability', 'monitoring', 'logging', 'tracing', 'metrics', 'apm', 'cloudwatch', 'datadog', 'grafana', 'prometheus', 'opentelemetry', 'alerting', 'dashboards'],
};

/**
 * Known domain-to-topic mappings (supporting signal).
 * Keys are domain substrings; values are topic labels.
 */
const DOMAIN_MAPPINGS = [
  { pattern: 'aws.amazon.com/lambda', topic: 'serverless' },
  { pattern: 'aws.amazon.com/step-functions', topic: 'serverless' },
  { pattern: 'aws.amazon.com/eventbridge', topic: 'eda' },
  { pattern: 'aws.amazon.com/sqs', topic: 'eda' },
  { pattern: 'aws.amazon.com/sns', topic: 'eda' },
  { pattern: 'aws.amazon.com/dynamodb', topic: 'databases' },
  { pattern: 'aws.amazon.com/rds', topic: 'databases' },
  { pattern: 'aws.amazon.com/bedrock', topic: 'ai' },
  { pattern: 'aws.amazon.com/sagemaker', topic: 'ai' },
  { pattern: 'aws.amazon.com/cloudwatch', topic: 'observability' },
  { pattern: 'aws.amazon.com/iam', topic: 'security' },
  { pattern: 'aws.amazon.com/cloudformation', topic: 'devops' },
  { pattern: 'openai.com', topic: 'ai' },
  { pattern: 'huggingface.co', topic: 'ai' },
  { pattern: 'reactjs.org', topic: 'frontend' },
  { pattern: 'react.dev', topic: 'frontend' },
  { pattern: 'vuejs.org', topic: 'frontend' },
  { pattern: 'angular.io', topic: 'frontend' },
  { pattern: 'svelte.dev', topic: 'frontend' },
  { pattern: 'terraform.io', topic: 'devops' },
  { pattern: 'jenkins.io', topic: 'devops' },
  { pattern: 'graphql.org', topic: 'apis' },
  { pattern: 'swagger.io', topic: 'apis' },
  { pattern: 'owasp.org', topic: 'security' },
  { pattern: 'datadog.com', topic: 'observability' },
  { pattern: 'grafana.com', topic: 'observability' },
  { pattern: 'jestjs.io', topic: 'testing' },
  { pattern: 'cypress.io', topic: 'testing' },
  { pattern: 'playwright.dev', topic: 'testing' },
];

/**
 * Tokenizes text into lowercase words, splitting on non-alphanumeric characters.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().split(/[^a-z0-9/.-]+/).filter(Boolean);
}

/**
 * Scores topics based on anchor text keyword matching (primary signal).
 * Checks both individual tokens and bigrams against keyword lists.
 * @param {string} anchorText
 * @returns {Map<string, number>}
 */
function scoreAnchorText(anchorText) {
  const scores = new Map();
  if (!anchorText) return scores;

  const lowerText = anchorText.toLowerCase();
  const tokens = tokenize(anchorText);

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const keyword of keywords) {
      if (keyword.includes(' ') || keyword.includes('/') || keyword.includes('-') || keyword.includes('.')) {
        // Multi-word or special-char keyword: check full text
        if (lowerText.includes(keyword)) {
          scores.set(topic, (scores.get(topic) || 0) + ANCHOR_WEIGHT);
        }
      } else {
        // Single-word keyword: check tokens
        if (tokens.includes(keyword)) {
          scores.set(topic, (scores.get(topic) || 0) + ANCHOR_WEIGHT);
        }
      }
    }
  }

  return scores;
}

/**
 * Scores topics based on known domain mappings (supporting signal).
 * @param {string} url
 * @returns {Map<string, number>}
 */
function scoreDomain(url) {
  const scores = new Map();
  if (!url) return scores;

  const lowerUrl = url.toLowerCase();
  for (const { pattern, topic } of DOMAIN_MAPPINGS) {
    if (lowerUrl.includes(pattern)) {
      scores.set(topic, (scores.get(topic) || 0) + DOMAIN_WEIGHT);
    }
  }

  return scores;
}

/**
 * Scores topics based on URL path keyword matching (supporting signal).
 * @param {string} url
 * @returns {Map<string, number>}
 */
function scorePath(url) {
  const scores = new Map();
  if (!url) return scores;

  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return scores;
  }

  // Split path on slashes, hyphens, dots, and underscores for broader matching
  const pathTokens = pathname.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const keyword of keywords) {
      // Only match single-word keywords in path segments
      if (!keyword.includes(' ') && pathTokens.includes(keyword)) {
        scores.set(topic, (scores.get(topic) || 0) + PATH_WEIGHT);
      }
    }
  }

  return scores;
}

/**
 * Merges multiple score maps into one combined map.
 * @param  {...Map<string, number>} maps
 * @returns {Map<string, number>}
 */
function mergeScores(...maps) {
  const combined = new Map();
  for (const map of maps) {
    for (const [topic, score] of map) {
      combined.set(topic, (combined.get(topic) || 0) + score);
    }
  }
  return combined;
}

/**
 * Classifies a link by matching URL patterns and anchor text against
 * the Platform_Topic_Taxonomy.
 *
 * @param {string} url - The normalized link URL
 * @param {string} anchorText - The link's anchor text from the HTML/markdown
 * @returns {{ primaryTopic: string|null, secondaryTopics: string[], confidence: number, classifiedBy: string }}
 */
export function classifyLink(url, anchorText) {
  const anchorScores = scoreAnchorText(anchorText);
  const domainScores = scoreDomain(url);
  const pathScores = scorePath(url);

  const combined = mergeScores(anchorScores, domainScores, pathScores);

  // Sort topics by score descending, then alphabetically for determinism
  const sorted = [...combined.entries()]
    .filter(([topic]) => VALID_TOPICS.has(topic))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (sorted.length === 0) {
    return {
      primaryTopic: null,
      secondaryTopics: [],
      confidence: 0.0,
      classifiedBy: 'heuristic',
    };
  }

  const primaryTopic = sorted[0][0];
  const secondaryTopics = sorted
    .slice(1, 3) // max 2 secondary topics
    .map(([topic]) => topic);

  return {
    primaryTopic,
    secondaryTopics,
    confidence: 1.0,
    classifiedBy: 'heuristic',
  };
}
