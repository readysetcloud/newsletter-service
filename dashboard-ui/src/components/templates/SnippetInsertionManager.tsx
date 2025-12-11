import React, { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Loader2, Undo2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SnippetErrorBoundary } from '@/components/error/SnippetErrorBoundary';
import { SnippetErrorDisplay } from './SnippetErrorDisplay';
import { useSnippetValidation } from '@/hooks/useSnippetValidation';
import { useNetworkErrorHandler } from '@/hooks/useNetworkErrorHandler';
import { useSnippetRollback } from '@/hooks/useSnippetRollback';
import SnippetInsertionUtils from '@/utils/snippetInsertionUtils';
import type { Snippet } from '@/types/template';

interface SnippetInsertionManagerProps {
  snippet: Snippet;
  parameters: Record<string, any>;
  onParametersChange: (parameters: Record<string, any>) => void;
  onInsert: (insertedText: string, newCursorPosition: number) => Promise<void>;
  onCancel: () => void;
  editorContent: string;
  cursorPosition: number;
  selectedText?: string;
  className?: string;
}

interface InsertionState {
  isInserting: boolean;
  isValidating: boolean;
  insertionSuccess: boolean;
  insertionError?: string;
  lastInsertionId?: string;
}

export const SnippetInsertionManager: React.FC<SnippetInsertionManagerProps> = ({
  snippet,
  parameters,
  onParametersChange,
  onInsert,
  onCancel,
  editorContent,
  cursorPosition,
  selectedText,
  className = ''
}) => {
  const [insertionState, setInsertionState] = useState<InsertionState>({
    isInserting: false,
    isValidating: false,
    insertionSuccess: false
  });

  // Validation hook
  const {
    validationState,
    validateAllFields,
    canSubmit
  } = useSnippetValidation(snippet, parameters, {
    validateOnChange: true,
    enableRealTimeValidation: true,
    strictMode: true
  });

  // Network error handling
  const {
    networkState,
    retryState,
    executeWithRetry,
    retryLastOperation
  } = useNetworkErrorHandler({
    maxRetries: 3,
    enableOfflineQueue: true,
    onRetryAttempt: (attempt, maxRetries) => {
      console.log(`Retry attempt ${attempt}/${maxRetries}`);
    }
  });

  // Rollback functionality
  const {
    rollbackState,
    recordOperation,
    markOperationSuccess,
    markOperationFailure,
    rollbackLastOperation,
    getLastFailedOperation
  } = useSnippetRollback({
    maxHistorySize: 20,
    onRollback: (operation) => {
      console.log('Rolled back operation:', operation);
    }
  });

  // Handle parameter changes with validation
  const handleParameterChange = useCallback((field: string, value: any) => {
    const newParameters = { ...parameters, [field]: value };
    onParametersChange(newParameters);
  }, [parameters, onParametersChange]);

  // Validate parameters before insertion
  const validateBeforeInsertion = useCallback(async (): Promise<boolean> => {
    setInsertionState(prev => ({ ...prev, isValidating: true }));

    try {
      const validation = await validateAllFields(parameters);

      setInsertionState(prev => ({ ...prev, isValidating: false }));

      if (!validation.isValid) {
        setInsertionState(prev => ({
          ...prev,
          insertionError: `Validation failed: ${validation.summary.errorCount} error(s) found`
        }));
        return false;
      }

      return true;
    } catch (error) {
      setInsertionState(prev => ({
        ...prev,
        isValidating: false,
        insertionError: error instanceof Error ? error.message : 'Validation failed'
      }));
      return false;
    }
  }, [validateAllFields, parameters]);

  // Handle snippet insertion with comprehensive error handling
  const handleInsert = useCallback(async () => {
    if (!canSubmit || insertionState.isInserting) {
      return;
    }

    // Validate parameters first
    const isValid = await validateBeforeInsertion();
    if (!isValid) {
      return;
    }

    setInsertionState(prev => ({
      ...prev,
      isInserting: true,
      insertionError: undefined,
      insertionSuccess: false
    }));

    // Record the operation for rollback
    const operationId = recordOperation({
      type: 'insert',
      snippet,
      parameters,
      context: {
        cursorPosition,
        selectedText,
        lineNumber: 0, // Could be calculated from editor
        columnNumber: 0
      },
      beforeState: {
        content: editorContent,
        cursorPosition,
        selection: selectedText ? { start: cursorPosition, end: cursorPosition + selectedText.length } : undefined
      },
      afterState: {
        content: '', // Will be updated after successful insertion
        cursorPosition: 0 // Will be updated after successful insertion
      },
      success: false // Will be updated based on result
    });

    try {
      // Generate snippet syntax with error handling
      const insertionResult = SnippetInsertionUtils.insertSnippetAtPosition(
        editorContent,
        snippet,
        parameters,
        {
          cursorPosition,
          selectedText
        },
        {
          addNewlines: true,
          formatOutput: true
        }
      );

      if (!insertionResult.success) {
        throw new Error(insertionResult.error || 'Failed to generate snippet syntax');
      }

      // Execute insertion with network retry
      await executeWithRetry(async () => {
        await onInsert(insertionResult.insertedText, insertionResult.newCursorPosition);
      });

      // Mark operation as successful
      markOperationSuccess(operationId, {
        content: insertionResult.insertedText,
        cursorPosition: insertionResult.newCursorPosition
      });

      setInsertionState(prev => ({
        ...prev,
        isInserting: false,
        insertionSuccess: true,
        lastInsertionId: operationId
      }));

      // Auto-close after successful insertion (optional)
      setTimeout(() => {
        onCancel();
      }, 1500);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Insertion failed';

      // Mark operation as failed
      markOperationFailure(operationId, errorMessage);

      setInsertionState(prev => ({
        ...prev,
        isInserting: false,
        insertionError: errorMessage,
        lastInsertionId: operationId
      }));
    }
  }, [
    canSubmit,
    insertionState.isInserting,
    validateBeforeInsertion,
    recordOperation,
    snippet,
    parameters,
    cursorPosition,
    selectedText,
    editorContent,
    executeWithRetry,
    onInsert,
    markOperationSuccess,
    markOperationFailure,
    onCancel
  ]);

  // Handle rollback
  const handleRollback = useCallback(async () => {
    try {
      const lastFailedOp = getLastFailedOperation();
      if (lastFailedOp) {
        const beforeState = await rollbackLastOperation();
        if (beforeState) {
          // Restore editor state
          await onInsert(beforeState.content, beforeState.cursorPosition);

          setInsertionState(prev => ({
            ...prev,
            insertionError: undefined,
            insertionSuccess: false
          }));
        }
      }
    } catch (error) {
      console.error('Rollback failed:', error);
    }
  }, [getLastFailedOperation, rollbackLastOperation, onInsert]);

  // Handle retry
  const handleRetry = useCallback(async () => {
    if (retryState.isRetrying) return;

    try {
      await retryLastOperation();
      setInsertionState(prev => ({
        ...prev,
        insertionError: undefined
      }));
    } catch (error) {
      console.error('Retry failed:', error);
    }
  }, [retryState.isRetrying, retryLastOperation]);

  // Auto-validate when parameters change
  useEffect(() => {
    if (Object.keys(parameters).length > 0) {
      validateAllFields(parameters);
    }
  }, [parameters, validateAllFields]);

  return (
    <SnippetErrorBoundary
      context="snippet"
      onRetry={handleRetry}
      onRollback={rollbackState.canRollback ? handleRollback : undefined}
    >
      <div className={`space-y-4 ${className}`}>
        {/* Error Display */}
        <SnippetErrorDisplay
          errors={validationState.fields ? Object.values(validationState.fields).flatMap(field => field.errors) : []}
          warnings={validationState.fields ? Object.values(validationState.fields).flatMap(field => field.warnings) : []}
          networkError={
            !networkState.isOnline || insertionState.insertionError
              ? {
                  message: insertionState.insertionError || 'Network connection lost',
                  isRetryable: retryState.retryCount < retryState.maxRetries,
                  isOffline: !networkState.isOnline,
                  onRetry: handleRetry,
                  onDismiss: () => setInsertionState(prev => ({ ...prev, insertionError: undefined }))
                }
              : undefined
          }
          validationSummary={validationState.summary}
          showSummary={true}
        />

        {/* Success Message */}
        {insertionState.insertionSuccess && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center space-x-2 text-green-800">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Snippet inserted successfully!</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <div className="flex items-center space-x-2">
            {/* Rollback button */}
            {rollbackState.canRollback && insertionState.insertionError && (
              <Button
                onClick={handleRollback}
                variant="outline"
                size="sm"
                disabled={rollbackState.isRollingBack}
                className="flex items-center gap-2"
              >
                {rollbackState.isRollingBack ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="h-4 w-4" />
                )}
                Undo
              </Button>
            )}

            {/* Network status indicator */}
            {!networkState.isOnline && (
              <div className="text-xs text-red-600 flex items-center gap-1">
                <div className="w-2 h-2 bg-red-500 rounded-full" />
                Offline
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Button
              onClick={onCancel}
              variant="outline"
              disabled={insertionState.isInserting}
            >
              Cancel
            </Button>

            <Button
              onClick={handleInsert}
              variant="primary"
              disabled={!canSubmit || insertionState.isInserting || insertionState.isValidating}
              className="flex items-center gap-2"
            >
              {insertionState.isInserting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Inserting...
                </>
              ) : insertionState.isValidating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Insert Snippet
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Validation Progress */}
        {validationState.summary.totalFieldCount > 0 && (
          <div className="text-xs text-gray-500">
            Validation: {validationState.summary.validFieldCount}/{validationState.summary.totalFieldCount} fields valid
            {validationState.summary.errorCount > 0 && (
              <span className="text-red-600 ml-2">
                • {validationState.summary.errorCount} error{validationState.summary.errorCount !== 1 ? 's' : ''}
              </span>
            )}
            {validationState.summary.warningCount > 0 && (
              <span className="text-yellow-600 ml-2">
                • {validationState.summary.warningCount} warning{validationState.summary.warningCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </SnippetErrorBoundary>
  );
};
