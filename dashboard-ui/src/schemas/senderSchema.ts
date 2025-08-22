import { z } from 'zod';

// Email validation schema
const emailSchema = z
  .string()
  .min(1, 'Email address is required')
  .email('Please enter a valid email address')
  .max(254, 'Email address is too long');

// Domain validation schema
const domainSchema = z
  .string()
  .min(1, 'Domain is required')
  .regex(
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    'Please enter a valid domain name'
  )
  .max(253, 'Domain name is too long');

// Sender name validation schema
const senderNameSchema = z
  .string()
  .max(64, 'Sender name must be less than 64 characters')
  .optional();

// Create sender form schema
export const createSenderSchema = z.object({
  email: emailSchema,
  name: senderNameSchema,
  verificationType: z.enum(['mailbox', 'domain'], {
    required_error: 'Please select a verification type'
  })
});

// Verify domain form schema
export const verifyDomainSchema = z.object({
  domain: domainSchema
});

// Update sender form schema
export const updateSenderSchema = z.object({
  name: senderNameSchema,
  isDefault: z.boolean().optional()
});

// Form data types
export type CreateSenderFormData = z.infer<typeof createSenderSchema>;
export type VerifyDomainFormData = z.infer<typeof verifyDomainSchema>;
export type UpdateSenderFormData = z.infer<typeof updateSenderSchema>;

// Validation helpers
export const validateEmail = (email: string): boolean => {
  try {
    emailSchema.parse(email);
    return true;
  } catch {
    return false;
  }
};

export const validateDomain = (domain: string): boolean => {
  try {
    domainSchema.parse(domain);
    return true;
  } catch {
    return false;
  }
};

export const extractDomainFromEmail = (email: string): string => {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1] : '';
};

// Verification type options
export const verificationTypeOptions = [
  {
    value: 'mailbox' as const,
    label: 'Email Verification',
    description: 'Verify individual email addresses by clicking a link sent to each address',
    icon: '📧',
    pros: ['Quick setup', 'No DNS changes required', 'Works with any email provider'],
    cons: ['Must verify each email individually', 'Limited to specific addresses']
  },
  {
    value: 'domain' as const,
    label: 'Domain Verification',
    description: 'Verify your entire domain to send from any email address under that domain',
    icon: '🌐',
    pros: ['Send from any email under your domain', 'One-time setup', 'More professional'],
    cons: ['Requires DNS record changes', 'May take up to 72 hours', 'Need domain admin access']
  }
];
