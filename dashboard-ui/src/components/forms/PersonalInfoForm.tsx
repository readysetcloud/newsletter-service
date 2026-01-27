import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { EnhancedInput } from '@/components/ui/EnhancedInput';
import { EnhancedForm } from '@/components/ui/EnhancedForm';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { personalInfoSchema, type PersonalInfoFormData } from '@/schemas/profileSchema';
import type { PersonalInfo } from '@/types/api';
import { useFormValidationState } from '@/hooks/useRealTimeValidation';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';

interface PersonalInfoFormProps {
  initialData?: PersonalInfo;
  onSubmit: (data: PersonalInfoFormData) => Promise<void>;
  isLoading?: boolean;
}

export function PersonalInfoForm({ initialData, onSubmit, isLoading = false }: PersonalInfoFormProps) {
  const { addToast } = useToast();

  const form = useForm<PersonalInfoFormData>({
    resolver: zodResolver(personalInfoSchema),
    mode: 'onChange',
    defaultValues: {
      firstName: initialData?.firstName || '',
      lastName: initialData?.lastName || '',
      links: initialData?.links || []
    }
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty }
  } = form;

  const firstNameValue = useWatch({ control: form.control, name: 'firstName' });
  const lastNameValue = useWatch({ control: form.control, name: 'lastName' });

  const { isFormValid } = useFormValidationState(form);

  const handleFormSubmit = async (data: PersonalInfoFormData) => {
    try {
      await onSubmit(data);

      addToast({
        type: 'success',
        title: 'Profile Updated',
        message: 'Your personal information has been updated successfully!',
        duration: 3000
      });
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'profile');

      addToast({
        type: 'error',
        title: 'Update Failed',
        message: errorMessage,
        duration: 5000
      });

      throw error;
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">Personal Information</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Update your personal details and contact information.
        </p>
      </div>

      <EnhancedForm
        onSubmit={handleSubmit(handleFormSubmit)}
        submitButtonText="Save Changes"
        submitButtonLoadingText="Saving..."
        showProgress={true}
        optimisticUpdate={true}
        successMessage="Personal information updated successfully!"
        disabled={!isDirty || !isFormValid || isLoading}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <EnhancedInput
              label="First Name"
              {...register('firstName')}
              error={errors.firstName?.message}
              disabled={isLoading || isSubmitting}
              placeholder="Enter your first name"
              validationState={errors.firstName ? 'error' : firstNameValue ? 'success' : 'idle'}
              showValidationIcon={true}
            />
          </div>

          <div>
            <EnhancedInput
              label="Last Name"
              {...register('lastName')}
              error={errors.lastName?.message}
              disabled={isLoading || isSubmitting}
              placeholder="Enter your last name"
              validationState={errors.lastName ? 'error' : lastNameValue ? 'success' : 'idle'}
              showValidationIcon={true}
            />
          </div>
        </div>
      </EnhancedForm>
    </Card>
  );
}
