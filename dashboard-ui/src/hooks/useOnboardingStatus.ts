import { useAuth } from '@/contexts/AuthContext';

export interface OnboardingStatus {
  isNewUser: boolean;
  needsBrandSetup: boolean;
  needsProfileSetup: boolean;
  needsSenderSetup: boolean;
  isOnboardingComplete: boolean;
  nextStep: 'brand' | 'profile' | 'sender' | 'complete' | null;
}

export function useOnboardingStatus(): OnboardingStatus {
  const { user } = useAuth();

  if (!user) {
    return {
      isNewUser: false,
      needsBrandSetup: false,
      needsProfileSetup: false,
      needsSenderSetup: false,
      isOnboardingComplete: false,
      nextStep: null,
    };
  }

  // Check if user has tenantId (indicates brand setup is complete)
  const needsBrandSetup = !user.tenantId;

  // Check if user needs profile setup
  // For now, we'll consider profile setup needed if brand is complete but user hasn't completed profile
  // This could be expanded to check for specific profile fields
  const needsProfileSetup = !needsBrandSetup && !(user.firstName || user.lastName);

  // Check if user needs sender setup (optional step)
  // This is always optional, so we don't block onboarding completion on it
  // But we can offer it as an optional third step
  const needsSenderSetup = !needsBrandSetup && !needsProfileSetup;

  const isNewUser = needsBrandSetup || needsProfileSetup;
  const isOnboardingComplete = !isNewUser;

  let nextStep: 'brand' | 'profile' | 'sender' | 'complete' | null = null;
  if (needsBrandSetup) {
    nextStep = 'brand';
  } else if (needsProfileSetup) {
    nextStep = 'profile';
  } else if (needsSenderSetup) {
    nextStep = 'sender';
  } else {
    nextStep = 'complete';
  }

  return {
    isNewUser,
    needsBrandSetup,
    needsProfileSetup,
    needsSenderSetup,
    isOnboardingComplete,
    nextStep,
  };
}
