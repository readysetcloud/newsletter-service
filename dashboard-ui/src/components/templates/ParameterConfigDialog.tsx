import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { cn } from '../../utils/cn';
import { Modal, ModalHeader, ModalTitle, ModalDescription, ModalContent, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { TextArea } from '../ui/TextArea';
import { Select } from '../ui/Select';
import { ParameterPreview } from './ParameterPreview';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFocusManagement } from '@/hooks/useFocusManagement';
import SnippetInsertionUtils from '../../utils/snippetInsertionUtils';
import type { Snippet, SnippetParameter } from '@/types/template';

export interface ParameterConfigDialogProps {
  snippet: Snippet | null;
  isOpen: boolean;
  onConfirm: (parameters: Record<string, any>) => void;
  onCancel: () => void;
  initialValues?: Record<string, any>;
  className?: string;
}

interface ParameterFormState {
  values: Record<string, any>;
  errors: Record<string, string>;
  warnings: Record<string, string>;
  isValid: boolean;
  touched: Record<string, boolean>;
}

interface ParameterInputProps {
  parameter: SnippetParameter;
  value: any;
  error?: string;
  warning?: string;
  onChange: (value: any) => void;
  onBlur: () => void;
  touched: boolean;
}

const ParameterInput: React.FC<ParameterInputProps> = ({
  parameter,
  value,
  error,
  warning,
  onChange,
  onBlur,
  touched
}) => {
  const inputId = `param-${parameter.name}`;
  const hasError = !!error;
  const hasWarning = !!warning && !hasError;
  const describedBy = [
    hasError ? `${inputId}-error` : null,
    hasWarning ? `${inputId}-warning` : null,
    parameter.description ? `${inputId}-description` : null
  ].filter(Boolean).join(' ');

  const renderInput = () => {
    switch (parameter.type) {
      case 'string':
        return (
          <div>
            <Input
              id={inputId}
              type="text"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              placeholder={parameter.defaultValue ? `Default: ${parameter.defaultValue}` : undefined}
              className={cn(
                hasWarning && 'border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500',
                hasError && 'border-red-300 focus:border-red-500 focus:ring-red-500'
              )}
              aria-describedby={describedBy || undefined}
              aria-invalid={hasError}
              aria-required={parameter.required}
            />
            {hasError && (
              <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            {hasWarning && !hasError && (
              <p id={`${inputId}-warning`} className="mt-1 text-sm text-yellow-600">
                {warning}
              </p>
            )}
            {!hasError && !hasWarning && parameter.description && (
              <p id={`${inputId}-description`} className="mt-1 text-sm text-slate-500">
                {parameter.description}
              </p>
            )}
          </div>
        );

      case 'textarea':
        return (
          <div>
            <TextArea
              id={inputId}
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              placeholder={parameter.defaultValue ? `Default: ${parameter.defaultValue}` : undefined}
              rows={4}
              className={cn(
                hasWarning && 'border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500',
                hasError && 'border-red-300 focus:border-red-500 focus:ring-red-500'
              )}
              aria-describedby={describedBy || undefined}
              aria-invalid={hasError}
              aria-required={parameter.required}
            />
            {hasError && (
              <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            {hasWarning && !hasError && (
              <p id={`${inputId}-warning`} className="mt-1 text-sm text-yellow-600">
                {warning}
              </p>
            )}
            {!hasError && !hasWarning && parameter.description && (
              <p id={`${inputId}-description`} className="mt-1 text-sm text-slate-500">
                {parameter.description}
              </p>
            )}
          </div>
        );

      case 'number':
        return (
          <div>
            <Input
              id={inputId}
              type="number"
              value={value || ''}
              onChange={(e) => {
                const numValue = e.target.value === '' ? undefined : Number(e.target.value);
                onChange(numValue);
              }}
              onBlur={onBlur}
              placeholder={parameter.defaultValue ? `Default: ${parameter.defaultValue}` : undefined}
              min={parameter.validation?.min}
              max={parameter.validation?.max}
              className={cn(
                hasWarning && 'border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500',
                hasError && 'border-red-300 focus:border-red-500 focus:ring-red-500'
              )}
              aria-describedby={describedBy || undefined}
              aria-invalid={hasError}
              aria-required={parameter.required}
            />
            {hasError && (
              <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            {hasWarning && !hasError && (
              <p id={`${inputId}-warning`} className="mt-1 text-sm text-yellow-600">
                {warning}
              </p>
            )}
            {!hasError && !hasWarning && parameter.description && (
              <p id={`${inputId}-description`} className="mt-1 text-sm text-slate-500">
                {parameter.description}
              </p>
            )}
          </div>
        );

      case 'boolean':
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              <input
                id={inputId}
                type="checkbox"
                checked={value === true}
                onChange={(e) => onChange(e.target.checked)}
                onBlur={onBlur}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded"
                aria-describedby={describedBy || undefined}
                aria-invalid={hasError}
              />
              <label htmlFor={inputId} className="text-sm text-slate-700">
                Enable {parameter.name}
                {parameter.required && <span className="text-red-500 ml-1" aria-label="required">*</span>}
              </label>
            </div>
            {(hasError || hasWarning || parameter.description) && (
              <div className="ml-7">
                {hasError && (
                  <p id={`${inputId}-error`} className="text-sm text-red-600" role="alert">
                    {error}
                  </p>
                )}
                {hasWarning && !hasError && (
                  <p id={`${inputId}-warning`} className="text-sm text-yellow-600">
                    {warning}
                  </p>
                )}
                {!hasError && !hasWarning && parameter.description && (
                  <p id={`${inputId}-description`} className="text-sm text-slate-500">
                    {parameter.description}
                  </p>
                )}
              </div>
            )}
          </div>
        );

      case 'select':
        const options = parameter.options || [];
        return (
          <div>
            <Select
              id={inputId}
              value={value || ''}
              onChange={(selectedValue) => onChange(selectedValue)}
              onBlur={onBlur}
              options={[
                { value: '', label: parameter.defaultValue ? `Default: ${parameter.defaultValue}` : 'Select an option...' },
                ...options.map(option => ({ value: option, label: option }))
              ]}
              className={cn(
                hasWarning && 'border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500',
                hasError && 'border-red-300 focus:border-red-500 focus:ring-red-500'
              )}
              aria-describedby={describedBy || undefined}
              aria-invalid={hasError}
              aria-required={parameter.required}
            />
            {hasError && (
              <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            {hasWarning && !hasError && (
              <p id={`${inputId}-warning`} className="mt-1 text-sm text-yellow-600">
                {warning}
              </p>
            )}
            {!hasError && !hasWarning && parameter.description && (
              <p id={`${inputId}-description`} className="mt-1 text-sm text-slate-500">
                {parameter.description}
              </p>
            )}
          </div>
        );

      default:
        return (
          <div className="text-sm text-red-600">
            Unsupported parameter type: {parameter.type}
          </div>
        );
    }
  };

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {parameter.name}
        {parameter.required && <span className="text-red-500 ml-1" aria-label="required">*</span>}
      </label>
      {renderInput()}
    </div>
  );
};

export const ParameterConfigDialog: React.FC<ParameterConfigDialogProps> = ({
  snippet,
  isOpen,
  onConfirm,
  onCancel,
  initialValues = {},
  className
}) => {
  const [formState, setFormState] = useState<ParameterFormState>({
    values: {},
    errors: {},
    warnings: {},
    isValid: true,
    touched: {}
  });

  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [isValidating, setIsValidating] = useState(false);

  // Refs for focus management
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management
  const { containerRef: focusContainerRef } = useFocusManagement({
    trapFocus: isOpen,
    restoreFocus: true,
    autoFocus: false // We'll handle this manually
  });

  // Initialize form values when snippet or initial values change
  useEffect(() => {
    if (!snippet) return;

    const initialFormValues: Record<string, any> = {};
    const parameters = snippet.parameters || [];

    // Set initial values from props or defaults
    parameters.forEach(param => {
      if (initialValues[param.name] !== undefined) {
        initialFormValues[param.name] = initialValues[param.name];
      } else if (param.defaultValue !== undefined) {
        initialFormValues[param.name] = param.defaultValue;
      } else {
        // Set appropriate empty values based on type
        switch (param.type) {
          case 'boolean':
            initialFormValues[param.name] = false;
            break;
          case 'number':
            initialFormValues[param.name] = undefined;
            break;
          default:
            initialFormValues[param.name] = '';
        }
      }
    });

    setFormState(prev => ({
      ...prev,
      values: initialFormValues,
      errors: {},
      warnings: {},
      touched: {}
    }));
  }, [snippet, initialValues]);

  // Validate form whenever values change
  const validateForm = useCallback(async () => {
    if (!snippet || !snippet.parameters) {
      setFormState(prev => ({ ...prev, isValid: true, errors: {}, warnings: {} }));
      return;
    }

    setIsValidating(true);

    try {
      const validation = SnippetInsertionUtils.validateParameters(
        snippet.parameters,
        formState.values
      );

      setFormState(prev => ({
        ...prev,
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings
      }));
    } catch (error) {
      console.error('Validation error:', error);
      setFormState(prev => ({
        ...prev,
        isValid: false,
        errors: { _general: 'Validation failed' },
        warnings: {}
      }));
    } finally {
      setIsValidating(false);
    }
  }, [snippet, formState.values]);

  useEffect(() => {
    validateForm();
  }, [validateForm]);

  // Handle input changes
  const handleInputChange = useCallback((paramName: string, value: any) => {
    setFormState(prev => ({
      ...prev,
      values: {
        ...prev.values,
        [paramName]: value
      }
    }));
  }, []);

  // Handle input blur (mark as touched)
  const handleInputBlur = useCallback((paramName: string) => {
    setFormState(prev => ({
      ...prev,
      touched: {
        ...prev.touched,
        [paramName]: true
      }
    }));
  }, []);

  // Handle form submission
  const handleConfirm = useCallback(() => {
    if (!snippet || !formState.isValid) return;

    // Sanitize parameters before confirming
    const sanitizedParameters = SnippetInsertionUtils.sanitizeParameters(formState.values);
    onConfirm(sanitizedParameters);
  }, [snippet, formState.isValid, formState.values, onConfirm]);

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      shortcut: { key: 'Escape' },
      handler: () => onCancel(),
      description: 'Cancel parameter configuration'
    },
    {
      shortcut: { key: 'Enter', ctrlKey: true },
      handler: () => {
        if (formState.isValid) {
          handleConfirm();
        }
      },
      description: 'Confirm and insert snippet'
    }
  ], { enabled: isOpen });

  // Auto-focus first input when dialog opens
  useEffect(() => {
    if (isOpen && firstInputRef.current) {
      // Small delay to ensure modal is fully rendered
      setTimeout(() => {
        firstInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Handle preview generation
  const handlePreviewGenerated = useCallback((html: string, success: boolean) => {
    setPreviewHtml(html);
  }, []);

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setFormState({
        values: {},
        errors: {},
        warnings: {},
        isValid: true,
        touched: {}
      });
      setPreviewHtml('');
    }
  }, [isOpen]);

  // Memoize parameters for performance
  const parameters = useMemo(() => snippet?.parameters || [], [snippet?.parameters]);

  if (!snippet) return null;

  const hasParameters = parameters.length > 0;
  const hasErrors = Object.keys(formState.errors).length > 0;
  const hasWarnings = Object.keys(formState.warnings).length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      size="xl"
    >
      <div
        ref={focusContainerRef}
        role="dialog"
        aria-labelledby="parameter-dialog-title"
        aria-describedby="parameter-dialog-description"
      >
        <ModalHeader onClose={onCancel}>
          <ModalTitle id="parameter-dialog-title">Configure Snippet Parameters</ModalTitle>
          <ModalDescription id="parameter-dialog-description">
            Set up parameters for "{snippet.name}" snippet
            {snippet.description && ` - ${snippet.description}`}
            {hasParameters && (
              <span className="block mt-1 text-xs text-slate-500">
                Use Tab to navigate between fields, Ctrl+Enter to confirm, Escape to cancel
              </span>
            )}
          </ModalDescription>
        </ModalHeader>

      <ModalContent className="max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Parameter Form */}
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-slate-900 mb-4">Parameters</h3>

              {!hasParameters ? (
                <div className="text-center py-8 text-slate-500" role="status">
                  <svg
                    className="h-8 w-8 mx-auto mb-2 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="text-sm">This snippet has no configurable parameters</p>
                </div>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (formState.isValid) {
                      handleConfirm();
                    }
                  }}
                >
                  {parameters.map((parameter, index) => (
                    <ParameterInput
                      key={parameter.name}
                      parameter={parameter}
                      value={formState.values[parameter.name]}
                      error={formState.touched[parameter.name] ? formState.errors[parameter.name] : undefined}
                      warning={formState.touched[parameter.name] ? formState.warnings[parameter.name] : undefined}
                      onChange={(value) => handleInputChange(parameter.name, value)}
                      onBlur={() => handleInputBlur(parameter.name)}
                      touched={formState.touched[parameter.name] || false}
                    />
                  ))}
                </form>
              )}

              {/* Validation Summary */}
              {(hasErrors || hasWarnings) && (
                <div className="mt-4 space-y-2">
                  {hasErrors && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-3">
                      <div className="flex">
                        <svg
                          className="h-5 w-5 text-red-400 mr-2 mt-0.5 flex-shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <div>
                          <h4 className="text-sm font-medium text-red-800">
                            Please fix the following errors:
                          </h4>
                          <ul className="mt-1 text-sm text-red-700 list-disc list-inside">
                            {Object.entries(formState.errors).map(([field, error]) => (
                              <li key={field}>{error}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {hasWarnings && !hasErrors && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                      <div className="flex">
                        <svg
                          className="h-5 w-5 text-yellow-400 mr-2 mt-0.5 flex-shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                          />
                        </svg>
                        <div>
                          <h4 className="text-sm font-medium text-yellow-800">
                            Warnings:
                          </h4>
                          <ul className="mt-1 text-sm text-yellow-700 list-disc list-inside">
                            {Object.entries(formState.warnings).map(([field, warning]) => (
                              <li key={field}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Live Preview */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-slate-900">Live Preview</h3>
            <ParameterPreview
              snippet={snippet}
              parameters={formState.values}
              onPreviewGenerated={handlePreviewGenerated}
              className="min-h-[300px]"
            />
          </div>
        </div>
      </ModalContent>

        <ModalFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            aria-label="Cancel parameter configuration (Escape)"
          >
            Cancel
          </Button>
          <Button
            ref={confirmButtonRef}
            variant="primary"
            onClick={handleConfirm}
            disabled={!formState.isValid || isValidating}
            isLoading={isValidating}
            aria-label={`${hasParameters ? 'Insert snippet with parameters' : 'Insert snippet'} (Ctrl+Enter)`}
          >
            {hasParameters ? 'Insert Snippet' : 'Insert'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
};
