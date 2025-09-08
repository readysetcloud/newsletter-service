import { jest } from '@jest/globals';

// Mock instances
const ddbInstance = { send: jest.fn() };
const s3Instance = { send: jest.fn() };
const eventBridgeInstance = { send: jest.fn() };

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ddbInstance),
  GetItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => ({
    id: 'template-123',
    name: 'Test Template',
    s3Key: 'templates/tenant1/template-123.hbs',
    s3VersionId: 'version-123',
    snippets: ['snippet1', 'snippet2']
  }))
}));

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => s3Instance),
  GetObjectCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => eventBridgeInstance),
  PutEventsCommand: jest.fn((params) => params)
}));

// Mock template engine
jest.unstable_mockModule('../functions/templates/utils/template-engine.mjs', () => ({
  renderTemplate: jest.fn(),
  validateTemplate: jest.fn()
}));

// Mock auth functions
jest.unstable_mockModule('../functions/auth/jwt-verifier.mjs', () => ({
  verifyJWT: jest.fn()
}));

jest.unstable_mockModule('../functions/auth/validate-api-key.mjs', () => ({
  validateApiKey: jest.fn()
}));

// Import after mocks
const { handler } = await import('../functions/templates/preview-template.mjs');

describe('Preview Template Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEMPLATES_TABLE_NAME = 'test-templates-table';
    process.env.TEMPLATES_BUCKET_NAME = 'test-templates-bucket';
  });

  const mockTemplate = {
    id: 'template-123',
    name: 'Test Template',
    s3Key: 'templates/tenant1/template-123.hbs',
    s3VersionId: 'version-123',
    snippets: ['snippet1', 'snippet2']
  };

  const mockTemplateContent = '<h1>{{title}}</h1><p>{{content}}</p>{{> snippet1}}';
  const mockRenderedHtml = '<h1>Test Title</h1><p>Test Content</p><div>Snippet Content</div>';

  test('should preview template with Cognito authentication', async () => {
    // Mock JWT verification
    const { verifyJWT } = await import('../functions/auth/jwt-verifier.mjs');
    verifyJWT.mockResolvedValue({
      'custom:tenantId': 'tenant1',
      sub: 'user123'
    });

    // Mock DynamoDB response
    ddbInstance.send.mockResolvedValue({
      Item: mockTemplate
    });

    // Mock S3 response
    s3Instance.send.mockResolvedValue({
      Body: {
        transformToString: () => Promise.resolve(mockTemplateContent)
      }
    });

    // Mock template engine
    const { renderTemplate, validateTemplate } = await import('../functions/templates/utils/template-engine.mjs');
    validateTemplate.mockReturnValue({ isValid: true, errors: [] });
    renderTemplate.mockResolvedValue(mockRenderedHtml);

    const event = {
      pathParameters: { templateId: 'template-123' },
      headers: { Authorization: 'Bearer valid-jwt-token' },
      body: JSON.stringify({
        testData: { title: 'Test Title', content: 'Test Content' }
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.templateId).toBe('template-123');
    expect(responseBody.templateName).toBe('Test Template');
    expect(responseBody.renderedHtml).toBe(mockRenderedHtml);
    expect(responseBody.validation.isValid).toBe(true);
    expect(responseBody.validation.snippetsUsed).toEqual(['snippet1', 'snippet2']);
  });

  test('should return 401 for missing authentication', async () => {
    const event = {
      pathParameters: { templateId: 'template-123' },
      headers: {},
      body: JSON.stringify({
        testData: { title: 'Test Title' }
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.error).toBe('Authentication required');
  });
});
