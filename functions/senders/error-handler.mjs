/**
 * @fileoverview Comprehensive error handling for sender email management
 */

import { formatResponse } from '../utils/helpers.mjs';

/**
 * Error types for sender operations
 */
export const ERROR_TYPES = {
  VALIDATION: 'validation',
  TIER_LIMIT: 'tier_limit',
  DUPLICATE: 'duplicate',
  NOT_FOUND: 'not_found',
  SES_ERROR: 'ses_error',
  DNS_ERROR: 'dns_error',
  NETWORK_ERROR: 'network_error',
  AUTHORIZATION: 'authorization',
  RATE_LIMIT: 'rate_limit',
  UNKNOWN: 'unknown'
};

/**
 * Error codes for specific scenarios
 */
export const ERROR_CODES = {
  // Validation errors
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_DOMAIN: 'INVALID_DOMAIN',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',

  // Tier limit errors
  SENDER_LIMIT_EXCEEDED: 'SENDER_LIMIT_EXCEEDED',
  DNS_VERIFICATION_NOT_ALLOWED: 'DNS_VERIFICATION_NOT_ALLOWED',
  MAILBOX_VERIFICATION_NOT_ALLOWED: 'MAILBOX_VERIFICATION_NOT_ALLOWED',

  // Duplicate errors
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  DOMAIN_ALREADY_EXISTS: 'DOMAIN_ALREADY_EXISTS',

  // Not found errors
  SENDER_NOT_FOUND: 'SENDER_NOT_FOUND',
  DOMAIN_NOT_FOUND: 'DOMAIN_NOT_FOUND',

  // SES errors
  SES_IDENTITY_CREATION_FAILED: 'SES_IDENTITY_CREATION_FAILED',
  SES_IDENTITY_DELETION_FAILED: 'SES_IDENTITY_DELETION_FAILED',
  SES_VERIFICATION_FAILED: 'SES_VERIFICATION_FAILED',
  SES_QUOTA_EXCEEDED: 'SES_QUOTA_EXCEEDED',

  // DNS errors
  DNS_RECORD_GENERATION_FAILED: 'DNS_RECORD_GENERATION_FAILED',
  DNS_PROPAGATION_TIMEOUTROPAGATION_TIMEOUT',

  // Authorization errors
  TENANT_ACCESS_REQUIRED: 'TENANT_ACCESS_REQUIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',

  // Rate limiting
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  VERIFICATION_ATTEMPTS_EXCEEDED: 'VERIFICATION_ATTEMPTS_EXCEEDED'
};

/**
 * User-friendly error messages
 */
export const ERROR_MESSAGES = {
  [ERROR_CODES.INVALID_EMAIL]: 'Please enter a valid email address',
  [ERROR_CODES.INVALID_DOMAIN]: 'Please enter a valid domain name',
  [ERROR_CODES.MISSING_REQUIRED_FIELD]: 'Please fill in all required fields',

  [ERROR_CODES.SENDER_LIMIT_EXCEEDED]: 'You have reached the maximum number of sender emails for your plan',
  [ERROR_CODES.DNS_VERIFICATION_NOT_ALLOWED]: 'Domain verification is not available on your current plan',
  [ERROR_CODES.MAILBOX_VERIFICATION_NOT_ALLOWED]: 'Email verification is not available on your current plan',

  [ERROR_CODES.EMAIL_ALREADY_EXISTS]: 'This email address is already configured',
  [ERROR_CODES.DOMAIN_ALREADY_EXISTS]: 'This domain is already being verified',

  [ERROR_CODES.SENDER_NOT_FOUND]: 'Sender email not found',
  [ERROR_CODES.DOMAIN_NOT_FOUND]: 'Domain verification not found',

  [ERROR_CODES.SES_IDENTITY_CREATION_FAILED]: 'Failed to set up email verification. Please try again.',
  [ERROR_CODES.SES_IDENTITY_DELETION_FAILED]: 'Failed to remove email verification. The sender has been deleted from your account.',
  [ERROR_CODES.SES_VERIFICATION_FAILED]: 'Email verification failed. Please check your email and try again.',
  [ERROR_CODES.SES_QUOTA_EXCEEDED]: 'Email service quota exceeded. Please try again later.',

  [ERROR_CODES.DNS_RECORD_GENERATION_FAILED]: 'Failed to generate DNS verification records. Please try again.',
  [ERROR_CODES.DNS_PROPAGATION_TIMEOUT]: 'DNS verification is taking longer than expected. Please check your DNS records.',

  [ERROR_CODES.TENANT_ACCESS_REQUIRED]: 'Authentication required to access this resource',
  [ERROR_CODES.INSUFFICIENT_PERMISSIONS]: 'You do not have permission to perform this action',

  [ERROR_CODES.TOO_MANY_REQUESTS]: 'Too many requests. Please wait a moment before trying again.',
  [ERROR_CODES.VERIFICATION_ATTEMPTS_EXCEEDED]: 'Too many verification attempts. Please wait before trying again.'
};

/**
 * Retry configuration for different error types
 */
export const RETRY_CONFIG = {
  [ERROR_TYPES.NETWORK_ERROR]: { retryable: true, maxRetries: 3, baseDelay: 1000 },
  [ERROR_TYPES.SES_ERROR]: { retryable: true, maxRetries: 2, baseDelay: 2000 },
  [ERROR_TYPES.DNS_ERROR]: { retryable: true, maxRetries: 2, baseDelay: 5000 },
  [ERROR_TYPES.RATE_LIMIT]: { retryable: true, maxRetries: 1, baseDelay: 10000 },
  [ERROR_TYPES.VALIDATION]: { retryable: false, maxRetries: 0, baseDelay: 0 },
  [ERROR_TYPES.TIER_LIMIT]: { retryable: false, maxRetries: 0, baseDelay: 0 },
  [ERROR_TYPES.DUPLICATE]: { retryable: false, maxRetries: 0, baseDelay: 0 },
  [ERROR_CODES.NOT_FOUND]: { retryable: false, maxRetries: 0, baseDelay: 0 },
  [ERROR_TYPES.AUTHORIZATION]: { retryable: false, maxRetries: 0, baseDelay: 0 },
  [ERROR_TYPES.UNKNOWN]: { retryable: false, maxRetries: 0, baseDelay: 0 }
};

/**
 * Create a standardized error response
 */
export const createErrorResponse = (errorCode, customMessage = null, statusCode = 400, additionalData = {}) => {
  const errorType = getErrorType(errorCode);
  const message = customMessage || ERROR_MESSAGES[errorCode] || 'An unexpected error occurred';
  const retryConfig = RETRY_CONFIG[errorType];

  return formatResponse(statusCode, {
    error: message,
    errorCode,
    errorType,
    retryable: retryConfig?.retryable || false,
    timestamp: new Date().toISOString(),
    ...additionalData
  });
};

/**
 * Get error type from error code
 */
export const getErrorType = (errorCode) => {
  if (errorCode.includes('INVALID_') || errorCode.includes('MISSING_')) {
    return ERROR_TYPES.VALIDATION;
  }
  if (errorCode.includes('LIMIT') || errorCode.includes('NOT_ALLOWED')) {
    return ERROR_TYPES.TIER_LIMIT;
  }
  if (errorCode.includes('ALREADY_EXISTS')) {
    return ERROR_TYPES.DUPLICATE;
  }
  if (errorCode.includes('NOT_FOUND')) {
    return ERROR_TYPES.NOT_FOUND;
  }
  if (errorCode.includes('SES_')) {
    return ERROR_TYPES.SES_ERROR;
  }
  if (errorCode.includes('DNS_')) {
    return ERROR_TYPES.DNS_ERROR;
  }
  if (errorCode.includes('TENANT_') || errorCode.includes('PERMISSIONS')) {
    return ERROR_TYPES.AUTHORIZATION;
  }
  if (errorCode.includes('TOO_MANY') || errorCode.includes('EXCEEDED')) {
    return ERROR_TYPES.RATE_LIMIT;
  }
  return ERROR_TYPES.UNKNOWN;
};

/**
 * Handle SES-specific errors
 */
export const handleSESError = (error, operation = 'SES operation') => {
  console.error(`SES Error during ${operation}:`, error);

  // Map common SES errors to our error codes
  if (error.name === 'AlreadyExistsException') {
    return createErrorResponse(ERROR_CODES.EMAIL_ALREADY_EXISTS, null, 409);
  }

  if (error.name === 'LimitExceededException') {
    return createErrorResponse(ERROR_CODES.SES_QUOTA_EXCEEDED, null, 429);
  }

  if (error.name === 'InvalidParameterException') {
    return createErrorResponse(ERROR_CODES.INVALID_EMAIL, 'Invalid email address or domain format');
  }

  if (error.name === 'NotFoundException') {
    return createErrorResponse(ERROR_CODES.SENDER_NOT_FOUND, null, 404);
  }

  if (error.name === 'ThrottlingException') {
    return createErrorResponse(ERROR_CODES.TOO_MANY_REQUESTS, null, 429);
  }

  // Generic SES error
  const errorCode = operation.includes('create')
    ? ERROR_CODES.SES_IDENTITY_CREATION_FAILED
    : operation.includes('delete')
    ? ERROR_CODES.SES_IDENTITY_DELETION_FAILED
    : ERROR_CODES.SES_VERIFICATION_FAILED;

  return createErrorResponse(errorCode, null, 500, {
    details: error.message,
    sesErrorName: error.name
  });
};

/**
 * Handle DynamoDB-specific errors
 */
export const handleDynamoDBError = (error, operation = 'database operation') => {
  console.error(`DynamoDB Error during ${operation}:`, error);

  if (error.name === 'ConditionalCheckFailedException') {
    if (operation.includes('create')) {
      return createErrorResponse(ERROR_CODES.EMAIL_ALREADY_EXISTS, null, 409);
    }
    return createErrorResponse(ERROR_CODES.SENDER_NOT_FOUND, null, 404);
  }

  if (error.name === 'ResourceNotFoundException') {
    return createErrorResponse(ERROR_CODES.SENDER_NOT_FOUND, null, 404);
  }

  if (error.name === 'ThrottlingException') {
    return createErrorResponse(ERROR_CODES.TOO_MANY_REQUESTS, null, 429);
  }

  // Generic database error
  return createErrorResponse(ERROR_CODES.UNKNOWN, 'Database operation failed. Please try again.', 500, {
    details: error.message,
    dynamoErrorName: error.name
  });
};

/**
 * Handle validation errors
 */
export const handleValidationError = (field, value, requirement) => {
  let errorCode = ERROR_CODES.MISSING_REQUIRED_FIELD;
  let message = `${field} is required`;

  if (value) {
    if (field === 'email') {
      errorCode = ERROR_CODES.INVALID_EMAIL;
      message = 'Please enter a valid email address';
    } else if (field === 'domain') {
      errorCode = ERROR_CODES.INVALID_DOMAIN;
      message = 'Please enter a valid domain name';
    } else {
      message = `Invalid ${field}: ${requirement}`;
    }
  }

  return createErrorResponse(errorCode, message, 400, {
    field,
    value: value ? '[REDACTED]' : null,
    requirement
  });
};

/**
 * Handle tier limit errors with upgrade guidance
 */
export const handleTierLimitError = (tierLimits, attemptedAction) => {
  let errorCode = ERROR_CODES.SENDER_LIMIT_EXCEEDED;
  let message = ERROR_MESSAGES[errorCode];
  let upgradeGuidance = {};

  if (attemptedAction === 'dns_verification') {
    errorCode = ERROR_CODES.DNS_VERIFICATION_NOT_ALLOWED;
    message = ERROR_MESSAGES[errorCode];
    upgradeGuidance = {
      requiredTier: 'creator-tier',
      benefits: [
        'Up to 2 sender emails',
        'Domain verification with DNS',
        'Send from multiple addresses under verified domains'
      ]
    };
  } else if (attemptedAction === 'add_sender') {
    upgradeGuidance = {
      currentLimit: tierLimits.maxSenders,
      currentUsage: tierLimits.currentCount,
      suggestedTier: tierLimits.tier === 'free-tier' ? 'creator-tier' : 'pro-tier',
      benefits: tierLimits.tier === 'free-tier'
        ? ['Up to 2 sender emails', 'Domain verification']
        : ['Up to 5 sender emails', 'Advanced features']
    };
  }

  return createErrorResponse(errorCode, message, 400, {
    tierLimits,
    upgradeGuidance,
    upgradeRequired: true
  });
};

/**
 * Wrap async operations with comprehensive error handling
 */
export const withErrorHandling = (operation, context = 'operation') => {
  return async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      console.error(`Error in ${context}:`, error);

      // Handle specific error types
      if (error.name?.includes('SES') || error.$metadata?.httpStatusCode) {
        return handleSESError(error, context);
      }

      if (error.name?.includes('DynamoDB') || error.name?.includes('ConditionalCheck')) {
        return handleDynamoDBError(error, context);
      }

      if (error.message?.includes('Invalid authorization context')) {
        return createErrorResponse(ERROR_CODES.TENANT_ACCESS_REQUIRED, null, 401);
      }

      // Generic error handling
      return createErrorResponse(ERROR_CODES.UNKNOWN, 'An unexpected error occurred. Please try again.', 500, {
        context,
        details: error.message
      });
    }
  };
};

/**
 * Validate email format
 */
export const validateEmail = (email) => {
  if (!email) {
    return handleValidationError('email', email, 'Email address is required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return handleValidationError('email', email, 'Valid email format required');
  }

  return null; // Valid
};

/**
 * Validate domain format
 */
export const validateDomain = (domain) => {
  if (!domain) {
    return handleValidationError('domain', domain, 'Domain is required');
  }

  // Basic domain validation
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!domainRegex.test(domain)) {
    return handleValidationError('domain', domain, 'Valid domain format required');
  }

  // Ensure domain doesn't contain protocol
  if (domain.includes('://') || domain.includes('/')) {
    return handleValidationError('domain', domain, 'Domain should not include protocol or path');
  }

  return null; // Valid
};

/**
 * Create success response with consistent format
 */
export const createSuccessResponse = (data, message = null, statusCode = 200) => {
  return formatResponse(statusCode, {
    success: true,
    data,
    ...(message && { message }),
    timestamp: new Date().toISOString()
  });
};

/**
 * Log error with context for monitoring
 */
export const logError = (error, context, additionalData = {}) => {
  const logData = {
    timestamp: new Date().toISOString(),
    context,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    ...additionalData
  };

  console.error('Sender Error:', JSON.stringify(logData, null, 2));

  // In production, you might want to send this to a monitoring service
  // Example: await sendToMonitoring(logData);
};
