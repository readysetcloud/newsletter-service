import React, { useState, useEffect } from 'react';
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

interface TemplateNameInputProps {
  value: string;
  onChange: (value: string) => void;
  onValidationChange?: (isValid: boolean, error?: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  showSuggestions?: boolean;
  suggestions?: string[];
  onSuggestionSelect?: (suggestion: string) => void;
}

export const TemplateNameInput: React.FC<TemplateNameInputProps> = ({
  value,
  onChange,
  onValidationChange,
  placeholder = "Enter template name...",
  required = true,
  disabled = false,
  className,
  showSuggestions = false,
  suggestions = [],
  onSuggestionSelect
}) => {
  const [error, setError] = useState<string>('');
  const [isValid, setIsValid] = useState<boolean>(true);
  const [showSuggestionsList, setShowSuggestionsList] = useState(false);

  // Validate template name format
  const validateName = (name: string): { isValid: boolean; error?: string } => {
    if (required && (!name || name.trim().length === 0)) {
      return { isValid: false, error: 'Template name is required' };
    }

    const trimmedName = name.trim();

    if (trimmedName.length > 100) {
      return { isValid: false, error: 'Template name must be 100 characters or less' };
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidChars.test(trimmedName)) {
      return { isValid: false, error: 'Template name contains invalid characters' };
    }

    return { isValid: true };
  };

  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    // Validate the new value
    const validation = validateName(newValue);
    setIsValid(validation.isValid);
    setError(validation.error || '');

    // Notify parent of validation state
    if (onValidationChange) {
      onValidationChange(validation.isValid, validation.error);
    }
  };

  // Handle suggestion selection
  const handleSuggestionSelect = (suggestion: string) => {
    onChange(suggestion);
    setShowSuggestionsList(false);

    if (onSuggestionSelect) {
      onSuggestionSelect(suggestion);
    }

    // Validate the suggestion
    const validation = validateName(suggestion);
    setIsValid(validation.isValid);
    setError(validation.error || '');

    if (onValidationChange) {
      onValidationChange(validation.isValid, validation.error);
    }
  };

  // Show suggestions when there are conflicts
  useEffect(() => {
    setShowSuggestionsList(showSuggestions && suggestions.length > 0);
  }, [showSuggestions, suggestions]);

  // Initial validation
  useEffect(() => {
    const validation = validateName(value);
    setIsValid(validation.isValid);
    setError(validation.error || '');

    if (onValidationChange) {
      onValidationChange(validation.isValid, validation.error);
    }
  }, [value, required, onValidationChange]);

  return (
    <div className={cn('space-y-2', className)}>
      {/* Input Field */}
      <div className="relative">
        <Input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'pr-10',
            !isValid && 'border-red-500 focus:border-red-500 focus:ring-red-500',
            isValid && value && 'border-green-500 focus:border-green-500 focus:ring-green-500'
          )}
          maxLength={100}
        />

        {/* Validation Icon */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
          {!isValid && error && (
            <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
          )}
          {isValid && value && (
            <CheckCircleIcon className="w-5 h-5 text-green-500" />
          )}
        </div>
      </div>

      {/* Error Message */}
      {!isValid && error && (
        <p className="text-sm text-red-600 flex items-center">
          <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
          {error}
        </p>
      )}

      {/* Character Count */}
      <div className="flex justify-between items-center text-xs text-gray-500">
        <span>{value.length}/100 characters</span>
        {required && (
          <span className="text-red-500">* Required</span>
        )}
      </div>

      {/* Name Suggestions */}
      {showSuggestionsList && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
          <div className="flex items-start">
            <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 mt-0.5 mr-2 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-medium text-yellow-800 mb-2">
                Name Already Exists
              </h4>
              <p className="text-sm text-yellow-700 mb-3">
                A template with this name already exists. Try one of these alternatives:
              </p>
              <div className="space-y-1">
                {suggestions.map((suggestion, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => handleSuggestionSelect(suggestion)}
                    className="mr-2 mb-1 text-xs bg-white hover:bg-yellow-50 border-yellow-300"
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
