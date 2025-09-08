import { z } from 'zod';

/**
 * Snippet parameter validation schema
 */
export const snippetParameterSchema = z.object({
  name: z
    .string()
    .min(1, 'Parameter name is required')
    .max(50, 'Parameter name must be less than 50 characters')
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Parameter name must start with a letter or underscore and contain only letters, numbers, and underscores'),
  type: z.enum(['string', 'number', 'boolean'], {
    errorMap: () => ({ message: 'Parameter type must be string, number, or boolean' })
  }),
  required: z.boolean().default(false),
  defaultValue: z.any().optional(),
  description: z
    .string()
    .max(200, 'Parameter description must be less than 200 characters')
    .optional()
});

/**
 * Template creation validation schema
 */
export const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1, 'Template name is required')
    .max(100, 'Template name must be less than 100 characters')
    .regex(/^[a-zA-Z0-9\s\-_()]+$/, 'Template name can only contain letters, numbers, spaces, hyphens, underscores, and parentheses'),
  description: z
    .string()
    .max(500, 'Template description must be less than 500 characters')
    .optional(),
  content: z
    .string()
    .min(1, 'Template content is required')
    .max(1000000, 'Template content must be less than 1MB'),
  category: z
    .string()
    .max(50, 'Category must be less than 50 characters')
    .optional(),
  tags: z
    .array(
      z.string()
        .min(1, 'Tag cannot be empty')
        .max(30, 'Each tag must be less than 30 characters')
        .regex(/^[a-zA-Z0-9\-_]+$/, 'Tags can only contain letters, numbers, hyphens, and underscores')
    )
    .max(10, 'Maximum 10 tags allowed')
    .optional()
    .default([]),
  isVisualMode: z.boolean().optional().default(false),
  visualConfig: z.any().optional()
});

/**
 * Template update validation schema
 */
export const updateTemplateSchema = createTemplateSchema.partial().extend({
  // At least one field must be provided for update
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

/**
 * Snippet creation validation schema
 */
export const createSnippetSchema = z.object({
  name: z
    .string()
    .min(1, 'Snippet name is required')
    .max(100, 'Snippet name must be less than 100 characters')
    .regex(/^[a-zA-Z0-9\-_]+$/, 'Snippet name can only contain letters, numbers, hyphens, and underscores'),
  description: z
    .string()
    .max(500, 'Snippet description must be less than 500 characters')
    .optional(),
  content: z
    .string()
    .min(1, 'Snippet content is required')
    .max(100000, 'Snippet content must be less than 100KB'),
  parameters: z
    .array(snippetParameterSchema)
    .max(10, 'Maximum 10 parameters allowed')
    .optional()
    .default([])
    .refine(
      (params) => {
        const names = params.map(p => p.name);
        return names.length === new Set(names).size;
      },
      { message: 'Parameter names must be unique' }
    )
});

/**
 * Snippet update validation schema
 */
export const updateSnippetSchema = createSnippetSchema.partial().extend({
  // At least one field must be provided for update
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

/**
 * Template preview validation schema
 */
export const previewTemplateSchema = z.object({
  testData: z.record(z.any()).optional(),
  sendTestEmail: z.boolean().optional().default(false),
  testEmailAddress: z
    .string()
    .email('Invalid email address')
    .optional()
});

/**
 * Snippet preview validation schema
 */
export const previewSnippetSchema = z.object({
  parameters: z.record(z.any()).optional().default({})
});

/**
 * Template filters validation schema
 */
export const templateFiltersSchema = z.object({
  search: z.string().max(100, 'Search term must be less than 100 characters').optional(),
  category: z.string().max(50, 'Category must be less than 50 characters').optional(),
  tags: z.array(z.string().max(30, 'Tag must be less than 30 characters')).optional(),
  createdBy: z.string().max(100, 'Created by must be less than 100 characters').optional(),
  dateRange: z.object({
    start: z.string().datetime('Invalid start date'),
    end: z.string().datetime('Invalid end date')
  }).optional().refine(
    (range) => {
      if (range && new Date(range.start) > new Date(range.end)) {
        return false;
      }
      return true;
    },
    { message: 'Start date must be before end date' }
  )
});

/**
 * Snippet filters validation schema
 */
export const snippetFiltersSchema = z.object({
  search: z.string().max(100, 'Search term must be less than 100 characters').optional(),
  createdBy: z.string().max(100, 'Created by must be less than 100 characters').optional(),
  dateRange: z.object({
    start: z.string().datetime('Invalid start date'),
    end: z.string().datetime('Invalid end date')
  }).optional().refine(
    (range) => {
      if (range && new Date(range.start) > new Date(range.end)) {
        return false;
      }
      return true;
    },
    { message: 'Start date must be before end date' }
  )
});

/**
 * Export templates validation schema
 */
export const exportTemplatesSchema = z.object({
  templateIds: z
    .array(z.string().uuid('Invalid template ID'))
    .min(1, 'At least one template must be selected')
    .max(50, 'Maximum 50 templates can be exported at once'),
  includeSnippets: z.boolean().optional().default(true),
  format: z.enum(['zip', 'json']).optional().default('zip')
});

/**
 * Import templates validation schema
 */
export const importTemplatesSchema = z.object({
  data: z.string().min(1, 'Import data is required'),
  format: z.enum(['zip', 'json']).optional().default('json'),
  conflictResolution: z.enum(['skip', 'overwrite', 'rename']).optional().default('skip'),
  preserveIds: z.boolean().optional().default(false)
});

/**
 * Visual config validation schema
 */
export const visualConfigSchema = z.object({
  version: z.string().default('1.0'),
  components: z.array(z.object({
    id: z.string(),
    type: z.string(),
    props: z.record(z.any()),
    children: z.array(z.any()).optional()
  })).default([]),
  styles: z.record(z.any()).optional().default({}),
  settings: z.record(z.any()).optional().default({})
});

/**
 * Validation helper functions
 */

/**
 * Validate template name uniqueness (client-side check)
 */
export const validateTemplateNameUniqueness = (
  name: string,
  existingTemplates: Array<{ name: string; id?: string }>,
  currentTemplateId?: string
): boolean => {
  return !existingTemplates.some(
    template =>
      template.name.toLowerCase() === name.toLowerCase() &&
      template.id !== currentTemplateId
  );
};

/**
 * Validate snippet name uniqueness (client-side check)
 */
export const validateSnippetNameUniqueness = (
  name: string,
  existingSnippets: Array<{ name: string; id?: string }>,
  currentSnippetId?: string
): boolean => {
  return !existingSnippets.some(
    snippet =>
      snippet.name.toLowerCase() === name.toLowerCase() &&
      snippet.id !== currentSnippetId
  );
};

/**
 * Validate handlebars syntax (client-side basic check)
 */
export const validateHandlebarsSyntax = (content: string): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Check for unmatched braces
  const openBraces = (content.match(/\{\{/g) || []).length;
  const closeBraces = (content.match(/\}\}/g) || []).length;

  if (openBraces !== closeBraces) {
    errors.push('Unmatched handlebars braces detected');
  }

  // Check for unmatched block helpers
  const blockOpeners = content.match(/\{\{#\w+/g) || [];
  const blockClosers = content.match(/\{\{\/\w+/g) || [];

  if (blockOpeners.length !== blockClosers.length) {
    errors.push('Unmatched handlebars block helpers detected');
  }

  // Check for invalid helper names
  const invalidHelpers = content.match(/\{\{[#\/]?\s*[^a-zA-Z_]/g);
  if (invalidHelpers) {
    errors.push('Invalid handlebars helper names detected');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate snippet parameter values
 */
export const validateSnippetParameterValues = (
  parameters: Array<{ name: string; type: string; required: boolean }>,
  values: Record<string, any>
): { isValid: boolean; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};

  parameters.forEach(param => {
    const value = values[param.name];

    // Check required parameters
    if (param.required && (value === undefined || value === null || value === '')) {
      errors[param.name] = `${param.name} is required`;
      return;
    }

    // Skip validation if value is empty and not required
    if (!param.required && (value === undefined || value === null || value === '')) {
      return;
    }

    // Type validation
    switch (param.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors[param.name] = `${param.name} must be a string`;
        }
        break;
      case 'number':
        if (typeof value !== 'number' && !(!isNaN(Number(value)))) {
          errors[param.name] = `${param.name} must be a number`;
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors[param.name] = `${param.name} must be true or false`;
        }
        break;
    }
  });

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

/**
 * Get validation error messages from Zod error
 */
export const getValidationErrorMessages = (error: z.ZodError): Record<string, string> => {
  const errors: Record<string, string> = {};

  error.errors.forEach(err => {
    const path = err.path.join('.');
    errors[path] = err.message;
  });

  return errors;
};

/**
 * Safe validation wrapper that returns result instead of throwing
 */
export const safeValidate = <T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: Record<string, string> } => {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: getValidationErrorMessages(error) };
    }
    return { success: false, errors: { _general: 'Validation failed' } };
  }
};

/**
 * Async validation wrapper for forms
 */
export const validateAsync = async <T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  additionalValidation?: (data: T) => Promise<Record<string, string>>
): Promise<{ success: true; data: T } | { success: false; errors: Record<string, string> }> => {
  // First run Zod validation
  const zodResult = safeValidate(schema, data);
  if (!zodResult.success) {
    return zodResult;
  }

  // Run additional async validation if provided
  if (additionalValidation) {
    const additionalErrors = await additionalValidation(zodResult.data);
    if (Object.keys(additionalErrors).length > 0) {
      return { success: false, errors: additionalErrors };
    }
  }

  return zodResult;
};
