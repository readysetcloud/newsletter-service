import type { InterestScoreEntry } from '@/services/segmentService';

export const TOPIC_DISPLAY_NAMES: Record<string, string> = {
  ai: 'AI',
  serverless: 'Serverless',
  eda: 'Event-Driven Architecture',
  devops: 'DevOps',
  security: 'Security',
  frontend: 'Frontend',
  databases: 'Databases',
  career: 'Career',
  cloud: 'Cloud',
  apis: 'APIs',
  testing: 'Testing',
  observability: 'Observability',
};

export function getTopicDisplayName(label: string): string {
  return TOPIC_DISPLAY_NAMES[label] ?? label;
}

export type RecencyStatus = 'active' | 'recent' | 'stale';

export function getRecencyStatus(lastScoredAt: string): RecencyStatus {
  const now = Date.now();
  const scored = new Date(lastScoredAt).getTime();
  const daysSince = (now - scored) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return 'active';
  if (daysSince <= 30) return 'recent';
  return 'stale';
}

export interface SortedInterestEntry {
  topic: string;
  displayName: string;
  score: number;
  recency: RecencyStatus;
}

export function getSortedInterestProfile(
  interestScores?: Record<string, InterestScoreEntry>
): SortedInterestEntry[] {
  if (!interestScores) return [];
  return Object.entries(interestScores)
    .filter(([, entry]) => entry.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([topic, entry]) => ({
      topic,
      displayName: getTopicDisplayName(topic),
      score: entry.score,
      recency: getRecencyStatus(entry.lastScoredAt),
    }));
}

export const RECENCY_STYLES: Record<RecencyStatus, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  recent: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  stale: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};
