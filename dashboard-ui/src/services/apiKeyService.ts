import { apiClient } from './api';
import type {
  ApiResponse,
  ApiKey,
  CreateApiKeyRequest,
} from '@/types';

/**
 * API Key Service - Handles all API key management operations
 */
export class ApiKeyService {
  /**
   * Create a new API key
   */
  async createApiKey(data: CreateApiKeyRequest): Promise<ApiResponse<{ id: string; value: string }>> {
    return apiClient.post<{ id: string; value: string }>('/api-keys', data);
  }

  /**
   * List all API keys for the current user
   */
  async listApiKeys(): Promise<ApiResponse<{ apiKeys: Omit<ApiKey, 'keyValue'>[]; count: number }>> {
    return apiClient.get<{ apiKeys: Omit<ApiKey, 'keyValue'>[]; count: number }>('/api-keys');
  }

  /**
   * Get details of a specific API key (without the key value)
   */
  async getApiKey(keyId: string): Promise<ApiResponse<{ apiKey: Omit<ApiKey, 'keyValue'> }>> {
    return apiClient.get<{ apiKey: Omit<ApiKey, 'keyValue'> }>(`/api-keys/${keyId}`);
  }

  /**
   * Delete an API key permanently
   */
  async deleteApiKey(keyId: string): Promise<ApiResponse<void>> {
    return apiClient.delete<void>(`/api-keys/${keyId}`);
  }

  /**
   * Revoke an API key (soft delete - keeps record but disables key)
   */
  async revokeApiKey(keyId: string): Promise<ApiResponse<{
    message: string;
    keyId: string;
    status: string;
    revokedAt: string;
  }>> {
    return apiClient.delete<{
      message: string;
      keyId: string;
      status: string;
      revokedAt: string;
    }>(`/api-keys/${keyId}?revoke=true`);
  }

  /**
   * Get API key usage statistics
   */
  async getApiKeyStats(keyId: string): Promise<ApiResponse<{
    keyId: string;
    usageCount: number;
    lastUsed?: string;
    createdAt: string;
    status: string;
  }>> {
    const response = await this.getApiKey(keyId);

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to fetch API key stats',
      };
    }

    const { apiKey } = response.data;
    return {
      success: true,
      data: {
        keyId: apiKey.keyId,
        usageCount: apiKey.usageCount,
        lastUsed: apiKey.lastUsed,
        createdAt: apiKey.createdAt,
        status: apiKey.status,
      },
    };
  }

  /**
   * Check if an API key is expired
   */
  isApiKeyExpired(apiKey: Omit<ApiKey, 'keyValue'>): boolean {
    if (!apiKey.expiresAt) {
      return false; // No expiration date means it doesn't expire
    }

    return new Date(apiKey.expiresAt) < new Date();
  }

  /**
   * Check if an API key is active (not revoked and not expired)
   */
  isApiKeyActive(apiKey: Omit<ApiKey, 'keyValue'>): boolean {
    return apiKey.status === 'active' && !this.isApiKeyExpired(apiKey);
  }

  /**
   * Format API key for display (mask the key value)
   */
  formatApiKeyForDisplay(keyValue: string): string {
    if (keyValue === '***hidden***') {
      return keyValue;
    }

    // Show first 8 characters and last 4 characters
    if (keyValue.length <= 12) {
      return '***hidden***';
    }

    return `${keyValue.substring(0, 8)}...${keyValue.substring(keyValue.length - 4)}`;
  }
}

// Export singleton instance
export const apiKeyService = new ApiKeyService();
