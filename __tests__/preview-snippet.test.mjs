import { jest } from '@jest/globals';

// Mock instances
const ddbInstance = { send: jest.fn() };
const s3Instance = { send: jest.fn() };

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ddbInstance),
  GetItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => ({
    id: 'snippet-123',
    name: 'Test Snippet',
    s3Key: 'snippets/tenant1/snippet-123.hbs',
    s3VersionId: 'version-123',
    parameters: [
      { name: 'title', type: 'string', required: true },
      { name: 'count', type: 'number', required: false, defaultValue: 1 },
      { name: 'visible', type: 'boolean', required: false, defaultValue: true }
    ]
  }))
}));

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => s3Instance),
  GetObjectCommand: jest.fn((params) => params)
}));

// Mock Handlebars
jest.unstable_mockModule('handlebars', () => ({
  default: {
    compile: jest.fn()
  }
}));

// Mock auth functions
jest.unstable_mockModule('../functions/auth/jwt-verifier.mjs', () => ({
  verifyJWT: jest.fn()
}));

jest.unstable_mockModule('../functions/auth/validate-api-key.mjs', () => ({
  validateApiKey: jest.fn()
}));

// Import after mocks
const { handler } = await import('../functions/templates/preview-snippet.mjs');

describe('Preview Snippet Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEMPLATES_TABLE_NAME = 'test-templates-table';
    process.env.TEMPLATES_BUCKET_NAME = 'test-templates-bucket';
  });

  const mockSnippetContent = '<div class="snippet"><h3>{{title}}</h3><p>Count: {{count}}</p>{{#if visible}}<span>Visible</span>{{/if}}</div>';
  const mockRenderedHtml = '<div class="snippet"><h3>Test Title</h3><p>Count: 5</p><span>Visible</span></div>';

  test('should preview snippet with Cognito authentication', async () => {
    // Mock JWT verification
    const { verifyJWT } = await import('../functions/auth/jwt-verifier.mjs');
    verifyJWT.mockResolvedValue({
      'custom:tenantId': 'tenant1',
      sub: 'user123'
    });

    // Mock DynamoDB response
    ddbInstance.send.mockResolvedValue({
      Item: {}
    });

    // Mock S3 response
    s3Instance.send.mockResolvedValue({
      Body: {
        transformToString: () => Promise.resolve(mockSnippetContent)
      }
    });

    // Mock Handlebars compilation
    const Handlebars = await import('handlebars');
    const mockTemplate = jest.fn().mockReturnValue(mockRenderedHtml);
    Handlebars.default.compile.mockReturnValue(mockTemplate);

    const event = {
      pathParameters: { snippetId: 'snippet-123' },
      headers: { Authorization: 'Bearer valid-jwt-token' },
      body: JSON.stringify({
        parameters: {
          title: 'Test Title',
          count: 5,
          visible: true
        }
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.snippetId).toBe('snippet-123');
    expect(responseBody.snippetName).toBe('Test Snippet');
    expect(responseBody.renderedHtml).toBe(mockRenderedHtml);
  });

  test('should return 401 for missing authentication', async () => {
    const event = {
      pathParameters: { snippetId: 'snippet-123' },
      headers: {},
      body: JSON.stringify({
        parameters: { title: 'Test Title' }
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.error).toBe('Authentication required');
  });
});
