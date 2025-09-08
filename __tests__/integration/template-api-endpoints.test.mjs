import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock AWS SDK instances
const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();
const mockEventBridgeSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDdbSend })),
  GetItemCommand: jest.fn((params) => params),
  PutItemCommand: jest.fn((params) => params),
  QueryCommand: jest.fn((params) => params),
  UpdateItemCommand: jest.fn((params) => params),
  DeleteItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => params),
  PutObjectCommand: jest.fn((params) => params),
  DeleteObjectCommand: jest.fn((params) => params),
  ListObjectVersionsCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn((params) => params)
}));

// Mock auth functions
jest.unstable_mockModule('../functions/auth/jwt-verifier.mjs', () => ({
  verifyJWT: jest.fn()
}));

jest.unstable_mockModule('../functions/auth/validate-api-key.mjs', () => ({
  validateApiKey: jest.fn()
}));

// Import handlers after mocks
const { handler: listTemplatesHandler } = await import('../functions/templates/list-templates.mjs');
const { handler: getTemplateHandler } = await import('../functions/templates/get-template.mjs');
const { handler: createTemplateHandler } = await import('../functions/templates/create-template.mjs');
const { handler: updateTemplateHandler } = await import('../functions/templates/update-template.mjs');
const { handler: deleteTemplateHandler } = await import('../functions/templates/delete-template.mjs');
const { handler: previewTemplateHandler } = await import('../functions/templates/preview-template.mjs');

const { handler: listSnippetsHandler } = await import('../functions/templates/list-snippets.mjs');
const { handler: getSntHandler } = await import('../functions/templates/get-snippet.mjs');
const { handler: createSnippetHandler } = await import('../functions/templates/create-snippet.mjs');
const { handler: updateSnippetHandler } = await import('../functions/templates/update-snippet.mjs');
const { handler: deleteSnippetHandler } = await import('../functions/templates/delete-snippet.mjs');
const { handler: previewSnippetHandler } = await import('../functions/templates/preview-snippet.mjs');

describe('Template API Endpoints Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEMPLATES_TABLE_NAME = 'test-templates-table';
    process.env.TEMPLATES_BUCKET_NAME = 'test-templates-bucket';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
  });

  afterEach(() => {
    delete process.env.TEMPLATES_TABLE_NAME;
    delete process.env.TEMPLATES_BUCKET_NAME;
    delete process.env.EVENT_BUS_NAME;
  });

  describe('Template CRUD Operations', () => {
    describe('Cognito Authentication', () => {
      beforeEach(() => {
        const { verifyJWT } = jest.requireMock('../functions/auth/jwt-verifier.mjs');
        verifyJWT.mockResolvedValue({
          'custom:tenantId': 'tenant-123',
          sub: 'user-456',
          email: 'test@example.com'
        });
      });

      describe('List Templates', () => {
        it('should list templates for authenticated user', async () => {
          mockDdbSend.mockResolvedValue({
            Items: [
              {
                id: 'template-1',
                name: 'Newsletter Template',
                description: 'Monthly newsletter',
                category: 'newsletter',
                tags: ['monthly', 'news'],
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
                createdBy: 'user-456'
              },
              {
                id: 'template-2',
                name: 'Welcome Email',
                description: 'Welcome new users',
                category: 'welcome',
                tags: ['onboarding'],
                createdAt: '2024-01-02T00:00:00Z',
                updatedAt: '2024-01-02T00:00:00Z',
                createdBy: 'user-456'
              }
            ],
            Count: 2
          });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            queryStringParameters: { limit: '10' }
          };

          const result = await listTemplatesHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.templates).toHaveLength(2);
          expect(body.templates[0].name).toBe('Newsletter Template');
          expect(body.pagination.total).toBe(2);
        });

        it('should filter templates by category', async () => {
          mockDdbSend.mockResolvedValue({
            Items: [
              {
                id: 'template-1',
                name: 'Newsletter Template',
                category: 'newsletter'
              }
            ],
            Count: 1
          });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            queryStringParameters: { category: 'newsletter' }
          };

          const result = await listTemplatesHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.templates).toHaveLength(1);
          expect(body.templates[0].category).toBe('newsletter');
        });

        it('should handle pagination', async () => {
          mockDdbSend.mockResolvedValue({
            Items: [{ id: 'template-1', name: 'Template 1' }],
            Count: 1,
            LastEvaluatedKey: { PK: 'tenant-123#template-1', SK: 'template' }
          });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            queryStringParameters: { limit: '1' }
          };

          const result = await listTemplatesHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.pagination.hasMore).toBe(true);
          expect(body.pagination.cursor).toBeDefined();
        });
      });

      describe('Get Template', () => {
        it('should get template with content', async () => {
          const mockTemplate = {
            id: 'template-123',
            name: 'Test Template',
            description: 'Test description',
            tenantId: 'tenant-123',
            s3Key: 'templates/tenant-123/template-123.hbs',
            s3VersionId: 'version-123',
            snippets: ['header-snippet', 'footer-snippet'],
            createdBy: 'user-456'
          };

          mockDdbSend.mockResolvedValue({
            Item: mockTemplate
          });

          mockS3Send.mockResolvedValue({
            Body: {
              transformToString: () => Promise.resolve('<h1>{{title}}</h1>{{> header-snippet}}<p>{{content}}</p>{{> footer-snippet}}')
            }
          });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'template-123' }
          };

          const result = await getTemplateHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.template.id).toBe('template-123');
          expect(body.template.name).toBe('Test Template');
          expect(body.template.content).toContain('{{title}}');
          expect(body.template.snippets).toEqual(['header-snippet', 'footer-snippet']);
        });

        it('should return 404 for non-existent template', async () => {
          mockDdbSend.mockResolvedValue({
            Item: null
          });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'non-existent' }
          };

          const result = await getTemplateHandler(event);

          expect(result.statusCode).toBe(404);
          const body = JSON.parse(result.body);
          expect(body.message).toBe('Template not found');
        });

        it('should handle S3 content retrieval errors', async () => {
          mockDdbSend.mockResolvedValue({
            Item: {
              id: 'template-123',
              tenantId: 'tenant-123',
              s3Key: 'templates/tenant-123/template-123.hbs'
            }
          });

          mockS3Send.mockRejectedValue(new Error('S3 access denied'));

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'template-123' }
          };

          const result = await getTemplateHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.template.content).toBe('');
          expect(body.warnings).toContain('Failed to load template content');
        });
      });

      describe('Create Template', () => {
        it('should create template successfully', async () => {
          mockDdbSend.mockResolvedValue({});
          mockS3Send.mockResolvedValue({
            VersionId: 'version-123',
            ETag: 'etag-123'
          });
          mockEventBridgeSend.mockResolvedValue({});

          const templateData = {
            name: 'New Template',
            description: 'A new template',
            content: '<h1>{{title}}</h1><p>{{content}}</p>',
            category: 'newsletter',
            tags: ['test', 'new']
          };

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            body: JSON.stringify(templateData)
          };

          const result = await createTemplateHandler(event);

          expect(result.statusCode).toBe(201);
          const body = JSON.parse(result.body);
          expect(body.template.name).toBe('New Template');
          expect(body.template.id).toBeDefined();
          expect(body.template.s3Key).toContain('templates/tenant-123/');
          expect(body.template.s3VersionId).toBe('version-123');
        });

        it('should validate template content', async () => {
          const templateData = {
            name: 'Invalid Template',
            content: '<h1>{{title</h1>' // Invalid handlebars syntax
          };

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            body: JSON.stringify(templateData)
          };

          const result = await createTemplateHandler(event);

          expect(result.statusCode).toBe(400);
          const body = JSON.parse(result.body);
          expect(body.code).toBe('TEMPLATE_VALIDATION_FAILED');
          expect(body.errors).toBeDefined();
        });

        it('should require name and content', async () => {
          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            body: JSON.stringify({ description: 'Missing required fields' })
          };

          const result = await createTemplateHandler(event);

          expect(result.statusCode).toBe(400);
          const body = JSON.parse(result.body);
          expect(body.message).toContain('Name and content are required');
        });

        it('should handle DynamoDB errors', async () => {
          mockDdbSend.mockRejectedValue(new Error('DynamoDB error'));

          const templateData = {
            name: 'Test Template',
            content: '<h1>{{title}}</h1>'
          };

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            body: JSON.stringify(templateData)
          };

          const result = await createTemplateHandler(event);

          expect(result.statusCode).toBe(500);
          const body = JSON.parse(result.body);
          expect(body.message).toContain('Failed to create template');
        });
      });

      describe('Update Template', () => {
        it('should update template successfully', async () => {
          const existingTemplate = {
            id: 'template-123',
            name: 'Old Name',
            tenantId: 'tenant-123',
            version: 1
          };

          mockDdbSend
            .mockResolvedValueOnce({ Item: existingTemplate }) // Get existing
            .mockResolvedValueOnce({}); // Update

          mockS3Send.mockResolvedValue({
            VersionId: 'version-124',
            ETag: 'etag-124'
          });

          mockEventBridgeSend.mockResolvedValue({});

          const updateData = {
            name: 'Updated Name',
            content: '<h1>{{title}}</h1><p>Updated content: {{content}}</p>',
            description: 'Updated description'
          };

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'template-123' },
            body: JSON.stringify(updateData)
          };

          const result = await updateTemplateHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.template.name).toBe('Updated Name');
          expect(body.template.version).toBe(2);
          expect(body.template.s3VersionId).toBe('version-124');
        });

        it('should return 404 for non-existent template', async () => {
          mockDdbSend.mockResolvedValue({ Item: null });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'non-existent' },
            body: JSON.stringify({ name: 'Updated Name' })
          };

          const result = await updateTemplateHandler(event);

          expect(result.statusCode).toBe(404);
        });

        it('should validate updated content', async () => {
          const existingTemplate = {
            id: 'template-123',
            tenantId: 'tenant-123'
          };

          mockDdbSend.mockResolvedValue({ Item: existingTemplate });

          const updateData = {
            content: '<h1>{{invalid</h1>' // Invalid handlebars
          };

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'template-123' },
            body: JSON.stringify(updateData)
          };

          const result = await updateTemplateHandler(event);

          expect(result.statusCode).toBe(400);
          const body = JSON.parse(result.body);
          expect(body.code).toBe('TEMPLATE_VALIDATION_FAILED');
        });
      });

      describe('Delete Template', () => {
        it('should delete template successfully', async () => {
          const existingTemplate = {
            id: 'template-123',
            name: 'Template to Delete',
            tenantId: 'tenant-123',
            s3Key: 'templates/tenant-123/template-123.hbs'
          };

          mockDdbSend
            .mockResolvedValueOnce({ Item: existingTemplate }) // Get existing
            .mockResolvedValueOnce({}); // Delete

          mockS3Send.mockResolvedValue({
            VersionId: 'delete-marker-123'
          });

          mockEventBridgeSend.mockResolvedValue({});

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'template-123' }
          };

          const result = await deleteTemplateHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.message).toBe('Template deleted successfully');
          expect(body.templateId).toBe('template-123');
        });

        it('should return 404 for non-existent template', async () => {
          mockDdbSend.mockResolvedValue({ Item: null });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'non-existent' }
          };

          const result = await deleteTemplateHandler(event);

          expect(result.statusCode).toBe(404);
        });
      });

      describe('Preview Template', () => {
        it('should preview template with test data', async () => {
          const mockTemplate = {
            id: 'template-123',
            name: 'Test Template',
            tenantId: 'tenant-123',
            s3Key: 'templates/tenant-123/template-123.hbs',
            snippets: ['header-snippet']
          };

          mockDdbSend
            .mockResolvedValueOnce({ Item: mockTemplate }) // Get template
            .mockResolvedValueOnce({ // Get snippets
              Items: [{
                id: 'header-snippet',
                name: 'header-snippet',
                s3Key: 'snippets/tenant-123/header-snippet.hbs'
              }]
            });

          mockS3Send
            .mockResolvedValueOnce({ // Get template content
              Body: {
                transformToString: () => Promise.resolve('{{> header-snippet}}<h1>{{title}}</h1><p>{{content}}</p>')
              }
            })
            .mockResolvedValueOnce({ // Get snippet content
              Body: {
                transformToString: () => Promise.resolve('<header>{{siteName}}</header>')
              }
            });

          const testData = {
            title: 'Test Title',
            content: 'Test content',
            siteName: 'My Site'
          };

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'template-123' },
            body: JSON.stringify({ testData })
          };

          const result = await previewTemplateHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.templateId).toBe('template-123');
          expect(body.renderedHtml).toContain('<header>My Site</header>');
          expect(body.renderedHtml).toContain('<h1>Test Title</h1>');
          expect(body.validation.isValid).toBe(true);
        });

        it('should send test email when requested', async () => {
          const mockTemplate = {
            id: 'template-123',
            tenantId: 'tenant-123',
            s3Key: 'templates/tenant-123/template-123.hbs'
          };

          mockDdbSend.mockResolvedValue({ Item: mockTemplate });
          mockS3Send.mockResolvedValue({
            Body: {
              transformToString: () => Promise.resolve('<h1>{{title}}</h1>')
            }
          });

          // Mock SES send
          const mockSesSend = jest.fn().mockResolvedValue({});
          jest.doMock('@aws-sdk/client-ses', () => ({
            SESClient: jest.fn(() => ({ send: mockSesSend })),
            SendEmailCommand: jest.fn((params) => params)
          }));

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { templateId: 'template-123' },
            body: JSON.stringify({
              testData: { title: 'Test Email' },
              sendTestEmail: true,
              testEmailAddress: 'test@example.com'
            })
          };

          const result = await previewTemplateHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.testEmailSent).toBe(true);
          expect(body.testEmailAddress).toBe('test@example.com');
        });
      });
    });

    describe('API Key Authentication', () => {
      beforeEach(() => {
        const { validateApiKey } = jest.requireMock('../functions/auth/validate-api-key.mjs');
        validateApiKey.mockResolvedValue({
          tenantId: 'tenant-456',
          apiKeyId: 'api-key-789',
          permissions: ['templates:read', 'templates:write']
        });
      });

      it('should list templates with API key auth', async () => {
        mockDdbSend.mockResolvedValue({
          Items: [
            {
              id: 'template-1',
              name: 'API Template',
              tenantId: 'tenant-456'
            }
          ],
          Count: 1
        });

        const event = {
          headers: { 'X-API-Key': 'valid-api-key' },
          queryStringParameters: {}
        };

        const result = await listTemplatesHandler(event);

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body.templates).toHaveLength(1);
        expect(body.templates[0].name).toBe('API Template');
        // API key auth should not include user-specific fields
        expect(body.templates[0].createdBy).toBeUndefined();
      });

      it('should create template with API key auth', async () => {
        mockDdbSend.mockResolvedValue({});
        mockS3Send.mockResolvedValue({
          VersionId: 'version-123',
          ETag: 'etag-123'
        });
        mockEventBridgeSend.mockResolvedValue({});

        const templateData = {
          name: 'API Template',
          content: '<h1>{{title}}</h1>'
        };

        const event = {
          headers: { 'X-API-Key': 'valid-api-key' },
          body: JSON.stringify(templateData)
        };

        const result = await createTemplateHandler(event);

        expect(result.statusCode).toBe(201);
        const body = JSON.parse(result.body);
        expect(body.template.name).toBe('API Template');
        expect(body.template.apiKeyId).toBe('api-key-789');
        expect(body.template.createdBy).toBeUndefined();
      });

      it('should handle insufficient permissions', async () => {
        const { validateApiKey } = jest.requireMock('../functions/auth/validate-api-key.mjs');
        validateApiKey.mockResolvedValue({
          tenantId: 'tenant-456',
          apiKeyId: 'api-key-789',
          permissions: ['templates:read'] // No write permission
        });

        const templateData = {
          name: 'API Template',
          content: '<h1>{{title}}</h1>'
        };

        const event = {
          headers: { 'X-API-Key': 'limited-api-key' },
          body: JSON.stringify(templateData)
        };

        const result = await createTemplateHandler(event);

        expect(result.statusCode).toBe(403);
        const body = JSON.parse(result.body);
        expect(body.message).toContain('Insufficient permissions');
      });
    });
  });

  describe('Snippet CRUD Operations', () => {
    describe('Cognito Authentication', () => {
      beforeEach(() => {
        const { verifyJWT } = jest.requireMock('../functions/auth/jwt-verifier.mjs');
        verifyJWT.mockResolvedValue({
          'custom:tenantId': 'tenant-123',
          sub: 'user-456',
          email: 'test@example.com'
        });
      });

      describe('Create Snippet', () => {
        it('should create snippet with parameters', async () => {
          mockDdbSend.mockResolvedValue({});
          mockS3Send.mockResolvedValue({
            VersionId: 'version-123',
            ETag: 'etag-123'
          });
          mockEventBridgeSend.mockResolvedValue({});

          const snippetData = {
            name: 'card-snippet',
            description: 'A reusable card component',
            content: '<div class="card {{className}}"><h3>{{title}}</h3><p>{{content}}</p></div>',
            parameters: [
              { name: 'title', type: 'string', required: true, description: 'Card title' },
              { name: 'content', type: 'string', required: true, description: 'Card content' },
              { name: 'className', type: 'string', required: false, defaultValue: '', description: 'Additional CSS classes' }
            ]
          };

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            body: JSON.stringify(snippetData)
          };

          const result = await createSnippetHandler(event);

          expect(result.statusCode).toBe(201);
          const body = JSON.parse(result.body);
          expect(body.snippet.name).toBe('card-snippet');
          expect(body.snippet.parameters).toHaveLength(3);
          expect(body.snippet.parameters[0].name).toBe('title');
        });

        it('should validate snippet parameters', async () => {
          const snippetData = {
            name: 'invalid-snippet',
            content: '<div>{{title}}</div>',
            parameters: [
              { name: 'invalid-name!', type: 'string', required: true } // Invalid parameter name
            ]
          };

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            body: JSON.stringify(snippetData)
          };

          const result = await createSnippetHandler(event);

          expect(result.statusCode).toBe(400);
          const body = JSON.parse(result.body);
          expect(body.code).toBe('REQUEST_VALIDATION_FAILED');
        });
      });

      describe('Preview Snippet', () => {
        it('should preview snippet with parameters', async () => {
          const mockSnippet = {
            id: 'snippet-123',
            name: 'card-snippet',
            tenantId: 'tenant-123',
            s3Key: 'snippets/tenant-123/snippet-123.hbs',
            parameters: [
              { name: 'title', type: 'string', required: true },
              { name: 'content', type: 'string', required: true }
            ]
          };

          mockDdbSend.mockResolvedValue({ Item: mockSnippet });
          mockS3Send.mockResolvedValue({
            Body: {
              transformToString: () => Promise.resolve('<div class="card"><h3>{{title}}</h3><p>{{content}}</p></div>')
            }
          });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { snippetId: 'snippet-123' },
            body: JSON.stringify({
              parameters: {
                title: 'Test Card',
                content: 'This is test content'
              }
            })
          };

          const result = await previewSnippetHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.snippetId).toBe('snippet-123');
          expect(body.renderedHtml).toBe('<div class="card"><h3>Test Card</h3><p>This is test content</p></div>');
        });

        it('should validate required parameters', async () => {
          const mockSnippet = {
            id: 'snippet-123',
            tenantId: 'tenant-123',
            parameters: [
              { name: 'title', type: 'string', required: true }
            ]
          };

          mockDdbSend.mockResolvedValue({ Item: mockSnippet });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { snippetId: 'snippet-123' },
            body: JSON.stringify({
              parameters: {} // Missing required parameter
            })
          };

          const result = await previewSnippetHandler(event);

          expect(result.statusCode).toBe(400);
          const body = JSON.parse(result.body);
          expect(body.code).toBe('VALIDATION_FAILED');
          expect(body.errors.some(e => e.code === 'REQUIRED_PARAMETER_MISSING')).toBe(true);
        });
      });

      describe('Delete Snippet with Dependency Check', () => {
        it('should prevent deletion of snippet used in templates', async () => {
          const mockSnippet = {
            id: 'snippet-123',
            name: 'header-snippet',
            tenantId: 'tenant-123'
          };

          mockDdbSend
            .mockResolvedValueOnce({ Item: mockSnippet }) // Get snippet
            .mockResolvedValueOnce({ // Check template dependencies
              Items: [
                { id: 'template-1', name: 'Newsletter Template' },
                { id: 'template-2', name: 'Welcome Email' }
              ]
            });

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { snippetId: 'snippet-123' }
          };

          const result = await deleteSnippetHandler(event);

          expect(result.statusCode).toBe(409);
          const body = JSON.parse(result.body);
          expect(body.code).toBe('SNIPPET_IN_USE');
          expect(body.dependentTemplates).toHaveLength(2);
          expect(body.dependentTemplates[0].name).toBe('Newsletter Template');
        });

        it('should delete snippet when not used in templates', async () => {
          const mockSnippet = {
            id: 'snippet-123',
            name: 'unused-snippet',
            tenantId: 'tenant-123',
            s3Key: 'snippets/tenant-123/snippet-123.hbs'
          };

          mockDdbSend
            .mockResolvedValueOnce({ Item: mockSnippet }) // Get snippet
            .mockResolvedValueOnce({ Items: [] }) // No dependencies
            .mockResolvedValueOnce({}); // Delete snippet

          mockS3Send.mockResolvedValue({
            VersionId: 'delete-marker-123'
          });

          mockEventBridgeSend.mockResolvedValue({});

          const event = {
            headers: { Authorization: 'Bearer valid-jwt-token' },
            pathParameters: { snippetId: 'snippet-123' }
          };

          const result = await deleteSnippetHandler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body);
          expect(body.message).toBe('Snippet deleted successfully');
        });
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      const { verifyJWT } = jest.requireMock('../functions/auth/jwt-verifier.mjs');
      verifyJWT.mockResolvedValue({
        'custom:tenantId': 'tenant-123',
        sub: 'user-456'
      });
    });

    it('should handle missing authentication', async () => {
      const event = {
        headers: {},
        pathParameters: { templateId: 'template-123' }
      };

      const result = await getTemplateHandler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Authentication required');
    });

    it('should handle invalid JSON in request body', async () => {
      const event = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: 'invalid json'
      };

      const result = await createTemplateHandler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('INVALID_REQUEST_FORMAT');
    });

    it('should handle DynamoDB service errors', async () => {
      mockDdbSend.mockRejectedValue(new Error('Service unavailable'));

      const event = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        queryStringParameters: {}
      };

      const result = await listTemplatesHandler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Internal server error');
    });

    it('should handle S3 service errors', async () => {
      mockDdbSend.mockResolvedValue({
        Item: {
          id: 'template-123',
          tenantId: 'tenant-123',
          s3Key: 'templates/tenant-123/template-123.hbs'
        }
      });

      mockS3Send.mockRejectedValue(new Error('Access denied'));

      const event = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: 'template-123' }
      };

      const result = await getTemplateHandler(event);

      // Should still return 200 but with warning about content
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.template.content).toBe('');
      expect(body.warnings).toContain('Failed to load template content');
    });
  });

  describe('Cross-tenant Access Prevention', () => {
    beforeEach(() => {
      const { verifyJWT } = jest.requireMock('../functions/auth/jwt-verifier.mjs');
      verifyJWT.mockResolvedValue({
        'custom:tenantId': 'tenant-123',
        sub: 'user-456'
      });
    });

    it('should prevent access to templates from other tenants', async () => {
      mockDdbSend.mockResolvedValue({
        Item: {
          id: 'template-123',
          tenantId: 'tenant-456', // Different tenant
          name: 'Other Tenant Template'
        }
      });

      const event = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: 'template-123' }
      };

      const result = await getTemplateHandler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Access denied');
    });

    it('should prevent updating templates from other tenants', async () => {
      mockDdbSend.mockResolvedValue({
        Item: {
          id: 'template-123',
          tenantId: 'tenant-456', // Different tenant
          name: 'Other Tenant Template'
        }
      });

      const event = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: 'template-123' },
        body: JSON.stringify({ name: 'Updated Name' })
      };

      const result = await updateTemplateHandler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Access denied');
    });
  });
});
