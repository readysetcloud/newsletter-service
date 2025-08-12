import { useAuth } from '@/contexts/AuthContext';

export interface OnboardingStatus {
  isNewUser: boolean;
  needsBrandSetup: boolean;
  needsProfileSetup: boolean;
  isOnboardingComplete: boolean;
  nextStep: 'brand' | 'profile' | 'complete' | null;
}

export function useOnboardingStatus(): OnboardingStatus {
  const { user } = useAuth();

  if (!user) {
    return {
      isNewUser: false,
      needsBrandSetup: false,
      needsProfileSetup: false,
      isOnboardingComplete: false,
      nextStep: null,
    };
  }

  // Check if user has tenantId (indicates brand setup is complete)
  const needsBrandSetup = !user.tenantId;

  // Check if user has basic profile info (first/last name)
  // This would need to be expanded based on your profile requirements
  const needsProfileSetup = false; // For now, we'll focus on brand setup

  const isNewUser = needsBrandSetup || needsProfileSetup;
  const isOnboardingComplete = !isNewUser;

  let nextStep: 'brand' | 'profile' | 'complete' | null = null;
  if (needsBrandSetup) {
    nextStep = 'brand';
  } else if (needsProfileSetup) {
    nextStep = 'profile';
  } else {
    nextStep = 'complete';
  }

  return {
    isNewUser,
    needsBrandSetup,
    needsProfileSetup,
    isOnboardingComplete,
    nextStep,
  };
}
