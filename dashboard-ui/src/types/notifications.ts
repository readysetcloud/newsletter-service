/**
 * Types for in-app notifications.
 *
 * These mirror the backend contract for `GET /notifications`,
 * `PUT /notifications/{id}/read` and `POST /notifications/read-all`. The stored
 * shape lives in `functions/utils/notification-record.mjs`.
 */

/**
 * What happened. The dashboard picks an icon and a tone from this rather than
 * from the wording, so a copy change never changes how something renders.
 */
export type NotificationType =
  | 'report.ready'
  | 'report.empty'
  | 'report.failed'
  | 'issue.published'
  | 'issue.failed'
  | 'sender.verified'
  | 'sender.failed'
  | 'billing.payment_succeeded'
  | 'billing.payment_failed';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  /** Stable for the event that produced it, so a retry is not a second row. */
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  /** Where in the dashboard this is about. Absent when nowhere in particular. */
  link?: string;
  createdAt: string;
  /** Absent while unread. Shared across everyone on the tenant. */
  readAt?: string;
}

export interface ListNotificationsParams {
  limit?: number;
  nextToken?: string;
  unreadOnly?: boolean;
}

export interface ListNotificationsResponse {
  notifications: Notification[];
  nextToken?: string;
  /**
   * Unread within the most recent notifications, not over all history — see
   * `unreadCountCapped`. A badge figure, not an accounting one.
   */
  unreadCount: number;
  /** True when there may be more unread than `unreadCount` says. */
  unreadCountCapped: boolean;
}

export interface MarkReadResponse {
  /** How many this call actually marked, which is bounded server-side. */
  marked: number;
  /** True when unread ones were left for a further call. */
  moreRemaining: boolean;
}
