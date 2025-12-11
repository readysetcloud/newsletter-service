import React, { useRef, forwardRef, useCallback } from 'react';
import { Variable, ComponentType } from '../../types/variable';
import { TextArea } from '../ui/TextArea';
import { VariableInputButton } from './VariableInputButton';
import { cn } from '../../utils/cn';

export interface VariableTextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Component type for contextual variable filtering
   */
  contextType?: ComponentType;

  /**
   * Whether to show the variable picker button
   */
  showVariableButton?: boolean;

  /**
   * Callback when a variable is inserted
   */
  onVariableInsert?: (variable: Variable) => void;

  /**
   * Whether the variable button should be disabled
   */
  variableButtonDisabled?: boolean;

  /**
   * Pre-filtered variables to show in the picker
   */
  availableVariables?: Variable[];

  /**
   * Label for the textarea
   */
  label?: string;

  /**
   * Error message
   */
  error?: string;

  /**
   * Helper text
   */
  helperText?: string;
}

/**
 * Enhanced textarea component with integrated variable picker button
 *
 * This component provides a textarea with variable insertion capabilities,
 * positioned at the top-right corner of the textarea field.
 */
export const VariableTextArea = forwardRef<HTMLTextAreaElement, VariableTextAreaProps>(
  ({
    contextType,
    showVariableButton = true,
    onVariableInsert,
    variableButtonDisabled = false,
    availableVariables,
    label,
    error,
    helperText,
    className,
    disabled,
    id,
    ...props
  }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Create a fake input ref for the VariableInputButton to work with textareas
    React.useEffect(() => {
      if (textareaRef.current && !inputRef.current) {
        // Create a proxy object that mimics HTMLInputElement interface for VariableInputButton
        (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = textareaRef.current as any;
      }
    }, []);

    // Combine refs if both are provided
    const combinedRef = useCallback((node: HTMLTextAreaElement) => {
      (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref && 'current' in ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    }, [ref]);

    const handleVariableInsert = useCallback((variable: Variable) => {
      onVariableInsert?.(variable);
    }, [onVariableInsert]);

    const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = !!error;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-slate-700 mb-1">
            {label}
          </label>
        )}

        <div className="relative">
          <textarea
            ref={combinedRef}
            id={textareaId}
            disabled={disabled}
            className={cn(
              'block w-full rounded-md border-slate-300 shadow-sm',
              'focus:border-blue-500 focus:ring-blue-500',
              'disabled:bg-slate-50 disabled:text-slate-500',
              'placeholder:text-slate-400',
              'min-h-[100px] px-3 py-2.5 text-base sm:text-sm',
              'touch-manipulation resize-vertical',
              // Add right padding when variable button is shown
              showVariableButton && 'pr-10',
              hasError && 'border-red-300 focus:border-red-500 focus:ring-red-500',
              className
            )}
            {...props}
          />

          {showVariableButton && (
            <VariableInputButton
              inputRef={inputRef}
              onVariableInsert={handleVariableInsert}
              contextType={contextType}
              disabled={disabled || variableButtonDisabled}
              availableVariables={availableVariables}
              className="top-3 -translate-y-0" // Position at top for textarea
            />
          )}
        </div>

        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-slate-500">{helperText}</p>
        )}
      </div>
    );
  }
);

VariableTextArea.displayName = 'VariableTextArea';

export default VariableTextArea;
