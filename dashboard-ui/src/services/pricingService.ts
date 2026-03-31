import { apiClient } from './api';
import type {
  ApiResponse,
  PricingData,
  PricingHistoryData,
  JobStatus,
  Questionnaire,
  QuestionnaireResponse,
} from '@/types';

/**
 * Pricing Service - Handles all sponsorship pricing API operations
 */
export class PricingService {
  /**
   * Get current pricing data for the authenticated tenant
   */
  async getPricing(): Promise<ApiResponse<PricingData>> {
    return apiClient.get<PricingData>('/pricing');
  }

  /**
   * Get pricing history (up to 52 weekly records) for the trend chart
   */
  async getPricingHistory(): Promise<ApiResponse<PricingHistoryData>> {
    return apiClient.get<PricingHistoryData>('/pricing/history');
  }

  /**
   * Trigger an on-demand price recalculation
   */
  async triggerRecalculation(): Promise<ApiResponse<{ jobId: string }>> {
    return apiClient.post<{ jobId: string }>('/pricing/recalculate');
  }

  /**
   * Poll the status of an in-progress recalculation job
   */
  async pollRecalculationStatus(jobId: string): Promise<ApiResponse<JobStatus>> {
    return apiClient.get<JobStatus>(`/pricing/recalculate/${encodeURIComponent(jobId)}`);
  }

  /**
   * Get the pricing questionnaire for the authenticated tenant
   */
  async getQuestionnaire(): Promise<ApiResponse<Questionnaire>> {
    return apiClient.get<Questionnaire>('/pricing/questionnaire');
  }

  /**
   * Submit questionnaire responses and trigger a recalculation
   */
  async submitQuestionnaire(
    version: string,
    responses: QuestionnaireResponse[]
  ): Promise<ApiResponse<{ jobId: string }>> {
    return apiClient.post<{ jobId: string }>('/pricing/questionnaire', {
      version,
      responses,
    });
  }
}

// Export singleton instance
export const pricingService = new PricingService();
