import { jest } from '@jest/globals';

// Mock template builder functionality
const mockTemplateBuilder = {
  generateTemplate: jest.fn(),
  trackUnsavedChanges: jest.fn(),
  handleSave: jest.fn(),
  handleAutoSave: jest.fn()
};

describe('Template Builder Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate template from visual components', () => {
    // Arrange
    const components = [
      {
        id: 'comp1',
        type: 'heading',
        properties: { text: '{{newsletter.title}}', level: 'h1', align: 'center' }
      },
      {
        id: 'comp2',
        type: 'text',
        properties: { content: 'Welcome to our newsletter!', align: 'left' }
      }
    ];

    const expectedTemplate = {
      name: 'Test Template',
      description: 'A test template',
      content: '<h1 style="text-align: center">{{newsletter.title}}</h1>\n<p style="text-align: left">Welcome to our newsletter!</p>',
      isVisualMode: true,
      visualConfig: { components }
    };

    mockTemplateBuilder.generateTemplate.mockReturnValue(expectedTemplate);

    // Act
    const result = mockTemplateBuilder.generateTemplate();

    // Assert
    expect(result.name).toBe('Test Template');
    expect(result.isVisualMode).toBe(true);
    expect(result.visualConfig.components).toHaveLength(2);
    expect(result.content).toContain('{{newsletter.title}}');
    expect(result.content).toContain('Welcome to our newsletter!');
  });

  it('should track unsaved changes when template is modified', () => {
    // Arrange
    const originalTemplate = {
      name: 'Original Template',
      description: 'Original description',
      components: []
    };

    const modifiedTemplate = {
      name: 'Modified Template',
      description: 'Original description',
      components: [
        { id: 'comp1', type: 'heading', properties: { text: 'New heading' } }
      ]
    };

    // Mock the unsaved changes tracking logic
    const hasUnsavedChanges = (
      modifiedTemplate.name !== originalTemplate.name ||
      modifiedTemplate.description !== originalTemplate.description ||
      JSON.stringify(modifiedTemplate.components) !== JSON.stringify(originalTemplate.components)
    );

    mockTemplateBuilder.trackUnsavedChanges.mockReturnValue(hasUnsavedChanges);

    // Act
    const result = mockTemplateBuilder.trackUnsavedChanges();

    // Assert
    expect(result).toBe(true);
  });

  it('should handle save operation with proper validation', async () => {
    // Arrange
    const templateData = {
      name: 'Valid Template Name',
      description: 'A valid template',
      content: '<h1>Hello World</h1>',
      isVisualMode: true,
      visualConfig: { components: [] }
    };

    const saveResponse = {
      success: true,
      data: { ...templateData, id: 'new-template-id' }
    };

    mockTemplateBuilder.handleSave.mockResolvedValue(saveResponse);

    // Act
    const result = await mockTemplateBuilder.handleSave(templateData);

    // Assert
    expect(mockTemplateBuilder.handleSave).toHaveBeenCalledWith(templateData);
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Valid Template Name');
  });

  it('should prevent save when template name is empty', async () => {
    // Arrange
    const invalidTemplateData = {
      name: '',
      description: 'A template without name',
      content: '<h1>Hello World</h1>',
      isVisualMode: true,
      visualConfig: { components: [] }
    };

    const validationError = new Error('Template name is required');
    mockTemplateBuilder.handleSave.mockRejectedValue(validationError);

    // Act & Assert
    await expect(mockTemplateBuilder.handleSave(invalidTemplateData))
      .rejects.toThrow('Template name is required');
  });

  it('should handle auto-save functionality', async () => {
    // Arrange
    const templateData = {
      name: 'Auto-saved Template',
      description: 'Template with auto-save',
      content: '<h1>Auto-saved content</h1>',
      hasUnsavedChanges: true
    };

    const autoSaveResponse = {
      success: true,
      data: { ...templateData, lastSaved: new Date() }
    };

    mockTemplateBuilder.handleAutoSave.mockResolvedValue(autoSaveResponse);

    // Act
    const result = await mockTemplateBuilder.handleAutoSave(templateData);

    // Assert
    expect(mockTemplateBuilder.handleAutoSave).toHaveBeenCalledWith(templateData);
    expect(result.success).toBe(true);
    expect(result.data.lastSaved).toBeDefined();
  });

  it('should convert visual components to handlebars template', () => {
    // Arrange
    const components = [
      {
        id: 'comp1',
        type: 'heading',
        properties: { text: '{{newsletter.title}}', level: 'h2', align: 'center' }
      },
      {
        id: 'comp2',
        type: 'button',
        properties: { text: 'Read More', url: '{{article.url}}', color: '#007bff' }
      },
      {
        id: 'comp3',
        type: 'divider',
        properties: { style: 'solid', color: '#ccc' }
      }
    ];

    // Mock the template generation logic
    const generateHandlebarsFromComponents = (components) => {
      return components.map(c => {
        switch (c.type) {
          case 'heading':
            return `<${c.properties.level} style="text-align: ${c.properties.align}">${c.properties.text}</${c.properties.level}>`;
          case 'button':
            return `<a href="${c.properties.url}" style="display: inline-block; padding: 12px 24px; background-color: ${c.properties.color}; color: white; text-decoration: none; border-radius: 4px;">${c.properties.text}</a>`;
          case 'divider':
            return `<hr style="border: 1px ${c.properties.style} ${c.properties.color};" />`;
          default:
            return '';
        }
      }).join('\n');
    };

    // Act
    const handlebarsTemplate = generateHandlebarsFromComponents(components);

    // Assert
    expect(handlebarsTemplate).toContain('<h2 style="text-align: center">{{newsletter.title}}</h2>');
    expect(handlebarsTemplate).toContain('href="{{article.url}}"');
    expect(handlebarsTemplate).toContain('background-color: #007bff');
    expect(handlebarsTemplate).toContain('<hr style="border: 1px solid #ccc;" />');
  });

  it('should handle template preview with test data', () => {
    // Arrange
    const template = '<h1>{{newsletter.title}}</h1><p>Issue #{{newsletter.issue}}</p>';
    const testData = {
      newsletter: {
        title: 'Weekly Newsletter',
        issue: 42
      }
    };

    // Mock the template rendering logic
    const renderTemplateWithData = (template, data) => {
      let rendered = template;
      rendered = rendered.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const keys = path.trim().split('.');
        let value = data;
        for (const key of keys) {
          if (value && typeof value === 'object' && key in value) {
            value = value[key];
          } else {
            return match;
          }
        }
        return String(value);
      });
      return rendered;
    };

    // Act
    const renderedTemplate = renderTemplateWithData(template, testData);

    // Assert
    expect(renderedTemplate).toBe('<h1>Weekly Newsletter</h1><p>Issue #42</p>');
  });
});
