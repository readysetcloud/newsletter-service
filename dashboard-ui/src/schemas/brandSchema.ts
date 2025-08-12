import { z } from 'zod';

export const brandSchema = z.object({
  brandId: z
    .string()
    .min(1, 'Brand ID is required')
    .min(3, 'Brand ID must be at least 3 characters')
    .max(50, 'Brand ID must be less than 50 characters')
    .regex(/^[a-z]+$/, 'Brand ID can only contain lowercase letters'),

  brandName: z
    .string()
    .min(1, 'Brand name is required')
    .min(2, 'Brand name must be at least 2 characters')
    .max(100, 'Brand name must be less than 100 characters'),

  website: z
    .string()
    .optional()
    .refine((val) => {
      if (!val) return true;
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    }, 'Please enter a valid URL (including http:// or https://)'),

  industry: z
    .string()
    .min(1, 'Industry is required'),

  brandDescription: z
    .string()
    .optional()
    .refine((val) => !val || val.length <= 500, 'Description must be less than 500 characters'),

  tags: z
    .array(z.string())
    .optional()
    .default([])
});

export type BrandFormData = z.infer<typeof brandSchema>;

// Industry options for the select dropdown
export const industryOptions = [
  { value: 'technology', label: 'Technology' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'finance', label: 'Finance' },
  { value: 'education', label: 'Education' },
  { value: 'retail', label: 'Retail' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'media', label: 'Media & Entertainment' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'government', label: 'Government' },
  { value: 'real-estate', label: 'Real Estate' },
  { value: 'food-beverage', label: 'Food & Beverage' },
  { value: 'travel', label: 'Travel & Tourism' },
  { value: 'automotive', label: 'Automotive' },
  { value: 'sports', label: 'Sports & Recreation' },
  { value: 'other', label: 'Other' }
];
