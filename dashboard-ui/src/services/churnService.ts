import { apiClient } from './api';
import type { ApiResponse } from '@/types';

/** A single leading-indicator churn-risk reason (matches the Rust API enum). */
export type ChurnRiskReason = 'fading' | 'interest_stale' | 'streak_break';

export interface AtRiskSubscriber {
  email: string;
  lastEngagedIssue?: number | null;
  engagementCount: number;
  reasons: ChurnRiskReason[];
  topTopic?: string;
}

export interface AtRiskSummary {
  total: number;
  byReason: {
    fading: number;
    interestStale: number;
    streakBreak: number;
  };
}

export interface AtRiskResponse {
  atRisk: AtRiskSubscriber[];
  summary: AtRiskSummary;
}

/** Human-readable labels for the reason chips, keyed by the API reason string. */
export const CHURN_REASON_LABELS: Record<ChurnRiskReason, string> = {
  fading: 'Fading',
  interest_stale: 'Interests gone stale (AI)',
  streak_break: 'Streak broken',
};

export class ChurnService {
  async getAtRisk(latestIssueNumber: number): Promise<ApiResponse<AtRiskResponse>> {
    return apiClient.get<AtRiskResponse>(
      `/subscribers/at-risk?latestIssueNumber=${latestIssueNumber}`
    );
  }
}

export const churnService = new ChurnService();
