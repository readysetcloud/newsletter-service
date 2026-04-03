import { apiClient } from './api';
import { validateSubscriberCountResponse, validateSubscriberTrendsResponse } from '@/utils/dataValidation';
import type { ApiResponse, SubscriberCountResponse, SubscriberTrendsResponse } from '@/types';

export class SubscriberService {
  async getCount(): Promise<ApiResponse<SubscriberCountResponse>> {
    const response = await apiClient.get<SubscriberCountResponse>('/subscribers/count');

    if (response.success && response.data && !validateSubscriberCountResponse(response.data)) {
      return {
        success: false,
        error: 'Invalid subscriber count data structure received from server',
      };
    }

    return response;
  }

  async getTrends(issueCount: number = 10): Promise<ApiResponse<SubscriberTrendsResponse>> {
    const response = await apiClient.get<SubscriberTrendsResponse>(`/subscribers/trends?issueCount=${issueCount}`);

    if (response.success && response.data && !validateSubscriberTrendsResponse(response.data)) {
      return {
        success: false,
        error: 'Invalid subscriber trends data structure received from server',
      };
    }

    return response;
  }
}

export const subscriberService = new SubscriberService();
