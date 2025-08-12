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
  const { user } = useAuth();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Async function to upload logo after tenant creation
  const uploadLogoAsync = async (logoFile: File) => {
    try {
      console.log('Uploading brand logo asynchronously...', {
        fileName: logoFile.name,
        fileSize: logoFile.size,
        fileType: logoFile.type
      });

      const uploadResponse = await profileService.uploadBrandPhoto(logoFile);
      console.log('Async upload response:', uploadResponse);

      if (uploadResponse.success && uploadResponse.data) {
        console.log('Logo uploaded successfully:', uploadResponse.data);

        // Update the brand with the logo URL
        await updateBrand({ brandLogo: uploadResponse.data });
        console.log('Brand updated with logo URL');

        addToast({
          type: 'success',
          title: 'Logo Uploaded!',
          message: 'Your brand logo has been uploaded successfully.',
          duration: 3000
        });
      } else {
        console.error('Async upload failed:', uploadResponse);
        addToast({
          type: 'warning',
          title: 'Logo Upload Failed',
          message: 'Your brand was created but the logo upload failed. You can upload it later from your brand settings.',
          duration: 5000
        });
      }
    } catch (error) {
      console.error('Async logo upload error:', error);
      addToast({
        type: 'warning',
        title: 'Logo Upload Failed',
        message: 'Your brand was created but the logo upload failed. You can upload it later from your brand settings.',
        duration: 5000
      });
    }
  };

  const handleBrandSubmit = async (brandData: any, logoFile?: File) => {
    console.log('=== Brand Submit Started ===');
    console.log('Brand data received:', brandData);
    console.log('Logo file received:', logoFile);

    setIsSubmitting(true);
    try {
      // Step 1: Create tenant first (synchronous) - this establishes proper auth context
      console.log('Step 1: Creating tenant and updating brand information...');
      const updateResponse = await updateBrand(brandData);
      console.log('Brand/tenant creation response:', updateResponse);

      // Step 2: Upload logo asynchronously if provided (now with proper tenant context)
      if (logoFile) {
        console.log('Step 2: Starting async logo upload with tenant context...');
        // Don't await - let it happen in background
        uploadLogoAsync(logoFile);

        addToast({
          type: 'success',
          title: 'Brand Setup Complete!',
          message: 'Your brand has been created successfully. Logo is being uploaded...',
        });
      } else {
        console.log('Step 2: No logo file to upload');
        addToast({
          type: 'success',
          title: 'Brand Setup Complete!',
          message: 'Your brand information has been saved successfully.',
        });
      }

      // Small delay to allow the backend to update the user's tenantId
      setTimeout(() => {
        // Force a page refresh to get updated user info, or redirect to dashboard
        window.location.href = '/dashboard';
      }, 1000);

    } catch (error) {
      console.error('Brand setup error:', error);

      // Extract more detailed error information
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

      // Re-throw the error so the form can handle it
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
