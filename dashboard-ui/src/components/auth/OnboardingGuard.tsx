import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

interface OnboardingGuardProps {
  children: React.ReactNode;
  allowOnboarding?: boolean; // If true, allows access even during onboarding
}

export function OnboardingGuard({
  children,
  allowOnboarding = false
}: OnboardingGuardProps) {
  const { isNewUser, nextStep } = useOnboardingStatus();
  const location = useLocation();

  // If user is not in onboarding, allow access
  if (!isNewUser) {
    return <>{children}</>;
  }

  // If this route allows onboarding access, allow it
  if (allowOnboarding) {
    return <>{children}</>;
  }

  // Redirect to appropriate onboarding step
  if (nextStep === 'brand') {
    return <Navigate to="/onboarding/brand" state={{ from: location }} replace />;
  }

  if (nextStep === 'profile') {
    return <Navigate to="/onboarding/profile" state={{ from: location }} replace />;
  }

  // Fallback - shouldn't happen but redirect to brand setup
  return <Navigate to="/onboarding/brand" state={{ from: location }} replace />;
}
