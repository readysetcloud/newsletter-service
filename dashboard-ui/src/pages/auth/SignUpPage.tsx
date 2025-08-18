import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { ConfirmSignUpForm } from '@/components/auth/ConfirmSignUpForm';

type SignUpStep = 'signup' | 'confirm';

export function SignUpPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [currentStep, setCurrentStep] = useState<SignUpStep>('signup');
  const [signUpEmail, setSignUpEmail] = useState('');

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-gray-600">Loading...</span>
        </div>
      </div>
    );
  }

  // Redirect to dashboard if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSignUpSuccess = () => {
    // If sign up is complete, redirect to dashboard
    // This will happen if email verification is not required
    window.location.href = '/dashboard';
  };

  const handleNeedConfirmation = (email: string) => {
    setSignUpEmail(email);
    setCurrentStep('confirm');
  };

  const handleConfirmationSuccess = () => {
    // After successful confirmation, redirect to dashboard
    window.location.href = '/dashboard';
  };

  const handleBackToSignUp = () => {
    setCurrentStep('signup');
    setSignUpEmail('');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Newsletter Admin
          </h1>
          <p className="text-gray-600">
            {currentStep === 'signup'
              ? 'Create your account to get started'
              : 'Verify your email to complete setup'
            }
          </p>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        {currentStep === 'signup' ? (
          <SignUpForm
            onSuccess={handleSignUpSuccess}
            onNeedConfirmation={handleNeedConfirmation}
          />
        ) : (
          <ConfirmSignUpForm
            email={signUpEmail}
            onSuccess={handleConfirmationSuccess}
            onBackToSignUp={handleBackToSignUp}
          />
        )}
      </div>

      <div className="mt-8 text-center">
        {currentStep === 'signup' ? (
          <p className="text-sm text-gray-500">
            Already have an account?{' '}
            <Link
              to="/login"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Sign in
            </Link>
          </p>
        ) : (
          <p className="text-sm text-gray-500">
            Need help? Contact your administrator
          </p>
        )}
      </div>
    </div>
  );
}
