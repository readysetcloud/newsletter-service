import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import {
  socialLinkSchema,
  socialPlatformOptions
} from '@/schemas/profileSchema';
import type { SocialLink } from '@/types/api';
import { z } from 'zod';

const socialLinksArraySchema = z.object({
  links: z.array(socialLinkSchema)
});

type SocialLinksFormData = z.infer<typeof socialLinksArraySchema>;

interface SocialLinksManagerProps {
  initialLinks?: SocialLink[];
  onUpdate: (links: SocialLink[]) => Promise<void>;
  isLoading?: boolean;
}

export function SocialLinksManager({ initialLinks = [], onUpdate, isLoading = false }: SocialLinksManagerProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors }
  } = useForm<SocialLinksFormData>({
    resolver: zodResolver(socialLinksArraySchema),
    defaultValues: {
      links: initialLinks.length > 0 ? initialLinks : [{ platform: '', url: '', displayName: '' }]
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'links'
  });

  const handleFormSubmit = async (data: SocialLinksFormData) => {
    setIsSubmitting(true);
    try {
      // Filter out empty links
      const validLinks = data.links.filter(link => link.platform && link.url);
      await onUpdate(validLinks);
    } catch (error) {
      console.error('Failed to update social links:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addNewLink = () => {
    append({ platform: '', url: '', displayName: '' });
  };

  const removeLink = (index: number) => {
    remove(index);
  };

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Social Links</h3>
        <p className="text-sm text-gray-600 mt-1">
          Add your social media profiles and professional links.
        </p>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        {fields.map((field, index) => (
          <div key={field.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-medium text-gray-700">Link {index + 1}</h4>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLink(index)}
                  disabled={isLoading || isSubmitting}
                  className="text-red-600 hover:text-red-700"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Select
                  label="Platform"
                  {...register(`links.${index}.platform`)}
                  error={errors.links?.[index]?.platform?.message}
                  disabled={isLoading || isSubmitting}
                  options={socialPlatformOptions}
                  placeholder="Select platform"
                />
              </div>

              <div>
                <Input
                  label="URL"
                  {...register(`links.${index}.url`)}
                  error={errors.links?.[index]?.url?.message}
                  disabled={isLoading || isSubmitting}
                  placeholder="https://example.com"
                  type="url"
                />
              </div>

              <div>
                <Input
                  label="Display Name (Optional)"
                  {...register(`links.${index}.displayName`)}
                  error={errors.links?.[index]?.displayName?.message}
                  disabled={isLoading || isSubmitting}
                  placeholder="Custom display name"
                />
              </div>
            </div>
          </div>
        ))}

        <div className="flex justify-between items-center pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={addNewLink}
            disabled={isLoading || isSubmitting}
            className="flex items-center gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            Add Link
          </Button>

          <Button
            type="submit"
            disabled={isLoading || isSubmitting}
            isLoading={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save Links'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
