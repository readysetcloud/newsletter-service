import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { BrandForm } from '../../components/forms/BrandForm';
import { BrandPreview } from '../../components/brand/BrandPreview';
import { AppHeader } from '../../components/layout/AppHeader';
import { BrandFormData } from '../../schemas/brandSchema';
import { BrandInfo, UserProfile } from '../../types';
import { profileService } from '../../services/profileService';
import { useAuth } from '../../contexts/AuthContext';
import { BuildingOfficeIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export const BrandPage: React.FC = () => {
  const { } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Partial<BrandInfo>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | undefined>();

  // Load user profile on mount
  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await profileService.getProfile();

      if (response.success && response.data) {
        setProfile(response.data);
        setPreviewData(response.data.brand || {});
      } else {
        setError(response.error || 'Failed to load profile');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = async (data: BrandFormData, logoFile?: File) => {
    try {
      setIsSubmitting(true);
      setError(null);
      setSuccess(null);

      // Upload logo if provided
      let logoUrl = profile?.brand?.brandLogo;
      if (logoFile) {
        const uploadResponse = await profileService.uploadBrandPhoto(logoFile);
        if (uploadResponse.success && uploadResponse.data) {
          logoUrl = uploadResponse.data;
        } else {
          throw new Error(uploadResponse.error || 'Failed to upload logo');
        }
      }

      // Update brand information
      const brandData = {
        ...data,
        ...(logoUrl && { brandLogo: logoUrl })
      };

      const response = await profileService.updateBrand(brandData);

      if (response.success) {
        setSuccess(profile?.brand?.brandId ? 'Brand updated successfully!' : 'Brand created successfully!');
        // Reload profile to get updated data including brandId
        await loadProfile();
      } else {
        throw new Error(response.error || 'Failed to save brand');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save brand');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePreviewChange = (data: Partial<BrandInfo>, photo?: string) => {
    setPreviewData(data);
    setPreviewPhoto(photo);
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="h-64 bg-slate-200 rounded"></div>
            </div>
            <div className="space-y-4">
              <div className="h-64 bg-slate-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-3 mb-2">
          <BuildingOfficeIcon className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-slate-900">
            {profile?.brand?.brandId ? 'Manage Brand' : 'Create Your Brand'}
          </h1>
        </div>
        <p className="text-slate-600">
          {profile?.brand?.brandId
            ? 'Update your brand information and settings'
            : 'Set up your newsletter brand to get started'
          }
 </p>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-md p-4">
          <div className="flex items-center">
            <CheckCircleIcon className="h-5 w-5 text-green-400 mr-2" />
            <p className="text-sm text-green-800">{success}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-400 mr-2" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        {/* Brand Form */}
        <Card>
          <CardHeader>
            <CardTitle>Brand Information</CardTitle>
          </CardHeader>
          <CardContent>
            <BrandForm
              initialData={profile?.brand}
              onSubmit={handleFormSubmit}
              onPreviewChange={handlePreviewChange}
              isSubmitting={isSubmitting}
            />
          </CardContent>
        </Card>

        {/* Brand Preview */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <BrandPreview
            brand={previewData}
            previewPhoto={previewPhoto}
          />
        </div>
      </div>
      </main>
    </div>
  );
};
