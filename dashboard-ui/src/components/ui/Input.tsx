import React, { useId } from 'react';
import { cn } from '../../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, rightIcon, className, id, ...props }, ref) => {
    const hasError = !!error;
    const generatedId = useId();
    const inputId = id || `input-${generatedId}`;
    const errorId = `${inputId}-error`;
    const descriptionId = `${inputId}-description`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-muted-foreground mb-1">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <div className="h-5 w-5 text-muted-foreground">{leftIcon}</div>
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-describedby={error ? errorId : helperText ? descriptionId : undefined}
            aria-invalid={hasError}
            className={cn(
              'block w-full rounded-md border-border shadow-sm',
              'focus:border-primary-500 focus:ring-ring',
              'disabled:bg-background disabled:text-muted-foreground',
              'placeholder:text-muted-foreground',
              'min-h-[44px] px-3 py-2.5 text-base sm:text-sm', // Better mobile touch targets
              'touch-manipulation', // Improves touch responsiveness
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              hasError && 'border-error-300 focus:border-error-500 focus:ring-error-500',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <div className="h-5 w-5 text-muted-foreground">{rightIcon}</div>
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1 text-sm text-error-600" id={errorId} role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-muted-foreground" id={descriptionId}>
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
