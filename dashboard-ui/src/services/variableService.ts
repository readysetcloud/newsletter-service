import { apiClient } from './api';
import { retryWithBackoff } from '@/utils/errorHandling';
import type { ApiResponse } from '@/types/api';
import type { CustomVariable, VariableType } from '@/types/variable';

export interface CreateCustomVariableRequest {
  name: string;
  path: string;
  defaultValue: any;
  type: VariableType;
  description?: string;
}

export interface UpdateCustomVariableRequest {
  name?: string;
  path?: string;
  defaultValue?: any;
  type?: VariableType;
  description?: string;
}

export interface CustomVariableListResponse {
  variables: CustomVariable[];
  total: number;
}

export interface VariableUsageResponse {
  templateIds: string[];
  snippetIds: string[];
  usageCount: number;
}

class VariableService {
  private baseUrl = '/variables';

  // Custom Variable CRUD operations
  async getCustomVariables(): Promise<ApiResponse<CustomVariableListResponse>> {
    return apiClient.get<CustomVariableListResponse>(`${this.baseUrl}/custom`);
  }

  async getCustomVariable(id: string): Promise<ApiResponse<CustomVariable>> {
    return apiClient.get<CustomVariable>(`${this.baseUrl}/custom/${id}`);
  }

  async createCustomVariable(data: CreateCustomVariableRequest): Promise<ApiResponse<CustomVariable>> {
    return apiClient.post<CustomVariable>(`${this.baseUrl}/custom`, {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  async updateCustomVariable(id: string, data: UpdateCustomVariableRequest): Promise<ApiResponse<CustomVariable>> {
    return apiClient.put<CustomVariable>(`${this.baseUrl}/custom/${id}`, {
      ...data,
      updatedAt: new Date()
    });
  }

  async deleteCustomVariable(id: string): Promise<ApiResponse<void>> {
    return apiClient.delete(`${this.baseUrl}/custom/${id}`);
  }

  // Variable usage tracking
  async getVariableUsage(id: string): Promise<ApiResponse<VariableUsageResponse>> {
    return apiClient.get<VariableUsageResponse>(`${this.baseUrl}/custom/${id}/usage`);
  }

  async getVariableUsageMap(variableIds: string[]): Promise<Map<string, string[]>> {
    const usageMap = new Map<string, string[]>();

    try {
      const promises = variableIds.map(async (id) => {
        const response = await this.getVariableUsage(id);
        if (response.data) {
          const allUsages = [
            ...response.data.templateIds,
            ...response.data.snippetIds
          ];
          usageMap.set(id, allUsages);
        }
      });

      await Promise.allSettled(promises);
    } catch (error) {
      console.warn('Failed to fetch variable usage map:', error);
    }

    return usageMap;
  }

  // Retry methods for better reliability
  async createCustomVariableWithRetry(data: CreateCustomVariableRequest): Promise<ApiResponse<CustomVariable>> {
    return retryWithBackoff(() => this.createCustomVariable(data));
  }

  async updateCustomVariableWithRetry(id: string, data: UpdateCustomVariableRequest): Promise<ApiResponse<CustomVariable>> {
    return retryWithBackoff(() => this.updateCustomVariable(id, data));
  }

  async deleteCustomVariableWithRetry(id: string): Promise<ApiResponse<void>> {
    return retryWithBackoff(() => this.deleteCustomVariable(id));
  }

  // Validation helpers
  async validateVariablePath(path: string, excludeId?: string): Promise<boolean> {
    try {
      const response = await this.getCustomVariables();
      if (!response.data) return true;

      const existingPaths = response.data.variables
        .filter(v => excludeId ? v.id !== excludeId : true)
        .map(v => v.path);

      return !existingPaths.includes(path);
    } catch (error) {
      console.warn('Failed to validate variable path:', error);
      return true; // Allow if validation fails
    }
  }

  async validateVariableName(name: string, excludeId?: string): Promise<boolean> {
    try {
      const response = await this.getCustomVariables();
      if (!response.data) return true;

      const existingNames = response.data.variables
        .filter(v => excludeId ? v.id !== excludeId : true)
        .map(v => v.name.toLowerCase());

      return !existingNames.includes(name.toLowerCase());
    } catch (error) {
      console.warn('Failed to validate variable name:', error);
      return true; // Allow if validation fails
    }
  }

  // Bulk operations
  async bulkDeleteCustomVariables(ids: string[]): Promise<ApiResponse<{ deleted: string[]; failed: string[] }>> {
    return apiClient.post<{ deleted: string[]; failed: string[] }>(`${this.baseUrl}/custom/bulk-delete`, { ids });
  }

  async exportCustomVariables(ids?: string[]): Promise<ApiResponse<{ variables: CustomVariable[] }>> {
    const params = ids ? `?ids=${ids.join(',')}` : '';
    return apiClient.get<{ variables: CustomVariable[] }>(`${this.baseUrl}/custom/export${params}`);
  }

  async importCustomVariables(variables: Omit<CustomVariable, 'id' | 'createdAt' | 'updatedAt'>[], options: {
    conflictResolution?: 'skip' | 'overwrite' | 'rename'
  } = {}): Promise<ApiResponse<{ imported: CustomVariable[]; skipped: string[]; errors: string[] }>> {
    return apiClient.post<{ imported: CustomVariable[]; skipped: string[]; errors: string[] }>(`${this.baseUrl}/custom/import`, {
      variables,
      conflictResolution: options.conflictResolution || 'skip'
    });
  }
}

export const variableService = new VariableService();
