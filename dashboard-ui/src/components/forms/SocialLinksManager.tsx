import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import {
  socialLinkSchema
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
      links: initialLinks.length > 0 ? initialLinks : [{ url: '', name: '' }]
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'links'
  });

  const handleFormSubmit = async (data: SocialLinksFormData) => {
    setIsSubmitting(true);
    try {
      const validLinks = data.links.filter(link => link.url && link.name);
      await onUpdate(validLinks);
    } catch (error) {
      console.error('Failed to update social links:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addNewLink = () => {
    append({ url: '', name: '' });
  };

  const removeLink = (index: number) => {
    remove(index);
  };

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">Social Links</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Add your social media profiles and professional links.
        </p>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        {fields.map((field, index) => (
          <div key={field.id} className="border border-border rounded-lg p-4 bg-background">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-medium text-muted-foreground">Link {index + 1}</h4>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLink(index)}
                  disabled={isLoading || isSubmitting}
                  className="text-error-600 hover:text-error-700"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                  label="Display Name"
                  {...register(`links.${index}.name`)}
                  error={errors.links?.[index]?.name?.message}
                  disabled={isLoading || isSubmitting}
                  placeholder="My Website"
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
