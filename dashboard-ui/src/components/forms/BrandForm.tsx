import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { getUserFriendlyErrorMessage } from '../../utils/errorHandling';

type BrandFormInput = z.input<typeof brandSchema>;

interface BrandFormProps {
  initialData?: Partial<BrandInfo>;
  onSubmit: (data: BrandFormData, logoFile?: File, logoRemoved?: boolean) => Promise<void>;
  onPreviewChange?: (data: Partial<BrandInfo>, previewPhoto?: string) => void;
  isSubmitting?: boolean;
  className?: string;
  submitButtonText?: string;
  showCancelButton?: boolean;
  onCancel?: () => void;
}

export const BrandForm: React.FC<BrandFormProps> = (props) => {
  const { initialData } = props;
  const resetKey = [
    initialData?.brandId ?? 'new',
    initialData?.brandName ?? '',
    initialData?.website ?? '',
    initialData?.industry ?? '',
    initialData?.brandDescription ?? '',
    initialData?.tags?.join(',') ?? '',
    initialData?.brandLogo ?? ''
  ].join('|');

  return <BrandFormInner key={resetKey} {...props} />;
};

const BrandFormInner: React.FC<BrandFormProps> = ({
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
  const [hasLogoChanged, setHasLogoChanged] = useState(false);
  const [isLogoRemoved, setIsLogoRemoved] = useState(false);
  const { addToast } = useToast();

  const form = useForm<BrandFormInput>({
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
    formState: { errors, isDirty },
    setValue,
    control,
    getValues
  } = form;

  // Editing an existing brand vs. creating one (onboarding / first-time setup).
  // In edit mode we keep a "must have changes" guard so an unchanged form can't be
  // re-saved. We intentionally do NOT gate the button on form validity: a disabled
  // button gives the user no idea what's wrong. Instead the button stays clickable
  // and react-hook-form's handleSubmit surfaces a focused error next to whichever
  // field is invalid (and blocks the actual submit).
  const isEditMode = !!initialData?.brandId;

  // Watch specific form values for preview updates
  const brandId = useWatch({ control, name: 'brandId' });
  const brandName = useWatch({ control, name: 'brandName' });
  const website = useWatch({ control, name: 'website' });
  const industry = useWatch({ control, name: 'industry' });
  const brandDescription = useWatch({ control, name: 'brandDescription' });
  const tags = useWatch({ control, name: 'tags' });

  const previewValues = useMemo(() => ({
    brandId,
    brandName,
    website,
    industry,
    brandDescription,
    tags
  }), [brandId, brandName, website, industry, brandDescription, tags]);

  const lastPreviewKeyRef = useRef<string | null>(null);
  const previewKey = useMemo(() => {
    return JSON.stringify({
      previewValues,
      logoPreview: logoPreview || null
    });
  }, [previewValues, logoPreview]);

  // Update preview when form values change
  useEffect(() => {
    if (!onPreviewChange) return;
    if (lastPreviewKeyRef.current === previewKey) return;
    lastPreviewKeyRef.current = previewKey;
    onPreviewChange(previewValues, logoPreview || undefined);
  }, [previewKey, previewValues, logoPreview, onPreviewChange]);

  const handlePhotoChange = useCallback((file: File | null) => {
    setLogoFile(file);
    setUploadError(null);
    setHasLogoChanged(true); // Mark logo as changed
    setIsLogoRemoved(false); // Reset removal state when new file is selected

    if (file) {
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
    } else {
      if (logoPreview) {
        URL.revokeObjectURL(logoPreview);
      }
      setLogoPreview(null);
    }
  }, [logoPreview]);

  const handlePhotoRemove = useCallback(() => {
    setLogoFile(null);
    setUploadError(null);
    setHasLogoChanged(true); // Mark logo as changed
    setIsLogoRemoved(true); // Mark logo as removed
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
    }

    // Trigger preview update to remove the logo from preview
    if (onPreviewChange) {
      const currentValues = getValues();
      onPreviewChange({
        ...currentValues,
        brandLogo: undefined // Remove logo from preview
      });
    }
  }, [logoPreview, onPreviewChange, getValues]);

  const handleFormSubmit = async (data: BrandFormInput) => {
    try {
      setUploadError(null);
      const normalizedData: BrandFormData = {
        ...data,
        tags: data.tags ?? []
      };
      await onSubmit(normalizedData, logoFile || undefined, isLogoRemoved);

      // Reset logo change state after successful submission
      setHasLogoChanged(false);
      setIsLogoRemoved(false);

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

  const handleTagsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const tags = value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    setValue('tags', tags, { shouldDirty: true });
  }, [setValue]);

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className={className}>
      <div className="space-y-6">
        {/* Brand Name */}
        <EnhancedInput
          label="Brand Name *"
          placeholder="Enter your brand name"
          error={errors.brandName?.message}
          validationState={errors.brandName ? 'error' : brandName ? 'success' : 'idle'}
          showValidationIcon={true}
          {...register('brandName')}
        />

        {/* Brand ID */}
        <BrandIdInput
          value={brandId || ''}
          onChange={(value) => setValue('brandId', value, { shouldValidate: true, shouldDirty: true })}
          brandName={brandName || ''}
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
          validationState={errors.website ? 'error' : website && !errors.website ? 'success' : 'idle'}
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
          disabled={isSubmitting || (isEditMode && !isDirty && !logoFile && !hasLogoChanged)}
          isLoading={isSubmitting}
        >
          {isSubmitting ? 'Saving...' : submitButtonText}
        </Button>
      </div>
    </form>
  );
};
