import { useState, useEffect, useCallback } from 'react';
import { variableService, CreateCustomVariableRequest, UpdateCustomVariableRequest } from '@/services/variableService';
import { CustomVariable } from '@/types/variable';
import { useNotifications } from './useNotifications';

interface UseCustomVariablesOptions {
  autoLoad?: boolean;
  onError?: (error: Error) => void;
}

interface UseCustomVariablesReturn {
  variables: CustomVariable[];
  loading: boolean;
  error: string | null;
  usageMap: Map<string, string[]>;

  // CRUD operations
  createVariable: (data: CreateCustomVariableRequest) => Promise<CustomVariable | null>;
  updateVariable: (id: string, data: UpdateCustomVariableRequest) => Promise<CustomVariable | null>;
  deleteVariable: (id: string) => Promise<boolean>;

  // Utility functions
  refreshVariables: () => Promise<void>;
  getVariableUsage: (id: string) => Promise<string[]>;
  validateVariableName: (name: string, excludeId?: string) => Promise<boolean>;
  validateVariablePath: (path: string, excludeId?: string) => Promise<boolean>;

  // Bulk operations
  bulkDelete: (ids: string[]) => Promise<{ deleted: string[]; failed: string[] }>;
  exportVariables: (ids?: string[]) => Promise<CustomVariable[]>;
}

export const useCustomVariables = (options: UseCustomVariablesOptions = {}): UseCustomVariablesReturn => {
  const { autoLoad = true, onError } = options;
  const { addNotification } = useNotifications();

  const [variables, setVariables] = useState<CustomVariable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageMap, setUsageMap] = useState<Map<string, string[]>>(new Map());

  // Load variables from API
  const loadVariables = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await variableService.getCustomVariables();
      if (response.data) {
        setVariables(response.data.variables);

        // Load usage map for all variables
        const variableIds = response.data.variables.map(v => v.id);
        if (variableIds.length > 0) {
          const usage = await variableService.getVariableUsageMap(variableIds);
          setUsageMap(usage);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load custom variables';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      loadVariables();
    }
  }, [autoLoad, loadVariables]);

  // Create new variable
  const createVariable = useCallback(async (data: CreateCustomVariableRequest): Promise<CustomVariable | null> => {
    try {
      const response = await variableService.createCustomVariableWithRetry(data);
      if (response.data) {
        setVariables(prev => [...prev, response.data!]);
        addNotification({
          type: 'success',
          title: 'Variable Created',
          message: `Custom variable "${data.name}" has been created successfully.`
        });
        return response.data;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create variable';
      addNotification({
        type: 'error',
        title: 'Creation Failed',
        message: errorMessage
      });
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
    return null;
  }, [addNotification, onError]);

  // Update existing variable
  const updateVariable = useCallback(async (id: string, data: UpdateCustomVariableRequest): Promise<CustomVariable | null> => {
    try {
      const response = await variableService.updateCustomVariableWithRetry(id, data);
      if (response.data) {
        setVariables(prev => prev.map(v => v.id === id ? response.data! : v));
        addNotification({
          type: 'success',
          title: 'Variable Updated',
          message: `Custom variable has been updated successfully.`
        });
        return response.data;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update variable';
      addNotification({
        type: 'error',
        title: 'Update Failed',
        message: errorMessage
      });
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
    return null;
  }, [addNotification, onError]);

  // Delete variable
  const deleteVariable = useCallback(async (id: string): Promise<boolean> => {
    try {
      await variableService.deleteCustomVariableWithRetry(id);
      setVariables(prev => prev.filter(v => v.id !== id));
      setUsageMap(prev => {
        const newMap = new Map(prev);
        newMap.delete(id);
        return newMap;
      });

      addNotification({
        type: 'success',
        title: 'Variable Deleted',
        message: 'Custom variable has been deleted successfully.'
      });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete variable';
      addNotification({
        type: 'error',
        title: 'Deletion Failed',
        message: errorMessage
      });
      onError?.(err instanceof Error ? err : new Error(errorMessage));
      return false;
    }
  }, [addNotification, onError]);

  // Get variable usage
  const getVariableUsage = useCallback(async (id: string): Promise<string[]> => {
    try {
      const response = await variableService.getVariableUsage(id);
      if (response.data) {
        const usage = [...response.data.templateIds, ...response.data.snippetIds];
        setUsageMap(prev => new Map(prev).set(id, usage));
        return usage;
      }
    } catch (err) {
      console.warn('Failed to get variable usage:', err);
    }
    return [];
  }, []);

  // Validation functions
  const validateVariableName = useCallback(async (name: string, excludeId?: string): Promise<boolean> => {
    return variableService.validateVariableName(name, excludeId);
  }, []);

  const validateVariablePath = useCallback(async (path: string, excludeId?: string): Promise<boolean> => {
    return variableService.validateVariablePath(path, excludeId);
  }, []);

  // Bulk operations
  const bulkDelete = useCallback(async (ids: string[]): Promise<{ deleted: string[]; failed: string[] }> => {
    try {
      const response = await variableService.bulkDeleteCustomVariables(ids);
      if (response.data) {
        // Remove successfully deleted variables from state
        setVariables(prev => prev.filter(v => !response.data!.deleted.includes(v.id)));

        // Update usage map
        setUsageMap(prev => {
          const newMap = new Map(prev);
          response.data!.deleted.forEach(id => newMap.delete(id));
          return newMap;
        });

        if (response.data.deleted.length > 0) {
          addNotification({
            type: 'success',
            title: 'Variables Deleted',
            message: `${response.data.deleted.length} variable(s) deleted successfully.`
          });
        }

        if (response.data.failed.length > 0) {
          addNotification({
            type: 'warning',
            title: 'Partial Deletion',
            message: `${response.data.failed.length} variable(s) could not be deleted.`
          });
        }

        return response.data;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete variables';
      addNotification({
        type: 'error',
        title: 'Bulk Deletion Failed',
        message: errorMessage
      });
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }

    return { deleted: [], failed: ids };
  }, [addNotification, onError]);

  // Export variables
  const exportVariables = useCallback(async (ids?: string[]): Promise<CustomVariable[]> => {
    try {
      const response = await variableService.exportCustomVariables(ids);
      if (response.data) {
        return response.data.variables;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to export variables';
      addNotification({
        type: 'error',
        title: 'Export Failed',
        message: errorMessage
      });
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
    return [];
  }, [addNotification, onError]);

  return {
    variables,
    loading,
    error,
    usageMap,
    createVariable,
    updateVariable,
    deleteVariable,
    refreshVariables: loadVariables,
    getVariableUsage,
    validateVariableName,
    validateVariablePath,
    bulkDelete,
    exportVariables
  };
};
