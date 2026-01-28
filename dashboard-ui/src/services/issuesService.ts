import { apiClient } from './api';
import type {
  Issue,
  IssueListItem,
  TrendsData,
  CreateIssueRequest,
  UpdateIssueRequest,
  ListIssuesParams,
} from '@/types/issues';
import type { ApiResponse } from '@/types';

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
    return apiClient.get(`/issues/${id}`);
  }

  /**
   * Retrieves performance trends and aggregate metrics across all issues
   * @param timeRange - Optional time range filter (e.g., '7d', '30d', '90d', 'all')
   * @returns Promise resolving to trends data including total issues, published count, average rates, and top performers
   */
  async getTrends(timeRange?: string): Promise<ApiResponse<TrendsData>> {
    const query = timeRange ? `?timeRange=${timeRange}` : '';
    return apiClient.get(`/issues/trends${query}`);
  }

  /**
   * Creates a new draft issue
   * @param data - Issue creation data including title, content, slug, and optional metadata
   * @returns Promise resolving to the newly created issue
   */
  async createIssue(data: CreateIssueRequest): Promise<ApiResponse<Issue>> {
    return apiClient.post('/issues', data);
  }

  /**
   * Updates an existing draft issue
   * @param issueId - Unique identifier of the issue to update
   * @param data - Partial issue data to update (title, content, slug, scheduledAt, metadata)
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
}

/**
 * Singleton instance of the IssuesService for managing newsletter issues
 */
export const issuesService = new IssuesService();
