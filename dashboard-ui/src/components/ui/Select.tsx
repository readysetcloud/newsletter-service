import React, { useId } from 'react';
import { cn } from '../../utils/cn';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

/*
 * Styled by the shared .input/.field-* classes from @readysetcloud/ui.
 * Stays local for the optional label and the options-array API the package
 * Select (children-based) doesn't offer.
 */
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, options, placeholder, className, id, ...props }, ref) => {
    const hasError = !!error;
    const generatedId = useId();
    const selectId = id || `select-${generatedId}`;
    const errorId = `${selectId}-error`;
    const descriptionId = `${selectId}-description`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="field-label block mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            aria-describedby={error ? errorId : helperText ? descriptionId : undefined}
            aria-invalid={hasError}
            className={cn(
              'input',
              'pr-10 appearance-none',
              hasError && 'input-error',
              className
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <ChevronDownIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
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

Select.displayName = 'Select';
