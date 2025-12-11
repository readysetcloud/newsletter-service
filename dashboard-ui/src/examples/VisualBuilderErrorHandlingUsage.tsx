import React, { useState, useCallback } from 'react';
import { AlertTriangle, Code, Grid, RefreshCw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import {
  VariablePickerErrorBoundary,
  DropZoneErrorBoundary,
  VariableValidationErrorBoundary,
  VisualBuilderErrorRecovery
} from '@/components/error';
import { useVisualBuilderErrorHandler } from '@/hooks/useVisualBuilderErrorHandler';
import { validateVariableSyntax } from '@/utils/variableSyntaxErrorHandler';

/**
 * Example component demonstrating comprehensive error handling for the visual builder
 *
 * Features demonstrated:
 * - Error boundaries for different component types
 * - Graceful degradation with fallback modes
 * - User-friendly error messages for syntax validation
 * - Automatic error recovery
 * - Centralized error management
 */
export const VisualBuilderErrorHandlingUsage: React.FC = () => {
  const [templateContent, setTemplateContent] = useState('{{newsletter.title}}');
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);

  const {
    errorState,
    addError,
    removeError,
    clearErrors,
    retryAll,
    enableFallbackMode,
    disableFallbackMode,
    autoFixSyntaxErrors,
    handleVariablePickerError,
    handleDropZoneError,
    handleValidationError,
    validateAndReportSyntax,
    networkState,
    variableDefinitionsState
  } = useVisualBuilderErrorHandler({
    enableAutoRecovery: true,
    enableFallbackMode: true,
    onError: (error) => {
      console.log('Visual builder error:', error);
    },
    onRecovery: (errorId) => {
      console.log('Error recovered:', errorId);
    },
    onFallbackModeEnabled: () => {
      setFallbackMode(true);
    },
    onAutoFix: (fixes) => {
      console.log('Auto-fixes applied:', fixes);
    }
  });

  // Simulate different types of errors for demonstration
  const simulateErrorType = useCallback((type: string) => {
    setSimulateError(type);

    switch (type) {
      case 'variable-picker':
        addError(new Error('Variable picker component failed to load'), 'variable-picker');
        break;
      case 'drop-zone':
        addError(new Error('Drop zone drag handler encountered an error'), 'drop-zone');
        break;
      case 'validation':
        addError(new Error('Invalid variable syntax detected'), 'variable-validation', '{{unclosed.variable');
        break;
      case 'network':
        addError(new Error('Network connection failed'), 'network');
        break;
      default:
        addError(new Error('Unknown error occurred'), 'unknown');
    }
  }, [addError]);

  // Handle template content changes with validation
  const handleTemplateChange = useCallback((value: string) => {
    setTemplateContent(value);

    // Validate syntax and report errors
    const isValid = validateAndReportSyntax(value);

    if (!isValid) {
      const validation = validateVariableSyntax(value);
      validation.errors.forEach(error => {
        handleValidationError(new Error(error.message), error.context);
      });
    }
  }, [validateAndReportSyntax, handleValidationError]);

  // Auto-fix template content
  const handleAutoFix = useCallback(() => {
    const { fixed, changes } = autoFixSyntaxErrors(templateContent);
    if (changes.length > 0) {
      setTemplateContent(fixed);
    }
  }, [templateContent, autoFixSyntaxErrors]);

  // Component that might fail (for demonstration)
  const FailingVariablePicker: React.FC = () => {
    if (simulateError === 'variable-picker') {
      throw new Error('Variable picker component failed to render');
    }

    return (
      <div className="p-4 border border-gray-200 rounded-lg">
        <h4 className="font-medium mb-2">Variable Picker</h4>
        <p className="text-sm text-gray-600">
          This would be the variable picker component.
          {fallbackMode && (
            <span className="ml-2 text-yellow-600 font-medium">
              (Fallback Mode: Manual input only)
            </span>
          )}
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline">{`{{newsletter.title}}`}</Button>
          <Button size="sm" variant="outline">{`{{subscriber.name}}`}</Button>
          <Button size="sm" variant="outline">{`{{brand.logo}}`}</Button>
        </div>
      </div>
    );
  };

  // Component that might fail (for demonstration)
  const FailingDropZone: React.FC = () => {
    if (simulateError === 'drop-zone') {
      throw new Error('Drop zone component failed to handle drag event');
    }

    return (
      <div className="p-8 border-2 border-dashed border-gray-300 rounded-lg text-center">
        <Grid className="h-8 w-8 text-gray-400 mx-auto mb-2" />
        <p className="text-gray-600">
          Drop components here
          {fallbackMode && (
            <span className="block text-sm text-yellow-600 mt-1">
              (Basic drop zone active)
            </span>
          )}
        </p>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Visual Builder Error Handling
        </h1>
        <p className="text-gray-600 max-w-3xl mx-auto">
          Comprehensive error handling system for the visual builder with error boundaries,
          graceful degradation, syntax validation, and automatic recovery.
        </p>
      </div>

      {/* Error Recovery Panel */}
      {errorState.hasErrors && (
        <VisualBuilderErrorRecovery
          errors={errorState.errors}
          onErrorResolved={removeError}
          onRetryAll={retryAll}
          onEnableFallbackMode={enableFallbackMode}
          onAutoFix={handleAutoFix}
        />
      )}

      {/* Status Panel */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">System Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="font-medium text-gray-700">Network</div>
            <div className={`${networkState.isOnline ? 'text-green-600' : 'text-red-600'}`}>
              {networkState.isOnline ? 'Connected' : 'Offline'}
            </div>
          </div>
          <div>
            <div className="font-medium text-gray-700">Variable Definitions</div>
            <div className={`${variableDefinitionsState.isUsingFallback ? 'text-yellow-600' : 'text-green-600'}`}>
              {variableDefinitionsState.isLoading ? 'Loading...' :
               variableDefinitionsState.isUsingFallback ? 'Fallback Mode' : 'Loaded'}
            </div>
          </div>
          <div>
            <div className="font-medium text-gray-700">Errors</div>
            <div className={`${errorState.hasErrors ? 'text-red-600' : 'text-green-600'}`}>
              {errorState.errorCount} errors, {errorState.warningCount} warnings
            </div>
          </div>
        </div>
      </Card>

      {/* Error Simulation Controls */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Error Simulation (Demo)</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            onClick={() => simulateErrorType('variable-picker')}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <Code className="h-4 w-4" />
            Variable Picker Error
          </Button>
          <Button
            onClick={() => simulateErrorType('drop-zone')}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <Grid className="h-4 w-4" />
            Drop Zone Error
          </Button>
          <Button
            onClick={() => simulateErrorType('validation')}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <AlertTriangle className="h-4 w-4" />
            Validation Error
          </Button>
          <Button
            onClick={() => simulateErrorType('network')}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Network Error
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={clearErrors}
            variant="secondary"
            size="sm"
          >
            Clear All Errors
          </Button>
          <Button
            onClick={() => setSimulateError(null)}
            variant="outline"
            size="sm"
          >
            Reset Simulation
          </Button>
        </div>
      </Card>

      {/* Template Editor with Validation */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Template Editor with Syntax Validation</h3>
        <VariableValidationErrorBoundary
          onError={(error, errorInfo) => {
            console.error('Validation error boundary triggered:', error, errorInfo);
          }}
          onRetry={() => {
            console.log('Retrying validation...');
          }}
          onClearValidation={() => {
            setTemplateContent('{{newsletter.title}}');
          }}
          showSyntaxHelp={true}
        >
          <div className="space-y-3">
            <TextArea
              value={templateContent}
              onChange={(e) => handleTemplateChange(e.target.value)}
              placeholder="Enter template content with variables..."
              rows={6}
              className="font-mono text-sm"
            />
            <div className="flex gap-2">
              <Button
                onClick={handleAutoFix}
                variant="secondary"
                size="sm"
                className="flex items-center gap-2"
              >
                <Settings className="h-4 w-4" />
                Auto-Fix Syntax
              </Button>
              <Button
                onClick={() => setTemplateContent('{{unclosed.variable')}
                variant="outline"
                size="sm"
              >
                Add Syntax Error
              </Button>
              <Button
                onClick={() => setTemplateContent('{{newsletter.title}} - {{subscriber.name}}')}
                variant="outline"
                size="sm"
              >
                Valid Template
              </Button>
            </div>
          </div>
        </VariableValidationErrorBoundary>
      </Card>

      {/* Variable Picker with Error Boundary */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Variable Picker with Error Boundary</h3>
        <VariablePickerErrorBoundary
          onError={handleVariablePickerError}
          onRetry={() => setSimulateError(null)}
          enableFallbackMode={true}
          onFallbackMode={() => setFallbackMode(true)}
        >
          <FailingVariablePicker />
        </VariablePickerErrorBoundary>
      </Card>

      {/* Drop Zone with Error Boundary */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Drop Zone with Error Boundary</h3>
        <DropZoneErrorBoundary
          onError={handleDropZoneError}
          onRetry={() => setSimulateError(null)}
          enableFallbackMode={true}
          onFallbackMode={() => setFallbackMode(true)}
        >
          <FailingDropZone />
        </DropZoneErrorBoundary>
      </Card>

      {/* Usage Examples */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Usage Examples</h3>
        <div className="space-y-4 text-sm">
          <div>
            <h4 className="font-medium mb-2">Error Boundaries</h4>
            <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`import { VariablePickerErrorBoundary } from '@/components/error';

<VariablePickerErrorBoundary
  onError={(error, errorInfo) => console.error(error)}
  onRetry={() => refetchData()}
  enableFallbackMode={true}
>
  <VariablePicker />
</VariablePickerErrorBoundary>`}
            </pre>
          </div>

          <div>
            <h4 className="font-medium mb-2">Error Handler Hook</h4>
            <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`import { useVisualBuilderErrorHandler } from '@/hooks/useVisualBuilderErrorHandler';

const {
  errorState,
  addError,
  retryAll,
  enableFallbackMode
} = useVisualBuilderErrorHandler({
  enableAutoRecovery: true,
  onError: (error) => console.log(error)
});`}
            </pre>
          </div>

          <div>
            <h4 className="font-medium mb-2">Syntax Validation</h4>
            <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`import { validateVariableSyntax } from '@/utils/variableSyntaxErrorHandler';

const validation = validateVariableSyntax(templateContent);
if (!validation.isValid) {
  validation.errors.forEach(error => {
    console.error(error.message, error.suggestions);
  });
}`}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default VisualBuilderErrorHandlingUsage;
