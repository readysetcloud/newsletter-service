import { apiClient } from './api';
import { validateIssueAnalytics, validateIssueStats, validateTrendsData } from '@/utils/dataValidation';
import type {
  Issue,
  IssueAnalytics,
  IssueListItem,
  IssueMetrics,
  TrendsData,
  CreateIssueRequest,
  UpdateIssueRequest,
  RescheduleIssueRequest,
  RescheduleIssueResponse,
  ListIssuesParams,
  VariantId,
  AbHistoryResponse,
  ActiveAbTestsResponse,
  AbSuggestionRequest,
  AbSuggestionResponse,
} from '@/types/issues';
import type { ApiResponse } from '@/types';
import { calculateCompositeScore } from '@/utils/analyticsCalculations';

/** The enriched analytics report the aggregation pipeline writes over `stats.analytics`. */
interface ReportEnvelope {
  eventAnalytics?: IssueAnalytics | null;
}

/**
 * Whether `stats.analytics` is the report envelope rather than the raw event
 * analytics this UI renders.
 *
 * Keyed on `currentMetrics`, which is the marker the report builder itself
 * uses to tell its own output apart from an event-analytics blob — and
 * deliberately not on `eventAnalytics` being truthy. The envelope carries
 * `eventAnalytics: null` for any issue that never produced that slice, and
 * reading that as "not an envelope" hands the whole report object to the page
 * as if it were `IssueAnalytics`. It has none of that shape, so validation
 * rejects it, and the issue is discarded over an optional section.
 */
const isReportEnvelope = (analytics: unknown): boolean =>
  !!analytics &&
  typeof analytics === 'object' &&
  'currentMetrics' in (analytics as Record<string, unknown>);

/**
 * Service for managing newsletter issues through the API
 */
class IssuesService {
  /**
   * Retrieves a paginated list of issues with optional filtering
   * @param params - Optional query parameters for filtering and pagination
   * @param params.limit - Maximum number of issues to return per page
   * @param params.nextToken - Token for fetching the next page of results
   * @param params.status - Filter issues by status (draft, scheduled, published, failed)
   * @returns Promise resolving to list of issues and optional next page token
   */
  async listIssues(params?: ListIssuesParams): Promise<ApiResponse<{
    issues: IssueListItem[];
    nextToken?: string;
  }>> {
    const queryParams = new URLSearchParams();

    if (params?.limit) {
      queryParams.append('limit', params.limit.toString());
    }
    if (params?.nextToken) {
      queryParams.append('nextToken', params.nextToken);
    }
    if (params?.status) {
      queryParams.append('status', params.status);
    }

    const query = queryParams.toString();
    const endpoint = query ? `/issues?${query}` : '/issues';

    return apiClient.get(endpoint);
  }

  /**
   * Retrieves detailed information for a specific issue
   * @param id - Unique identifier of the issue
   * @returns Promise resolving to the complete issue details including content and stats
   */
  async getIssue(id: string): Promise<ApiResponse<Issue>> {
    const response = await apiClient.get<Issue>(`/issues/${id}`);

    if (response.success && response.data?.stats) {
      const stats = response.data.stats;

      // The API may return analytics in an enriched report envelope that wraps
      // the raw event analytics alongside benchmarks, health scores and
      // insight candidates. Only the nested slice matches `IssueAnalytics`.
      if (isReportEnvelope(stats.analytics)) {
        // `?? undefined`, not the envelope: an issue whose event analytics were
        // never built carries `eventAnalytics: null`, and that means "no
        // analytics", which is what the detail page's processing notice is for.
        stats.analytics = (stats.analytics as unknown as ReportEnvelope).eventAnalytics ?? undefined;
      }

      // Analytics are an optional enrichment, so a slice this build cannot read
      // costs the analytics panels and nothing else. Dropping it here rather
      // than failing the request keeps the subject, content, timeline and
      // counters on screen — those come from a different writer and are still
      // good, and they are what somebody is on the page to see.
      if (stats.analytics !== undefined && !validateIssueAnalytics(stats.analytics)) {
        stats.analytics = undefined;
      }

      if (!validateIssueStats(stats)) {
        return {
          success: false,
          error: 'Invalid issue stats structure received from server',
        };
      }
    }

    return response;
  }

  /**
   * Retrieves performance trends and aggregate metrics across all issues
   * @param timeRange - Optional time range filter (e.g., '7d', '30d', '90d', 'all')
   * @returns Promise resolving to trends data including total issues, published count, average rates, and top performers
   */
  async getTrends(timeRange?: string): Promise<ApiResponse<TrendsData>> {
    const query = timeRange ? `?timeRange=${timeRange}` : '';
    const response = await apiClient.get<TrendsData>(`/issues/trends${query}`);

    if (response.success && response.data) {
      if (!validateTrendsData(response.data)) {
        return {
          success: false,
          error: 'Invalid trends data structure received from server',
        };
      }
    }

    return response;
  }

  /**
   * Creates a new draft issue
   * @param data - Issue creation data including subject, content, and optional metadata
   * @param options - Optional request options (e.g., idempotency key)
   * @returns Promise resolving to the newly created issue
   */
  async createIssue(
    data: CreateIssueRequest,
    options?: { idempotencyKey?: string }
  ): Promise<ApiResponse<Issue>> {
    const headers = options?.idempotencyKey
      ? { 'Idempotency-Key': options.idempotencyKey }
      : undefined;

    return apiClient.post('/issues', data, headers ? { headers } : undefined);
  }

  /**
   * Updates an existing draft issue
   * @param issueId - Unique identifier of the issue to update
   * @param data - Partial issue data to update (subject, content, scheduledAt, metadata)
   * @returns Promise resolving to the updated issue
   * @throws {Error} 409 Conflict if attempting to update a non-draft issue
   */
  async updateIssue(issueId: string, data: UpdateIssueRequest): Promise<ApiResponse<Issue>> {
    return apiClient.put(`/issues/${issueId}`, data);
  }

  /**
   * Moves a scheduled issue's send time.
   *
   * Separate from {@link updateIssue} because the API treats it separately: a
   * scheduled issue refuses content edits, but its send time can still move
   * until the publish workflow starts. Passing a bare `YYYY-MM-DD` resolves the
   * day against the tenant's default send time server-side, which is how an
   * issue scheduled without one gets corrected.
   *
   * @param issueId - Unique identifier of the issue to reschedule
   * @param scheduledAt - RFC3339 instant, or a date-only `YYYY-MM-DD` value
   * @returns Promise resolving to the resolved send instant
   * @throws {Error} 409 Conflict if the send has already started
   */
  async rescheduleIssue(
    issueId: string,
    scheduledAt: string
  ): Promise<ApiResponse<RescheduleIssueResponse>> {
    return apiClient.put<RescheduleIssueResponse>(`/issues/${issueId}/schedule`, {
      scheduledAt
    } satisfies RescheduleIssueRequest);
  }

  /**
   * Deletes a draft issue
   * @param issueId - Unique identifier of the issue to delete
   * @returns Promise resolving when deletion is complete
   * @throws {Error} 409 Conflict if attempting to delete a non-draft issue
   */
  async deleteIssue(issueId: string): Promise<ApiResponse<void>> {
    return apiClient.delete(`/issues/${issueId}`);
  }

  /**
   * Requests analytics rebuild for a published issue
   * @param issueId - Unique identifier of the issue to rebuild analytics for
   * @returns Promise resolving when the rebuild request is accepted
   */
  async rebuildAnalytics(issueId: string): Promise<ApiResponse<{ status: string }>> {
    return apiClient.post(`/issues/${issueId}/analytics/rebuild`, {});
  }

  /**
   * Sends a published issue again.
   *
   * Only subscribers who never received it are mailed: every send runs through
   * an idempotency filter keyed on the issue, so this is a no-op for anyone who
   * already got it. That is what makes it safe to offer as a repair for an
   * issue that reached `published` without its send ever firing.
   *
   * @param issueId - Unique identifier of the issue to send again
   * @returns Promise resolving once the send has been queued
   * @throws {Error} 400 Bad Request if the issue is not published
   */
  async resendIssue(issueId: string): Promise<ApiResponse<{ status: string }>> {
    return apiClient.post(`/issues/${issueId}/resend`, {});
  }

  /**
   * Manually declares the winner of an issue's A/B test, overriding automatic
   * evaluation. Records the winner and marks the test as sent.
   * @param issueId - Unique identifier of the issue
   * @param variantId - The winning variant ('a' or 'b')
   * @returns Promise resolving to the updated issue
   */
  async declareAbWinner(issueId: string, variantId: VariantId): Promise<ApiResponse<Issue>> {
    return apiClient.post(`/issues/${issueId}/ab-test/declare-winner`, { variantId });
  }

  /**
   * Retrieves the tenant's A/B test history: past tests with per-variant
   * engagement plus headline aggregates (significant counts, avg winning lift,
   * top winning send hours). Tests are returned newest-issue-first.
   * @returns Promise resolving to the A/B test history response
   */
  async getAbHistory(): Promise<ApiResponse<AbHistoryResponse>> {
    return apiClient.get<AbHistoryResponse>('/ab-test/history');
  }

  /**
   * Retrieves the tenant's in-progress A/B tests: managed tests whose sample has
   * been sent but whose winner has not been decided yet, with live per-variant
   * engagement counters. Used for the dashboard's "test in progress" indicator.
   * @returns Promise resolving to the active A/B tests response
   */
  async getActiveAbTests(): Promise<ApiResponse<ActiveAbTestsResponse>> {
    return apiClient.get<ActiveAbTestsResponse>('/ab-test/active');
  }

  /**
   * Requests AI-generated A/B test suggestions for the given dimension. For
   * subject tests the response carries candidate `subjects`; for send-time
   * tests it carries candidate `sendTimes`. The `usedHistory` flag indicates
   * whether suggestions were personalized from the tenant's past tests.
   * @param body - The dimension plus optional subject/content context
   * @returns Promise resolving to the suggestion response
   */
  async getAbSuggestions(
    body: AbSuggestionRequest
  ): Promise<ApiResponse<AbSuggestionResponse>> {
    return apiClient.post<AbSuggestionResponse>('/ab-test/suggestions', body);
  }

  /**
   * Fetches comparison data for an issue including average, last issue, and best issue metrics
   * @param currentIssueId - ID of the current issue to exclude from calculations
   * @param issueCount - Number of recent issues to include in average calculation
   * @returns Promise resolving to comparison metrics
   */
  async getComparisonData(currentIssueId: string, _issueCount: number = 10): Promise<{
    average?: IssueMetrics;
    lastIssue?: IssueMetrics;
    bestIssue?: IssueMetrics;
  }> {
    try {
      const trendsResponse = await this.getTrends();

      if (!trendsResponse.success || !trendsResponse.data) {
        return {};
      }

      const { issues, aggregates } = trendsResponse.data;

      // Filter out the current issue
      const otherIssues = issues.filter(issue => issue.id !== currentIssueId);

      if (otherIssues.length === 0) {
        return {};
      }

      // Only issues that recorded a list size count toward the average; an
      // issue without a snapshot is unmeasured, not an issue with no audience.
      const measuredSubscribers = otherIssues
        .map(issue => issue.metrics.subscribers)
        .filter((value): value is number => value !== undefined);
      const averageSubscribers = measuredSubscribers.length > 0
        ? measuredSubscribers.reduce((sum, value) => sum + value, 0) / measuredSubscribers.length
        : undefined;

      // Calculate average metrics from aggregates
      const average: IssueMetrics = {
        openRate: aggregates.avgOpenRate,
        clickRate: aggregates.avgClickRate,
        clickToOpenRate: aggregates.avgClickToOpenRate,
        bounceRate: aggregates.avgBounceRate,
        delivered: Math.round(aggregates.totalDelivered / aggregates.issueCount),
        opens: 0,
        clicks: 0,
        bounces: 0,
        complaints: 0,
        ...(averageSubscribers !== undefined && { subscribers: Math.round(averageSubscribers) }),
      };

      // Get last issue (most recent)
      const lastIssue = otherIssues[0];
      const lastIssueMetrics: IssueMetrics | undefined = lastIssue ? {
        ...lastIssue.metrics,
      } : undefined;

      // Find best issue by composite score
      let bestIssue: IssueMetrics | undefined;
      let bestScore = -1;

      for (const issue of otherIssues) {
        const score = calculateCompositeScore(issue.metrics);
        if (score > bestScore) {
          bestScore = score;
          bestIssue = { ...issue.metrics };
        }
      }

      return {
        average,
        lastIssue: lastIssueMetrics,
        bestIssue,
      };
    } catch (error) {
      console.error('Error fetching comparison data:', error);
      return {};
    }
  }
}

/**
 * Singleton instance of the IssuesService for managing newsletter issues
 */
export const issuesService = new IssuesService();
