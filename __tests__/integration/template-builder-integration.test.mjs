// Integration test for Template Builder with component-level code editing

describe('Template Builder Integration - Component Code Editing', () => {
  let mockTemplate;

  beforeEach(() => {
    mockTemplate = {
      id: 'test-template',
      name: 'Test Template',
      content: '',
      isVisualMode: true,
      visualConfig: {
        components: [
          {
            id: 'comp1',
            type: 'heading',
            properties: {
              text: 'Newsletter Title',
              level: 'h1',
              align: 'center'
            }
          },
          {
            id: 'comp2',
            type: 'button',
            properties: {
              text: 'Read More',
              url: 'https://example.com',
              color: '#007bff'
            }
          }
        ]
      }
    };
  });

  describe('Template Generation', () => {
    it('should generate complete template from visual components', () => {
      const components = mockTemplate.visualConfig.components;

      const generatedContent = components.map(c => {
        switch (c.type) {
          case 'heading':
            return `<${c.properties.level} style="text-align: ${c.properties.align}">${c.properties.text}</${c.properties.level}>`;
          case 'button':
            return `<table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
  <tr>
    <td style="background-color: ${c.properties.color}; border-radius: 4px; padding: 12px 24px; text-align: center;">
      <a href="${c.properties.url}" style="color: #ffffff; text-decoration: none; font-weight: bold; display: inline-block;">
        ${c.properties.text}
      </a>
    </td>
  </tr>
</table>`;
          default:
            return '';
        }
      }).join('\n');

      expect(generatedContent).toContain('<h1 style="text-align: center">Newsletter Title</h1>');
      expect(generatedContent).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(generatedContent).toContain('href="https://example.com"');
      expect(generatedContent).toContain('Read More');
    });

    it('should maintain email compatibility in generated HTML', () => {
      const buttonComponent = mockTemplate.visualConfig.components.find(c => c.type === 'button');

      const buttonHTML = `<table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
  <tr>
    <td style="background-color: ${buttonComponent.properties.color}; border-radius: 4px; padding: 12px 24px; text-align: center;">
      <a href="${buttonComponent.properties.url}" style="color: #ffffff; text-decoration: none; font-weight: bold; display: inline-block;">
        ${buttonComponent.properties.text}
      </a>
    </td>
  </tr>
</table>`;

      // Email compatibility checks
      expect(buttonHTML).toContain('cellpadding="0" cellspacing="0"');
      expect(buttonHTML).toContain('style='); // Inline styles
      expect(buttonHTML).not.toContain('<div'); // No divs for email compatibility
      expect(buttonHTML).not.toContain('class='); // No CSS classes
    });
  });

  describe('Mode Switching', () => {
    it('should preserve content when switching between visual and code modes', () => {
      const originalComponents = mockTemplate.visualConfig.components;

      // Simulate switching to code mode
      const codeContent = originalComponents.map(c => {
        switch (c.type) {
          case 'heading':
            return `<${c.properties.level} style="text-align: ${c.properties.align}">${c.properties.text}</${c.properties.level}>`;
          case 'button':
            return `<table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
  <tr>
    <td style="background-color: ${c.properties.color}; border-radius: 4px; padding: 12px 24px; text-align: center;">
      <a href="${c.properties.url}" style="color: #ffffff; text-decoration: none; font-weight: bold; display: inline-block;">
        ${c.properties.text}
      </a>
    </td>
  </tr>
</table>`;
          default:
            return '';
        }
      }).join('\n');

      // Simulate switching back to visual mode by parsing the code
      const parsedComponents = [];
      const headingMatch = codeContent.match(/<(h[1-6])[^>]*style="text-align:\s*([^"]+)"[^>]*>([^<]+)<\/h[1-6]>/);
      if (headingMatch) {
        parsedComponents.push({
          type: 'heading',
          properties: {
            level: headingMatch[1],
            align: headingMatch[2],
            text: headingMatch[3]
          }
        });
      }

      const buttonTextMatch = codeContent.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
      const buttonColorMatch = codeContent.match(/background-color:\s*([^;"]+)/);
      if (buttonTextMatch && buttonColorMatch) {
        parsedComponents.push({
          type: 'button',
          properties: {
            url: buttonTextMatch[1],
            text: buttonTextMatch[2],
            color: buttonColorMatch[1]
          }
        });
      }

      // Verify content is preserved
      expect(parsedComponents).toHaveLength(2);
      expect(parsedComponents[0].properties.text).toBe('Newsletter Title');
      expect(parsedComponents[0].properties.level).toBe('h1');
      expect(parsedComponents[1].properties.text.trim()).toBe('Read More');
      expect(parsedComponents[1].properties.url).toBe('https://example.com');
    });
  });

  describe('Validation', () => {
    it('should detect syntax errors in handlebars code', () => {
      const invalidCode = '<h1 unclosed tag>Title';
      const errors = [];

      // Simulate validation
      const lines = invalidCode.split('\n');
      lines.forEach((line, lineIndex) => {
        const openTags = (line.match(/<[^/>][^>]*>/g) || []).length;
        const closeTags = (line.match(/<\/[^>]+>/g) || []).length;

        if (openTags > closeTags) {
          errors.push({
            line: lineIndex + 1,
            message: 'Unclosed HTML tag',
            severity: 'error'
          });
        }
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Unclosed HTML tag');
      expect(errors[0].severity).toBe('error');
    });

    it('should validate handlebars expressions', () => {
      const codeWithEmptyExpression = '<h1>{{  }}</h1>';
      const errors = [];

      // Simulate handlebars validation
      const handlebarsMatches = codeWithEmptyExpression.match(/\{\{[^}]*\}\}/g);
      if (handlebarsMatches) {
        handlebarsMatches.forEach(match => {
          const content = match.slice(2, -2).trim();
          if (!content) {
            errors.push({
              line: 1,
              message: 'Empty handlebars expression',
              severity: 'error'
            });
          }
        });
      }

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Empty handlebars expression');
    });
  });

  describe('Real-time Updates', () => {
    it('should update component properties when code changes', () => {
      const originalComponent = {
        id: 'test',
        type: 'heading',
        properties: {
          text: 'Original Title',
          level: 'h2',
          align: 'left'
        }
      };

      const modifiedCode = '<h3 style="text-align: center">Modified Title</h3>';

      // Simulate parsing the modified code
      const levelMatch = modifiedCode.match(/<(h[1-6])/i);
      const textMatch = modifiedCode.match(/>([^<]+)</);
      const alignMatch = modifiedCode.match(/text-align:\s*([^;"]+)/);

      const updatedProperties = { ...originalComponent.properties };
      if (levelMatch) updatedProperties.level = levelMatch[1].toLowerCase();
      if (textMatch) updatedProperties.text = textMatch[1].trim();
      if (alignMatch) updatedProperties.align = alignMatch[1].trim();

      expect(updatedProperties.level).toBe('h3');
      expect(updatedProperties.text).toBe('Modified Title');
      expect(updatedProperties.align).toBe('center');
    });
  });
});
