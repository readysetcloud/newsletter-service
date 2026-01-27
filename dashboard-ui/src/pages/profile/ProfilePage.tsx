import { useState, useEffect } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { Loading } from '@/components/ui/Loading';
import { useToast } from '@/components/ui/Toast';
import { PersonalInfoForm } from '@/components/forms/PersonalInfoForm';
import { SocialLinksManager } from '@/components/forms/SocialLinksManager';
import { UserPreferencesForm } from '@/components/forms/UserPreferencesForm';
import { profileService } from '@/services/profileService';
import type {
  UserProfile,
  SocialLink
} from '@/types/api';
import type {
  PersonalInfoFormData,
  UserPreferencesFormData
} from '@/schemas/profileSchema';

export function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  // Load profile data on component mount
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
      } else {
        setError(response.error || 'Failed to load profile');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePersonalInfoUpdate = async (data: PersonalInfoFormData) => {
    try {
      const response = await profileService.updateProfile({
        firstName: data.firstName,
        lastName: data.lastName,
        links: data.links?.map(link => ({
          name: link.name,
          url: link.url
        }))
      });

      if (response.success) {
        // Update local state
        setProfile(prev => prev ? {
          ...prev,
          profile: {
            ...prev.profile,
            firstName: data.firstName,
            lastName: data.lastName,
            links: data.links
          }
        } : null);

        addToast({
          title: 'Success',
          message: 'Personal information updated successfully',
          type: 'success'
        });
      } else {
        throw new Error(response.error || 'Failed to update personal information');
      }
    } catch (err) {
      addToast({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to update personal information',
        type: 'error'
      });
      throw err;
    }
  };

  const handleSocialLinksUpdate = async (links: SocialLink[]) => {
    try {
      const response = await profileService.updateProfile({
        links: links.map(link => ({
          name: link.name,
          url: link.url
        }))
      });

      if (response.success) {
        // Update local state
        setProfile(prev => prev ? {
          ...prev,
          profile: {
            ...prev.profile,
            links: links
          }
        } : null);

        addToast({
          title: 'Success',
          message: 'Social links updated successfully',
          type: 'success'
        });
      } else {
        throw new Error(response.error || 'Failed to update social links');
      }
    } catch (err) {
      addToast({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to update social links',
        type: 'error'
      });
      throw err;
    }
  };

  const handlePreferencesUpdate = async (data: UserPreferencesFormData) => {
    try {
      const response = await profileService.updateProfile({
        timezone: data.timezone,
        locale: data.locale
      });

      if (response.success) {
        // Update local state
        setProfile(prev => prev ? {
          ...prev,
          preferences: {
            ...prev.preferences,
            timezone: data.timezone,
            locale: data.locale
          }
        } : null);

        addToast({
          title: 'Success',
          message: 'Preferences updated successfully',
          type: 'success'
        });
      } else {
        throw new Error(response.error || 'Failed to update preferences');
      }
    } catch (err) {
      addToast({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to update preferences',
        type: 'error'
      });
      throw err;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error ? (
            <div className="bg-error-50 border border-error-200 rounded-lg p-6 text-center">
              <h2 className="text-lg font-semibold text-error-800 mb-2">Error Loading Profile</h2>
              <p className="text-error-600 mb-4">{error}</p>
              <button
                onClick={loadProfile}
                className="bg-error-600 text-white px-4 py-2 rounded-md hover:bg-error-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : !profile ? (
            <div className="bg-warning-50 border border-warning-200 rounded-lg p-6 text-center">
              <h2 className="text-lg font-semibold text-warning-800 mb-2">No Profile Data</h2>
              <p className="text-warning-600">Unable to load profile information.</p>
            </div>
          ) : (
            <>
              {/* Page Header */}
              <div className="mb-6 sm:mb-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Profile Settings</h1>
                <p className="text-muted-foreground mt-2 text-sm sm:text-base">
                  Manage your personal information, social links, and account preferences.
                </p>
              </div>

              {/* Profile Forms */}
              <div className="space-y-6 sm:space-y-8">
                {/* Personal Information */}
                <PersonalInfoForm
                  initialData={profile.profile}
                  onSubmit={handlePersonalInfoUpdate}
                  isLoading={isLoading}
                />

                {/* Social Links */}
                <SocialLinksManager
                  initialLinks={profile.profile.links}
                  onUpdate={handleSocialLinksUpdate}
                  isLoading={isLoading}
                />

                {/* User Preferences */}
                <UserPreferencesForm
                  initialData={profile.preferences}
                  onSubmit={handlePreferencesUpdate}
                  isLoading={isLoading}
                />
              </div>
            </>
          )}
        </div>
      </main>


    </div>
  );
}
