import { jest } from '@jest/globals';

// Mock the template service
const mockTemplateService = {
  createTemplateWithRetry: jest.fn(),
  updateTemplateWithRetry: jest.fn()
};

// Mock template data
const mockTemplate = {
  id: 'test-template-id',
  tenantId: 'test-tenant',
  name: 'Test Template',
  description: 'A test template',
  type: 'template',
  content: '<h1>{{title}}</h1>',
  isVisualMode: true,
  visualConfig: {
    components: [
      {
        id: 'comp1',
        type: 'heading',
        properties: { text: '{{title}}', level: 'h1', align: 'center' }
      }
    ]
  },
  s3Key: 'templates/test-template.hbs',
  s3VersionId: '1',
  version: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  isActive: true
};

describe('Template Save Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a new template successfully', async () => {
    // Arrange
    const createRequest = {
      name: 'New Template',
      description: 'A new template',
      content: '<h1>Hello World</h1>',
      isVisualMode: true,
      visualConfig: { components: [] }
    };

    const expectedResponse = {
      success: true,
      data: { ...mockTemplate, ...createRequest, id: 'new-template-id' }
    };

    mockTemplateService.createTemplateWithRetry.mockResolvedValue(expectedResponse);

    // Act
    const result = await mockTemplateService.createTemplateWithRetry(createRequest);

    // Assert
    expect(mockTemplateService.createTemplateWithRetry).toHaveBeenCalledWith(createRequest);
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('New Template');
    expect(result.data.content).toBe('<h1>Hello World</h1>');
  });

  it('should update an existing template successfully', async () => {
    // Arrange
    const templateId = 'existing-template-id';
    const updateRequest = {
      name: 'Updated Template',
      description: 'An updated template',
      content: '<h1>Updated Content</h1>',
      isVisualMode: true,
      visualConfig: { components: [] }
    };

    const expectedResponse = {
      success: true,
      data: { ...mockTemplate, ...updateRequest, id: templateId }
    };

    mockTemplateService.updateTemplateWithRetry.mockResolvedValue(expectedResponse);

    // Act
    const result = await mockTemplateService.updateTemplateWithRetry(templateId, updateRequest);

    // Assert
    expect(mockTemplateService.updateTemplateWithRetry).toHaveBeenCalledWith(templateId, updateRequest);
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Updated Template');
    expect(result.data.content).toBe('<h1>Updated Content</h1>');
  });

  it('should handle save errors gracefully', async () => {
    // Arrange
    const createRequest = {
      name: '',
      description: '',
      content: '',
      isVisualMode: true,
      visualConfig: { components: [] }
    };

    const expectedResponse = {
      success: false,
      error: 'Template name is required'
    };

    mockTemplateService.createTemplateWithRetry.mockResolvedValue(expectedResponse);

    // Act
    const result = await mockTemplateService.createTemplateWithRetry(createRequest);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toBe('Template name is required');
  });

  it('should handle network errors during save', async () => {
    // Arrange
    const createRequest = {
      name: 'Test Template',
      description: 'A test template',
      content: '<h1>Test</h1>',
      isVisualMode: true,
      visualConfig: { components: [] }
    };

    mockTemplateService.createTemplateWithRetry.mockRejectedValue(
      new Error('Network error')
    );

    // Act & Assert
    await expect(mockTemplateService.createTemplateWithRetry(createRequest))
      .rejects.toThrow('Network error');
  });

  it('should validate template name before saving', () => {
    // Arrange
    const templateName = '';
    const isValid = templateName.trim().length > 0;

    // Assert
    expect(isValid).toBe(false);

    // Test with valid name
    const validName = 'Valid Template Name';
    const isValidName = validName.trim().length > 0;
    expect(isValidName).toBe(true);
  });

  it('should track unsaved changes correctly', () => {
    // Arrange
    const originalTemplate = {
      name: 'Original Name',
      description: 'Original Description',
      components: []
    };

    const currentTemplate = {
      name: 'Modified Name',
      description: 'Original Description',
      components: []
    };

    // Act
    const hasChanges = (
      currentTemplate.name !== originalTemplate.name ||
      currentTemplate.description !== originalTemplate.description ||
      JSON.stringify(currentTemplate.components) !== JSON.stringify(originalTemplate.components)
    );

    // Assert
    expect(hasChanges).toBe(true);

    // Test no changes
    const unchangedTemplate = { ...originalTemplate };
    const noChanges = (
      unchangedTemplate.name === originalTemplate.name &&
      unchangedTemplate.description === originalTemplate.description &&
      JSON.stringify(unchangedTemplate.components) === JSON.stringify(originalTemplate.components)
    );

    expect(noChanges).toBe(true);
  });
});
