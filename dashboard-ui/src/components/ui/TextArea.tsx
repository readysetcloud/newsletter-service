import React, { useId } from 'react';
import { cn } from '../../utils/cn';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const hasError = !!error;
    const generatedId = useId();
    const textareaId = id || `textarea-${generatedId}`;
    const errorId = `${textareaId}-error`;
    const descriptionId = `${textareaId}-description`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-muted-foreground mb-1">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          aria-describedby={error ? errorId : helperText ? descriptionId : undefined}
          aria-invalid={hasError}
          className={cn(
            'block w-full rounded-md border-border shadow-sm',
            'focus:border-primary-500 focus:ring-ring',
            'disabled:bg-background disabled:text-muted-foreground',
            'placeholder:text-muted-foreground',
            'resize-vertical min-h-[100px] px-3 py-2.5 text-base sm:text-sm',
            'touch-manipulation', // Improves touch responsiveness
            hasError && 'border-error-300 focus:border-error-500 focus:ring-error-500',
            className
          )}
          {...props}
        />
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

TextArea.displayName = 'TextArea';
