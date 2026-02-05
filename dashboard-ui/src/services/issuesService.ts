import { apiClient } from './api';
import { validateIssueStats, validateTrendsData } from '@/utils/dataValidation';
import type {
  Issue,
  IssueListItem,
  IssueMetrics,
  TrendsData,
  CreateIssueRequest,
  UpdateIssueRequest,
  ListIssuesParams,
} from '@/types/issues';
import type { ApiResponse } from '@/types';
import { calculateCompositeScore } from '@/utils/analyticsCalculations';

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
      if (!validateIssueStats(response.data.stats)) {
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
   * Deletes a draft issue
   * @param issueId - Unique identifier of the issue to delete
   * @returns Promise resolving when deletion is complete
   * @throws {Error} 409 Conflict if attempting to delete a non-draft issue
   */
  async deleteIssue(issueId: string): Promise<ApiResponse<void>> {
    return apiClient.delete(`/issues/${issueId}`);
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

      const averageSubscribers = otherIssues.reduce((sum, issue) => sum + issue.metrics.subscribers, 0) / otherIssues.length;

      // Calculate average metrics from aggregates
      const average: IssueMetrics = {
        openRate: aggregates.avgOpenRate,
        clickRate: aggregates.avgClickRate,
        bounceRate: aggregates.avgBounceRate,
        delivered: Math.round(aggregates.totalDelivered / aggregates.issueCount),
        opens: 0,
        clicks: 0,
        bounces: 0,
        complaints: 0,
        subscribers: Math.round(averageSubscribers),
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
