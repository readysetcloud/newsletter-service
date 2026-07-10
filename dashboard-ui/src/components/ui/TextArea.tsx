import React, { useId } from 'react';
import { cn } from '../../utils/cn';

/*
 * Styled by the shared .input/.field-* classes from @readysetcloud/ui.
 * Stays local for the optional label the package TextArea requires.
 */
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
          <label htmlFor={textareaId} className="field-label block mb-1.5">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          aria-describedby={error ? errorId : helperText ? descriptionId : undefined}
          aria-invalid={hasError}
          className={cn(
            'input',
            'resize-vertical min-h-[100px]',
            hasError && 'input-error',
            className
          )}
          {...props}
        />
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

TextArea.displayName = 'TextArea';
