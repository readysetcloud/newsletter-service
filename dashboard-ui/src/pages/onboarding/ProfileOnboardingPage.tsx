import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { PersonalInfoForm } from '@/components/forms/PersonalInfoForm';
import { SocialLinksManager } from '@/components/forms/SocialLinksManager';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { profileService } from '@/services/profileService';
import type { SocialLink } from '@/types/api';

export function ProfileOnboardingPage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSection, setCurrentSection] = useState<'personal' | 'social'>('personal');

  const handlePersonalInfoSubmit = async (personalData: any) => {
    console.log('=== Personal Info Submit Started ===');
    console.log('Personal data received:', personalData);

    setIsSubmitting(true);
    try {
      const response = await profileService.updateProfile(personalData);
      console.log('Personal info update response:', response);

      if (response.success) {
        addToast({
          type: 'success',
          title: 'Personal Info Saved!',
          message: 'Your personal information has been saved successfully.',
        });

        // Move to social links section
        setCurrentSection('social');
      } else {
        throw new Error(response.error || 'Failed to update personal information');
      }
    } catch (error) {
      console.error('Personal info update error:', error);

      let errorMessage = 'There was an error saving your personal information. Please try again.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      addToast({
        type: 'error',
        title: 'Save Failed',
        message: errorMessage,
      });

      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSocialLinksSubmit = async (links: SocialLink[]) => {
    console.log('=== Social Links Submit Started ===');
    console.log('Social links received:', links);

    setIsSubmitting(true);
    try {
      const response = await profileService.updateProfile({
        links,
        markAsCompleted: true
      });
      console.log('Social links update response:', response);

      if (response.success) {
        addToast({
          type: 'success',
          title: 'Profile Setup Complete!',
          message: 'Your profile has been set up successfully.',
        });

        // Refresh user context and navigate to sender setup
        console.log('Refreshing user context and navigating to sender setup...');
        await refreshUser();

        // Small delay to ensure any backend processing completes
        await new Promise(resolve => setTimeout(resolve, 500));

        navigate('/onboarding/sender', { replace: true });
      } else {
        throw new Error(response.error || 'Failed to update social links');
      }
    } catch (error) {
      console.error('Social links update error:', error);

      let errorMessage = 'There was an error saving your social links. Please try again.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      addToast({
        type: 'error',
        title: 'Save Failed',
        message: errorMessage,
      });

      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipSocialLinks = async () => {
    console.log('=== Skipping Social Links ===');

    setIsSubmitting(true);
    try {
      // Mark profile as completed even if skipping social links
      const response = await profileService.updateProfile({
        markAsCompleted: true
      });

      if (response.success) {
        addToast({
          type: 'success',
          title: 'Profile Setup Complete!',
          message: 'Your profile has been set up successfully.',
        });

        // Refresh user context and navigate to sender setup
        await refreshUser();
        await new Promise(resolve => setTimeout(resolve, 500));
        navigate('/onboarding/sender', { replace: true });
      } else {
        throw new Error(response.error || 'Failed to complete profile setup');
      }
    } catch (error) {
      console.error('Profile completion error:', error);
      addToast({
        type: 'error',
        title: 'Setup Failed',
        message: 'There was an error completing your profile setup.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="profile"
      title={currentSection === 'personal' ? 'Complete Your Profile' : 'Add Social Links'}
      description={
        currentSection === 'personal'
          ? 'Tell us a bit about yourself to personalize your experience'
          : 'Connect your social profiles to build your professional presence'
      }
    >
      {currentSection === 'personal' ? (
        <div>
          <PersonalInfoForm
            onSubmit={handlePersonalInfoSubmit}
            isLoading={isSubmitting}
          />

          {/* Skip option */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setCurrentSection('social')}
              className="text-sm text-gray-500 hover:text-gray-700"
              disabled={isSubmitting}
            >
              Skip personal info for now
            </button>
          </div>
        </div>
      ) : (
        <div>
          <SocialLinksManager
            initialLinks={[]}
            onUpdate={handleSocialLinksSubmit}
            isLoading={isSubmitting}
          />

          {/* Skip and Complete buttons */}
          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setCurrentSection('personal')}
              className="text-sm text-gray-500 hover:text-gray-700"
              disabled={isSubmitting}
            >
              ← Back to Personal Info
            </button>

            <button
              type="button"
              onClick={handleSkipSocialLinks}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              disabled={isSubmitting}
            >
              Skip & Complete Setup
            </button>
          </div>
        </div>
      )}
    </OnboardingLayout>
  );
}
