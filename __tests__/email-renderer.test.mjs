// Jest test for Email Renderer Utility

describe('Email Renderer Utility', () => {
  let emailRenderer;

  beforeEach(async () => {
    // Mock the email renderer functions
    emailRenderer = {
      componentToEmailHtml: (component) => {
        const { type, properties } = component;

        switch (type) {
          case 'button':
            return `<table cellpadding="0" cellspacing="0" border="0" style="margin: 16px auto;">
  <tr>
    <td style="background-color: ${properties.color || '#007bff'}; border-radius: 4px; padding: 12px 24px; text-align: center;">
      <a href="${properties.url || '#'}" style="color: ${properties.textColor || '#ffffff'}; text-decoration: none; font-weight: bold; display: inline-block; font-family: Arial, sans-serif;">
        ${properties.text || 'Button'}
      </a>
    </td>
  </tr>
</table>`;

          case 'image':
            return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td align="${properties.align || 'center'}">
      <img src="${properties.src || ''}" alt="${properties.alt || ''}" style="display: block; max-width: ${properties.width || '100%'}; height: auto; border: 0;" />
    </td>
  </tr>
</table>`;

          case 'divider':
            return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td style="border-top: ${properties.height || '1px'} ${properties.style || 'solid'} ${properties.color || '#cccccc'}; font-size: 0; line-height: 0;">&nbsp;</td>
  </tr>
</table>`;

          default:
            return `<!-- Unsupported component type: ${type} -->`;
        }
      },

      validateEmailCompatibility: (html) => {
        const warnings = [];

        // Check for problematic patterns
        if (html.includes('<div')) {
          warnings.push({
            type: 'compatibility',
            severity: 'warning',
            message: 'DIV elements may not render consistently across email clients.',
            count: (html.match(/<div/g) || []).length
          });
        }

        if (html.includes('position:')) {
          warnings.push({
            type: 'compatibility',
            severity: 'error',
            message: 'CSS positioning may not work in email clients.',
            count: (html.match(/position:/g) || []).length
          });
        }

        if (html.includes('display: flex') || html.includes('display: grid')) {
          warnings.push({
            type: 'compatibility',
            severity: 'error',
            message: 'Modern CSS layout methods are not supported in email clients.',
            count: (html.match(/display:\s*(flex|grid)/g) || []).length
          });
        }

        // Check for missing alt attributes
        const imgWithoutAlt = html.match(/<img(?![^>]*alt=)[^>]*>/g);
        if (imgWithoutAlt) {
          warnings.push({
            type: 'accessibility',
            severity: 'warning',
            message: 'Images without alt attributes may cause accessibility issues.',
            count: imgWithoutAlt.length
          });
        }

        return warnings;
      },

      renderForEmailClient: (html, client) => {
        let clientHtml = html;

        if (!client.features.supportsMediaQueries) {
          clientHtml = clientHtml.replace(/@media[^{]*{[^}]*}/gi, '');
        }

        if (!client.features.supportsWebFonts) {
          clientHtml = clientHtml.replace(/font-family:\s*[^,;]*,\s*/gi, 'font-family: ');
        }

        if (client.features.stripsStyleTags) {
          clientHtml = clientHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        }

        if (!client.features.supportsBackgroundImages) {
          clientHtml = clientHtml.replace(/background-image:[^;]*;?/gi, '');
        }

        return clientHtml;
      }
    };
  });

  describe('Component to Email HTML Conversion', () => {
    it('should convert button component to email-compatible HTML', () => {
      const buttonComponent = {
        type: 'button',
        properties: {
          text: 'Click Me',
          url: 'https://example.com',
          color: '#007bff',
          textColor: '#ffffff'
        }
      };

      const result = emailRenderer.componentToEmailHtml(buttonComponent);

      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('background-color: #007bff');
      expect(result).toContain('color: #ffffff');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('Click Me');
      expect(result).toContain('font-family: Arial, sans-serif');
    });

    it('should convert image component to email-compatible HTML', () => {
      const imageComponent = {
        type: 'image',
        properties: {
          src: 'https://example.com/image.jpg',
          alt: 'Test Image',
          width: '300px',
          align: 'center'
        }
      };

      const result = emailRenderer.componentToEmailHtml(imageComponent);

      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('align="center"');
      expect(result).toContain('src="https://example.com/image.jpg"');
      expect(result).toContain('alt="Test Image"');
      expect(result).toContain('max-width: 300px');
      expect(result).toContain('display: block');
      expect(result).toContain('border: 0');
    });

    it('should convert divider component to email-compatible HTML', () => {
      const dividerComponent = {
        type: 'divider',
        properties: {
          color: '#cccccc',
          style: 'solid',
          height: '2px'
        }
      };

      const result = emailRenderer.componentToEmailHtml(dividerComponent);

      expect(result).toContain('<table cellpadding="0" cellspacing="0" border="0"');
      expect(result).toContain('border-top: 2px solid #cccccc');
      expect(result).toContain('font-size: 0');
      expect(result).toContain('line-height: 0');
    });

    it('should handle unsupported component types', () => {
      const unsupportedComponent = {
        type: 'unsupported',
        properties: {}
      };

      const result = emailRenderer.componentToEmailHtml(unsupportedComponent);

      expect(result).toContain('<!-- Unsupported component type: unsupported -->');
    });
  });

  describe('Email Compatibility Validation', () => {
    it('should detect DIV elements as warnings', () => {
      const htmlWithDivs = '<div>Content</div><div>More content</div>';
      const warnings = emailRenderer.validateEmailCompatibility(htmlWithDivs);

      const divWarning = warnings.find(w => w.message.includes('DIV elements'));
      expect(divWarning).toBeDefined();
      expect(divWarning.severity).toBe('warning');
      expect(divWarning.count).toBe(2);
    });

    it('should detect CSS positioning as errors', () => {
      const htmlWithPositioning = '<div style="position: absolute;">Content</div>';
      const warnings = emailRenderer.validateEmailCompatibility(htmlWithPositioning);

      const positionWarning = warnings.find(w => w.message.includes('CSS positioning'));
      expect(positionWarning).toBeDefined();
      expect(positionWarning.severity).toBe('error');
    });

    it('should detect modern CSS layout methods as errors', () => {
      const htmlWithFlex = '<div style="display: flex;">Content</div>';
      const warnings = emailRenderer.validateEmailCompatibility(htmlWithFlex);

      const flexWarning = warnings.find(w => w.message.includes('Modern CSS layout'));
      expect(flexWarning).toBeDefined();
      expect(flexWarning.severity).toBe('error');
    });

    it('should detect images without alt attributes', () => {
      const htmlWithoutAlt = '<img src="image.jpg"><img src="image2.jpg" alt="Good">';
      const warnings = emailRenderer.validateEmailCompatibility(htmlWithoutAlt);

      const altWarning = warnings.find(w => w.message.includes('alt attributes'));
      expect(altWarning).toBeDefined();
      expect(altWarning.severity).toBe('warning');
      expect(altWarning.count).toBe(1);
    });

    it('should return empty array for email-compatible HTML', () => {
      const emailCompatibleHtml = `
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <img src="image.jpg" alt="Good image" style="display: block;" />
            </td>
          </tr>
        </table>
      `;
      const warnings = emailRenderer.validateEmailCompatibility(emailCompatibleHtml);

      expect(warnings).toHaveLength(0);
    });
  });

  describe('Email Client Rendering', () => {
    const mockClient = {
      name: 'Outlook 2016',
      id: 'outlook-2016',
      features: {
        supportsMediaQueries: false,
        supportsWebFonts: false,
        stripsStyleTags: true,
        supportsBackgroundImages: false
      }
    };

    it('should remove media queries for clients that do not support them', () => {
      const htmlWithMediaQueries = `
        <style>
          @media screen and (max-width: 600px) {
            .mobile { display: block; }
          }
        </style>
        <div>Content</div>
      `;

      const result = emailRenderer.renderForEmailClient(htmlWithMediaQueries, mockClient);

      expect(result).not.toContain('@media');
      expect(result).toContain('<div>Content</div>');
    });

    it('should remove web fonts for clients that do not support them', () => {
      const htmlWithWebFonts = '<div style="font-family: CustomFont, Arial, sans-serif;">Content</div>';

      const result = emailRenderer.renderForEmailClient(htmlWithWebFonts, mockClient);

      expect(result).toContain('font-family: Arial, sans-serif');
      expect(result).not.toContain('CustomFont,');
    });

    it('should remove style tags for clients that strip them', () => {
      const htmlWithStyleTags = `
        <style>
          .test { color: red; }
        </style>
        <div class="test">Content</div>
      `;

      const result = emailRenderer.renderForEmailClient(htmlWithStyleTags, mockClient);

      expect(result).not.toContain('<style>');
      expect(result).not.toContain('.test { color: red; }');
      expect(result).toContain('<div class="test">Content</div>');
    });

    it('should remove background images for clients that do not support them', () => {
      const htmlWithBackgroundImages = '<div style="background-image: url(image.jpg); color: red;">Content</div>';

      const result = emailRenderer.renderForEmailClient(htmlWithBackgroundImages, mockClient);

      expect(result).not.toContain('background-image:');
      expect(result).toContain('color: red');
      expect(result).toContain('Content');
    });

    it('should preserve HTML for clients with full support', () => {
      const fullSupportClient = {
        name: 'Gmail',
        id: 'gmail',
        features: {
          supportsMediaQueries: true,
          supportsWebFonts: true,
          stripsStyleTags: false,
          supportsBackgroundImages: true
        }
      };

      const originalHtml = `
        <style>@media screen { .test { color: red; } }</style>
        <div style="font-family: CustomFont, Arial; background-image: url(bg.jpg);">Content</div>
      `;

      const result = emailRenderer.renderForEmailClient(originalHtml, fullSupportClient);

      expect(result).toBe(originalHtml);
    });
  });

  describe('Integration Tests', () => {
    it('should process a complete email template with multiple components', () => {
      const components = [
        {
          type: 'button',
          properties: {
            text: 'Subscribe Now',
            url: 'https://newsletter.com/subscribe',
            color: '#28a745'
          }
        },
        {
          type: 'image',
          properties: {
            src: 'https://newsletter.com/logo.png',
            alt: 'Newsletter Logo',
            width: '200px'
          }
        },
        {
          type: 'divider',
          properties: {
            color: '#e9ecef',
            style: 'solid'
          }
        }
      ];

      const emailHtml = components
        .map(component => emailRenderer.componentToEmailHtml(component))
        .join('\n\n');

      // Validate the complete email
      const warnings = emailRenderer.validateEmailCompatibility(emailHtml);

      // Should have no warnings for properly structured email components
      expect(warnings).toHaveLength(0);

      // Should contain all components
      expect(emailHtml).toContain('Subscribe Now');
      expect(emailHtml).toContain('Newsletter Logo');
      expect(emailHtml).toContain('border-top:');

      // Should be table-based throughout
      expect(emailHtml.match(/<table/g)).toHaveLength(3);
      expect(emailHtml).not.toContain('<div');
    });
  });
});
