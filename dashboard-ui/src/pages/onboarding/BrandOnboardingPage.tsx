import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { BrandForm } from '@/components/forms/BrandForm';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { updateBrand } from '@/services/brandService';
import { profileService } from '@/services/profileService';

export function BrandOnboardingPage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);



  const handleBrandSubmit = async (brandData: any, logoFile?: File) => {
    console.log('=== Brand Submit Started ===');
    console.log('Brand data received:', brandData);
    console.log('Logo file received:', logoFile);

    setIsSubmitting(true);
    try {
      // Step 1: Create tenant first - this establishes proper auth context
      console.log('Step 1: Creating tenant and updating brand information...');
      const updateResponse = await updateBrand(brandData);
      console.log('Brand/tenant creation response:', updateResponse);

      // Step 2: Upload logo synchronously if provided (wait for completion)
      if (logoFile) {
        console.log('Step 2: Uploading logo synchronously...');

        try {
          const uploadResponse = await profileService.uploadBrandPhoto(logoFile);
          console.log('Logo upload response:', uploadResponse);

          if (uploadResponse.success && uploadResponse.data) {
            console.log('Logo uploaded successfully, updating brand with logo URL...');
            await updateBrand({ ...brandData, brandLogo: uploadResponse.data });

            addToast({
              type: 'success',
              title: 'Brand Setup Complete!',
              message: 'Your brand and logo have been set up successfully.',
            });
          } else {
            console.error('Logo upload failed:', uploadResponse);
            addToast({
              type: 'success',
              title: 'Brand Setup Complete!',
              message: 'Your brand was created successfully, but logo upload failed. You can upload it later.',
            });
          }
        } catch (logoError) {
          console.error('Logo upload error:', logoError);
          addToast({
            type: 'success',
            title: 'Brand Setup Complete!',
            message: 'Your brand was created successfully, but logo upload failed. You can upload it later.',
          });
        }
      } else {
        console.log('Step 2: No logo file to upload');
        addToast({
          type: 'success',
          title: 'Brand Setup Complete!',
          message: 'Your brand information has been saved successfully.',
        });
      }

      // Step 3: Refresh user context and navigate to profile setup
      console.log('Step 3: Refreshing user context and navigating to profile setup...');
      await refreshUser();

      // Small delay to ensure token refresh propagates
      await new Promise(resolve => setTimeout(resolve, 500));

      // Navigate to profile onboarding as step 2
      navigate('/onboarding/profile', { replace: true });

    } catch (error) {
      console.error('Brand setup error:', error);

      let errorMessage = 'There was an error setting up your brand. Please try again.';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null && 'message' in error) {
        errorMessage = String(error.message);
      }

      addToast({
        type: 'error',
        title: 'Setup Failed',
        message: errorMessage,
      });

      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="brand"
      title="Set Up Your Brand"
      description="Tell us about your brand to get started with your newsletter"
    >
      <BrandForm
        onSubmit={handleBrandSubmit}
        isSubmitting={isSubmitting}
        submitButtonText="Complete Brand Setup"
        showCancelButton={false}
      />

      {/* Skip option for now - you might want to remove this in production */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Skip for now (not recommended)
        </button>
      </div>
    </OnboardingLayout>
  );
}
