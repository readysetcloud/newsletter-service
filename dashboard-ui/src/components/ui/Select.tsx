import React, { useId } from 'react';
import { cn } from '../../utils/cn';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

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
          <label htmlFor={selectId} className="block text-sm font-medium text-muted-foreground mb-1">
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
              'block w-full rounded-md border-border shadow-sm',
              'focus:border-primary-500 focus:ring-ring',
              'disabled:bg-background disabled:text-muted-foreground',
              'pr-10 appearance-none min-h-[44px] px-3 py-2.5 text-base sm:text-sm',
              'touch-manipulation', // Improves touch responsiveness
              hasError && 'border-error-300 focus:border-error-500 focus:ring-error-500',
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

Select.displayName = 'Select';
