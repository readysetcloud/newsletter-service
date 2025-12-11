import { useState, useCallback, useEffect, useMemo } from 'react';
import { useDebounce } from './useDebounce';
import type { Snippet, SnippetParameter } from '@/types/template';

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
  suggestion?: string;
}

interface FieldValidationState {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  isValidating: boolean;
  lastValidated?: Date;
}

interface ValidationState {
  isValid: boolean;
  isValidating: boolean;
  fields: Record<string, FieldValidationState>;
  globalErrors: ValidationError[];
  globalWarnings: ValidationWarning[];
  summary: {
    errorCount: number;
    warningCount: number;
    validFieldCount: number;
    totalFieldCount: number;
  };
}

interface UseSnippetValidationOptions {
  validateOnChange?: boolean;
  validateOnBlur?: boolean;
  debounceMs?: number;
  enableRealTimeValidation?: boolean;
  strictMode?: boolean;
}

interface UseSnippetValidationResult {
  validationState: ValidationState;
  validateField: (fieldName: string, value: any) => Promise<FieldValidationState>;
  validateAllFields: (parameters: Record<string, any>) => Promise<ValidationState>;
  clearValidation: (fieldName?: string) => void;
  getFieldErrors: (fieldName: string) => ValidationError[];
  getFieldWarnings: (fieldName: string) => ValidationWarning[];
  isFieldValid: (fieldName: string) => boolean;
  canSubmit: boolean;
}

const DEFAULT_OPTIONS: UseSnippetValidationOptions = {
  validateOnChange: true,
  validateOnBlur: true,
  debounceMs: 300,
  enableRealTimeValidation: true,
  strictMode: false
};

export const useSnippetValidation = (
  snippet: Snippet,
  initialParameters: Record<string, any> = {},
  options: UseSnippetValidationOptions = {}
): UseSnippetValidationResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [validationState, setValidationState] = useState<ValidationState>(() => {
    const initialFields: Record<string, FieldValidationState> = {};

    snippet.parameters?.forEach(param => {
      initialFields[param.name] = {
        isValid: true,
        errors: [],
        warnings: [],
        isValidating: false
      };
    });

    return {
      isValid: true,
      isValidating: false,
      fields: initialFields,
      globalErrors: [],
      globalWarnings: [],
      summary: {
        errorCount: 0,
        warningCount: 0,
        validFieldCount: snippet.parameters?.length || 0,
        totalFieldCount: snippet.parameters?.length || 0
      }
    };
  });

  // Debounced parameters for real-time validation
  const debouncedParameters = useDebounce(initialParameters, opts.debounceMs || 300);

  // Validation functions
  const validateParameterType = useCallback((
    parameter: SnippetParameter,
    value: any
  ): { isValid: boolean; errors: ValidationError[]; warnings: ValidationWarning[] } => {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check if value is empty
    const isEmpty = value === undefined || value === null || value === '';

    // Required field validation
    if (parameter.required && isEmpty) {
      errors.push({
        field: parameter.name,
        message: `${parameter.name} is required`,
        code: 'REQUIRED_FIELD',
        severity: 'error'
      });
      return { isValid: false, errors, warnings };
    }

    // Skip further validation if field is empty and not required
    if (isEmpty) {
      return { isValid: true, errors, warnings };
    }

    // Type-specific validation
    switch (parameter.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push({
            field: parameter.name,
            message: `${parameter.name} must be a string`,
            code: 'INVALID_TYPE',
            severity: 'error'
          });
        } else {
          // String-specific warnings
          if (value.length > 1000) {
            warnings.push({
              field: parameter.name,
              message: 'Very long text may affect performance',
              code: 'LONG_STRING',
              suggestion: 'Consider shortening the text or using a textarea parameter'
            });
          }

          if (value.includes('<script>') || value.includes('javascript:')) {
            warnings.push({
              field: parameter.name,
              message: 'Potentially unsafe content detected',
              code: 'UNSAFE_CONTENT',
              suggestion: 'Remove script tags and javascript: URLs'
            });
          }

          // Pattern validation
          if (parameter.validation?.pattern) {
            const regex = new RegExp(parameter.validation.pattern);
            if (!regex.test(value)) {
              errors.push({
                field: parameter.name,
                message: parameter.validation.message || `${parameter.name} format is invalid`,
                code: 'PATTERN_MISMATCH',
                severity: 'error'
              });
            }
          }

          // Length validation
          if (parameter.validation?.min && value.length < parameter.validation.min) {
            errors.push({
              field: parameter.name,
              message: `${parameter.name} must be at least ${parameter.validation.min} characters`,
              code: 'MIN_LENGTH',
              severity: 'error'
            });
          }

          if (parameter.validation?.max && value.length > parameter.validation.max) {
            errors.push({
              field: parameter.name,
              message: `${parameter.name} must be no more than ${parameter.validation.max} characters`,
              code: 'MAX_LENGTH',
              severity: 'error'
            });
          }
        }
        break;

      case 'number':
        const numValue = Number(value);
        if (isNaN(numValue) || !isFinite(numValue)) {
          errors.push({
            field: parameter.name,
            message: `${parameter.name} must be a valid number`,
            code: 'INVALID_NUMBER',
            severity: 'error'
          });
        } else {
          // Range validation
          if (parameter.validation?.min !== undefined && numValue < parameter.validation.min) {
            errors.push({
              field: parameter.name,
              message: `${parameter.name} must be at least ${parameter.validation.min}`,
              code: 'MIN_VALUE',
              severity: 'error'
            });
          }

          if (parameter.validation?.max !== undefined && numValue > parameter.validation.max) {
            errors.push({
              field: parameter.name,
              message: `${parameter.name} must be no more than ${parameter.validation.max}`,
              code: 'MAX_VALUE',
              severity: 'error'
            });
          }

          // Number-specific warnings
          if (numValue < 0 && parameter.name.toLowerCase().includes('count')) {
            warnings.push({
              field: parameter.name,
              message: 'Negative values may not be appropriate for count parameters',
              code: 'NEGATIVE_COUNT',
              suggestion: 'Use a positive number for count parameters'
            });
          }
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          // Try to convert string representations
          if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lowerValue)) {
              errors.push({
                field: parameter.name,
                message: `${parameter.name} must be a boolean value (true/false)`,
                code: 'INVALID_BOOLEAN',
                severity: 'error'
              });
            }
          } else {
            errors.push({
              field: parameter.name,
              message: `${parameter.name} must be a boolean`,
              code: 'INVALID_TYPE',
              severity: 'error'
            });
          }
        }
        break;

      case 'select':
        if (parameter.options && !parameter.options.includes(value)) {
          errors.push({
            field: parameter.name,
            message: `${parameter.name} must be one of: ${parameter.options.join(', ')}`,
            code: 'INVALID_OPTION',
            severity: 'error'
          });
        }
        break;

      case 'textarea':
        if (typeof value !== 'string') {
          errors.push({
            field: parameter.name,
            message: `${parameter.name} must be a string`,
            code: 'INVALID_TYPE',
            severity: 'error'
          });
        } else if (value.length > 10000) {
          warnings.push({
            field: parameter.name,
            message: 'Very long content may affect performance',
            code: 'LONG_TEXTAREA',
            suggestion: 'Consider breaking up long content into smaller sections'
          });
        }
        break;

      default:
        errors.push({
          field: parameter.name,
          message: `Unknown parameter type: ${parameter.type}`,
          code: 'UNKNOWN_TYPE',
          severity: 'error'
        });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }, []);

  const validateField = useCallback(async (
    fieldName: string,
    value: any
  ): Promise<FieldValidationState> => {
    const parameter = snippet.parameters?.find(p => p.name === fieldName);

    if (!parameter) {
      return {
        isValid: false,
        errors: [{
          field: fieldName,
          message: `Unknown parameter: ${fieldName}`,
          code: 'UNKNOWN_PARAMETER',
          severity: 'error'
        }],
        warnings: [],
        isValidating: false,
        lastValidated: new Date()
      };
    }

    // Set validating state
    setValidationState(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [fieldName]: {
          ...prev.fields[fieldName],
          isValidating: true
        }
      }
    }));

    // Simulate async validation (for future server-side validation)
    await new Promise(resolve => setTimeout(resolve, 50));

    const validation = validateParameterType(parameter, value);

    const fieldState: FieldValidationState = {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      isValidating: false,
      lastValidated: new Date()
    };

    // Update validation state
    setValidationState(prev => {
      const newFields = {
        ...prev.fields,
        [fieldName]: fieldState
      };

      // Recalculate summary
      const summary = calculateSummary(newFields, prev.globalErrors, prev.globalWarnings);

      return {
        ...prev,
        fields: newFields,
        isValid: summary.errorCount === 0,
        summary
      };
    });

    return fieldState;
  }, [snippet.parameters, validateParameterType]);

  const validateAllFields = useCallback(async (
    parameters: Record<string, any>
  ): Promise<ValidationState> => {
    setValidationState(prev => ({ ...prev, isValidating: true }));

    const fieldValidations: Record<string, FieldValidationState> = {};
    const globalErrors: ValidationError[] = [];
    const globalWarnings: ValidationWarning[] = [];

    // Validate each parameter
    for (const parameter of snippet.parameters || []) {
      const value = parameters[parameter.name];
      const validation = validateParameterType(parameter, value);

      fieldValidations[parameter.name] = {
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings,
        isValidating: false,
        lastValidated: new Date()
      };
    }

    // Check for unknown parameters in strict mode
    if (opts.strictMode) {
      const knownParams = new Set(snippet.parameters?.map(p => p.name) || []);
      for (const paramName of Object.keys(parameters)) {
        if (!knownParams.has(paramName)) {
          globalWarnings.push({
            field: paramName,
            message: `Unknown parameter: ${paramName}`,
            code: 'UNKNOWN_PARAMETER',
            suggestion: 'Remove this parameter or check the snippet definition'
          });
        }
      }
    }

    const summary = calculateSummary(fieldValidations, globalErrors, globalWarnings);

    const newState: ValidationState = {
      isValid: summary.errorCount === 0,
      isValidating: false,
      fields: fieldValidations,
      globalErrors,
      globalWarnings,
      summary
    };

    setValidationState(newState);
    return newState;
  }, [snippet.parameters, validateParameterType, opts.strictMode]);

  const clearValidation = useCallback((fieldName?: string) => {
    if (fieldName) {
      setValidationState(prev => ({
        ...prev,
        fields: {
          ...prev.fields,
          [fieldName]: {
            isValid: true,
            errors: [],
            warnings: [],
            isValidating: false
          }
        }
      }));
    } else {
      setValidationState(prev => {
        const clearedFields: Record<string, FieldValidationState> = {};

        snippet.parameters?.forEach(param => {
          clearedFields[param.name] = {
            isValid: true,
            errors: [],
            warnings: [],
            isValidating: false
          };
        });

        return {
          isValid: true,
          isValidating: false,
          fields: clearedFields,
          globalErrors: [],
          globalWarnings: [],
          summary: {
            errorCount: 0,
            warningCount: 0,
            validFieldCount: snippet.parameters?.length || 0,
            totalFieldCount: snippet.parameters?.length || 0
          }
        };
      });
    }
  }, [snippet.parameters]);

  // Helper functions
  const getFieldErrors = useCallback((fieldName: string): ValidationError[] => {
    return validationState.fields[fieldName]?.errors || [];
  }, [validationState.fields]);

  const getFieldWarnings = useCallback((fieldName: string): ValidationWarning[] => {
    return validationState.fields[fieldName]?.warnings || [];
  }, [validationState.fields]);

  const isFieldValid = useCallback((fieldName: string): boolean => {
    return validationState.fields[fieldName]?.isValid ?? true;
  }, [validationState.fields]);

  // Calculate summary helper
  const calculateSummary = useCallback((
    fields: Record<string, FieldValidationState>,
    globalErrors: ValidationError[],
    globalWarnings: ValidationWarning[]
  ) => {
    let errorCount = globalErrors.length;
    let warningCount = globalWarnings.length;
    let validFieldCount = 0;
    const totalFieldCount = Object.keys(fields).length;

    Object.values(fields).forEach(field => {
      errorCount += field.errors.length;
      warningCount += field.warnings.length;
      if (field.isValid) {
        validFieldCount++;
      }
    });

    return {
      errorCount,
      warningCount,
      validFieldCount,
      totalFieldCount
    };
  }, []);

  // Real-time validation effect
  useEffect(() => {
    if (opts.enableRealTimeValidation && opts.validateOnChange) {
      validateAllFields(debouncedParameters);
    }
  }, [debouncedParameters, opts.enableRealTimeValidation, opts.validateOnChange, validateAllFields]);

  // Computed properties
  const canSubmit = useMemo(() => {
    return validationState.isValid && !validationState.isValidating;
  }, [validationState.isValid, validationState.isValidating]);

  return {
    validationState,
    validateField,
    validateAllFields,
    clearValidation,
    getFieldErrors,
    getFieldWarnings,
    isFieldValid,
    canSubmit
  };
};
