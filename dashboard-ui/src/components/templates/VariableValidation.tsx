import React, { useMemo } from'react';
import { ValidationResult, ValidationError, ValidationWarning } from '../../types/variable';
import { VariableValidator } from '../../utils/variableValidator';
import { cn } from '../../utils/cn';

interface VariableValidationProps {
  content: string;
  showWarnings?: boolean;
  className?: string;
  inline?: boolean;
}

interface ValidationDisplayProps {
  validation: ValidationResult;
  showWarnings?: boolean;
  className?: string;
  inline?: boolean;
}

const ValidationIcon: React.FC<{ type: 'error' | 'warning' | 'success' }> = ({ type }) => {
  switch (type) {
    case 'error':
      return (
        <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      );
    case 'warning':
      return (
        <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      );
    case 'success':
      return (
        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      );
  }
};

const ValidationMessage: React.FC<{
  message: ValidationError | ValidationWarning;
  type: 'error' | 'warning';
}> = ({ message, type }) => {
  return (
    <div className={cn(
      'flex items-start space-x-2 p-2 rounded text-sm',
      type === 'error'
        ? 'bg-red-50 border border-red-200 text-red-700'
        : 'bg-yellow-50 border border-yellow-200 text-yellow-700'
    )}>
      <ValidationIcon type={type} />
      <div className="flex-1">
        <div className="font-medium">
          {message.message}
        </div>
        {message.field && (
          <div className="text-xs opacity-75 mt-1">
            Field: {message.field}
          </div>
        )}
        {message.code && (
          <div className="text-xs opacity-75 mt-1">
            Code: {message.code}
          </div>
        )}
      </div>
    </div>
  );
};

const ValidationDisplay: React.FC<ValidationDisplayProps> = ({
  validation,
  showWarnings = true,
  className,
  inline = false
}) => {
  const hasErrors = validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;
  const isValid = validation.isValid;

  if (inline) {
    return (
      <div className={cn('flex items-center space-x-2', className)}>
        {hasErrors && (
          <div className="flex items-center space-x-1">
            <ValidationIcon type="error" />
            <span className="text-sm text-red-600">
              {validation.errors.length} error{validation.errors.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
        {!hasErrors && hasWarnings && showWarnings && (
          <div className="flex items-center space-x-1">
            <ValidationIcon type="warning" />
            <span className="text-sm text-yellow-600">
              {validation.warnings.length} warning{validation.warnings.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
        {!hasErrors && !hasWarnings && (
          <div className="flex items-center space-x-1">
            <ValidationIcon type="success" />
            <span className="text-sm text-green-600">Valid</span>
          </div>
        )}
      </div>
    );
  }

  if (isValid && (!hasWarnings || !showWarnings)) {
    return (
      <div className={cn(
        'flex items-center space-x-2 p-3 bg-green-50 border border-green-200 rounded-lg',
        className
      )}>
        <ValidationIcon type="success" />
        <span className="text-sm text-green-700 font-medium">
          Syntax is valid
        </span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Errors */}
      {hasErrors && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <ValidationIcon type="error" />
            <span className="text-sm font-medium text-red-700">
              {validation.errors.length} Error{validation.errors.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1">
            {validation.errors.map((error, index) => (
              <ValidationMessage
                key={`error-${index}`}
                message={error}
                type="error"
              />
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && showWarnings && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <ValidationIcon type="warning" />
            <span className="text-sm font-medium text-yellow-700">
              {validation.warnings.length} Warning{validation.warnings.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1">
            {validation.warnings.map((warning, index) => (
              <ValidationMessage
                key={`warning-${index}`}
                message={warning}
                type="warning"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const VariableValidation: React.FC<VariableValidationProps> = ({
  content,
  showWarnings = true,
  className,
  inline = false
}) => {
  const validator = useMemo(() => new VariableValidator(), []);

  const validation = useMemo(() => {
    if (!content || content.trim().length === 0) {
      return {
        isValid: true,
        errors: [],
        warnings: []
      };
    }

    return validator.validateHandlebarsSyntax(content);
  }, [content, validator]);

  return (
    <ValidationDisplay
      validation={validation}
      showWarnings={showWarnings}
      className={className}
      inline={inline}
    />
  );
};

// Hook for real-time validation
export const useVariableValidation = (content: string) => {
  const validator = useMemo(() => new VariableValidator(), []);

  return useMemo(() => {
    if (!content || content.trim().length === 0) {
      return {
        isValid: true,
        errors: [],
        warnings: []
      };
    }

    return validator.validateHandlebarsSyntax(content);
  }, [content, validator]);
};

// Component for highlighting syntax errors in text
interface VariableSyntaxHighlighterProps {
  content: string;
  className?: string;
}

export const VariableSyntaxHighlighter: React.FC<VariableSyntaxHighlighterProps> = ({
  content,
  className
}) => {
  const validation = useVariableValidation(content);

  const highlightedContent = useMemo(() => {
    if (!content) return '';

    let highlighted = content;

    // Highlight valid variables in green
    highlighted = highlighted.replace(
      /\{\{(?!#|\/)[^}]+\}\}/g,
      '<span class="bg-green-100 text-green-800 px-1 rounded">$&</span>'
    );

    // Highlight block helpers in blue
    highlighted = highlighted.replace(
      /\{\{#[^}]+\}\}/g,
      '<span class="bg-blue-100 text-blue-800 px-1 rounded">$&</span>'
    );

    // Highlight closing tags in blue
    highlighted = highlighted.replace(
      /\{\{\/[^}]+\}\}/g,
      '<span class="bg-blue-100 text-blue-800 px-1 rounded">$&</span>'
    );

    // If there are errors, highlight problematic areas in red
    if (!validation.isValid) {
      // Highlight unmatched braces
      highlighted = highlighted.replace(
        /\{\{(?![^}]*\}\})/g,
        '<span class="bg-red-100 text-red-800 px-1 rounded border border-red-300">$&</span>'
      );

      highlighted = highlighted.replace(
        /(?<!\{\{[^}]*)\}\}/g,
        '<span class="bg-red-100 text-red-800 px-1 rounded border border-red-300">$&</span>'
      );
    }

    return highlighted;
  }, [content, validation]);

  return (
    <div className={cn('font-mono text-sm', className)}>
      <div
        dangerouslySetInnerHTML={{ __html: highlightedContent }}
      />
    </div>
  );
};

export default VariableValidation;
