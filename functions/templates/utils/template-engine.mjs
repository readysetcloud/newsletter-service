import Handlebars from 'handlebars';
import { componentToEmailHtml, validateEmailCompatibility, inlineStyles } from './email-renderer.mjs';

/**
 * Render a handlebars template
 * @param {string} templateContent - The handlebars template content
 * @param {Object} data - Data to render the template with
 * @param {Object} options - Rendering options
 * @returns {string} Rendered HTML content
 */
export const renderTemplate = (templateContent, data, options = {}) => {
  try {
    const template = Handlebars.compile(templateContent);
    let rendered = template(data);

    // Apply email compatibility if requested
    if (options.emailCompatible) {
      rendered = inlineStyles(rendered);
    }

    return rendered;
  } catch (error) {
    console.error('Template rendering error:', error);
    throw new Error(`Template rendering failed: ${error.message}`);
  }
};

/**
 * Render a snippet with parameters
 * @param {string} snippetContent - The snippet handlebars content
 * @param {Object} parameters - Parameters to render the snippet with
 * @returns {string} Rendered HTML content
 */
export const renderSnippet = (snippetContent, parameters = {}) => {
  return renderTemplate(snippetContent, parameters);
};

/**
 * Validate handlebars template syntax and email compatibility
 * @param {string} templateContent - The template content to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result with isValid, errors, and warnings
 */
export const validateTemplate = (templateContent, options = {}) => {
  if (!templateContent || typeof templateContent !== 'string' || templateContent.trim().length === 0) {
    return {
      isValid: false,
      errors: ['Template content is required'],
      warnings: []
    };
  }

  const errors = [];
  const warnings = [];

  try {
    const template = Handlebars.compile(templateContent);
    template({}); // Test with empty data

    // Check email compatibility if requested
    if (options.checkEmailCompatibility) {
      const emailWarnings = validateEmailCompatibility(templateContent);
      warnings.push(...emailWarnings);
    }

    return {
      isValid: true,
      errors: [],
      warnings
    };
  } catch (error) {
    errors.push(error.message);
    return {
      isValid: false,
      errors,
      warnings
    };
  }
};



/**
 * Extract used snippets from template content
 * @param {string} templateContent - Template content
 * @returns {Array<string>} Array of snippet names used in template
 */
export const extractUsedSnippets = (templateContent) => {
  const snippetRegex = /\{\{>\s*([a-zA-Z0-9_-]+)/g;
  const snippets = [];
  let match;

  while ((match = snippetRegex.exec(templateContent)) !== null) {
    const snippetName = match[1].trim();
    if (!snippets.includes(snippetName)) {
      snippets.push(snippetName);
    }
  }

  return snippets;
};

/**
 * Validate snippet syntax and email compatibility
 * @param {string} snippetContent - The snippet content to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result with isValid, errors, and warnings
 */
export const validateSnippet = (snippetContent, options = {}) => {
  return validateTemplate(snippetContent, options);
};

/**
 * Convert visual components to email-compatible handlebars template
 * @param {Array} components - Array of visual components
 * @param {Object} options - Conversion options
 * @returns {string} Email-compatible handlebars template
 */
export const componentsToEmailTemplate = (components, options = {}) => {
  if (!Array.isArray(components)) {
    return '';
  }

  const emailHtml = components
    .map(component => componentToEmailHtml(component))
    .join('\n\n');

  return emailHtml;
};
