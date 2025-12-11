import React, { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, RefreshCw, Settings, Code, Grid, Lightbulb, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useVariableDefinitionsWithFallback } from '@/hooks/useVariableDefinitionsWithFallback';
import { validateVariableSyntax, autoFixVariableSyntax } from '@/utils/variableSyntaxErrorHandler';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';

interface VisualBuilderError {
  id: string;
  type: 'variable-picker' | 'drop-zone' | 'variable-validation' | 'network' | 'unknown';
  message: string;
  severity: 'error' | 'warning' | 'info';
  timestamp: Date;
  context?: string;
  recoverable: boolean;
  autoFixable?: boolean;
}

interface VisualBuilderErrorRecoveryProps {
  errors: VisualBuilderError[];
  onErrorResolved: (errorId: string) => void;
  onRetryAll: () => void;
  onEnableFallbackMode: () => void;
  onAutoFix?: (fixes: string[]) => void;
  className?: string;
}

interface RecoveryAction {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void | Promise<void>;
  primary?: boolean;
  disabled?: boolean;
}

export const VisualBuilderErrorRecovery: React.FC<VisualBuilderErrorRecoveryProps> = ({
  errors,
  onErrorResolved,
  onRetryAll,
  onEnableFallbackMode,
  onAutoFix,
  className = ''
}) => {
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryProgress, setRecoveryProgress] = useState<Record<string, 'pending' | 'success' | 'failed'>>({});
  const [autoFixResults, setAutoFixResults] = useState<string[]>([]);

  const {
    isUsingFallback,
    enableFallbackMode,
    disableFallbackMode,
    refetch: refetchVariableDefinitions
  } = useVariableDefinitionsWithFallback({
    enableFallback: true,
    onFallback: () => console.log('Variable definitions fallback mode enabled'),
    onRecovery: () => console.log('Variable definitions recovered')
  });

  // Group errors by type for better organization
  const errorsByType = errors.reduce((acc, error) => {
    if (!acc[error.type]) {
      acc[error.type] = [];
    }
    acc[error.type].push(error);
    return acc;
  }, {} as Record<string, VisualBuilderError[]>);

  // Get recovery actions based on error types
  const getRecoveryActions = useCallback((): RecoveryAction[] => {
    const actions: RecoveryAction[] = [];

    // Global retry action
    if (errors.some(e => e.recoverable)) {
      actions.push({
        id: 'retry-all',
        label: 'Retry All',
        description: 'Attempt to recover from all recoverable errors',
        icon: RefreshCw,
        action: async () => {
          setIsRecovering(true);
          try {
            await onRetryAll();
            errors.forEach(error => {
              if (error.recoverable) {
                setRecoveryProgress(prev => ({ ...prev, [error.id]: 'success' }));
                onErrorResolved(error.id);
              }
            });
          } catch (error) {
            console.error('Retry all failed:', error);
            errors.forEach(err => {
              setRecoveryProgress(prev => ({ ...prev, [err.id]: 'failed' }));
            });
          } finally {
            setIsRecovering(false);
          }
        },
        primary: true
      });
    }

    // Fallback mode action
    if (errorsByType['variable-picker'] || errorsByType['drop-zone']) {
      actions.push({
        id: 'fallback-mode',
        label: isUsingFallback ? 'Disable Fallback Mode' : 'Enable Fallback Mode',
        description: isUsingFallback
          ? 'Return to enhanced features'
          : 'Use simplified interface with basic functionality',
        icon: Settings,
        action: async () => {
          if (isUsingFallback) {
            await disableFallbackMode();
          } else {
            enableFallbackMode();
            onEnableFallbackMode();
          }
        }
      });
    }

    // Auto-fix action for validation errors
    if (errorsByType['variable-validation']?.some(e => e.autoFixable)) {
      actions.push({
        id: 'auto-fix',
        label: 'Auto-Fix Syntax',
        description: 'Automatically fix common variable syntax errors',
        icon: Code,
        action: () => {
          const validationErrors = errorsByType['variable-validation'] || [];
          const fixes: string[] = [];

          validationErrors.forEach(error => {
            if (error.context && error.autoFixable) {
              const { fixed, changes } = autoFixVariableSyntax(error.context);
              fixes.push(...changes);
            }
          });

          setAutoFixResults(fixes);
          onAutoFix?.(fixes);

          // Mark validation errors as resolved
          validationErrors.forEach(error => {
            if (error.autoFixable) {
              onErrorResolved(error.id);
            }
          });
        }
      });
    }

    // Refresh variable definitions
    if (errorsByType['network'] || errorsByType['variable-picker']) {
      actions.push({
        id: 'refresh-definitions',
        label: 'Refresh Variable Definitions',
        description: 'Reload variable definitions from the server',
        icon: RefreshCw,
        action: async () => {
          try {
            await refetchVariableDefinitions();
            // Mark related errors as resolved
            [...(errorsByType['network'] || []), ...(errorsByType['variable-picker'] || [])]
              .forEach(error => onErrorResolved(error.id));
          } catch (error) {
            console.error('Failed to refresh variable definitions:', error);
          }
        }
      });
    }

    return actions;
  }, [errors, errorsByType, isUsingFallback, onRetryAll, onEnableFallbackMode, onAutoFix, onErrorResolved, enableFallbackMode, disableFallbackMode, refetchVariableDefinitions]);

  // Get error type display information
  const getErrorTypeInfo = (type: string) => {
    switch (type) {
      case 'variable-picker':
        return {
          title: 'Variable Picker Issues',
          icon: Code,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200'
        };
      case 'drop-zone':
        return {
          title: 'Drop Zone Issues',
          icon: Grid,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200'
        };
      case 'variable-validation':
        return {
          title: 'Variable Syntax Issues',
          icon: AlertTriangle,
          color: 'text-yellow-600',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200'
        };
      case 'network':
        return {
          title: 'Network Issues',
          icon: RefreshCw,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200'
        };
      default:
        return {
          title: 'Other Issues',
          icon: AlertTriangle,
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200'
        };
    }
  };

  const recoveryActions = getRecoveryActions();

  if (errors.length === 0) {
    return null;
  }

  return (
    <Card className={`p-6 ${className}`}>
      <div className="flex items-start space-x-3 mb-6">
        <AlertTriangle className="h-6 w-6 text-orange-500 mt-1" />
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Visual Builder Issues Detected
          </h3>
          <p className="text-gray-600">
            {errors.length} issue{errors.length !== 1 ? 's' : ''} found that may affect the visual builder experience.
            {isUsingFallback && (
              <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                Fallback Mode Active
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Error groups */}
      <div className="space-y-4 mb-6">
        {Object.entries(errorsByType).map(([type, typeErrors]) => {
          const typeInfo = getErrorTypeInfo(type);
          const Icon = typeInfo.icon;

          return (
            <div
              key={type}
              className={`rounded-lg border p-4 ${typeInfo.bgColor} ${typeInfo.borderColor}`}
            >
              <div className="flex items-center space-x-2 mb-3">
                <Icon className={`h-5 w-5 ${typeInfo.color}`} />
                <h4 className={`font-medium ${typeInfo.color}`}>
                  {typeInfo.title} ({typeErrors.length})
                </h4>
              </div>

              <div className="space-y-2">
                {typeErrors.map(error => (
                  <div key={error.id} className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{error.message}</p>
                      {error.context && (
                        <code className="text-xs bg-white bg-opacity-50 px-2 py-1 rounded mt-1 inline-block">
                          {error.context}
                        </code>
                      )}
                    </div>

                    {recoveryProgress[error.id] && (
                      <div className="ml-3">
                        {recoveryProgress[error.id] === 'success' && (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                        {recoveryProgress[error.id] === 'failed' && (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        )}
                        {recoveryProgress[error.id] === 'pending' && (
                          <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Auto-fix results */}
      {autoFixResults.length > 0 && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center space-x-2 mb-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <h4 className="font-medium text-green-900">Auto-Fix Applied</h4>
          </div>
          <ul className="text-sm text-green-800 space-y-1">
            {autoFixResults.map((fix, index) => (
              <li key={index} className="flex items-start">
                <span className="text-green-600 mr-2">•</span>
                {fix}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recovery actions */}
      {recoveryActions.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3 flex items-center">
            <Lightbulb className="h-4 w-4 mr-2 text-yellow-500" />
            Recovery Actions
          </h4>

          <div className="flex flex-wrap gap-3">
            {recoveryActions.map(action => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.id}
                  onClick={action.action}
                  variant={action.primary ? 'primary' : 'secondary'}
                  size="sm"
                  disabled={action.disabled || isRecovering}
                  className="flex items-center gap-2"
                >
                  <Icon className="h-4 w-4" />
                  {action.label}
                </Button>
              );
            })}
          </div>

          <div className="mt-3 text-xs text-gray-500">
            {recoveryActions.map(action => (
              <div key={action.id} className="mb-1">
                <strong>{action.label}:</strong> {action.description}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
