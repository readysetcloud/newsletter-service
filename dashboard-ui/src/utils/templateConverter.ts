import type { Snippet } from '@/types/template';

export interface VisualComponent {
  id: string;
  type: 'text' | 'image' | 'button' | 'snippet' | 'heading' | 'divider' | 'spacer';
  properties: Record<string, any>;
}

export interface VisualConfig {
  components: VisualComponent[];
  globalStyles?: {
    backgroundColor?: string;
    fontFamily?: string;
    maxWidth?: string;
  };
}

/**
 * Convert visual config to handlebars template
 */
export function visualConfigToHandlebars(config: VisualConfig, snippets: Snippet[] = []): string {
  if (!config.components || config.components.length === 0) {
    return '';
  }

  const globalStyles = config.globalStyles || {};

  let template = '';

  // Add global styles if any
  if (Object.keys(globalStyles).length > 0) {
    template += '<div style="';
    if (globalStyles.backgroundColor) {
      template += `background-color: ${globalStyles.backgroundColor}; `;
    }
    if (globalStyles.fontFamily) {
      template += `font-family: ${globalStyles.fontFamily}; `;
    }
    if (globalStyles.maxWidth) {
      template += `max-width: ${globalStyles.maxWidth}; margin: 0 auto; `;
    }
    template += '">\n';
  }

  // Convert each component
  config.components.forEach((component, index) => {
    template += componentToHandlebars(component, snippets);
    if (index < config.components.length - 1) {
      template += '\n';
    }
  });

  // Close global styles wrapper
  if (Object.keys(globalStyles).length > 0) {
    template += '\n</div>';
  }

  return template;
}

/**
 * Convert handlebars template to visual config (basic parsing)
 */
export function handlebarsToVisualConfig(template: string, snippets: Snippet[] = []): VisualConfig {
  // This is a simplified parser - in a real implementation, you'd want a more robust parser
  const config: VisualConfig = {
    components: [],
    globalStyles: {}
  };

  if (!template.trim()) {
    return config;
  }

  // For now, return empty config if template exists but can't be parsed
  // In a full implementation, you'd parse the handlebars template back to components
  // This is complex and would require a proper HTML/handlebars parser

  return config;
}

/**
 * Convert a single visual component to handlebars
 */
function componentToHandlebars(component: VisualComponent, snippets: Snippet[]): string {
  switch (component.type) {
    case 'text':
      return textComponentToHandlebars(component);

    case 'image':
      return imageComponentToHandlebars(component);

    case 'button':
      return buttonComponentToHandlebars(component);

    case 'snippet':
      return snippetComponentToHandlebars(component, snippets);

    default:
      return `<!-- Unknown component type: ${component.type} -->`;
  }
}

/**
 * Convert text component to handlebars
 */
function textComponentToHandlebars(component: VisualComponent): string {
  const props = component.properties;

  let styles = '';
  if (props.fontSize) styles += `font-size: ${props.fontSize}; `;
  if (props.color) styles += `color: ${props.color}; `;
  if (props.textAlign) styles += `text-align: ${props.textAlign}; `;
  if (props.fontWeight) styles += `font-weight: ${props.fontWeight}; `;
  if (props.marginBottom) styles += `margin-bottom: ${props.marginBottom}; `;

  const content = props.content || 'Enter your text here...';

  if (styles) {
    return `<div style="${styles.trim()}">${content}</div>`;
  } else {
    return `<div>${content}</div>`;
  }
}

/**
 * Convert image component to handlebars
 */
function imageComponentToHandlebars(component: VisualComponent): string {
  const props = component.properties;

  if (!props.src) {
    return '<!-- Image component: No source URL specified -->';
  }

  let styles = '';
  if (props.width) styles += `width: ${props.width}; `;
  if (props.height) styles += `height: ${props.height}; `;
  if (props.marginBottom) styles += `margin-bottom: ${props.marginBottom}; `;

  let imgTag = `<img src="${props.src}"`;

  if (props.alt) {
    imgTag += ` alt="${props.alt}"`;
  }

  if (styles) {
    imgTag += ` style="${styles.trim()}"`;
  }

  imgTag += ' />';

  return imgTag;
}

/**
 * Convert button component to handlebars
 */
function buttonComponentToHandlebars(component: VisualComponent): string {
  const props = component.properties;

  let styles = '';
  if (props.backgroundColor) styles += `background-color: ${props.backgroundColor}; `;
  if (props.color) styles += `color: ${props.color}; `;
  if (props.padding) styles += `padding: ${props.padding}; `;
  if (props.borderRadius) styles += `border-radius: ${props.borderRadius}; `;
  if (props.marginBottom) styles += `margin-bottom: ${props.marginBottom}; `;

  // Always add some default button styles
  styles += 'text-decoration: none; display: inline-block; ';

  const text = props.text || 'Click Here';
  const href = props.href || '#';

  let containerStyles = '';
  if (props.textAlign) {
    containerStyles = `text-align: ${props.textAlign}; `;
  }

  let buttonHtml = `<a href="${href}" style="${styles.trim()}">${text}</a>`;

  if (containerStyles) {
    buttonHtml = `<div style="${containerStyles.trim()}">${buttonHtml}</div>`;
  }

  return buttonHtml;
}

/**
 * Convert snippet component to handlebars
 */
function snippetComponentToHandlebars(component: VisualComponent, snippets: Snippet[]): string {
  const props = component.properties;

  if (!props.snippetId) {
    return '<!-- Snippet component: No snippet selected -->';
  }

  const snippet = snippets.find(s => s.id === props.snippetId);
  if (!snippet) {
    return `<!-- Snippet component: Snippet "${props.snippetId}" not found -->`;
  }

  // Build the handlebars partial call
  let snippetCall = `{{> ${snippet.name}`;

  // Add parameters
  const parameters = props.parameters || {};
  const paramEntries = Object.entries(parameters);

  if (paramEntries.length > 0) {
    const paramStrings = paramEntries.map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}="${value}"`;
      } else {
        return `${key}=${value}`;
      }
    });
    snippetCall += ` ${paramStrings.join(' ')}`;
  }

  snippetCall += '}}';

  return snippetCall;
}

/**
 * Validate visual config
 */
export function validateVisualConfig(config: VisualConfig): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.components) {
    errors.push('Config must have components array');
    return { isValid: false, errors };
  }

  // Validate each component
  config.components.forEach((component, index) => {
    if (!component.id) {
      errors.push(`Component at index ${index} is missing ID`);
    }

    if (!component.type) {
      errors.push(`Component at index ${index} is missing type`);
    }

    if (!component.properties) {
      errors.push(`Component at index ${index} is missing properties`);
    }

    // Type-specific validation
    switch (component.type) {
      case 'text':
        if (!component.properties.content) {
          errors.push(`Text component at index ${index} is missing content`);
        }
        break;

      case 'image':
        if (!component.properties.src) {
          errors.push(`Image component at index ${index} is missing src URL`);
        }
        break;

      case 'button':
        if (!component.properties.text) {
          errors.push(`Button component at index ${index} is missing text`);
        }
        if (!component.properties.href) {
          errors.push(`Button component at index ${index} is missing href URL`);
        }
        break;

      case 'snippet':
        if (!component.properties.snippetId) {
          errors.push(`Snippet component at index ${index} is missing snippetId`);
        }
        break;
    }
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Create empty visual config
 */
export function createEmptyVisualConfig(): VisualConfig {
  return {
    components: [],
    globalStyles: {
      backgroundColor: '#ffffff',
      fontFamily: 'Arial, sans-serif',
      maxWidth: '600px'
    }
  };
}
