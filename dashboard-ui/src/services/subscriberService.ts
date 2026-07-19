import { apiClient } from './api';
import { validateSubscriberCountResponse, validateSubscriberTrendsResponse } from '@/utils/dataValidation';
import type { ApiResponse, SubscriberCountResponse, SubscriberTrendsResponse, SubscriberListResponse, SubscriberDetail } from '@/types';

export class SubscriberService {
  /**
   * Per-session cache of subscriber detail (the activity timeline), keyed by
   * email. The detail is a single-item lookup that never changes for a given
   * subscriber within a session, so caching it means the profile modal opens
   * instantly on re-visit and a prefetch on row-hover is not repeated.
   */
  private detailCache = new Map<string, SubscriberDetail>();
  /** In-flight detail requests, so a prefetch + an open coalesce into one call. */
  private detailInFlight = new Map<string, Promise<ApiResponse<SubscriberDetail>>>();

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

  async getList(): Promise<ApiResponse<SubscriberListResponse>> {
    return apiClient.get<SubscriberListResponse>('/subscribers');
  }

  /**
   * Fetch a subscriber's full detail (including the recent-activity timeline).
   * Served from the per-session cache when available, and coalesced with any
   * in-flight request for the same email so a hover-prefetch and the click that
   * follows never fire two calls.
   */
  async getSubscriber(email: string): Promise<ApiResponse<SubscriberDetail>> {
    const cached = this.detailCache.get(email);
    if (cached) {
      return { success: true, data: cached };
    }

    const existing = this.detailInFlight.get(email);
    if (existing) return existing;

    const request = apiClient
      .get<SubscriberDetail>(`/subscribers/${encodeURIComponent(email)}`)
      .then((response) => {
        if (response.success && response.data) {
          this.detailCache.set(email, response.data);
        }
        return response;
      })
      .finally(() => {
        this.detailInFlight.delete(email);
      });

    this.detailInFlight.set(email, request);
    return request;
  }

  /**
   * Warm the detail cache ahead of a click (e.g. on row-hover/focus) so the
   * profile modal has the activity timeline ready by the time it opens. Fire
   * and forget — failures are swallowed and simply retried on actual open.
   */
  prefetchSubscriber(email: string): void {
    if (this.detailCache.has(email) || this.detailInFlight.has(email)) return;
    void this.getSubscriber(email).catch(() => undefined);
  }

  async unsubscribe(email: string): Promise<ApiResponse<void>> {
    const response = await apiClient.delete<void>(`/subscribers/${encodeURIComponent(email)}`);
    // Drop any cached detail so a re-add of the same email doesn't serve stale data.
    this.detailCache.delete(email);
    this.detailInFlight.delete(email);
    return response;
  }
}

export const subscriberService = new SubscriberService();
