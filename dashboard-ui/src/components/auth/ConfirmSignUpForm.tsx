import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface ConfirmSignUpFormProps {
  email: string;
  onSuccess?: () => void;
  onBackToSignUp?: () => void;
}

export function ConfirmSignUpForm({ email, onSuccess, onBackToSignUp }: ConfirmSignUpFormProps) {
  const { confirmSignUp, resendSignUpCode, isLoading, error, clearError } = useAuth();
  const [confirmationCode, setConfirmationCode] = useState('');
  const [formErrors, setFormErrors] = useState<{ confirmationCode?: string }>({});
  const [resendCooldown, setResendCooldown] = useState(0);

  // Cooldown timer for resend button
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const validateForm = () => {
    const errors: { confirmationCode?: string } = {};

    if (!confirmationCode) {
      errors.confirmationCode = 'Confirmation code is required';
    } else if (!/^\d{6}$/.test(confirmationCode)) {
      errors.confirmationCode = 'Confirmation code must be 6 digits';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    clearError();

    try {
      await confirmSignUp(email, confirmationCode);
      onSuccess?.();
    } catch (error) {
      // Error is handled by the AuthContext
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0) return;

    clearError();

    try {
      await resendSignUpCode(email);
      setResendCooldown(60); // 60 second cooldown
    } catch (error) {
      // Error is handled by the AuthContext
    }
  };

  const handleInputChange = (value: string) => {
    // Only allow digits and limit to 6 characters
    const numericValue = value.replace(/\D/g, '').slice(0, 6);
    setConfirmationCode(numericValue);

    if (formErrors.confirmationCode) {
      setFormErrors(prev => ({ ...prev, confirmationCode: undefined }));
    }

    if (error) {
      clearError();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white shadow-lg rounded-lg px-8 py-6">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Verify Your Email</h2>
          <p className="text-gray-600 mt-2">
            We've sent a confirmation code to
          </p>
          <p className="text-gray-900 font-medium">{email}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Confirmation Code Field */}
          <div>
            <label htmlFor="confirmationCode" className="block text-sm font-medium text-gray-700 mb-1">
              Confirmation Code
            </label>
            <input
              id="confirmationCode"
              type="text"
              value={confirmationCode}
              onChange={(e) => handleInputChange(e.target.value)}
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center text-lg tracking-widest ${
                formErrors.confirmationCode ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder="000000"
              disabled={isLoading}
              maxLength={6}
            />
            {formErrors.confirmationCode && (
              <p className="mt-1 text-sm text-red-600">{formErrors.confirmationCode}</p>
            )}
          </div>

          {/* Global Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <div className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Verifying...
              </div>
            ) : (
              'Verify Email'
            )}
          </button>
        </form>

        {/* Resend Code */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600 mb-2">
            Didn't receive the code?
          </p>
          <button
            type="button"
            onClick={handleResendCode}
            disabled={isLoading || resendCooldown > 0}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : 'Resend confirmation code'
            }
          </button>
        </div>

        {/* Back to Sign Up */}
        {onBackToSignUp && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={onBackToSignUp}
              className="text-sm text-gray-600 hover:text-gray-700"
            >
              ← Back to sign up
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
