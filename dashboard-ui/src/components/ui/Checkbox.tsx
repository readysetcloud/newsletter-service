import React from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface CheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked = false,
  indeterminate = false,
  onChange,
  disabled = false,
  id,
  name,
  className,
  size = 'md',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled && onChange) {
      onChange(event.target.checked);
    }
  };

  const sizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5'
  };

  const iconSizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-3 w-3',
    lg: 'h-4 w-4'
  };

  return (
    <div className="relative inline-flex items-center">
      <input
        type="checkbox"
        id={id}
        name={name}
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        className="sr-only"
      />
      <div
        className={cn(
          'relative flex items-center justify-center border-2 rounded transition-all duration-200 cursor-pointer',
          sizeClasses[size],
          {
            // Unchecked states
            'border-gray-300 bg-white hover:border-gray-400': !checked && !indeterminate && !disabled,
            'border-gray-200 bg-gray-50': !checked && !indeterminate && disabled,

            // Checked states
            'border-blue-600 bg-blue-600 hover:border-blue-700 hover:bg-blue-700': (checked || indeterminate) && !disabled,
            'border-blue-300 bg-blue-300': (checked || indeterminate) && disabled,

            // Focus states
            'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2': !disabled,

            // Disabled cursor
            'cursor-not-allowed': disabled,
          },
          className
        )}
        onClick={() => {
          if (!disabled && onChange) {
            onChange(!checked);
          }
        }}
      >
        {checked && !indeterminate && (
          <Check
            className={cn(
              'text-white',
              iconSizeClasses[size]
            )}
          />
        )}
        {indeterminate && (
          <Minus
            className={cn(
              'text-white',
              iconSizeClasses[size]
            )}
          />
        )}
      </div>
    </div>
  );
};

export default Checkbox;
