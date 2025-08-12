import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z
    .string()
    .min(1, 'API key name is required')
    .min(3, 'API key name must be at least 3 characters')
    .max(50, 'API key name must be less than 50 characters')
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'API key name can only contain letters, numbers, spaces, hyphens, and underscores'),

  description: z
    .string()
    .max(200, 'Description must be less than 200 characters')
    .optional(),

  expiresAt: z
    .string()
    .optional()
    .refine((date) => {
      if (!date) return true; // Optional field
      const expirationDate = new Date(date);
      const now = new Date();
      return expirationDate > now;
    }, 'Expiration date must be in the future')
});

export type CreateApiKeyFormData = z.infer<typeof createApiKeySchema>;
