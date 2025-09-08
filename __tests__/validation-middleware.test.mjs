import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  validateRequestBody,
  validaemplateContent,
  validateSnippetContent,
  validationMiddleware,
  validatePreviewRequest,
  createValidationErrorResponse
} from '../functions/templates/utils/validation-middleware.mjs';

// Mock template engine functions
jest.mock('../functions/templates/utils/template-engine.mjs', () => ({
  validateTemplate: jest.fn(),
  validateSnippet: jest.fn()
}));

describe('Validation Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateRequestBody', () => {
    describe('createTemplate schema', () => {
      it('should validate valid template creation request', () => {
        const validBody = {
          name: 'Test Template',
          description: 'A test template',
          content: '<h1>{{title}}</h1><p>{{content}}</p>',
          category: 'newsletter',
          tags: ['test', 'newsletter'],
          isVisualMode: false
        };

        const result = validateRequestBody(validBody, 'createTemplate');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should require name and content', () => {
        const invalidBody = {
          description: 'Missing required fields'
        };

        const result = validateRequestBody(invalidBody, 'createTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'name' && e.code === 'FIELD_REQUIRED')).toBe(true);
        expect(result.errors.some(e => e.field === 'content' && e.code === 'FIELD_REQUIRED')).toBe(true);
      });

      it('should validate name format', () => {
        const invalidBody = {
          name: 'Invalid<>Name', // Contains invalid characters
          content: '<h1>{{title}}</h1>'
        };

        const result = validateRequestBody(invalidBody, 'createTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'name' && e.code === 'PATTERN_VIOLATION')).toBe(true);
      });

      it('should validate name length', () => {
        const invalidBody = {
          name: 'x'.repeat(101), // Too long
          content: '<h1>{{title}}</h1>'
        };

        const result = validateRequestBody(invalidBody, 'createTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'name' && e.code === 'MAX_LENGTH_VIOLATION')).toBe(true);
      });

      it('should validate content length', () => {
        const invalidBody = {
          name: 'Test Template',
          content: 'x'.repeat(1000001) // Too large
        };

        const result = validateRequestBody(invalidBody, 'createTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'content' && e.code === 'MAX_LENGTH_VIOLATION')).toBe(true);
      });

      it('should validate tags array', () => {
        const invalidBody = {
          name: 'Test Template',
          content: '<h1>{{title}}</h1>',
          tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) // Too many tags
        };

        const result = validateRequestBody(invalidBody, 'createTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'tags' && e.code === 'MAX_ITEMS_VIOLATION')).toBe(true);
      });

      it('should validate individual tag format', () => {
        const invalidBody = {
          name: 'Test Template',
          content: '<h1>{{title}}</h1>',
          tags: ['valid-tag', 'invalid tag!'] // Second tag has invalid characters
        };

        const result = validateRequestBody(invalidBody, 'createTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'tags[1]' && e.code === 'PATTERN_VIOLATION')).toBe(true);
      });

      it('should validate boolean fields', () => {
        const invalidBody = {
          name: 'Test Template',
          content: '<h1>{{title}}</h1>',
          isVisualMode: 'not-a-boolean'
        };

        const result = validateRequestBody(invalidBody, 'createTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'isVisualMode' && e.code === 'INVALID_TYPE')).toBe(true);
      });
    });

    describe('createSnippet schema', () => {
      it('should validate valid snippet creation request', () => {
        const validBody = {
          name: 'test-snippet',
          description: 'A test snippet',
          content: '<div>{{content}}</div>',
          parameters: [
            {
              name: 'content',
              type: 'string',
              required: true,
              description: 'The content to display'
            },
            {
              name: 'className',
              type: 'string',
              required: false,
              description: 'CSS class name'
            }
          ]
        };

        const result = validateRequestBody(validBody, 'createSnippet');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should validate snippet name format', () => {
        const invalidBody = {
          name: 'invalid snippet name!', // Contains spaces and special chars
          content: '<div>{{content}}</div>'
        };

        const result = validateRequestBody(invalidBody, 'createSnippet');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'name' && e.code === 'PATTERN_VIOLATION')).toBe(true);
      });

      it('should validate parameter structure', () => {
        const invalidBody = {
          name: 'test-snippet',
          content: '<div>{{content}}</div>',
          parameters: [
            {
              name: 'invalid-param-name!', // Invalid parameter name
              type: 'string',
              required: true
            },
            {
              name: 'validParam',
              type: 'invalid-type', // Invalid parameter type
              required: true
            }
          ]
        };

        const result = validateRequestBody(invalidBody, 'createSnippet');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.includes('parameters[0].name'))).toBe(true);
        expect(result.errors.some(e => e.field.includes('parameters[1].type'))).toBe(true);
      });

      it('should validate parameter types', () => {
        const validBody = {
          name: 'test-snippet',
          content: '<div>{{content}}</div>',
          parameters: [
            { name: 'stringParam', type: 'string', required: true },
            { name: 'numberParam', type: 'number', required: false },
            { name: 'booleanParam', type: 'boolean', required: false }
          ]
        };

        const result = validateRequestBody(validBody, 'createSnippet');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should limit number of parameters', () => {
        const invalidBody = {
          name: 'test-snippet',
          content: '<div>{{content}}</div>',
          parameters: Array.from({ length: 11 }, (_, i) => ({
            name: `param${i}`,
            type: 'string',
            required: false
          }))
        };

        const result = validateRequestBody(invalidBody, 'createSnippet');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'parameters' && e.code === 'MAX_ITEMS_VIOLATION')).toBe(true);
      });

      it('should check for duplicate parameter names', () => {
        const invalidBody = {
          name: 'test-snippet',
          content: '<div>{{content}}</div>',
          parameters: [
            { name: 'duplicateName', type: 'string', required: true },
            { name: 'duplicateName', type: 'number', required: false }
          ]
        };

        const result = validateRequestBody(invalidBody, 'createSnippet');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'parameters' && e.code === 'DUPLICATE_PARAMETER_NAMES')).toBe(true);
      });
    });

    describe('updateTemplate schema', () => {
      it('should allow partial updates', () => {
        const validBody = {
          name: 'Updated Name'
          // Only updating name, other fields optional
        };

        const result = validateRequestBody(validBody, 'updateTemplate');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should validate provided fields', () => {
        const invalidBody = {
          name: 'x'.repeat(101), // Too long
          tags: ['valid', 'invalid tag!'] // Invalid tag format
        };

        const result = validateRequestBody(invalidBody, 'updateTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'name')).toBe(true);
        expect(result.errors.some(e => e.field === 'tags[1]')).toBe(true);
      });
    });

    describe('previewTemplate schema', () => {
      it('should validate preview request', () => {
        const validBody = {
          testData: { title: 'Test', content: 'Content' },
          sendTestEmail: true,
          testEmailAddress: 'test@example.com'
        };

        const result = validateRequestBody(validBody, 'previewTemplate');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should validate email format', () => {
        const invalidBody = {
          testData: { title: 'Test' },
          sendTestEmail: true,
          testEmailAddress: 'invalid-email'
        };

        const result = validateRequestBody(invalidBody, 'previewTemplate');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'testEmailAddress' && e.code === 'PATTERN_VIOLATION')).toBe(true);
      });
    });
  });

  describe('validateTemplateContent', () => {
    it('should validate template content using template engine', async () => {
      const { validateTemplate } = jest.requireMock('../functions/templates/utils/template-engine.mjs');
      validateTemplate.mockReturnValue({
        isValid: true,
        errors: [],
        warnings: ['Some warning']
      });

      const content = '<h1>{{title}}</h1>';
      const result = await validateTemplateContent(content);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toEqual(['Some warning']);
      expect(validateTemplate).toHaveBeenCalledWith(content, { checkBestPractices: true });
    });

    it('should handle template validation errors', async () => {
      const { validateTemplate } = jest.requireMock('../functions/templates/utils/template-engine.mjs');
      validateTemplate.mockReturnValue({
        isValid: false,
        errors: [{ message: 'Invalid syntax', code: 'SYNTAX_ERROR' }],
        warnings: []
      });

      const content = '<h1>{{invalid</h1>';
      const result = await validateTemplateContent(content);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('Invalid syntax');
    });

    it('should handle template engine exceptions', async () => {
      const { validateTemplate } = jest.requireMock('../functions/templates/utils/template-engine.mjs');
      validateTemplate.mockImplementation(() => {
        throw new Error('Template engine error');
      });

      const content = '<h1>{{title}}</h1>';
      const result = await validateTemplateContent(content);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Template validation error: Template engine error');
    });
  });

  describe('validateSnippetContent', () => {
    it('should validate snippet content using template engine', async () => {
      const { validateSnippet } = jest.requireMock('../functions/templates/utils/template-engine.mjs');
      validateSnippet.mockReturnValue({
        isValid: true,
        errors: [],
        warnings: ['Parameter warning']
      });

      const content = '<div>{{content}}</div>';
      const parameters = [{ name: 'content', type: 'string', required: true }];
      const result = await validateSnippetContent(content, parameters);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toEqual(['Parameter warning']);
      expect(validateSnippet).toHaveBeenCalledWith(content, parameters, { checkBestPractices: true });
    });

    it('should handle snippet validation errors', async () => {
      const { validateSnippet } = jest.requireMock('../functions/templates/utils/template-engine.mjs');
      validateSnippet.mockReturnValue({
        isValid: false,
        errors: [{ message: 'Invalid snippet syntax', code: 'SNIPPET_SYNTAX_ERROR' }],
        warnings: []
      });

      const content = '<div>{{invalid</div>';
      const result = await validateSnippetContent(content);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('Invalid snippet syntax');
    });
  });

  describe('validationMiddleware', () => {
    it('should return null for valid request', async () => {
      const { validateTemplate } = jest.requireMock('../functions/templates/utils/template-engine.mjs');
      validateTemplate.mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      const middleware = validationMiddleware('createTemplate');
      const event = {
        body: JSON.stringify({
          name: 'Test Template',
          content: '<h1>{{title}}</h1>'
        })
      };

      const result = await middleware(event);

      expect(result).toBeNull();
    });

    it('should return error response for invalid request body', async () => {
      const middleware = validationMiddleware('createTemplate');
      const event = {
        body: JSON.stringify({
          name: '', // Invalid empty name
          content: '<h1>{{title}}</h1>'
        })
      };

      const result = await middleware(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('REQUEST_VALIDATION_FAILED');
      expect(body.errors).toBeDefined();
    });

    it('should return error response for invalid content', async () => {
      const { validateTemplate } = jest.requireMock('../functions/templates/utils/template-engine.mjs');
      validateTemplate.mockReturnValue({
        isValid: false,
        errors: [{ message: 'Invalid syntax' }],
        warnings: []
      });

      const middleware = validationMiddleware('createTemplate');
      const event = {
        body: JSON.stringify({
          name: 'Test Template',
          content: '<h1>{{invalid</h1>'
        })
      };

      const result = await middleware(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('CONTENT_VALIDATION_FAILED');
      expect(body.errors).toBeDefined();
    });

    it('should handle invalid JSON', async () => {
      const middleware = validationMiddleware('createTemplate');
      const event = {
        body: 'invalid json'
      };

      const result = await middleware(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('INVALID_REQUEST_FORMAT');
    });

    it('should handle missing body', async () => {
      const middleware = validationMiddleware('createTemplate');
      const event = {};

      const result = await middleware(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('REQUEST_VALIDATION_FAILED');
    });

    it('should log warnings for valid content with warnings', async () => {
      const { validateTemplate } = jest.requireMock('../functions/templates/utils/template-engine.mjs');
      validateTemplate.mockReturnValue({
        isValid: true,
        errors: [],
        warnings: [{ message: 'Best practice warning' }]
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const middleware = validationMiddleware('createTemplate');
      const event = {
        body: JSON.stringify({
          name: 'Test Template',
          content: '<h1>{{title}}</h1>'
        })
      };

      const result = await middleware(event);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Content validation warnings for createTemplate:',
        [{ message: 'Best practice warning' }]
      );

      consoleSpy.mockRestore();
    });
  });

  describe('validatePreviewRequest', () => {
    it('should validate template preview request', () => {
      const body = {
        testData: { title: 'Test' },
        sendTestEmail: false
      };

      const result = validatePreviewRequest(body, 'template');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require test email address when sending test email', () => {
      const body = {
        testData: { title: 'Test' },
        sendTestEmail: true
        // Missing testEmailAddress
      };

      const result = validatePreviewRequest(body, 'template');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'TEST_EMAIL_REQUIRED')).toBe(true);
    });

    it('should validate snippet parameters', () => {
      const body = {
        parameters: {
          title: 'Test Title',
          count: 5,
          visible: true
        }
      };

      const parameters = [
        { name: 'title', type: 'string', required: true },
        { name: 'count', type: 'number', required: false },
        { name: 'visible', type: 'boolean', required: false }
      ];

      const result = validatePreviewRequest(body, 'snippet', parameters);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate required snippet parameters', () => {
      const body = {
        parameters: {
          count: 5
          // Missing required title
        }
      };

      const parameters = [
        { name: 'title', type: 'string', required: true },
        { name: 'count', type: 'number', required: false }
      ];

      const result = validatePreviewRequest(body, 'snippet', parameters);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'REQUIRED_PARAMETER_MISSING')).toBe(true);
    });

    it('should validate parameter types', () => {
      const body = {
        parameters: {
          title: 123, // Should be string
          count: 'not-a-number', // Should be number
          visible: 'not-a-boolean' // Should be boolean
        }
      };

      const parameters = [
        { name: 'title', type: 'string', required: true },
        { name: 'count', type: 'number', required: false },
        { name: 'visible', type: 'boolean', required: false }
      ];

      const result = validatePreviewRequest(body, 'snippet', parameters);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'parameters.title' && e.code === 'INVALID_PARAMETER_TYPE')).toBe(true);
      expect(result.errors.some(e => e.field === 'parameters.count' && e.code === 'INVALID_PARAMETER_TYPE')).toBe(true);
      expect(result.errors.some(e => e.field === 'parameters.visible' && e.code === 'INVALID_PARAMETER_TYPE')).toBe(true);
    });

    it('should handle string representations of numbers and booleans', () => {
      const body = {
        parameters: {
          count: '5', // String representation of number
          visible: 'true' // String representation of boolean
        }
      };

      const parameters = [
        { name: 'count', type: 'number', required: false },
        { name: 'visible', type: 'boolean', required: false }
      ];

      const result = validatePreviewRequest(body, 'snippet', parameters);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('createValidationErrorResponse', () => {
    it('should create standardized error response', () => {
      const message = 'Validation failed';
      const errors = [
        { field: 'name', message: 'Name is required', code: 'FIELD_REQUIRED' }
      ];
      const warnings = [
        { field: 'content', message: 'Consider using CSS classes', code: 'BEST_PRACTICE' }
      ];

      const response = createValidationErrorResponse(message, errors, warnings);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toBe(message);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.errors).toEqual(errors);
      expect(body.warnings).toEqual(warnings);
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should handle empty warnings array', () => {
      const message = 'Validation failed';
      const errors = [
        { field: 'name', message: 'Name is required', code: 'FIELD_REQUIRED' }
      ];

      const response = createValidationErrorResponse(message, errors);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.warnings).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle unknown validation schema', () => {
      expect(() => {
        validateRequestBody({}, 'unknownSchema');
      }).toThrow('Unknown validation schema: unknownSchema');
    });

    it('should handle null values in request body', () => {
      const body = {
        name: null,
        content: '<h1>{{title}}</h1>',
        description: null,
        tags: null
      };

      const result = validateRequestBody(body, 'createTemplate');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'FIELD_REQUIRED')).toBe(true);
    });

    it('should handle undefined values in request body', () => {
      const body = {
        name: undefined,
        content: '<h1>{{title}}</h1>'
      };

      const result = validateRequestBody(body, 'createTemplate');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'FIELD_REQUIRED')).toBe(true);
    });

    it('should handle empty arrays', () => {
      const body = {
        name: 'Test Template',
        content: '<h1>{{title}}</h1>',
        tags: []
      };

      const result = validateRequestBody(body, 'createTemplate');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle very long field values', () => {
      const body = {
        name: 'Test Template',
        content: '<h1>{{title}}</h1>',
        description: 'x'.repeat(501) // Exceeds 500 char limit
      };

      const result = validateRequestBody(body, 'createTemplate');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'description' && e.code === 'MAX_LENGTH_VIOLATION')).toBe(true);
    });
  });
});
