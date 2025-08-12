import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../../utils/cn';
import { CheckCircleIcon, ExclamationCircleIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

export interface EnhancedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  warning?: string;
  success?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  validationState?: 'idle' | 'validating' | 'success' | 'error' | 'warning';
  showValidationIcon?: boolean;
  onValidationChange?: (isValid: boolean) => void;
  strengthIndicator?: boolean;
  strengthRequirements?: string[];
  debounceMs?: number;
  showPasswordToggle?: boolean;
}

export const EnhancedInput = React.forwardRef<HTMLInputElement, EnhancedInputProps>(
  ({
    label,
    error,
    warning,
    success,
    helperText,
    leftIcon,
    rightIcon,
    validationState = 'idle',
    showValidationIcon = true,
    onValidationChange,
    strengthIndicator = false,
    strengthRequirements = [],
    debounceMs = 300,
    showPasswordToggle = false,
    className,
    id,
    type = 'text',
    ...props
  }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);

    const inputId = id || `enhanced-input-${Math.random().toString(36).substr(2, 9)}`;
    const isPassword = type === 'password';
    const actualType = isPassword && showPassword ? 'text' : type;

    // Determine the current state
    const currentState = error ? 'error' : warning ? 'warning' : success ? 'success' : validationState;

    // Handle validation state changes
    useEffect(() => {
      if (onValidationChange) {
        onValidationChange(currentState === 'success');
      }
    }, [currentState, onValidationChange]);

    const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      props.onFocus?.(e);
    }, [props]);

    const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      setHasInteracted(true);
      props.onBlur?.(e);
    }, [props]);

    const getValidationIcon = () => {
      if (!showValidationIcon) return null;

      switch (currentState) {
        case 'validating':
          return (
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
          );
        case 'success':
          return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
        case 'error':
          return <ExclamationCircleIcon className="h-4 w-4 text-red-500" />;
        case 'warning':
          return <ExclamationCircleIcon className="h-4 w-4 text-amber-500" />;
        default:
          return null;
      }
    };

    const getPasswordToggleIcon = () => {
      if (!showPasswordToggle || !isPassword) return null;

      return (
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="text-slate-400 hover:text-slate-600 transition-colors p-1"
          tabIndex={-1}
        >
          {showPassword ? (
            <EyeSlashIcon className="h-4 w-4" />
          ) : (
            <EyeIcon className="h-4 w-4" />
          )}
        </button>
      );
    };

    const getBorderColor = () => {
      switch (currentState) {
        case 'error':
          return 'border-red-300 focus:border-red-500 focus:ring-red-500';
        case 'warning':
          return 'border-amber-300 focus:border-amber-500 focus:ring-amber-500';
        case 'success':
          return 'border-green-300 focus:border-green-500 focus:ring-green-500';
        case 'validating':
          return 'border-blue-300 focus:border-blue-500 focus:ring-blue-500';
        default:
          return 'border-slate-300 focus:border-blue-500 focus:ring-blue-500';
      }
    };

    const getHelperMessage = () => {
      if (error) return { text: error, type: 'error' };
      if (warning) return { text: warning, type: 'warning' };
      if (success) return { text: success, type: 'success' };
      if (helperText) return { text: helperText, type: 'helper' };
      return null;
    };

    const getHelperMessageColor = (type: string) => {
      switch (type) {
        case 'error':
          return 'text-red-600';
        case 'warning':
          return 'text-amber-600';
        case 'success':
          return 'text-green-600';
        default:
          return 'text-slate-500';
      }
    };

    const helperMessage = getHelperMessage();

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1">
            {label}
          </label>
        )}

        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <div className="h-5 w-5 text-slate-400">{leftIcon}</div>
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            type={actualType}
            className={cn(
              'block w-full rounded-md shadow-sm transition-all duration-200',
              'disabled:bg-slate-50 disabled:text-slate-500',
              'placeholder:text-slate-400',
              'min-h-[44px] px-3 py-2.5 text-base sm:text-sm',
              'touch-manipulation',
              leftIcon && 'pl-10',
              (rightIcon || showValidationIcon || showPasswordToggle) && 'pr-10',
              getBorderColor(),
              isFocused && 'ring-2 ring-offset-0',
              className
            )}
            onFocus={handleFocus}
            onBlur={handleBlur}
            {...props}
          />

          {(rightIcon || getValidationIcon() || getPasswordToggleIcon()) && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center space-x-1">
              {rightIcon && <div className="h-5 w-5 text-slate-400">{rightIcon}</div>}
              {getValidationIcon()}
              {getPasswordToggleIcon()}
            </div>
          )}
        </div>

        {helperMessage && (
          <p className={cn('mt-1 text-sm transition-colors duration-200', getHelperMessageColor(helperMessage.type))}>
            {helperMessage.text}
          </p>
        )}

        {/* Strength Indicator for passwords */}
        {strengthIndicator && isPassword && props.value && (
          <div className="mt-2">
            <PasswordStrengthIndicator
              password={props.value as string}
              requirements={strengthRequirements}
            />
          </div>
        )}
      </div>
    );
  }
);

EnhancedInput.displayName = 'EnhancedInput';

// Password Strength Indicator Component
interface PasswordStrengthIndicatorProps {
  password: string;
  requirements: string[];
}

const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({
  password,
  requirements
}) => {
  const getStrength = () => {
    let score = 0;
    const checks = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
      special: /[@$!%*?&]/.test(password)
    };

    Object.values(checks).forEach(check => {
      if (check) score++;
    });

    if (score < 2) return { level: 'weak', color: 'bg-red-500', text: 'Weak' };
    if (score < 4) return { level: 'medium', color: 'bg-amber-500', text: 'Medium' };
    return { level: 'strong', color: 'bg-green-500', text: 'Strong' };
  };

  const strength = getStrength();
  const progress = Math.min((password.length / 8) * 100, 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600">Password strength</span>
        <span className={cn('text-xs font-medium', {
          'text-red-600': strength.level === 'weak',
          'text-amber-600': strength.level === 'medium',
          'text-green-600': strength.level === 'strong'
        })}>
          {strength.text}
        </span>
      </div>

      <div className="w-full bg-slate-200 rounded-full h-1.5">
        <div
          className={cn('h-1.5 rounded-full transition-all duration-300', strength.color)}
          style={{ width: `${progress}%` }}
        />
      </div>

      {requirements.length > 0 && (
        <div className="text-xs text-slate-600 space-y-1">
          <div className="font-medium">Requirements:</div>
          <ul className="space-y-0.5">
            {requirements.map((req, index) => (
              <li key={index} className="flex items-center space-x-1">
                <div className={cn('w-1.5 h-1.5 rounded-full',
                  (password.length >= 8 && req.includes('8 characters')) ||
                  (/[A-Z]/.test(password) && req.includes('uppercase')) ||
                  (/[a-z]/.test(password) && req.includes('lowercase')) ||
                  (/\d/.test(password) && req.includes('number')) ||
                  (/[@$!%*?&]/.test(password) && req.includes('special'))
                    ? 'bg-green-500' : 'bg-slate-300'
                )} />
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
