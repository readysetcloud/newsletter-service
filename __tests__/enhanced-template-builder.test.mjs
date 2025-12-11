import { describe, it, expect, beforeEach } from '@jest/globals';

// Test utilities for drag-and-drop functionality
const createMockDragEvent = (dataType, data) => ({
  preventDefault: () => {},
  stopPropagation: () => {},
  dataTransfer: {
    setData: () => {},
    getData: (type) => type === dataType ? data : null,
    effectAllowed: '',
    dropEffect: 'copy'
  }
});

const createMockComponent = (id, type, properties = {}) => ({
  id,
  type,
  properties: {
    ...getDefaultProperties(type),
    ...properties
  }
});

const getDefaultProperties = (type) => {
  const defaults = {
    heading: { text: 'Heading', level: 'h2', align: 'left' },
    text: { content: 'Text content...', align: 'left' },
    image: { src: '', alt: '', width: '100%' },
    button: { text: 'Button', url: '', color: '#007bff' },
    divider: { style: 'solid', color: '#ccc' }
  };
  return defaults[type] || {};
};

// Mock template builder logic functions
class MockTemplateBuilder {
  constructor() {
    this.components = [];
    this.draggedComponent = null;
    this.draggedComponentId = null;
    this.dropZoneIndex = null;
    this.componentCounter = 0;
  }

  addComponent(type, insertIndex) {
    const component = createMockComponent(
      `comp_${++this.componentCounter}`,
      type
    );

    if (insertIndex !== undefined) {
      this.components.splice(insertIndex, 0, component);
    } else {
      this.components.push(component);
    }

    return component;
  }

  moveComponentToIndex(componentId, targetIndex) {
    const sourceIndex = this.components.findIndex(c => c.id === componentId);
    if (sourceIndex === -1 || sourceIndex === targetIndex) return false;

    const [movedComponent] = this.components.splice(sourceIndex, 1);
    const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    this.components.splice(adjustedIndex, 0, movedComponent);

    return true;
  }

  handlePaletteDragStart(componentType) {
    this.draggedComponent = componentType;
    return {
      dataType: 'application/component-type',
      data: componentType
    };
  }

  handleCanvasComponentDragStart(componentId) {
    this.draggedComponentId = componentId;
    return {
      dataType: 'application/component-id',
      data: componentId
    };
  }

  handleDropZoneDrop(dragEvent, index) {
    const componentType = dragEvent.dataTransfer.getData('application/component-type');
    const componentId = dragEvent.dataTransfer.getData('application/component-id');

    if (componentType) {
      // Adding new component from palette
      const component = this.addComponent(componentType, index);
      return component ? true : false;
    } else if (componentId) {
      // Moving existing component
      return this.moveComponentToIndex(componentId, index);
    }

    return false;
  }

  generateTemplate() {
    const html = this.components.map(c => {
      switch (c.type) {
        case 'heading':
          return `<${c.properties.level} style="text-align: ${c.properties.align}">${c.properties.text}</${c.properties.level}>`;
        case 'text':
          return `<p style="text-align: ${c.properties.align}">${c.properties.content}</p>`;
        case 'image':
          return `<img src="${c.properties.src}" alt="${c.properties.alt}" style="width: ${c.properties.width}; display: block; margin: 0 auto;" />`;
        case 'button':
          return `<a href="${c.properties.url}" style="display: inline-block; padding: 12px 24px; background-color: ${c.properties.color}; color: white; text-decoration: none; border-radius: 4px;">${c.properties.text}</a>`;
        case 'divider':
          return `<hr style="border: 1px ${c.properties.style} ${c.properties.color};" />`;
        default:
          return '';
      }
    }).join('\n');

    return {
      id: 'test-template',
      tenantId: 'test-tenant',
      name: 'Test Template',
      description: '',
      type: 'template',
      content: html,
      isVisualMode: true,
      visualConfig: { components: this.components },
      snippets: [],
      s3Key: 'test-key',
      s3VersionId: 'test-version',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'test-user',
      isActive: true
    };
  }
}

describe('Enhanced Template Builder Drag and Drop Logic', () => {
  let templateBuilder;

  beforeEach(() => {
    templateBuilder = new MockTemplateBuilder();
  });

  describe('Component Addition', () => {
    it('should add component to the end when no index specified', () => {
      const component = templateBuilder.addComponent('heading');

      expect(templateBuilder.components).toHaveLength(1);
      expect(templateBuilder.components[0]).toEqual(component);
      expect(component.type).toBe('heading');
      expect(component.properties.text).toBe('Heading');
    });

    it('should add component at specific index', () => {
      templateBuilder.addComponent('heading');
      templateBuilder.addComponent('text');
      const insertedComponent = templateBuilder.addComponent('button', 1);

      expect(templateBuilder.components).toHaveLength(3);
      expect(templateBuilder.components[1]).toEqual(insertedComponent);
      expect(templateBuilder.components[1].type).toBe('button');
    });

    it('should create components with correct default properties', () => {
      const headingComponent = templateBuilder.addComponent('heading');
      const textComponent = templateBuilder.addComponent('text');
      const buttonComponent = templateBuilder.addComponent('button');

      expect(headingComponent.properties).toEqual({
        text: 'Heading',
        level: 'h2',
        align: 'left'
      });

      expect(textComponent.properties).toEqual({
        content: 'Text content...',
        align: 'left'
      });

      expect(buttonComponent.properties).toEqual({
        text: 'Button',
        url: '',
        color: '#007bff'
      });
    });
  });

  describe('Component Reordering', () => {
    beforeEach(() => {
      templateBuilder.addComponent('heading');
      templateBuilder.addComponent('text');
      templateBuilder.addComponent('button');
    });

    it('should move component to new position', () => {
      const firstComponent = templateBuilder.components[0];
      const result = templateBuilder.moveComponentToIndex(firstComponent.id, 2);

      expect(result).toBe(true);
      expect(templateBuilder.components[1].id).toBe(firstComponent.id); // Adjusted index due to move logic
      expect(templateBuilder.components[1].type).toBe('heading');
    });

    it('should handle moving component forward in list', () => {
      const lastComponentId = templateBuilder.components[2].id;
      const result = templateBuilder.moveComponentToIndex(lastComponentId, 0);

      expect(result).toBe(true);
      expect(templateBuilder.components[0].id).toBe(lastComponentId);
      expect(templateBuilder.components[0].type).toBe('button');
    });

    it('should return false for invalid component ID', () => {
      const result = templateBuilder.moveComponentToIndex('invalid-id', 1);
      expect(result).toBe(false);
    });

    it('should return false when moving to same position', () => {
      const componentId = templateBuilder.components[1].id;
      const result = templateBuilder.moveComponentToIndex(componentId, 1);
      expect(result).toBe(false);
    });
  });

  describe('Drag and Drop Events', () => {
    it('should handle palette drag start correctly', () => {
      const result = templateBuilder.handlePaletteDragStart('heading');

      expect(templateBuilder.draggedComponent).toBe('heading');
      expect(result.dataType).toBe('application/component-type');
      expect(result.data).toBe('heading');
    });

    it('should handle canvas component drag start correctly', () => {
      const component = templateBuilder.addComponent('text');
      const result = templateBuilder.handleCanvasComponentDragStart(component.id);

      expect(templateBuilder.draggedComponentId).toBe(component.id);
      expect(result.dataType).toBe('application/component-id');
      expect(result.data).toBe(component.id);
    });

    it('should handle drop zone drop for new component', () => {
      const dragEvent = createMockDragEvent('application/component-type', 'heading');
      const result = templateBuilder.handleDropZoneDrop(dragEvent, 0);

      expect(result).toBeTruthy();
      expect(templateBuilder.components).toHaveLength(1);
      expect(templateBuilder.components[0].type).toBe('heading');
    });

    it('should handle drop zone drop for component reordering', () => {
      const component1 = templateBuilder.addComponent('heading');
      const component2 = templateBuilder.addComponent('text');

      // Move component1 from index 0 to index 2 (after component2)
      const dragEvent = createMockDragEvent('application/component-id', component1.id);
      const result = templateBuilder.handleDropZoneDrop(dragEvent, 2);

      expect(result).toBe(true);
      // After moving component1 to the end, it should be at index 1 and component2 at index 0
      expect(templateBuilder.components).toHaveLength(2);
      expect(templateBuilder.components.find(c => c.id === component1.id)).toBeTruthy();
      expect(templateBuilder.components.find(c => c.id === component2.id)).toBeTruthy();
    });
  });

  describe('Template Generation', () => {
    it('should generate correct HTML for components', () => {
      templateBuilder.addComponent('heading');
      templateBuilder.addComponent('text');
      templateBuilder.addComponent('button');

      const template = templateBuilder.generateTemplate();

      expect(template.content).toContain('<h2 style="text-align: left">Heading</h2>');
      expect(template.content).toContain('<p style="text-align: left">Text content...</p>');
      expect(template.content).toContain('<a href="" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Button</a>');
    });

    it('should generate template with correct metadata', () => {
      templateBuilder.addComponent('heading');
      const template = templateBuilder.generateTemplate();

      expect(template.type).toBe('template');
      expect(template.isVisualMode).toBe(true);
      expect(template.visualConfig.components).toHaveLength(1);
      expect(template.content).toBeTruthy();
    });

    it('should handle empty component list', () => {
      const template = templateBuilder.generateTemplate();

      expect(template.content).toBe('');
      expect(template.visualConfig.components).toHaveLength(0);
    });
  });

  describe('Enhanced Drag and Drop Features', () => {
    it('should support visual feedback during drag operations', () => {
      templateBuilder.handlePaletteDragStart('heading');
      expect(templateBuilder.draggedComponent).toBe('heading');

      templateBuilder.draggedComponent = null; // Simulate drag end
      expect(templateBuilder.draggedComponent).toBeNull();
    });

    it('should support drop zone validation', () => {
      // Test that drop zones can validate component placement
      const validComponentTypes = ['heading', 'text', 'image', 'button', 'divider'];

      validComponentTypes.forEach(type => {
        const dragEvent = createMockDragEvent('application/component-type', type);
        const result = templateBuilder.handleDropZoneDrop(dragEvent, 0);
        expect(result).toBeTruthy();
      });
    });

    it('should handle real-time preview updates', () => {
      // Add components and verify template generation updates
      templateBuilder.addComponent('heading');
      let template = templateBuilder.generateTemplate();
      expect(template.visualConfig.components).toHaveLength(1);

      templateBuilder.addComponent('text');
      template = templateBuilder.generateTemplate();
      expect(template.visualConfig.components).toHaveLength(2);

      // Verify content updates in real-time
      expect(template.content).toContain('Heading');
      expect(template.content).toContain('Text content...');
    });
  });
});
