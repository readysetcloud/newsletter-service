import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '../ui/Input';
import { EnhancedInput } from '../ui/EnhancedInput';
import { TextArea } from '../ui/TextArea';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';

import { useToast } from '../ui/Toast';
import { BrandPhotoUpload } from './BrandPhotoUpload';
import { BrandIdInput } from './BrandIdInput';
import { brandSchema, BrandFormData, industryOptions } from '../../schemas/brandSchema';
import { BrandInfo } from '../../types';
import { useRealTimeValidation, useFormValidationState } from '../../hooks/useRealTimeValidation';
import { getUserFriendlyErrorMessage } from '../../utils/errorHandling';



interface BrandFormProps {
  initialData?: Partial<BrandInfo>;
  onSubmit: (data: BrandFormData, logoFile?: File) => Promise<void>;
  onPreviewChange?: (data: Partial<BrandInfo>, previewPhoto?: string) => void;
  isSubmitting?: boolean;
  className?: string;
  submitButtonText?: string;
  showCancelButton?: boolean;
  onCancel?: () => void;
}

export const BrandForm: React.FC<BrandFormProps> = ({
  initialData,
  onSubmit,
  onPreviewChange,
  isSubmitting = false,
  className,
  submitButtonText = 'Save Brand Information',
  showCancelButton = true,
  onCancel
}) => {
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading] = useState(false);
  const { addToast } = useToast();

  const form = useForm<BrandFormData>({
    resolver: zodResolver(brandSchema),
    mode: 'onChange', // Enable real-time validation
    defaultValues: {
      brandId: initialData?.brandId || '',
      brandName: initialData?.brandName || '',
      website: initialData?.website || '',
      industry: initialData?.industry || '',
      brandDescription: initialData?.brandDescription || '',
      tags: initialData?.tags || []
    }
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty, isValid },
    setValue,
    reset
  } = form;

  // Enhanced validation state
  const { isFormValid, validationErrors } = useFormValidationState(form);

  // Watch form values for preview updates
  const watchedValues = watch();

  // Update preview when form values change
  useEffect(() => {
    if (onPreviewChange) {
      onPreviewChange(watchedValues, logoPreview || undefined);
    }
  }, [watchedValues, logoPreview, onPreviewChange]);

  // Reset form when initial data changes
  useEffect(() => {
    if (initialData) {
      reset({
        brandId: initialData.brandId || '',
        brandName: initialData.brandName || '',
        website: initialData.website || '',
        industry: initialData.industry || '',
        brandDescription: initialData.brandDescription || '',
        tags: initialData.tags || []
      });
    }
  }, [initialData, reset]);

  const handlePhotoChange = (file: File | null) => {
    setLogoFile(file);
    setUploadError(null);

    if (file) {
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
    } else {
      if (logoPreview) {
        URL.revokeObjectURL(logoPreview);
      }
      setLogoPreview(null);
    }
  };

  const handlePhotoRemove = () => {
    setLogoFile(null);
    setUploadError(null);
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
    }
  };

  const handleFormSubmit = async (data: BrandFormData) => {
    try {
      setUploadError(null);
      await onSubmit(data, logoFile || undefined);

      // Show success toast
      addToast({
        type: 'success',
        title: 'Brand Saved',
        message: initialData?.brandId ? 'Brand updated successfully!' : 'Brand created successfully!',
        duration: 3000
      });
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'brand');
      setUploadError(errorMessage);

      // Show error toast
      addToast({
        type: 'error',
        title: 'Save Failed',
        message: errorMessage,
        duration: 5000
      });

      throw error; // Re-throw for EnhancedForm to handle
    }
  };

  const handleTagsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const tags = value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    setValue('tags', tags, { shouldDirty: true });
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className={className}>
      <div className="space-y-6">
        {/* Brand Name */}
        <EnhancedInput
          label="Brand Name *"
          placeholder="Enter your brand name"
          error={errors.brandName?.message}
          validationState={errors.brandName ? 'error' : watch('brandName') ? 'success' : 'idle'}
          showValidationIcon={true}
          {...register('brandName')}
        />

        {/* Brand ID */}
        <BrandIdInput
          value={watch('brandId') || ''}
          onChange={(value) => setValue('brandId', value, { shouldValidate: true })}
          brandName={watch('brandName') || ''}
          error={errors.brandId?.message}
          disabled={!!initialData?.brandId} // Disable if brand already exists
          isOnboarding={!initialData?.brandId}
        />

        {/* Website */}
        <EnhancedInput
          label="Website"
          type="url"
          placeholder="https://example.com"
          error={errors.website?.message}
          helperText="Include http:// or https://"
          validationState={errors.website ? 'error' : watch('website') && !errors.website ? 'success' : 'idle'}
          showValidationIcon={true}
          {...register('website')}
        />

        {/* Industry */}
        <Select
          label="Industry *"
          placeholder="Select your industry"
          options={industryOptions}
          error={errors.industry?.message}
          {...register('industry')}
        />

        {/* Brand Description */}
        <TextArea
          label="Brand Description"
          placeholder="Describe your brand, mission, or what makes you unique..."
          rows={4}
          error={errors.brandDescription?.message}
          helperText="Optional - up to 500 characters"
          {...register('brandDescription')}
        />

        {/* Tags */}
        <Input
          label="Tags"
          placeholder="newsletter, marketing, tech (comma-separated)"
          helperText="Enter tags separated by commas"
          onChange={handleTagsChange}
          defaultValue={initialData?.tags?.join(', ') || ''}
        />

        {/* Brand Logo Upload */}
        <BrandPhotoUpload
          currentPhoto={initialData?.brandLogo}
          onPhotoChange={handlePhotoChange}
          onPhotoRemove={handlePhotoRemove}
          isUploading={isUploading}
          error={uploadError || undefined}
        />

        {/* Brand ID Display (if exists) */}
        {initialData?.brandId && (
          <div className="bg-slate-50 rounded-lg p-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Brand ID (Immutable)
            </label>
            <div className="font-mono text-sm text-slate-900 bg-white px-3 py-2 rounded border">
              {initialData.brandId}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              This ID cannot be changed and is used for API integration
            </p>
          </div>
        )}
      </div>

      {/* Submit Button */}
      <div className="flex justify-end space-x-3 pt-6">
        {showCancelButton && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={(!isDirty && !logoFile) || !isFormValid || isSubmitting}
          loading={isSubmitting}
        >
          {isSubmitting ? 'Saving...' : submitButtonText}
        </Button>
      </div>
    </form>
  );
};
