import { fetchAuthSession } from 'aws-amplify/auth';
import type { ApiResponse, RequestConfig, ApiClientConfig } from '@/types';
import { parseApiError, shouldRetryError, getRetryDelay } from '@/utils/errorHandling';

// API Client configuration
const DEFAULT_CONFIG: ApiClientConfig = {
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api',
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
};

// Custom fetch wrapper with authentication and error handling
class ApiClient {
  private config: ApiClientConfig;

  constructor(config: Partial<ApiClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      const session = await fetchAuthSession();
      if (session.tokens?.accessToken) {
        return session.tokens.accessToken.toString();
      }
      return null;
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  }

  private async request<T>(
    endpoint: string,
    config: RequestConfig = {},
    retryCount = 0
  ): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = this.config.timeout,
    } = config;

    const url = `${this.config.baseURL}${endpoint}`;
    const authToken = await this.getAuthToken();

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (authToken) {
      requestHeaders.Authorization = `Bearer ${authToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Handle specific HTTP status codes
        if (response.status === 401) {
          throw new Error('Authentication required. Please sign in again.');
        } else if (response.status === 403) {
          throw new Error('Access denied. You do not have permission to perform this action.');
        } else if (response.status === 404) {
          throw new Error('Resource not found.');
        } else if (response.status >= 500) {
          throw new Error('Server error. Please try again later.');
        }

        // Try to get error message from response
        try {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
        } catch {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }
      if (response.status == 204) {
        return { success: true };
      } else {
        const data = await response.json();
        return {
          success: true,
          data,
        };
      }
    } catch (error) {
      clearTimeout(timeoutId);

      // Retry logic for network errors and server errors
      if (retryCount < this.config.retries && this.shouldRetry(error)) {
        const delay = getRetryDelay(retryCount + 1, this.config.retryDelay);
        await this.delay(delay);
        return this.request<T>(endpoint, config, retryCount + 1);
      }

      const errorInfo = parseApiError(error);
      return {
        success: false,
        error: errorInfo.message,
      };
    }
  }

  private shouldRetry(error: any): boolean {
    return shouldRetryError(error);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async get<T>(endpoint: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'GET' });
  }

  async post<T>(endpoint: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'POST', body: data });
  }

  async put<T>(endpoint: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'PUT', body: data });
  }

  async delete<T>(endpoint: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'DELETE' });
  }

  async patch<T>(endpoint: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'PATCH', body: data });
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
