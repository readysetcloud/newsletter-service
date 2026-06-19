import { apiClient } from './api';
import type {
  MonthlyReport,
  ListReportsParams,
  ListReportsResponse,
} from '@/types/reports';
import type { ApiResponse } from '@/types';

/**
 * Service for retrieving monthly newsletter performance reports through the API
 */
class ReportsService {
  /**
   * Retrieves a paginated list of monthly performance reports
   * @param params - Optional query parameters for pagination
   * @param params.limit - Maximum number of reports to return per page
   * @param params.nextToken - Token for fetching the next page of results
   * @returns Promise resolving to list of report summaries and optional next page token
   */
  async listReports(params?: ListReportsParams): Promise<ApiResponse<ListReportsResponse>> {
    const queryParams = new URLSearchParams();

    if (params?.limit) {
      queryParams.append('limit', params.limit.toString());
    }
    if (params?.nextToken) {
      queryParams.append('nextToken', params.nextToken);
    }

    const query = queryParams.toString();
    const endpoint = query ? `/reports?${query}` : '/reports';

    return apiClient.get<ListReportsResponse>(endpoint);
  }

  /**
   * Retrieves a single monthly performance report by month id
   * @param id - The report month identifier (e.g. "2026-05")
   * @returns Promise resolving to the full monthly report
   */
  async getReport(id: string): Promise<ApiResponse<MonthlyReport>> {
    return apiClient.get<MonthlyReport>(`/reports/${id}`);
  }
}

/**
 * Singleton instance of the ReportsService for retrieving monthly reports
 */
export const reportsService = new ReportsService();
