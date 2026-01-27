import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { EnhancedInput } from '../ui/EnhancedInput';
import { generateBrandId, isValidBrandId } from '../../utils/brandUtils';
import { checkBrandIdAvailability } from '../../services/brandService';
import { useDebounce } from '../../hooks/useDebounce';

interface BrandIdInputProps {
  value: string;
  onChange: (value: string) => void;
  brandName: string;
  error?: string;
  disabled?: boolean;
  isOnboarding?: boolean;
}

export const BrandIdInput: React.FC<BrandIdInputProps> = ({
  value,
  onChange,
  brandName,
  error,
  disabled = false,
  isOnboarding = false
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [availabilityStatus, setAvailabilityStatus] = useState<'idle' | 'available' | 'taken' | 'invalid'>('idle');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hasUserModified, setHasUserModified] = useState(false);
  const [shouldCheck, setShouldCheck] = useState(false);

  const debouncedValue = useDebounce(value, 1000); // Increased debounce time

  // Auto-generate brand ID from brand name if user hasn't manually modified it
  useEffect(() => {
    // Skip auto-generation if field is disabled (brand already exists)
    if (disabled) return;

    if (!hasUserModified && brandName) {
      const generated = generateBrandId(brandName);
      if (generated && generated !== value) {
        onChange(generated);
        // Check availability for auto-generated values after a short delay
        setTimeout(() => {
          setShouldCheck(true);
        }, 1500);
      }
    }
  }, [brandName, hasUserModified, value, onChange, disabled]);

  // Reset hasUserModified if the current value matches what would be auto-generated
  // This allows auto-generation to continue working if user clears the field or it matches the generated value
  useEffect(() => {
    // Skip this logic if field is disabled (brand already exists)
    if (disabled) return;

    if (hasUserModified) {
      if (!value) {
        // If field is empty, allow auto-generation again
        setHasUserModified(false);
        setShouldCheck(false);
      } else if (brandName) {
        const generated = generateBrandId(brandName);
        if (value === generated) {
          // If current value matches what would be generated, allow auto-generation to continue
          setHasUserModified(false);
        }
      }
    }
  }, [brandName, value, hasUserModified, disabled]);

  // Check availability only when field has been blurred and value is valid
  useEffect(() => {
    const checkAvailability = async () => {
      // Skip validation if field is disabled (brand already exists)
      if (disabled) {
        setAvailabilityStatus('idle');
        setSuggestions([]);
        setIsChecking(false);
        return;
      }

      // Only check if user has blurred the field or explicitly requested check
      if (!shouldCheck || !debouncedValue || debouncedValue.length < 3) {
        if (!debouncedValue || debouncedValue.length < 3) {
          setAvailabilityStatus('idle');
          setSuggestions([]);
        }
        return;
      }

      if (!isValidBrandId(debouncedValue)) {
        setAvailabilityStatus('invalid');
        setSuggestions([]);
        return;
      }

      setIsChecking(true);
      try {
        const result = await checkBrandIdAvailability(debouncedValue);
        setAvailabilityStatus(result.available ? 'available' : 'taken');
        setSuggestions(result.suggestions || []);
      } catch (error) {
        console.error('Error checking brand ID availability:', error);
        setAvailabilityStatus('idle');
        setSuggestions([]);
      } finally {
        setIsChecking(false);
      }
    };

    checkAvailability();
  }, [debouncedValue, shouldCheck, disabled]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.toLowerCase().replace(/[^a-z]/g, '');
    setHasUserModified(true);
    // Reset availability status when user is typing
    setAvailabilityStatus('idle');
    setSuggestions([]);
    setShouldCheck(false);
    onChange(newValue);
  }, [onChange]);

  const handleInputBlur = useCallback(() => {
    setShouldCheck(true);
  }, []);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setHasUserModified(true);
    setShouldCheck(true); // Check availability immediately when suggestion is clicked
    onChange(suggestion);
  }, [onChange]);

  const getValidationState = () => {
    if (disabled) return 'idle'; // No validation state when disabled
    if (error) return 'error';
    if (isChecking) return 'validating';
    if (availabilityStatus === 'available') return 'success';
    if (availabilityStatus === 'taken' || availabilityStatus === 'invalid') return 'error';
    return 'idle';
  };

  const getValidationMessage = () => {
    if (disabled) return undefined; // No validation messages when disabled
    if (error) return error;
    if (isChecking) return 'Checking availability...';
    if (availabilityStatus === 'available') return 'Brand ID is available!';
    if (availabilityStatus === 'taken') return 'This brand ID is already taken';
    if (availabilityStatus === 'invalid') return 'Brand ID format is invalid';
    return undefined;
  };

  const getHelperText = (): string => {
    if (isOnboarding) {
      return `This will be your unique web address: ${value ? `${value}.newsletter.example.com` : 'yourbrand.newsletter.example.com'}. Only lowercase letters allowed. Must be 3-50 characters long. Availability will be checked when you finish typing. Cannot be changed after creation.`;
    }
    return 'Your unique brand identifier used for your newsletter subdomain. Availability will be checked when you finish typing. Cannot be changed after creation.';
  };

  return (
    <div className="space-y-3">
      <EnhancedInput
        label="Brand ID *"
        placeholder="yourbrandname"
        value={value}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        error={getValidationMessage()}
        helperText={getHelperText()}
        validationState={getValidationState()}
        showValidationIcon={true}
        disabled={disabled}
        maxLength={50}
      />

      {/* Suggestions */}
      {!disabled && suggestions.length > 0 && availabilityStatus === 'taken' && (
        <div className="bg-warning-50 border border-warning-200 rounded-lg p-4">
          <div className="flex items-start">
            <ExclamationTriangleIcon className="h-5 w-5 text-warning-400 mt-0.5 mr-2 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-medium text-warning-800 mb-2">
                Brand ID not available. Try these alternatives:
              </h4>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-warning-100 text-warning-800 hover:bg-warning-200 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auto-generation notice */}
      {!disabled && !hasUserModified && brandName && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-3">
          <div className="flex items-start">
            <CheckCircleIcon className="h-4 w-4 text-primary-400 mt-0.5 mr-2 flex-shrink-0" />
            <p className="text-xs text-primary-700">
              Brand ID auto-generated from your brand name. You can edit it if needed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
