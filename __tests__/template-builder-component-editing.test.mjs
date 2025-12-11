// Jest test for Template Builder Component-Level Code Editing

describe('Template Builder Component-Level Code Editing', () => {
  let mockComponent;
  let mockHandlebarsToComponent;
  let mockComponentToHandlebars;

  beforeEach(() => {
    mockComponent = {
      id: 'test-component',
      type: 'heading',
      properties: {
        text: 'Test Heading',
        level: 'h2',
        align: 'center'
      }
    };

    // Mock the conversion functions that would be in the TemplateBuilder (email-compatible)
    mockComponentToHandlebars = (component) => {
      switch (component.type) {
        case 'heading':
          const fontSize = {
            h1: '24px',
            h2: '20px',
            h3: '18px',
            h4: '16px',
            h5: '14px',
            h6: '12px'
          }[component.properties.level] || '20px';

          return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0 8px 0;">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: ${fontSize}; font-weight: bold; color: ${component.properties.color || '#000000'}; text-align: ${component.properties.align}; line-height: 1.2;">
      ${component.properties.text}
    </td>
  </tr>
</table>`;

        case 'text':
          return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 8px 0;">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: ${component.properties.fontSize || '14px'}; color: ${component.properties.color || '#000000'}; text-align: ${component.properties.align}; line-height: 1.4; padding: 8px 0;">
      ${component.properties.content}
    </td>
  </tr>
</table>`;

        case 'image':
          return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td align="${component.properties.align || 'center'}">
      <img src="${component.properties.src}" alt="${component.properties.alt}" style="display: block; max-width: ${component.properties.width || '100%'}; height: auto; border: 0;" />
    </td>
  </tr>
</table>`;

        case 'button':
          return `<table cellpadding="0" cellspacing="0" border="0" style="margin: 16px auto;">
  <tr>
    <td style="background-color: ${component.properties.color || '#007bff'}; border-radius: 4px; padding: 12px 24px; text-align: center;">
      <a href="${component.properties.url}" style="color: ${component.properties.textColor || '#ffffff'}; text-decoration: none; font-weight: bold; display: inline-block; font-family: Arial, sans-serif;">
        ${component.properties.text}
      </a>
    </td>
  </tr>
</table>`;

        case 'divider':
          return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td style="border-top: ${component.properties.height || '1px'} ${component.properties.style || 'solid'} ${component.properties.color || '#cccccc'}; font-size: 0; line-height: 0;">&nbsp;</td>
  </tr>
</table>`;

        default:
          return '';
      }
    };

    mockHandlebarsToComponent = (code, componentType) => {
      const properties = {};

      try {
        switch (componentType) {
          case 'heading': {
            const textMatch = code.match(/<td[^>]*>([^<]+)<\/td>/);
            const alignMatch = code.match(/text-align:\s*([^;"]+)/);
            const colorMatch = code.match(/color:\s*([^;"]+)/);
            const fontSizeMatch = code.match(/font-size:\s*([^;"]+)/);

            if (textMatch) properties.text = textMatch[1].trim();
            if (alignMatch) properties.align = alignMatch[1].trim();
            if (colorMatch) properties.color = colorMatch[1].trim();

            // Determine level from font size
            if (fontSizeMatch) {
              const fontSize = fontSizeMatch[1].trim();
              const levelMap = {
                '24px': 'h1',
                '20px': 'h2',
                '18px': 'h3',
                '16px': 'h4',
                '14px': 'h5',
                '12px': 'h6'
              };
              properties.level = levelMap[fontSize] || 'h2';
            }
            break;
          }
          case 'text': {
            const textMatch = code.match(/<td[^>]*>([^<]+)<\/td>/);
            const alignMatch = code.match(/text-align:\s*([^;"]+)/);
            const colorMatch = code.match(/color:\s*([^;"]+)/);
            const fontSizeMatch = code.match(/font-size:\s*([^;"]+)/);

            if (textMatch) properties.content = textMatch[1].trim();
            if (alignMatch) properties.align = alignMatch[1].trim();
            if (colorMatch) properties.color = colorMatch[1].trim();
            if (fontSizeMatch) properties.fontSize = fontSizeMatch[1].trim();
            break;
          }
          case 'image': {
            const srcMatch = code.match(/src="([^"]+)"/);
            const altMatch = code.match(/alt="([^"]+)"/);
            const alignMatch = code.match(/align="([^"]+)"/);
            const widthMatch = code.match(/max-width:\s*([^;"]+)/);

            if (srcMatch) properties.src = srcMatch[1];
            if (altMatch) properties.alt = altMatch[1];
            if (alignMatch) properties.align = alignMatch[1];
            if (widthMatch) properties.width = widthMatch[1].trim();
            break;
          }
          case 'button': {
            const textMatch = code.match(/<a[^>]*>([^<]+)<\/a>/);
            const urlMatch = code.match(/href="([^"]+)"/);
            const colorMatch = code.match(/background-color:\s*([^;"]+)/);
            const textColorMatch = code.match(/<a[^>]*style="[^"]*color:\s*([^;"]+)/);

            if (textMatch) properties.text = textMatch[1].trim();
            if (urlMatch) properties.url = urlMatch[1];
            if (colorMatch) properties.color = colorMatch[1].trim();
            if (textColorMatch) properties.textColor = textColorMatch[1].trim();
            break;
          }
          case 'divider': {
            const styleMatch = code.match(/border-top:\s*[^;]*\s+(solid|dashed|dotted)/);
            const colorMatch = code.match(/border-top:\s*[^;]*\s+([^;"]+)/);
            const heightMatch = code.match(/border-top:\s*([^;]*?)\s+/);

            if (styleMatch) properties.style = styleMatch[1];
            if (colorMatch) properties.color = colorMatch[1].trim();
            if (heightMatch) properties.height = heightMatch[1].trim();
            break;
          }
        }
      } catch (error) {
        console.warn('Failed to parse handlebars code:', error);
      }

      return properties;
    };
  });

  describe('Component to Handlebars Conversion', () => {
    it('should convert heading component to handlebars correctly', () => {
      const result = mockComponentToHandlebars(mockComponent);
      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('font-size: 20px');
      expect(result).toContain('text-align: center');
      expect(result).toContain('Test Heading');
    });

    it('should convert button component to email-compatible table structure', () => {
      const buttonComponent = {
        type: 'button',
        properties: {
          text: 'Click Me',
          url: 'https://example.com',
          color: '#007bff'
        }
      };

      const result = mockComponentToHandlebars(buttonComponent);
      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('background-color: #007bff');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('Click Me');
    });
  });

  describe('Handlebars to Component Conversion', () => {
    it('should parse heading handlebars back to component properties', () => {
      const handlebarsCode = `<table cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; color: #000000; text-align: left; line-height: 1.2;">
      My Title
    </td>
  </tr>
</table>`;
      const result = mockHandlebarsToComponent(handlebarsCode, 'heading');

      expect(result.level).toBe('h3');
      expect(result.text).toBe('My Title');
      expect(result.align).toBe('left');
    });

    it('should parse button handlebars back to component properties', () => {
      const handlebarsCode = `<table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background-color: #ff0000; border-radius: 4px; padding: 12px 24px;">
            <a href="https://test.com" style="color: #ffffff; text-decoration: none;">
              Test Button
            </a>
          </td>
        </tr>
      </table>`;

      const result = mockHandlebarsToComponent(handlebarsCode, 'button');

      expect(result.text).toBe('Test Button');
      expect(result.url).toBe('https://test.com');
      expect(result.color).toBe('#ff0000');
    });

    it('should handle malformed handlebars gracefully', () => {
      const malformedCode = '<h2 unclosed tag';
      const result = mockHandlebarsToComponent(malformedCode, 'heading');

      // Should not throw and should return partial results
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('Bidirectional Conversion', () => {
    it('should maintain component properties through round-trip conversion', () => {
      const originalComponent = {
        type: 'heading',
        properties: {
          text: 'Round Trip Test',
          level: 'h1',
          align: 'right',
          color: '#333333'
        }
      };

      // Convert to handlebars and back
      const handlebarsCode = mockComponentToHandlebars(originalComponent);
      const parsedProperties = mockHandlebarsToComponent(handlebarsCode, 'heading');

      expect(parsedProperties.text).toBe(originalComponent.properties.text);
      expect(parsedProperties.level).toBe(originalComponent.properties.level);
      expect(parsedProperties.align).toBe(originalComponent.properties.align);
      expect(parsedProperties.color).toBe(originalComponent.properties.color);
    });
  });

  describe('Email Compatibility', () => {
    it('should generate email-compatible button HTML', () => {
      const buttonComponent = {
        type: 'button',
        properties: {
          text: 'Email Button',
          url: 'mailto:test@example.com',
          color: '#28a745'
        }
      };

      const result = mockComponentToHandlebars(buttonComponent);

      // Check for email-compatible table structure
      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('<td style=');
      expect(result).toContain('display: inline-block');
      expect(result).not.toContain('<div'); // Should not use divs for email compatibility
    });

    it('should generate email-compatible heading HTML', () => {
      const headingComponent = {
        type: 'heading',
        properties: {
          text: 'Email Heading',
          level: 'h2',
          align: 'center',
          color: '#333333'
        }
      };

      const result = mockComponentToHandlebars(headingComponent);

      // Check for email-compatible table structure
      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('font-family: Arial, sans-serif');
      expect(result).toContain('text-align: center');
      expect(result).toContain('color: #333333');
    });

    it('should generate email-compatible image HTML', () => {
      const imageComponent = {
        type: 'image',
        properties: {
          src: 'https://example.com/image.jpg',
          alt: 'Test Image',
          width: '300px',
          align: 'center'
        }
      };

      const result = mockComponentToHandlebars(imageComponent);

      // Check for email-compatible table structure
      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('align="center"');
      expect(result).toContain('display: block');
      expect(result).toContain('border: 0');
    });

    it('should generate email-compatible divider HTML', () => {
      const dividerComponent = {
        type: 'divider',
        properties: {
          color: '#cccccc',
          style: 'solid',
          height: '2px'
        }
      };

      const result = mockComponentToHandlebars(dividerComponent);

      // Check for email-compatible table structure
      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('border-top: 2px solid #cccccc');
      expect(result).toContain('font-size: 0');
      expect(result).toContain('line-height: 0');
    });

    it('should generate email-compatible text HTML', () => {
      const textComponent = {
        type: 'text',
        properties: {
          content: 'This is email text content',
          align: 'left',
          fontSize: '16px',
          color: '#000000'
        }
      };

      const result = mockComponentToHandlebars(textComponent);

      // Check for email-compatible table structure
      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('font-family: Arial, sans-serif');
      expect(result).toContain('font-size: 16px');
      expect(result).toContain('text-align: left');
    });
  });
});
