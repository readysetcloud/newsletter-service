import { apiClient } from './api';
import type {
  ListNotificationsParams,
  ListNotificationsResponse,
  MarkReadResponse,
} from '@/types/notifications';
import type { ApiResponse } from '@/types';

/**
 * Service for reading and clearing in-app notifications.
 */
class NotificationsService {
  /**
   * A page of notifications, newest first, with the unread count alongside.
   *
   * @param params.limit - Maximum to return (server caps this at 50)
   * @param params.nextToken - Token from a previous response
   * @param params.unreadOnly - Return only notifications not yet read
   */
  async listNotifications(
    params?: ListNotificationsParams
  ): Promise<ApiResponse<ListNotificationsResponse>> {
    const queryParams = new URLSearchParams();

    if (params?.limit) {
      queryParams.append('limit', params.limit.toString());
    }
    if (params?.nextToken) {
      queryParams.append('nextToken', params.nextToken);
    }
    if (params?.unreadOnly) {
      queryParams.append('unreadOnly', 'true');
    }

    const query = queryParams.toString();

    return apiClient.get<ListNotificationsResponse>(
      query ? `/notifications?${query}` : '/notifications'
    );
  }

  /**
   * Marks one notification read, for everyone on the tenant.
   *
   * Idempotent: marking one that is already read leaves its original timestamp
   * alone rather than moving it forward.
   */
  async markRead(id: string): Promise<ApiResponse<MarkReadResponse>> {
    return apiClient.put<MarkReadResponse>(`/notifications/${encodeURIComponent(id)}/read`, {});
  }

  /**
   * Marks everything read.
   *
   * The server bounds how many one call touches, so the response says how many
   * it actually marked and whether more were left behind.
   */
  async markAllRead(): Promise<ApiResponse<MarkReadResponse>> {
    return apiClient.post<MarkReadResponse>('/notifications/read-all', {});
  }
}

export const notificationsService = new NotificationsService();
export default notificationsService;
