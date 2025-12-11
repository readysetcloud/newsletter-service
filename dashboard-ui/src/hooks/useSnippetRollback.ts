import { useState, useCallback, useRef, useEffect } from 'react';
import type { Snippet } from '@/types/template';

interface SnippetOperation {
  id: string;
  type: 'insert' | 'delete' | 'replace';
  timestamp: Date;
  snippet: Snippet;
  parameters: Record<string, any>;
  context: {
    cursorPosition: number;
    selectedText?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  beforeState: {
    content: string;
    cursorPosition: number;
    selection?: { start: number; end: number };
  };
  afterState: {
    content: string;
    cursorPosition: number;
    selection?: { start: number; end: number };
  };
  success: boolean;
  error?: string;
}

interface RollbackState {
  canRollback: boolean;
  operationHistory: SnippetOperation[];
  currentOperationId?: string;
  isRollingBack: boolean;
  rollbackError?: string;
}

interface UseSnippetRollbackOptions {
  maxHistorySize?: number;
  enableAutoSave?: boolean;
  autoSaveInterval?: number;
  onRollback?: (operation: SnippetOperation) => void;
  onRollbackError?: (error: Error, operation: SnippetOperation) => void;
}

interface UseSnippetRollbackResult {
  rollbackState: RollbackState;

  // Operation tracking
  recordOperation: (operation: Omit<SnippetOperation, 'id' | 'timestamp'>) => string;
  markOperationSuccess: (operationId: string, afterState: SnippetOperation['afterState']) => void;
  markOperationFailure: (operationId: string, error: string) => void;

  // Rollback functions
  rollbackOperation: (operationId: string) => Promise<SnippetOperation['beforeState']>;
  rollbackLastOperation: () => Promise<SnippetOperation['beforeState'] | null>;
  rollbackToOperation: (operationId: string) => Promise<SnippetOperation['beforeState']>;

  // History management
  getOperationHistory: () => SnippetOperation[];
  getOperation: (operationId: string) => SnippetOperation | null;
  clearHistory: () => void;
  getLastFailedOperation: () => SnippetOperation | null;

  // Batch operations
  createCheckpoint: (label?: string) => string;
  rollbackToCheckpoint: (checkpointId: string) => Promise<SnippetOperation['beforeState'] | null>;
}

const DEFAULT_OPTIONS: Required<UseSnippetRollbackOptions> = {
  maxHistorySize: 50,
  enableAutoSave: true,
  autoSaveInterval: 30000, // 30 seconds
  onRollback: () => {},
  onRollbackError: () => {}
};

export const useSnippetRollback = (
  options: UseSnippetRollbackOptions = {}
): UseSnippetRollbackResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [rollbackState, setRollbackState] = useState<RollbackState>({
    canRollback: false,
    operationHistory: [],
    isRollingBack: false
  });

  // Refs for managing state and cleanup
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const operationCounterRef = useRef(0);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('snippet-operation-history');
      if (savedHistory) {
        const history: SnippetOperation[] = JSON.parse(savedHistory);
        setRollbackState(prev => ({
          ...prev,
          operationHistory: history.slice(-opts.maxHistorySize),
          canRollback: history.length > 0
        }));
      }
    } catch (error) {
      console.warn('Failed to load operation history from localStorage:', error);
    }
  }, [opts.maxHistorySize]);

  // Auto-save history to localStorage
  useEffect(() => {
    if (!opts.enableAutoSave) return;

    const saveHistory = () => {
      try {
        localStorage.setItem(
          'snippet-operation-history',
          JSON.stringify(rollbackState.operationHistory)
        );
      } catch (error) {
        console.warn('Failed to save operation history to localStorage:', error);
      }
    };

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(saveHistory, opts.autoSaveInterval);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [rollbackState.operationHistory, opts.enableAutoSave, opts.autoSaveInterval]);

  const recordOperation = useCallback((
    operation: Omit<SnippetOperation, 'id' | 'timestamp'>
  ): string => {
    const operationId = `op_${Date.now()}_${++operationCounterRef.current}`;

    const newOperation: SnippetOperation = {
      ...operation,
      id: operationId,
      timestamp: new Date()
    };

    setRollbackState(prev => {
      const newHistory = [...prev.operationHistory, newOperation];

      // Trim history if it exceeds max size
      const trimmedHistory = newHistory.slice(-opts.maxHistorySize);

      return {
        ...prev,
        operationHistory: trimmedHistory,
        currentOperationId: operationId,
        canRollback: true
      };
    });

    return operationId;
  }, [opts.maxHistorySize]);

  const markOperationSuccess = useCallback((
    operationId: string,
    afterState: SnippetOperation['afterState']
  ) => {
    setRollbackState(prev => ({
      ...prev,
      operationHistory: prev.operationHistory.map(op =>
        op.id === operationId
          ? { ...op, success: true, afterState, error: undefined }
          : op
      )
    }));
  }, []);

  const markOperationFailure = useCallback((operationId: string, error: string) => {
    setRollbackState(prev => ({
      ...prev,
      operationHistory: prev.operationHistory.map(op =>
        op.id === operationId
          ? { ...op, success: false, error }
          : op
      )
    }));
  }, []);

  const rollbackOperation = useCallback(async (operationId: string): Promise<SnippetOperation['beforeState']> => {
    const operation = rollbackState.operationHistory.find(op => op.id === operationId);

    if (!operation) {
      throw new Error(`Operation ${operationId} not found in history`);
    }

    setRollbackState(prev => ({ ...prev, isRollingBack: true, rollbackError: undefined }));

    try {
      // Simulate async rollback operation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create rollback operation record
      const rollbackOp: Omit<SnippetOperation, 'id' | 'timestamp'> = {
        type: 'delete', // Rollback is essentially deleting the changes
        snippet: operation.snippet,
        parameters: operation.parameters,
        context: operation.context,
        beforeState: operation.afterState, // Current state becomes before state
        afterState: operation.beforeState, // Target state becomes after state
        success: true
      };

      // Record the rollback operation
      recordOperation(rollbackOp);

      setRollbackState(prev => ({ ...prev, isRollingBack: false }));

      opts.onRollback(operation);

      return operation.beforeState;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Rollback failed');

      setRollbackState(prev => ({
        ...prev,
        isRollingBack: false,
        rollbackError: err.message
      }));

      opts.onRollbackError(err, operation);
      throw err;
    }
  }, [rollbackState.operationHistory, recordOperation, opts.onRollback, opts.onRollbackError]);

  const rollbackLastOperation = useCallback(async (): Promise<SnippetOperation['beforeState'] | null> => {
    const lastOperation = rollbackState.operationHistory
      .slice()
      .reverse()
      .find(op => op.success);

    if (!lastOperation) {
      return null;
    }

    return await rollbackOperation(lastOperation.id);
  }, [rollbackState.operationHistory, rollbackOperation]);

  const rollbackToOperation = useCallback(async (operationId: string): Promise<SnippetOperation['beforeState']> => {
    const targetOperation = rollbackState.operationHistory.find(op => op.id === operationId);

    if (!targetOperation) {
      throw new Error(`Operation ${operationId} not found in history`);
    }

    // Find all operations after the target operation
    const targetIndex = rollbackState.operationHistory.findIndex(op => op.id === operationId);
    const operationsToRollback = rollbackState.operationHistory
      .slice(targetIndex + 1)
      .reverse()
      .filter(op => op.success);

    setRollbackState(prev => ({ ...prev, isRollingBack: true, rollbackError: undefined }));

    try {
      // Rollback operations in reverse order
      for (const operation of operationsToRollback) {
        await rollbackOperation(operation.id);
      }

      setRollbackState(prev => ({ ...prev, isRollingBack: false }));

      return targetOperation.beforeState;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Batch rollback failed');

      setRollbackState(prev => ({
        ...prev,
        isRollingBack: false,
        rollbackError: err.message
      }));

      throw err;
    }
  }, [rollbackState.operationHistory, rollbackOperation]);

  const getOperationHistory = useCallback((): SnippetOperation[] => {
    return [...rollbackState.operationHistory];
  }, [rollbackState.operationHistory]);

  const getOperation = useCallback((operationId: string): SnippetOperation | null => {
    return rollbackState.operationHistory.find(op => op.id === operationId) || null;
  }, [rollbackState.operationHistory]);

  const clearHistory = useCallback(() => {
    setRollbackState({
      canRollback: false,
      operationHistory: [],
      isRollingBack: false,
      rollbackError: undefined
    });

    // Clear localStorage
    try {
      localStorage.removeItem('snippet-operation-history');
    } catch (error) {
      console.warn('Failed to clear operation history from localStorage:', error);
    }
  }, []);

  const getLastFailedOperation = useCallback((): SnippetOperation | null => {
    return rollbackState.operationHistory
      .slice()
      .reverse()
      .find(op => !op.success) || null;
  }, [rollbackState.operationHistory]);

  // Checkpoint functionality for batch operations
  const createCheckpoint = useCallback((label?: string): string => {
    const checkpointId = `checkpoint_${Date.now()}_${++operationCounterRef.current}`;

    const checkpointOperation: Omit<SnippetOperation, 'id' | 'timestamp'> = {
      type: 'insert',
      snippet: {
        id: checkpointId,
        name: `Checkpoint: ${label || 'Unnamed'}`,
        description: `Checkpoint created at ${new Date().toISOString()}`,
        type: 'snippet'
      } as Snippet,
      parameters: { checkpointLabel: label || 'Unnamed' },
      context: { cursorPosition: 0 },
      beforeState: { content: '', cursorPosition: 0 },
      afterState: { content: '', cursorPosition: 0 },
      success: true
    };

    recordOperation(checkpointOperation);
    return checkpointId;
  }, [recordOperation]);

  const rollbackToCheckpoint = useCallback(async (checkpointId: string): Promise<SnippetOperation['beforeState'] | null> => {
    const checkpointOperation = rollbackState.operationHistory.find(
      op => op.snippet.id === checkpointId
    );

    if (!checkpointOperation) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    return await rollbackToOperation(checkpointOperation.id);
  }, [rollbackState.operationHistory, rollbackToOperation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  return {
    rollbackState,
    recordOperation,
    markOperationSuccess,
    markOperationFailure,
    rollbackOperation,
    rollbackLastOperation,
    rollbackToOperation,
    getOperationHistory,
    getOperation,
    clearHistory,
    getLastFailedOperation,
    createCheckpoint,
    rollbackToCheckpoint
  };
};
