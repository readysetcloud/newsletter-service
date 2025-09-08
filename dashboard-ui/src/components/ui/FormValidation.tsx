import React, { useState, useCallback, useEffect } from 'react';
import { cn } from '@/utils/cn';
import { InlineError, ValidationErrorSummary } from './ErrorDisplay';
import { ValidationLoading } from './LoadingStates';
import {
  ExclamationCircleIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline';

/**
 * Field validation state
 */
export interface FieldValidation {
  isValid: boolean;
  error?: string;
  warning?: string;
  isValidating?: boolean;
}

/**
 * Form validation state
 */
export interface FormValidation {
  isValid: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
  isValidating: boolean;
  touchedFields: Set<string>;
}

/**
 * Validation rule interface
 */
export interface ValidationRule {
  validate: (value: any, formData?: any) => boolean | Promise<boolean>;
  message: string;
  type?: 'error' | 'warning';
}

/**
 * Field validation props
 */
interface ValidatedFieldProps {
  name: string;
  value: any;
  validation?: FieldValidation;
  rules?: ValidationRule[];
  validateOnChange?: boolean;
  validateOnBlur?: boolean;
  debounceMs?: number;
  children: (props: {
    hasError: boolean;
    hasWarning: boolean;
    isValidating: boolean;
    onBlur: () => void;
    onChange: (value: any) => void;
  }) => React.ReactNode;
  onValidationChange?: (validation: FieldValidation) => void;
  className?: string;
}

/**
 * Validated field component
 */
export const ValidatedField: React.FC<ValidatedFieldProps> = ({
  name,
  value,
  validation,
  rules = [],
  validateOnChange = true,
  validateOnBlur = true,
  debounceMs = 300,
  children,
  onValidationChange,
  className
}) => {
  const [localValidation, setLocalValidation] = useState<FieldValidation>({
    isValid: true
  });
  const [isTouched, setIsTouched] = useState(false);
  const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout>();

  const currentValidation = validation || localValidation;

  const validateField = useCallback(async (fieldValue: any, formData?: any) => {
    if (rules.length === 0) return;

    setLocalValidation(prev => ({ ...prev, isValidating: true }));

    let isValid = true;
    let error: string | undefined;
    let warning: string | undefined;

    for (const rule of rules) {
      try {
        const result = await rule.validate(fieldValue, formData);
        if (!result) {
          if (rule.type === 'warning') {
            warning = rule.message;
          } else {
            error = rule.message;
            isValid = false;
            break; // Stop on first error
          }
        }
      } catch (validationError) {
        error = 'Validation failed';
        isValid = false;
        break;
      }
    }

    const newValidation: FieldValidation = {
      isValid,
      error,
      warning,
      isValidating: false
    };

    setLocalValidation(newValidation);
    onValidationChange?.(newValidation);
  }, [rules, onValidationChange]);

  const handleChange = useCallback((newValue: any) => {
    if (validateOnChange && isTouched) {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      const timeout = setTimeout(() => {
        validateField(newValue);
      }, debounceMs);

      setDebounceTimeout(timeout);
    }
  }, [validateOnChange, isTouched, debounceMs, validateField, debounceTimeout]);

  const handleBlur = useCallback(() => {
    setIsTouched(true);
    if (validateOnBlur) {
      validateField(value);
    }
  }, [validateOnBlur, validateField, value]);

  useEffect(() => {
    return () => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
    };
  }, [debounceTimeout]);

  return (
    <div className={cn('space-y-1', className)}>
      {children({
        hasError: !currentValidation.isValid && !!currentValidation.error,
        hasWarning: !!currentValidation.warning,
        isValidating: !!currentValidation.isValidating,
        onBlur: handleBlur,
        onChange: handleChange
      })}

      {/* Validation feedback */}
      <div className="min-h-[1.25rem]">
        {currentValidation.isValidating && (
          <ValidationLoading className="text-xs" />
        )}
        {!currentValidation.isValidating && currentValidation.error && isTouched && (
          <InlineError message={currentValidation.error} className="text-xs" />
        )}
        {!currentValidation.isValidating && currentValidation.warning && isTouched && (
          <div className="flex items-center text-xs text-yellow-600">
            <ExclamationCircleIcon className="w-3 h-3 mr-1 flex-shrink-0" />
            {currentValidation.warning}
          </div>
        )}
        {!currentValidation.isValidating && currentValidation.isValid && isTouched && !currentValidation.warning && (
          <div className="flex items-center text-xs text-green-600">
            <CheckCircleIcon className="w-3 h-3 mr-1 flex-shrink-0" />
            Valid
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Form validation context
 */
interface FormValidationContextType {
  validation: FormValidation;
  validateField: (name: string, value: any, rules?: ValidationRule[]) => Promise<void>;
  setFieldError: (name: string, error: string) => void;
  setFieldWarning: (name: string, warning: string) => void;
  clearFieldValidation: (name: string) => void;
  touchField: (name: string) => void;
  isFieldTouched: (name: string) => boolean;
  validateForm: () => Promise<boolean>;
  resetValidation: () => void;
}

const FormValidationContext = React.createContext<FormValidationContextType | undefined>(undefined);

/**
 * Form validation provider
 */
export const FormValidationProvider: React.FC<{
  children: React.ReactNode;
  onValidationChange?: (validation: FormValidation) => void;
}> = ({ children, onValidationChange }) => {
  const [validation, setValidation] = useState<FormValidation>({
    isValid: true,
    errors: {},
    warnings: {},
    isValidating: false,
    touchedFields: new Set()
  });

  const validateField = useCallback(async (
    name: string,
    value: any,
    rules: ValidationRule[] = []
  ) => {
    if (rules.length === 0) return;

    setValidation(prev => ({ ...prev, isValidating: true }));

    let error: string | undefined;
    let warning: string | undefined;

    for (const rule of rules) {
      try {
        const result = await rule.validate(value);
        if (!result) {
          if (rule.type === 'warning') {
            warning = rule.message;
          } else {
            error = rule.message;
            break;
          }
        }
      } catch (validationError) {
        error = 'Validation failed';
        break;
      }
    }

    setValidation(prev => {
      const newErrors = { ...prev.errors };
      const newWarnings = { ...prev.warnings };

      if (error) {
        newErrors[name] = error;
      } else {
        delete newErrors[name];
      }

      if (warning) {
        newWarnings[name] = warning;
      } else {
        delete newWarnings[name];
      }

      const newValidation = {
        ...prev,
        errors: newErrors,
        warnings: newWarnings,
        isValid: Object.keys(newErrors).length === 0,
        isValidating: false
      };

      onValidationChange?.(newValidation);
      return newValidation;
    });
  }, [onValidationChange]);

  const setFieldError = useCallback((name: string, error: string) => {
    setValidation(prev => {
      const newErrors = { ...prev.errors, [name]: error };
      const newValidation = {
        ...prev,
        errors: newErrors,
        isValid: Object.keys(newErrors).length === 0
      };
      onValidationChange?.(newValidation);
      return newValidation;
    });
  }, [onValidationChange]);

  const setFieldWarning = useCallback((name: string, warning: string) => {
    setValidation(prev => {
      const newWarnings = { ...prev.warnings, [name]: warning };
      const newValidation = {
        ...prev,
        warnings: newWarnings
      };
      onValidationChange?.(newValidation);
      return newValidation;
    });
  }, [onValidationChange]);

  const clearFieldValidation = useCallback((name: string) => {
    setValidation(prev => {
      const newErrors = { ...prev.errors };
      const newWarnings = { ...prev.warnings };
      delete newErrors[name];
      delete newWarnings[name];

      const newValidation = {
        ...prev,
        errors: newErrors,
        warnings: newWarnings,
        isValid: Object.keys(newErrors).length === 0
      };
      onValidationChange?.(newValidation);
      return newValidation;
    });
  }, [onValidationChange]);

  const touchField = useCallback((name: string) => {
    setValidation(prev => ({
      ...prev,
      touchedFields: new Set([...prev.touchedFields, name])
    }));
  }, []);

  const isFieldTouched = useCallback((name: string) => {
    return validation.touchedFields.has(name);
  }, [validation.touchedFields]);

  const validateForm = useCallback(async (): Promise<boolean> => {
    // This would typically validate all fields in the form
    // For now, just return the current validation state
    return validation.isValid;
  }, [validation.isValid]);

  const resetValidation = useCallback(() => {
    const newValidation: FormValidation = {
      isValid: true,
      errors: {},
      warnings: {},
      isValidating: false,
      touchedFields: new Set()
    };
    setValidation(newValidation);
    onValidationChange?.(newValidation);
  }, [onValidationChange]);

  const contextValue: FormValidationContextType = {
    validation,
    validateField,
    setFieldError,
    setFieldWarning,
    clearFieldValidation,
    touchField,
    isFieldTouched,
    validateForm,
    resetValidation
  };

  return (
    <FormValidationContext.Provider value={contextValue}>
      {children}
    </FormValidationContext.Provider>
  );
};

/**
 * Hook to use form validation
 */
export const useFormValidation = (): FormValidationContextType => {
  const context = React.useContext(FormValidationContext);
  if (!context) {
    throw new Error('useFormValidation must be used within a FormValidationProvider');
  }
  return context;
};

/**
 * Validation summary component
 */
export const FormValidationSummary: React.FC<{
  validation: FormValidation;
  showWarnings?: boolean;
  className?: string;
}> = ({ validation, showWarnings = true, className }) => {
  const errorCount = Object.keys(validation.errors).length;
  const warningCount = Object.keys(validation.warnings).length;

  if (errorCount === 0 && (!showWarnings || warningCount === 0)) {
    return null;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {errorCount > 0 && (
        <ValidationErrorSummary
          errors={validation.errors}
          title={`Please fix ${errorCount} error${errorCount !== 1 ? 's' : ''}:`}
        />
      )}
      {showWarnings && warningCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
          <div className="flex">
            <ExclamationCircleIcon className="h-5 w-5 text-yellow-400" />
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">
                {warningCount} warning{warningCount !== 1 ? 's' : ''}:
              </h3>
              <div className="mt-2 text-sm text-yellow-700">
                <ul className="list-disc list-inside space-y-1">
                  {Object.entries(validation.warnings).map(([field, warning]) => (
                    <li key={field}>
                      <span className="font-medium capitalize">
                        {field.replace(/([A-Z])/g, ' $1').toLowerCase()}:
                      </span>{' '}
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Common validation rules
 */
export const validationRules = {
  required: (message = 'This field is required'): ValidationRule => ({
    validate: (value) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    },
    message
  }),

  minLength: (min: number, message?: string): ValidationRule => ({
    validate: (value) => {
      if (!value) return true; // Let required rule handle empty values
      return String(value).length >= min;
    },
    message: message || `Must be at least ${min} characters`
  }),

  maxLength: (max: number, message?: string): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return String(value).length <= max;
    },
    message: message || `Must be no more than ${max} characters`
  }),

  pattern: (regex: RegExp, message: string): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return regex.test(String(value));
    },
    message
  }),

  email: (message = 'Please enter a valid email address'): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(String(value));
    },
    message
  }),

  unique: (
    existingValues: string[],
    message = 'This value already exists'
  ): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return !existingValues.includes(String(value).toLowerCase());
    },
    message
  }),

  custom: (
    validator: (value: any) => boolean | Promise<boolean>,
    message: string
  ): ValidationRule => ({
    validate: validator,
    message
  }),

  warning: (
    validator: (value: any) => boolean | Promise<boolean>,
    message: string
  ): ValidationRule => ({
    validate: validator,
    message,
    type: 'warning'
  })
};

/**
 * Template-specific validation rules
 */
export const templateValidationRules = {
  templateName: [
    validationRules.required('Template name is required'),
    validationRules.minLength(1, 'Template name cannot be empty'),
    validationRules.maxLength(100, 'Template name must be less than 100 characters'),
    validationRules.pattern(
      /^[a-zA-Z0-9\s\-_()]+$/,
      'Template name can only contain letters, numbers, spaces, hyphens, underscores, and parentheses'
    )
  ],

  snippetName: [
    validationRules.required('Snippet name is required'),
    validationRules.minLength(1, 'Snippet name cannot be empty'),
    validationRules.maxLength(100, 'Snippet name must be less than 100 characters'),
    validationRules.pattern(
      /^[a-zA-Z0-9\-_]+$/,
      'Snippet name can only contain letters, numbers, hyphens, and underscores'
    )
  ],

  templateContent: [
    validationRules.required('Template content is required'),
    validationRules.maxLength(1000000, 'Template content must be less than 1MB')
  ],

  snippetContent: [
    validationRules.required('Snippet content is required'),
    validationRules.maxLength(100000, 'Snippet content must be less than 100KB')
  ],

  description: [
    validationRules.maxLength(500, 'Description must be less than 500 characters')
  ],

  category: [
    validationRules.maxLength(50, 'Category must be less than 50 characters')
  ],

  parameterName: [
    validationRules.required('Parameter name is required'),
    validationRules.maxLength(50, 'Parameter name must be less than 50 characters'),
    validationRules.pattern(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      'Parameter name must start with a letter or underscore and contain only letters, numbers, and underscores'
    )
  ],

  parameterDescription: [
    validationRules.maxLength(200, 'Parameter description must be less than 200 characters')
  ]
};
