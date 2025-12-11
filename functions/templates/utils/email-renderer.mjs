// Email client compatibility patterns
const EMAIL_SAFE_PATTERNS = {
  // Table-based button structure for maximum compatibility
  button: (text, url, color = '#007bff', textColor = '#ffffff') => `
<table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
  <tr>
    <td style="background-color: ${color}; border-radius: 4px; padding: 12px 24px; text-align: center;">
      <a href="${url}" style="color: ${textColor}; text-decoration: none; font-weight: bold; display: inline-block; font-family: Arial, sans-serif;">
        ${text}
      </a>
    </td>
  </tr>
</table>`.trim(),

  // Email-safe image with proper attributes
  image: (src, alt, width = '100%', align = 'center') => `
<table cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td align="${align}">
      <img src="${src}" alt="${alt}" style="display: block; max-width: ${width}; height: auto; border: 0;" width="${width === '100%' ? '600' : width}" />
    </td>
  </tr>
</table>`.trim(),

  // Email-safe divider
  divider: (color = '#cccccc', style = 'solid', height = '1px') => `
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td style="border-top: ${height} ${style} ${color}; font-size: 0; line-height: 0;">&nbsp;</td>
  </tr>
</table>`.trim(),

  // Email-safe text block
  text: (content, align = 'left', fontSize = '14px', color = '#000000') => `
<table cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: ${fontSize}; color: ${color}; text-align: ${align}; line-height: 1.4; padding: 8px 0;">
      ${content}
    </td>
  </tr>
</table>`.trim(),

  // Email-safe heading
  heading: (text, level = 'h2', align = 'left', color = '#000000') => {
    const fontSize = {
      h1: '24px',
      h2: '20px',
      h3: '18px',
      h4: '16px',
      h5: '14px',
      h6: '12px'
    }[level] || '20px';

    return `
<table cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: ${fontSize}; font-weight: bold; color: ${color}; text-align: ${align}; line-height: 1.2; padding: 16px 0 8px 0;">
      ${text}
    </td>
  </tr>
</table>`.trim();
  }
};

/**
 * Convert component to email-compatible HTML
 * @param {Object} component - Component object with type and properties
 * @returns {string} Email-compatible HTML
 */
export const componentToEmailHtml = (component) => {
  const { type, properties } = component;

  switch (type) {
    case 'button':
      return EMAIL_SAFE_PATTERNS.button(
        properties.text || 'Button',
        properties.url || '#',
        properties.color || '#007bff',
        properties.textColor || '#ffffff'
      );

    case 'image':
      return EMAIL_SAFE_PATTERNS.image(
        properties.src || '',
        properties.alt || '',
        properties.width || '100%',
        properties.align || 'center'
      );

    case 'divider':
      return EMAIL_SAFE_PATTERNS.divider(
        properties.color || '#cccccc',
        properties.style || 'solid',
        properties.height || '1px'
      );

    case 'text':
      return EMAIL_SAFE_PATTERNS.text(
        properties.content || '',
        properties.align || 'left',
        properties.fontSize || '14px',
        properties.color || '#000000'
      );

    case 'heading':
      return EMAIL_SAFE_PATTERNS.heading(
        properties.text || 'Heading',
        properties.level || 'h2',
        properties.align || 'left',
        properties.color || '#000000'
      );

    default:
      return `<!-- Unsupported component type: ${type} -->`;
  }
};

/**
 * Generate complete email-compatible template
 * @param {Array} components - Array of components
 * @param {Object} options - Template options
 * @returns {string} Complete email HTML
 */
export const generateEmailTemplate = (components, options = {}) => {
  const {
    title = 'Newsletter',
    preheader = '',
    backgroundColor = '#ffffff',
    contentWidth = '600px',
    fontFamily = 'Arial, sans-serif'
  } = options;

  const componentHtml = components
    .map(component => componentToEmailHtml(component))
    .join('\n\n');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">
    table {border-collapse: collapse;}
    table, td {mso-table-lspace: 0pt; mso-table-rspace: 0pt;}
    img {-ms-interpolation-mode: bicubic;}
  </style>
  <![endif]-->
  <style type="text/css">
    body {
      margin: 0;
      padding: 0;
      font-family: ${fontFamily};
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }
    @media screen and (max-width: 600px) {
      .mobile-width {
        width: 100% !important;
      }
      .mobile-padding {
        padding: 10px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${backgroundColor};">
  ${preheader ? `
  <div style="display: none; font-size: 1px; color: #fefefe; line-height: 1px; font-family: ${fontFamily}; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${preheader}
  </div>
  ` : ''}

  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${backgroundColor};">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: ${contentWidth};" class="mobile-width">
          <tr>
            <td style="padding: 20px;" class="mobile-padding">
              ${componentHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Inline CSS styles for maximum email client compatibility
 * @param {string} html - HTML content
 * @returns {string} HTML with inlined styles
 */
export const inlineStyles = (html) => {
  // Simple CSS inlining - for production, consider using a library like 'juice'
  // This is a basic implementation for common patterns

  let inlinedHtml = html;

  // Inline common styles
  const styleReplacements = [
    // Convert margin/padding shorthand to individual properties
    {
      pattern: /style="([^"]*?)margin:\s*(\d+px)\s*(\d+px)\s*(\d+px)\s*(\d+px)([^"]*?)"/g,
      replacement: 'style="$1margin-top: $2; margin-right: $3; margin-bottom: $4; margin-left: $5;$6"'
    },
    {
      pattern: /style="([^"]*?)padding:\s*(\d+px)\s*(\d+px)\s*(\d+px)\s*(\d+px)([^"]*?)"/g,
      replacement: 'style="$1padding-top: $2; padding-right: $3; padding-bottom: $4; padding-left: $5;$6"'
    }
  ];

  styleReplacements.forEach(({ pattern, replacement }) => {
    inlinedHtml = inlinedHtml.replace(pattern, replacement);
  });

  return inlinedHtml;
};

/**
 * Validate email compatibility and return warnings
 * @param {string} html - HTML content to validate
 * @returns {Array} Array of warning objects
 */
export const validateEmailCompatibility = (html) => {
  const warnings = [];

  // Check for potentially problematic elements
  const problematicPatterns = [
    {
      pattern: /<div[^>]*>/gi,
      message: 'DIV elements may not render consistently across email clients. Consider using tables instead.',
      severity: 'warning'
    },
    {
      pattern: /<span[^>]*>/gi,
      message: 'SPAN elements may have limited support in some email clients.',
      severity: 'info'
    },
    {
      pattern: /position:\s*(absolute|fixed|relative)/gi,
      message: 'CSS positioning may not work in email clients. Use table-based layouts instead.',
      severity: 'error'
    },
    {
      pattern: /float:\s*(left|right)/gi,
      message: 'CSS float property is not supported in many email clients.',
      severity: 'warning'
    },
    {
      pattern: /display:\s*(flex|grid)/gi,
      message: 'Modern CSS layout methods (flexbox, grid) are not supported in email clients.',
      severity: 'error'
    },
    {
      pattern: /@media[^{]*{[^}]*}/gi,
      message: 'Media queries have limited support. Test thoroughly across email clients.',
      severity: 'info'
    },
    {
      pattern: /background-image:/gi,
      message: 'Background images may not display in all email clients, especially Outlook.',
      severity: 'warning'
    }
  ];

  problematicPatterns.forEach(({ pattern, message, severity }) => {
    const matches = html.match(pattern);
    if (matches) {
      warnings.push({
        type: 'compatibility',
        severity,
        message,
        count: matches.length,
        examples: matches.slice(0, 3) // Show first 3 examples
      });
    }
  });

  // Check for missing alt attributes on images
  const imgWithoutAlt = html.match(/<img(?![^>]*alt=)[^>]*>/gi);
  if (imgWithoutAlt) {
    warnings.push({
      type: 'accessibility',
      severity: 'warning',
      message: 'Images without alt attributes may cause accessibility issues.',
      count: imgWithoutAlt.length,
      examples: imgWithoutAlt.slice(0, 3)
    });
  }

  // Check for inline styles vs style attributes
  const styleElements = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi);
  if (styleElements) {
    warnings.push({
      type: 'compatibility',
      severity: 'info',
      message: 'Style elements may be stripped by some email clients. Consider inlining critical styles.',
      count: styleElements.length
    });
  }

  return warnings;
};

/**
 * Get email client preview modes
 * @returns {Array} Array of email client configurations
 */
export const getEmailClientPreviews = () => [
  {
    name: 'Gmail (Desktop)',
    id: 'gmail-desktop',
    viewport: { width: 600, height: 800 },
    features: {
      supportsMediaQueries: true,
      supportsWebFonts: true,
      stripsStyleTags: false,
      supportsBackgroundImages: true
    }
  },
  {
    name: 'Gmail (Mobile)',
    id: 'gmail-mobile',
    viewport: { width: 320, height: 568 },
    features: {
      supportsMediaQueries: true,
      supportsWebFonts: true,
      stripsStyleTags: false,
      supportsBackgroundImages: true
    }
  },
  {
    name: 'Outlook 2016/2019',
    id: 'outlook-desktop',
    viewport: { width: 600, height: 800 },
    features: {
      supportsMediaQueries: false,
      supportsWebFonts: false,
      stripsStyleTags: true,
      supportsBackgroundImages: false
    }
  },
  {
    name: 'Outlook.com',
    id: 'outlook-web',
    viewport: { width: 600, height: 800 },
    features: {
      supportsMediaQueries: true,
      supportsWebFonts: true,
      stripsStyleTags: false,
      supportsBackgroundImages: true
    }
  },
  {
    name: 'Apple Mail (iOS)',
    id: 'apple-mail-ios',
    viewport: { width: 320, height: 568 },
    features: {
      supportsMediaQueries: true,
      supportsWebFonts: true,
      stripsStyleTags: false,
      supportsBackgroundImages: true
    }
  },
  {
    name: 'Apple Mail (macOS)',
    id: 'apple-mail-macos',
    viewport: { width: 600, height: 800 },
    features: {
      supportsMediaQueries: true,
      supportsWebFonts: true,
      stripsStyleTags: false,
      supportsBackgroundImages: true
    }
  }
];

/**
 * Render template for specific email client
 * @param {string} html - Base HTML content
 * @param {string} clientId - Email client ID
 * @returns {string} Client-specific HTML
 */
export const renderForEmailClient = (html, clientId) => {
  const client = getEmailClientPreviews().find(c => c.id === clientId);
  if (!client) {
    return html;
  }

  let clientHtml = html;

  // Apply client-specific modifications
  if (!client.features.supportsMediaQueries) {
    // Remove media queries for clients that don't support them
    clientHtml = clientHtml.replace(/@media[^{]*{[^}]*}/gi, '');
  }

  if (!client.features.supportsWebFonts) {
    // Replace web fonts with fallbacks
    clientHtml = clientHtml.replace(/font-family:\s*[^,;]*,\s*/gi, 'font-family: ');
  }

  if (client.features.stripsStyleTags) {
    // Remove style tags for clients that strip them
    clientHtml = clientHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  }

  if (!client.features.supportsBackgroundImages) {
    // Remove background images for clients that don't support them
    clientHtml = clientHtml.replace(/background-image:[^;]*;?/gi, '');
  }

  return clientHtml;
};

export default {
  componentToEmailHtml,
  generateEmailTemplate,
  inlineStyles,
  validateEmailCompatibility,
  getEmailClientPreviews,
  renderForEmailClient
};
