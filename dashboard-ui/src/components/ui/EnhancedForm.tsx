/* eslint-disable react-refresh/only-export-components */
import React, { useState, useCallback, useRef } from 'react';
import { cn } from '../../utils/cn';
import { Button } from './Button';
import { useToast } from './Toast';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export interface FormSubmissionState {
  isSubmitting: boolean;
  isSuccess: boolean;
  error: string | null;
  progress?: number;
}

export interface EnhancedFormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  submitButtonText?: string;
  submitButtonLoadingText?: string;
  showProgress?: boolean;
  optimisticUpdate?: boolean;
  confirmBeforeSubmit?: boolean;
  confirmMessage?: string;
  resetOnSuccess?: boolean;
  showSuccessMessage?: boolean;
  successMessage?: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export const EnhancedForm: React.FC<EnhancedFormProps> = ({
  onSubmit,
  onSuccess,
  onError,
  submitButtonText = 'Submit',
  submitButtonLoadingText = 'Submitting...',
  showProgress = false,
  optimisticUpdate = false,
  confirmBeforeSubmit = false,
  confirmMessage = 'Are you sure you want to submit this form?',
  resetOnSuccess = false,
  showSuccessMessage = true,
  successMessage = 'Form submitted successfully!',
  children,
  className,
  disabled = false,
  ...props
}) => {
  const [submissionState, setSubmissionState] = useState<FormSubmissionState>({
    isSubmitting: false,
    isSuccess: false,
    error: null
  });

  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { addToast } = useToast();

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (disabled || submissionState.isSubmitting) return;

    // Confirmation dialog
    if (confirmBeforeSubmit && !window.confirm(confirmMessage)) {
      return;
    }

    try {
      // Start submission
      setSubmissionState({
        isSubmitting: true,
        isSuccess: false,
        error: null,
        progress: showProgress ? 0 : undefined
      });

      // Simulate progress for better UX
      if (showProgress) {
        const progressInterval = setInterval(() => {
          setSubmissionState(prev => ({
            ...prev,
            progress: Math.min((prev.progress || 0) + Math.random() * 20, 90)
          }));
        }, 200);

        try {
          await onSubmit(event);
          clearInterval(progressInterval);
        } catch (error) {
          clearInterval(progressInterval);
          throw error;
        }
      } else {
        await onSubmit(event);
      }

      // Success state
      setSubmissionState({
        isSubmitting: false,
        isSuccess: true,
        error: null,
        progress: showProgress ? 100 : undefined
      });

      // Show success animation
      setShowSuccessAnimation(true);
      setTimeout(() => setShowSuccessAnimation(false), 2000);

      // Success toast
      if (showSuccessMessage) {
        addToast({
          type: 'success',
          title: 'Success',
          message: successMessage,
          duration: 3000
        });
      }

      // Reset form if requested
      if (resetOnSuccess && formRef.current) {
        formRef.current.reset();
      }

      // Call success callback
      onSuccess?.();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';

      setSubmissionState({
        isSubmitting: false,
        isSuccess: false,
        error: errorMessage
      });

      // Error toast
      addToast({
        type: 'error',
        title: 'Submission Failed',
        message: errorMessage,
        duration: 5000
      });

      // Call error callback
      onError?.(error);
    }
  }, [
    disabled,
    submissionState.isSubmitting,
    confirmBeforeSubmit,
    confirmMessage,
    showProgress,
    onSubmit,
    showSuccessMessage,
    successMessage,
    resetOnSuccess,
    onSuccess,
    onError,
    addToast
  ]);

  const resetForm = useCallback(() => {
    setSubmissionState({
      isSubmitting: false,
      isSuccess: false,
      error: null
    });
    setShowSuccessAnimation(false);
  }, []);

  return (
    <div className="relative">
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className={cn('space-y-6', className)}
        {...props}
      >
        {/* Form Content */}
        <div className={cn(
          'transition-opacity duration-200',
          submissionState.isSubmitting && optimisticUpdate && 'opacity-50'
        )}>
          {children}
        </div>

        {/* Progress Bar */}
        {showProgress && submissionState.progress !== undefined && (
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${submissionState.progress}%` }}
            />
          </div>
        )}

        {/* Error Message */}
        {submissionState.error && (
          <div className="bg-error-50 border border-error-200 rounded-md p-4">
            <div className="flex">
              <ExclamationTriangleIcon className="h-5 w-5 text-error-400 mr-3 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-medium text-error-800">Submission Error</h3>
                <p className="text-sm text-error-700 mt-1">{submissionState.error}</p>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-sm text-error-600 hover:text-error-500 mt-2 underline"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {submissionState.isSuccess && (
          <div className={cn(
            'bg-success-50 border border-success-200 rounded-md p-4 transition-all duration-300',
            showSuccessAnimation && 'scale-105'
          )}>
            <div className="flex">
              <CheckCircleIcon className="h-5 w-5 text-success-400 mr-3 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-medium text-success-800">Success!</h3>
                <p className="text-sm text-success-700 mt-1">{successMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button
            type="submit"
            isLoading={submissionState.isSubmitting}
            disabled={disabled || submissionState.isSubmitting}
            className={cn(
              'transition-all duration-200',
              submissionState.isSuccess && 'bg-success-600 hover:bg-success-700'
            )}
          >
            {submissionState.isSubmitting
              ? submitButtonLoadingText
              : submissionState.isSuccess
              ? 'Submitted!'
              : submitButtonText
            }
          </Button>
        </div>
      </form>

      {/* Loading Overlay for Optimistic Updates */}
      {optimisticUpdate && submissionState.isSubmitting && (
        <div className="absolute inset-0 bg-surface bg-opacity-50 flex items-center justify-center rounded-md">
          <div className="bg-surface rounded-lg shadow-lg p-4 flex items-center space-x-3">
            <div className="animate-spin h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full" />
            <span className="text-sm text-muted-foreground">Processing...</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Hook for managing form submission state
export function useFormSubmission() {
  const [state, setState] = useState<FormSubmissionState>({
    isSubmitting: false,
    isSuccess: false,
    error: null
  });

  const startSubmission = useCallback(() => {
    setState({
      isSubmitting: true,
      isSuccess: false,
      error: null
    });
  }, []);

  const setSuccess = useCallback(() => {
    setState({
      isSubmitting: false,
      isSuccess: true,
      error: null
    });
  }, []);

  const setError = useCallback((error: string) => {
    setState({
      isSubmitting: false,
      isSuccess: false,
      error
    });
  }, []);

  const reset = useCallback(() => {
    setState({
      isSubmitting: false,
      isSuccess: false,
      error: null
    });
  }, []);

  return {
    state,
    startSubmission,
    setSuccess,
    setError,
    reset
  };
}

// Form validation context
export interface FormValidationContextType {
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isValid: boolean;
  setFieldError: (field: string, error: string | null) => void;
  setFieldTouched: (field: string, touched: boolean) => void;
  clearErrors: () => void;
}

const FormValidationContext = React.createContext<FormValidationContextType | null>(null);

export const useFormValidation = () => {
  const context = React.useContext(FormValidationContext);
  if (!context) {
    throw new Error('useFormValidation must be used within a FormValidationProvider');
  }
  return context;
};

export interface FormValidationProviderProps {
  children: React.ReactNode;
}

export const FormValidationProvider: React.FC<FormValidationProviderProps> = ({ children }) => {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const setFieldError = useCallback((field: string, error: string | null) => {
    setErrors(prev => {
      if (error === null) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return { ...prev, [field]: error };
    });
  }, []);

  const setFieldTouched = useCallback((field: string, touchedValue: boolean) => {
    setTouched(prev => ({ ...prev, [field]: touchedValue }));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors({});
    setTouched({});
  }, []);

  const isValid = Object.keys(errors).length === 0;

  const value: FormValidationContextType = {
    errors,
    touched,
    isValid,
    setFieldError,
    setFieldTouched,
    clearErrors
  };

  return (
    <FormValidationContext.Provider value={value}>
      {children}
    </FormValidationContext.Provider>
  );
};
