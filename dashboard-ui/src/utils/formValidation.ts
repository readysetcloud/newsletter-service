/**
 * Enhanced form validation utilities with real-time feedback
 */

import { z } from 'zod';
import { FieldError, FieldErrors } from 'react-hook-form';

export interface ValidationState {
  isValid: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
  touched: Record<string, boolean>;
}

export interface FieldValidationResult {
  isValid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Real-time field validation with debouncing
 */
export class FieldValidator {
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private validationCache: Map<string, FieldValidationResult> = new Map();

  validateField<T>(
    fieldName: string,
    value: any,
    schema: z.ZodSchema<T>,
    debounceMs: number = 300
  ): Promise<FieldValidationResult> {
    return new Promise((resolve) => {
      // Clear existing timer
      const existingTimer = this.debounceTimers.get(fieldName);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Check cache for immediate feedback on repeated values
      const cacheKey = `${fieldName}:${JSON.stringify(value)}`;
      const cached = this.validationCache.get(cacheKey);
      if (cached) {
        resolve(cached);
        return;
      }

      // Set new debounced validation
      const timer = setTimeout(() => {
        try {
          schema.parse(value);
          const result: FieldValidationResult = { isValid: true };
          this.validationCache.set(cacheKey, result);
          resolve(result);
        } catch (error) {
          if (error instanceof z.ZodError) {
            const result: FieldValidationResult = {
              isValid: false,
              error: error.errors[0]?.message || 'Invalid value'
            };
            this.validationCache.set(cacheKey, result);
            resolve(result);
          } else {
            const result: FieldValidationResult = {
              isValid: false,
              error: 'Validation error'
            };
            resolve(result);
          }
        }
        this.debounceTimers.delete(fieldName);
      }, debounceMs);

      this.debounceTimers.set(fieldName, timer);
    });
  }

  clearCache(): void {
    this.validationCache.clear();
  }

  clearField(fieldName: string): void {
    // Clear timers for the field
    const timer = this.debounceTimers.get(fieldName);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(fieldName);
    }

    // Clear cache entries for the field
    for (const key of this.validationCache.keys()) {
      if (key.startsWith(`${fieldName}:`)) {
        this.validationCache.delete(key);
      }
    }
  }
}

/**
 * Convert React Hook Form errors to user-friendly messages
 */
export function formatFieldErrors(errors: FieldErrors): Record<string, string> {
  const formatted: Record<string, string> = {};

  Object.entries(errors).forEach(([field, error]) => {
    if (error && typeof error === 'object' && 'message' in error) {
      formatted[field] = error.message as string;
    } else if (typeof error === 'string') {
      formatted[field] = error;
    }
  });

  return formatted;
}

/**
 * Get validation state for a form field
 */
export function getFieldValidationState(
  fieldName: string,
  errors: FieldErrors,
  touched: Record<string, boolean>
): 'idle' | 'error' | 'success' | 'validating' {
  if (!touched[fieldName]) return 'idle';
  if (errors[fieldName]) return 'error';
  return 'success';
}

/**
 * Enhanced validation schemas with better error messages
 */
export const enhancedValidationMessages = {
  required: (field: string) => `${field} is required`,
  minLength: (field: string, min: number) => `${field} must be at least ${min} characters`,
  maxLength: (field: string, max: number) => `${field} must be no more than ${max} characters`,
  email: 'Please enter a valid email address',
  url: 'Please enter a valid URL (including http:// or https://)',
  phone: 'Please enter a valid phone number',
  date: 'Please enter a valid date',
  futureDate: 'Date must be in the future',
  pastDate: 'Date must be in the past',
  alphanumeric: 'Only letters, numbers, spaces, hyphens, and underscores are allowed',
  strongPassword: 'Password must contain at least 8 characters with uppercase, lowercase, number, and special character'
};

/**
 * Common validation patterns
 */
export const validationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?[\d\s\-\(\)]+$/,
  url: /^https?:\/\/.+/,
  alphanumeric: /^[a-zA-Z0-9\s\-_]+$/,
  strongPassword: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
};

/**
 * Create enhanced Zod schemas with better error messages
 */
export function createEnhancedStringSchema(
  fieldName: string,
  options: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    patternMessage?: string;
    transform?: (value: string) => string;
  } = {}
) {
  let schema: any = z.string();

  if (options.required) {
    schema = schema.min(1, enhancedValidationMessages.required(fieldName));
  } else {
    schema = schema.optional();
  }

  if (options.minLength) {
    schema = schema.min(options.minLength, enhancedValidationMessages.minLength(fieldName, options.minLength));
  }

  if (options.maxLength) {
    schema = schema.max(options.maxLength, enhancedValidationMessages.maxLength(fieldName, options.maxLength));
  }

  if (options.pattern) {
    schema = schema.regex(options.pattern, options.patternMessage || 'Invalid format');
  }

  if (options.transform) {
    schema = schema.transform(options.transform);
  }

  return schema;
}

/**
 * Validation strength indicator
 */
export function getValidationStrength(value: string, requirements: string[]): {
  strength: 'weak' | 'medium' | 'strong';
  score: number;
  metRequirements: string[];
  unmetRequirements: string[];
} {
  const metRequirements: string[] = [];
  const unmetRequirements: string[] = [];

  requirements.forEach(requirement => {
    switch (requirement) {
      case 'minLength':
        if (value.length >= 8) {
          metRequirements.push('At least 8 characters');
        } else {
          unmetRequirements.push('At least 8 characters');
        }
        break;
      case 'uppercase':
        if (/[A-Z]/.test(value)) {
          metRequirements.push('Uppercase letter');
        } else {
          unmetRequirements.push('Uppercase letter');
        }
        break;
      case 'lowercase':
        if (/[a-z]/.test(value)) {
          metRequirements.push('Lowercase letter');
        } else {
          unmetRequirements.push('Lowercase letter');
        }
        break;
      case 'number':
        if (/\d/.test(value)) {
          metRequirements.push('Number');
        } else {
          unmetRequirements.push('Number');
        }
        break;
      case 'special':
        if (/[@$!%*?&]/.test(value)) {
          metRequirements.push('Special character');
        } else {
          unmetRequirements.push('Special character');
        }
        break;
    }
  });

  const score = metRequirements.length / requirements.length;
  let strength: 'weak' | 'medium' | 'strong' = 'weak';

  if (score >= 0.8) strength = 'strong';
  else if (score >= 0.5) strength = 'medium';

  return {
    strength,
    score,
    metRequirements,
    unmetRequirements
  };
}

/**
 * Form submission state management
 */
export interface FormSubmissionState {
  isSubmitting: boolean;
  isSuccess: boolean;
  error: string | null;
  progress?: number;
}

export function createFormSubmissionManager() {
  let state: FormSubmissionState = {
    isSubmitting: false,
    isSuccess: false,
    error: null
  };

  const listeners: Array<(state: FormSubmissionState) => void> = [];

  const setState = (newState: Partial<FormSubmissionState>) => {
    state = { ...state, ...newState };
    listeners.forEach(listener => listener(state));
  };

  return {
    getState: () => state,
    subscribe: (listener: (state: FormSubmissionState) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index > -1) listeners.splice(index, 1);
      };
    },
    startSubmission: () => setState({ isSubmitting: true, isSuccess: false, error: null }),
    setProgress: (progress: number) => setState({ progress }),
    setSuccess: () => setState({ isSubmitting: false, isSuccess: true, error: null, progress: 100 }),
    setError: (error: string) => setState({ isSubmitting: false, isSuccess: false, error, progress: undefined }),
    reset: () => setState({ isSubmitting: false, isSuccess: false, error: null, progress: undefined })
  };
}
