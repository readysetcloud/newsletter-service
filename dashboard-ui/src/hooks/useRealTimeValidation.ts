import { useState, useEffect, useCallback, useRef } from 'react';
import { z } from 'zod';
import { UseFormReturn, FieldPath, FieldValues } from 'react-hook-form';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  warning?: string;
  isValidating?: boolean;
}

export interface RealTimeValidationOptions {
  debounceMs?: number;
  validateOnMount?: boolean;
  showWarnings?: boolean;
}

/**
 * Hook for real-time field validation with debouncing
 */
export function useRealTimeValidation<T extends FieldValues>(
  form: UseFormReturn<T>,
  fieldName: FieldPath<T>,
  schema: z.ZodSchema,
  options: RealTimeValidationOptions = {}
) {
  const {
    debounceMs = 300,
    validateOnMount = false,
    showWarnings = true
  } = options;

  const [validationState, setValidationState] = useState<ValidationResult>({
    isValid: true
  });

  const debounceTimer = useRef<NodeJS.Timeout>();
  const lastValue = useRef<any>();

  const validateField = useCallback(async (value: any) => {
    // Skip validation if value hasn't changed
    if (lastValue.current === value) return;
    lastValue.current = value;

    setValidationState(prev => ({ ...prev, isValidating: true }));

    try {
      await schema.parseAsync(value);
      setValidationState({
        isValid: true,
        isValidating: false
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        setValidationState({
          isValid: false,
          error: firstError?.message || 'Invalid value',
          isValidating: false
        });
      } else {
        setValidationState({
          isValid: false,
          error: 'Validation error',
          isValidating: false
        });
      }
    }
  }, [schema]);

  const debouncedValidate = useCallback((value: any) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      validateField(value);
    }, debounceMs);
  }, [validateField, debounceMs]);

  // Watch field value changes
  const fieldValue = form.watch(fieldName);

  useEffect(() => {
    if (validateOnMount || (form.formState.touchedFields as any)[fieldName]) {
      debouncedValidate(fieldValue);
    }
  }, [fieldValue, debouncedValidate, validateOnMount, form.formState.touchedFields, fieldName]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return validationState;
}

/**
 * Hook for managing form-wide validation state
 */
export function useFormValidationState<T extends FieldValues>(
  form: UseFormReturn<T>
) {
  const [isFormValid, setIsFormValid] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [validationWarnings, setValidationWarnings] = useState<Record<string, string>>({});

  // Update form validation state when form errors change
  useEffect(() => {
    const errors = form.formState.errors;
    const errorMessages: Record<string, string> = {};

    Object.entries(errors).forEach(([field, error]) => {
      if (error && 'message' in error && typeof error.message === 'string') {
        errorMessages[field] = error.message;
      }
    });

    setValidationErrors(errorMessages);
    setIsFormValid(Object.keys(errorMessages).length === 0);
  }, [form.formState.errors]);

  const setFieldWarning = useCallback((field: string, warning: string | null) => {
    setValidationWarnings(prev => {
      if (warning === null) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: warning };
    });
  }, []);

  const clearFieldWarning = useCallback((field: string) => {
    setFieldWarning(field, null);
  }, [setFieldWarning]);

  const clearAllWarnings = useCallback(() => {
    setValidationWarnings({});
  }, []);

  return {
    isFormValid,
    validationErrors,
    validationWarnings,
    setFieldWarning,
    clearFieldWarning,
    clearAllWarnings
  };
}

/**
 * Hook for progressive validation (validates fields as user progresses through form)
 */
export function useProgressiveValidation<T extends FieldValues>(
  form: UseFormReturn<T>,
  fieldOrder: Array<FieldPath<T>>
) {
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [completedFields, setCompletedFields] = useState<Set<string>>(new Set());

  const currentField = fieldOrder[currentFieldIndex];
  const isLastField = currentFieldIndex === fieldOrder.length - 1;

  const markFieldComplete = useCallback((fieldName: string) => {
    setCompletedFields(prev => new Set([...prev, fieldName]));

    const fieldIndex = fieldOrder.indexOf(fieldName as FieldPath<T>);
    if (fieldIndex >= 0 && fieldIndex === currentFieldIndex && !isLastField) {
      setCurrentFieldIndex(prev => prev + 1);
    }
  }, [fieldOrder, currentFieldIndex, isLastField]);

  const goToField = useCallback((fieldName: string) => {
    const fieldIndex = fieldOrder.indexOf(fieldName as FieldPath<T>);
    if (fieldIndex >= 0) {
      setCurrentFieldIndex(fieldIndex);
    }
  }, [fieldOrder]);

  const resetProgress = useCallback(() => {
    setCurrentFieldIndex(0);
    setCompletedFields(new Set());
  }, []);

  return {
    currentField,
    currentFieldIndex,
    isLastField,
    completedFields,
    markFieldComplete,
    goToField,
    resetProgress,
    progressPercentage: (completedFields.size / fieldOrder.length) * 100
  };
}

/**
 * Hook for field-level optimistic updates
 */
export function useOptimisticFieldUpdate<T extends FieldValues>(
  form: UseFormReturn<T>,
  fieldName: FieldPath<T>,
  onUpdate: (value: any) => Promise<void>
) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [lastSavedValue, setLastSavedValue] = useState<any>(null);

  const fieldValue = form.watch(fieldName);
  const hasUnsavedChanges = lastSavedValue !== null && lastSavedValue !== fieldValue;

  const saveField = useCallback(async () => {
    if (isUpdating) return;

    try {
      setIsUpdating(true);
      setUpdateError(null);

      await onUpdate(fieldValue);
      setLastSavedValue(fieldValue);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Update failed';
      setUpdateError(errorMessage);

      // Revert to last saved value on error
      if (lastSavedValue !== null) {
        form.setValue(fieldName, lastSavedValue);
      }
    } finally {
      setIsUpdating(false);
    }
  }, [fieldValue, onUpdate, isUpdating, lastSavedValue, form, fieldName]);

  const revertChanges = useCallback(() => {
    if (lastSavedValue !== null) {
      form.setValue(fieldName, lastSavedValue);
      setUpdateError(null);
    }
  }, [lastSavedValue, form, fieldName]);

  // Auto-save after debounce period
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const timer = setTimeout(() => {
      saveField();
    }, 2000); // Auto-save after 2 seconds of inactivity

    return () => clearTimeout(timer);
  }, [hasUnsavedChanges, saveField]);

  return {
    isUpdating,
    updateError,
    hasUnsavedChanges,
    saveField,
    revertChanges
  };
}

/**
 * Hook for cross-field validation
 */
export function useCrossFieldValidation<T extends FieldValues>(
  form: UseFormReturn<T>,
  validationRules: Array<{
    fields: Array<FieldPath<T>>;
    validator: (values: Partial<T>) => string | null;
    message: string;
  }>
) {
  const [crossFieldErrors, setCrossFieldErrors] = useState<Record<string, string>>({});

  const validateCrossFields = useCallback(() => {
    const formValues = form.getValues();
    const errors: Record<string, string> = {};

    validationRules.forEach((rule, index) => {
      const error = rule.validator(formValues);
      if (error) {
        // Apply error to all fields in the rule
        rule.fields.forEach(field => {
          errors[field] = error;
        });
      }
    });

    setCrossFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form, validationRules]);

  // Watch all form values for cross-field validation
  const formValues = form.watch();

  useEffect(() => {
    validateCrossFields();
  }, [formValues, validateCrossFields]);

  return {
    crossFieldErrors,
    validateCrossFields,
    hasCrossFieldErrors: Object.keys(crossFieldErrors).length > 0
  };
}

/**
 * Validation state types for UI components
 */
export type ValidationStateType = 'idle' | 'validating' | 'success' | 'error' | 'warning';

export function getValidationStateType(
  hasError: boolean,
  hasWarning: boolean,
  isValidating: boolean,
  hasValue: boolean
): ValidationStateType {
  if (isValidating) return 'validating';
  if (hasError) return 'error';
  if (hasWarning) return 'warning';
  if (hasValue) return 'success';
  return 'idle';
}
