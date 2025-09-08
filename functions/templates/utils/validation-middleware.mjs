import { formatResponse } from '../../utils/helpers.mjs';
import { validateTemplate, validateSnippet } from './template-engine.mjs';

/**
 * Validation schemas for different operations
 */
const validationSchemas = {
  createTemplate: {
    name: {
      required: true,
      type: 'string',
minLength: 1,
      maxLength: 100,
      pattern: /^[a-zA-Z0-9\s\-_()]+$/,
      message: 'Template name must be 1-100 characters and contain only letters, numbers, spaces, hyphens, underscores, and parentheses'
    },
    description: {
      required: false,
      type: 'string',
      maxLength: 500,
      message: 'Description must be less than 500 characters'
    },
    content: {
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 1000000,
      message: 'Template content is required and must be less than 1MB'
    },
    category: {
      required: false,
      type: 'string',
      maxLength: 50,
      message: 'Category must be less than 50 characters'
    },
    tags: {
      required: false,
      type: 'array',
      maxItems: 10,
      itemValidation: {
        type: 'string',
        minLength: 1,
        maxLength: 30,
        pattern: /^[a-zA-Z0-9\-_]+$/,
        message: 'Each tag must be 1-30 characters and contain only letters, numbers, hyphens, and underscores'
      },
      message: 'Maximum 10 tags allowed'
    },
    isVisualMode: {
      required: false,
      type: 'boolean',
      message: 'isVisualMode must be a boolean'
    }
  },

  updateTemplate: {
    name: {
      required: false,
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: /^[a-zA-Z0-9\s\-_()]+$/,
      message: 'Template name must be 1-100 characters and contain only letters, numbers, spaces, hyphens, underscores, and parentheses'
    },
    description: {
      required: false,
      type: 'string',
      maxLength: 500,
      message: 'Description must be less than 500 characters'
    },
    content: {
      required: false,
      type: 'string',
      minLength: 1,
      maxLength: 1000000,
      message: 'Template content must be less than 1MB'
    },
    category: {
      required: false,
      type: 'string',
      maxLength: 50,
      message: 'Category must be less than 50 characters'
    },
    tags: {
      required: false,
      type: 'array',
      maxItems: 10,
      itemValidation: {
        type: 'string',
        minLength: 1,
        maxLength: 30,
        pattern: /^[a-zA-Z0-9\-_]+$/,
        message: 'Each tag must be 1-30 characters and contain only letters, numbers, hyphens, and underscores'
      },
      message: 'Maximum 10 tags allowed'
    },
    isVisualMode: {
      required: false,
      type: 'boolean',
      message: 'isVisualMode must be a boolean'
    }
  },

  createSnippet: {
    name: {
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: /^[a-zA-Z0-9\-_]+$/,
      message: 'Snippet name must be 1-100 characters and contain only letters, numbers, hyphens, and underscores'
    },
    description: {
      required: false,
      type: 'string',
      maxLength: 500,
      message: 'Description must be less than 500 characters'
    },
    content: {
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 100000,
      message: 'Snippet content is required and must be less than 100KB'
    },
    parameters: {
      required: false,
      type: 'array',
      maxItems: 10,
      itemValidation: {
        type: 'object',
        properties: {
          name: {
            required: true,
            type: 'string',
            minLength: 1,
            maxLength: 50,
            pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
            message: 'Parameter name must start with a letter or underscore and contain only letters, numbers, and underscores'
          },
          type: {
            required: true,
            type: 'string',
            enum: ['string', 'number', 'boolean'],
            message: 'Parameter type must be string, number, or boolean'
          },
          required: {
            required: false,
            type: 'boolean',
            message: 'Required must be a boolean'
          },
          description: {
            required: false,
            type: 'string',
            maxLength: 200,
            message: 'Parameter description must be less than 200 characters'
          }
        }
      },
      message: 'Maximum 10 parameters allowed'
    }
  },

  updateSnippet: {
    name: {
      required: false,
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: /^[a-zA-Z0-9\-_]+$/,
      message: 'Snippet name must be 1-100 characters and contain only letters, numbers, hyphens, and underscores'
    },
    description: {
      required: false,
      type: 'string',
      maxLength: 500,
      message: 'Description must be less than 500 characters'
    },
    content: {
      required: false,
      type: 'string',
      minLength: 1,
      maxLength: 100000,
      message: 'Snippet content must be less than 100KB'
    },
    parameters: {
      required: false,
      type: 'array',
      maxItems: 10,
      itemValidation: {
        type: 'object',
        properties: {
          name: {
            required: true,
            type: 'string',
            minLength: 1,
            maxLength: 50,
            pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
            message: 'Parameter name must start with a letter or underscore and contain only letters, numbers, and underscores'
          },
          type: {
            required: true,
            type: 'string',
            enum: ['string', 'number', 'boolean'],
            message: 'Parameter type must be string, number, or boolean'
          },
          required: {
            required: false,
            type: 'boolean',
            message: 'Required must be a boolean'
          },
          description: {
            required: false,
            type: 'string',
            maxLength: 200,
            message: 'Parameter description must be less than 200 characters'
          }
        }
      },
      message: 'Maximum 10 parameters allowed'
    }
  },

  previewTemplate: {
    testData: {
      required: false,
      type: 'object',
      message: 'Test data must be an object'
    },
    sendTestEmail: {
      required: false,
      type: 'boolean',
      message: 'sendTestEmail must be a boolean'
    },
    testEmailAddress: {
      required: false,
      type: 'string',
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: 'Test email address must be a valid email'
    }
  },

  previewSnippet: {
    parameters: {
      required: false,
      type: 'object',
      message: 'Parameters must be an object'
    }
  }
};

/**
 * Validate a single field against its schema
 */
const validateField = (fieldName, value, schema) => {
  const errors = [];

  // Check if required field is missing
  if (schema.required && (value === undefined || value === null || value === '')) {
    errors.push({
      field: fieldName,
      message: `${fieldName} is required`,
      code: 'FIELD_REQUIRED'
    });
    return errors;
  }

  // Skip validation if field is not required and empty
  if (!schema.required && (value === undefined || value === null || value === '')) {
    return errors;
  }

  // Type validation
  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== schema.type) {
      errors.push({
        field: fieldName,
        message: schema.message || `${fieldName} must be of type ${schema.type}`,
        code: 'INVALID_TYPE'
      });
      return errors;
    }
  }

  // String validations
  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) {
      errors.push({
        field: fieldName,
        message: schema.message || `${fieldName} must be at least ${schema.minLength} characters`,
        code: 'MIN_LENGTH_VIOLATION'
      });
    }

    if (schema.maxLength && value.length > schema.maxLength) {
      errors.push({
        field: fieldName,
        message: schema.message || `${fieldName} must be no more than ${schema.maxLength} characters`,
        code: 'MAX_LENGTH_VIOLATION'
      });
    }

    if (schema.pattern && !schema.pattern.test(value)) {
      errors.push({
        field: fieldName,
        message: schema.message || `${fieldName} format is invalid`,
        code: 'PATTERN_VIOLATION'
      });
    }

    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({
        field: fieldName,
        message: schema.message || `${fieldName} must be one of: ${schema.enum.join(', ')}`,
        code: 'ENUM_VIOLATION'
      });
    }
  }

  // Array validations
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.maxItems && value.length > schema.maxItems) {
      errors.push({
        field: fieldName,
        message: schema.message || `${fieldName} must have no more than ${schema.maxItems} items`,
        code: 'MAX_ITEMS_VIOLATION'
      });
    }

    if (schema.minItems && value.length < schema.minItems) {
      errors.push({
        field: fieldName,
        message: schema.message || `${fieldName} must have at least ${schema.minItems} items`,
        code: 'MIN_ITEMS_VIOLATION'
      });
    }

    // Validate array items
    if (schema.itemValidation) {
      value.forEach((item, index) => {
        if (schema.itemValidation.type === 'object' && schema.itemValidation.properties) {
          // Validate object properties
          Object.entries(schema.itemValidation.properties).forEach(([propName, propSchema]) => {
            const propErrors = validateField(`${fieldName}[${index}].${propName}`, item[propName], propSchema);
            errors.push(...propErrors);
          });
        } else {
          // Validate primitive items
          const itemErrors = validateField(`${fieldName}[${index}]`, item, schema.itemValidation);
          errors.push(...itemErrors);
        }
      });
    }
  }

  // Object validations
  if (schema.type === 'object' && schema.properties && typeof value === 'object') {
    Object.entries(schema.properties).forEach(([propName, propSchema]) => {
      const propErrors = validateField(`${fieldName}.${propName}`, value[propName], propSchema);
      errors.push(...propErrors);
    });
  }

  return errors;
};

/**
 * Validate request body against schema
 */
export const validateRequestBody = (body, schemaName) => {
  const schema = validationSchemas[schemaName];
  if (!schema) {
    throw new Error(`Unknown validation schema: ${schemaName}`);
  }

  const errors = [];

  // Validate each field in the schema
  Object.entries(schema).forEach(([fieldName, fieldSchema]) => {
    const fieldErrors = validateField(fieldName, body[fieldName], fieldSchema);
    errors.push(...fieldErrors);
  });

  // Check for unique parameter names in snippets
  if ((schemaName === 'createSnippet' || schemaName === 'updateSnippet') && body.parameters) {
    const paramNames = body.parameters.map(p => p.name).filter(Boolean);
    const uniqueNames = new Set(paramNames);
    if (paramNames.length !== uniqueNames.size) {
      errors.push({
        field: 'parameters',
        message: 'Parameter names must be unique',
        code: 'DUPLICATE_PARAMETER_NAMES'
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate template content syntax
 */
export const validateTemplateContent = async (content, parameters = []) => {
  try {
    const validation = validateTemplate(content, { checkBestPractices: true });
    return {
      isValid: validation.isValid,
      errors: validation.errors || [],
      warnings: validation.warnings || []
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [{
        message: `Template validation error: ${error.message}`,
        code: 'TEMPLATE_VALIDATION_ERROR',
        type: 'validation'
      }],
      warnings: []
    };
  }
};

/**
 * Validate snippet content syntax
 */
export const validateSnippetContent = async (content, parameters = []) => {
  try {
    const validation = validateSnippet(content, parameters, { checkBestPractices: true });
    return {
      isValid: validation.isValid,
      errors: validation.errors || [],
      warnings: validation.warnings || []
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [{
        message: `Snippet validation error: ${error.message}`,
        code: 'SNIPPET_VALIDATION_ERROR',
        type: 'validation'
      }],
      warnings: []
    };
  }
};

/**
 * Middleware function for request validation
 */
export const validationMiddleware = (schemaName) => {
  return async (event) => {
    try {
      const body = JSON.parse(event.body || '{}');

      // Basic request body validation
      const validation = validateRequestBody(body, schemaName);
      if (!validation.isValid) {
        return formatResponse(400, {
          message: 'Request validation failed',
          code: 'REQUEST_VALIDATION_FAILED',
          errors: validation.errors
        });
      }

      // Content-specific validation for templates and snippets
      if (body.content) {
        let contentValidation;

        if (schemaName.includes('Template')) {
          contentValidation = await validateTemplateContent(body.content);
        } else if (schemaName.includes('Snippet')) {
          contentValidation = await validateSnippetContent(body.content, body.parameters);
        }

        if (contentValidation && !contentValidation.isValid) {
          return formatResponse(400, {
            message: 'Content validation failed',
            code: 'CONTENT_VALIDATION_FAILED',
            errors: contentValidation.errors,
            warnings: contentValidation.warnings
          });
        }

        // Log warnings if present
        if (contentValidation && contentValidation.warnings && contentValidation.warnings.length > 0) {
          console.warn(`Content validation warnings for ${schemaName}:`, contentValidation.warnings);
        }
      }

      // Validation passed, continue with the request
      return null;
    } catch (error) {
      console.error('Validation middleware error:', error);
      return formatResponse(400, {
        message: 'Invalid request format',
        code: 'INVALID_REQUEST_FORMAT',
        details: { error: error.message }
      });
    }
  };
};

/**
 * Validate preview request parameters
 */
export const validatePreviewRequest = (body, templateOrSnippet, parameters = []) => {
  const errors = [];

  // Validate test email requirement
  if (body.sendTestEmail && !body.testEmailAddress) {
    errors.push({
      field: 'testEmailAddress',
      message: 'Test email address is required when sending test email',
      code: 'TEST_EMAIL_REQUIRED'
    });
  }

  // Validate snippet parameters
  if (templateOrSnippet === 'snippet' && body.parameters && parameters.length > 0) {
    parameters.forEach(param => {
      const value = body.parameters[param.name];

      if (param.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: `parameters.${param.name}`,
          message: `Parameter '${param.name}' is required`,
          code: 'REQUIRED_PARAMETER_MISSING'
        });
        return;
      }

      if (value !== undefined && value !== null && value !== '') {
        // Type validation
        switch (param.type) {
          case 'string':
            if (typeof value !== 'string') {
              errors.push({
                field: `parameters.${param.name}`,
                message: `Parameter '${param.name}' must be a string`,
                code: 'INVALID_PARAMETER_TYPE'
              });
            }
            break;
          case 'number':
            if (typeof value !== 'number' && isNaN(Number(value))) {
              errors.push({
                field: `parameters.${param.name}`,
                message: `Parameter '${param.name}' must be a number`,
                code: 'INVALID_PARAMETER_TYPE'
              });
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
              errors.push({
                field: `parameters.${param.name}`,
                message: `Parameter '${param.name}' must be a boolean`,
                code: 'INVALID_PARAMETER_TYPE'
              });
            }
            break;
        }
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Create standardized error response
 */
export const createValidationErrorResponse = (message, errors, warnings = []) => {
  return formatResponse(400, {
    message,
    code: 'VALIDATION_FAILED',
    errors,
    warnings,
    timestamp: new Date().toISOString()
  });
};
