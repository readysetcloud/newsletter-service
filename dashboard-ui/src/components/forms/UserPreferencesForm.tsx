import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import {
  userPreferencesSchema,
  timezoneOptions,
  localeOptions,
  type UserPreferencesFormData
} from '@/schemas/profileSchema';
import type { UserPreferences } from '@/types/api';

interface UserPreferencesFormProps {
  initialData?: UserPreferences;
  onSubmit: (data: UserPreferencesFormData) => Promise<void>;
  isLoading?: boolean;
}

export function UserPreferencesForm({ initialData, onSubmit, isLoading = false }: UserPreferencesFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<UserPreferencesFormData>({
    resolver: zodResolver(userPreferencesSchema),
    defaultValues: {
      timezone: initialData?.timezone || 'UTC',
      locale: initialData?.locale || 'en-US'
    }
  });

  const handleFormSubmit = async (data: UserPreferencesFormData) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error('Failed to update preferences:', error);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Preferences</h3>
        <p className="text-sm text-gray-600 mt-1">
          Configure your timezone and language preferences.
        </p>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Select
              label="Timezone"
              {...register('timezone')}
              error={errors.timezone?.message}
              disabled={isLoading || isSubmitting}
              options={timezoneOptions}
              placeholder="Select your timezone"
            />
          </div>

          <div>
            <Select
              label="Language & Region"
              {...register('locale')}
              error={errors.locale?.message}
              disabled={isLoading || isSubmitting}
              options={localeOptions}
              placeholder="Select your language"
            />
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button
            type="submit"
            disabled={isLoading || isSubmitting}
            isLoading={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save Preferences'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
