import React, { useId } from 'react';
import { cn } from '../../utils/cn';

/*
 * Styled by the shared .input/.field-* classes from @readysetcloud/ui.
 * Stays local for the optional label and the leftIcon/rightIcon slots the
 * package Input doesn't offer.
 */
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
          <label htmlFor={inputId} className="field-label block mb-1.5">
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
              'input',
              hasError && 'input-error',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
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
          <p className="field-error mt-1 block" id={errorId} role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="field-hint mt-1 block" id={descriptionId}>
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
