import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter,
} from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EnhancedInput } from '@/components/ui/EnhancedInput';
import { TextArea } from '@/components/ui/TextArea';
import { useToast } from '@/components/ui/Toast';
import { createApiKeySchema, type CreateApiKeyFormData } from '@/schemas/apiKeySchema';
import { useFormValidationState } from '@/hooks/useRealTimeValidation';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';

interface CreateApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateApiKeyFormData) => Promise<void>;
}

export const CreateApiKeyModal: React.FC<CreateApiKeyModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { addToast } = useToast();

  const form = useForm<CreateApiKeyFormData>({
    resolver: zodResolver(createApiKeySchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      description: '',
      expiresAt: '',
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = form;

  const { isFormValid } = useFormValidationState(form);
  const hasExpiration = watch('expiresAt');

  const handleFormSubmit = async (data: CreateApiKeyFormData) => {
    try {
      setIsSubmitting(true);

      // Clean up the data - remove empty strings
      const cleanData = {
        name: data.name,
        description: data.description || undefined,
        expiresAt: data.expiresAt || undefined,
      };

      await onSubmit(cleanData);

      addToast({
        type: 'success',
        title: 'API Key Created',
        message: `API key "${data.name}" has been created successfully!`,
        duration: 3000
      });

      reset();
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'apikey');

      addToast({
        type: 'error',
        title: 'Creation Failed',
        message: errorMessage,
        duration: 5000
      });

      console.error('Error submitting form:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      reset();
      onClose();
    }
  };

  // Generate a default expiration date (30 days from now)
  const getDefaultExpirationDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 16); // Format for datetime-local input
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md">
      <form onSubmit={handleSubmit(handleFormSubmit)}>
        <ModalHeader onClose={handleClose}>
          <ModalTitle>Create New API Key</ModalTitle>
          <ModalDescription>
            Create a new API key to access the newsletter service programmatically.
            The key value will only be shown once after creation.
          </ModalDescription>
        </ModalHeader>

        <ModalContent>
          <div className="space-y-4">
            {/* Name Field */}
            <div>
              <EnhancedInput
                label="Name *"
                id="name"
                type="text"
                placeholder="e.g., Production API Key"
                {...register('name')}
                error={errors.name?.message}
                disabled={isSubmitting}
                helperText="A descriptive name to help you identify this API key"
                validationState={errors.name ? 'error' : watch('name') ? 'success' : 'idle'}
                showValidationIcon={true}
              />
            </div>

            {/* Description Field */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <TextArea
                id="description"
                placeholder="Optional description of what this API key will be used for..."
                rows={3}
                {...register('description')}
                error={errors.description?.message}
                disabled={isSubmitting}
              />
            </div>

            {/* Expiration Field */}
            <div>
              <EnhancedInput
                label="Expiration Date (Optional)"
                id="expiresAt"
                type="datetime-local"
                {...register('expiresAt')}
                error={errors.expiresAt?.message}
                disabled={isSubmitting}
                min={new Date().toISOString().slice(0, 16)}
                helperText={hasExpiration
                  ? 'The API key will automatically expire on this date'
                  : 'Leave empty for a key that never expires'
                }
                validationState={errors.expiresAt ? 'error' : hasExpiration ? 'success' : 'idle'}
                showValidationIcon={true}
              />
              {!hasExpiration && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const defaultDate = getDefaultExpirationDate();
                    const event = { target: { value: defaultDate } };
                    register('expiresAt').onChange(event);
                  }}
                  className="mt-1 text-xs"
                  disabled={isSubmitting}
                >
                  Set to 30 days from now
                </Button>
              )}
            </div>
          </div>
        </ModalContent>

        <ModalFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            isLoading={isSubmitting}
            disabled={isSubmitting || !isFormValid}
          >
            Create API Key
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
