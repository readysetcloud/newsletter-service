import { formatResponse } from '../../utils/helpers.mjs';
import { validateTemplate, validateSnippet } from './template-engine.mjs';

/**
 * Simple validation for template/snippet requests
 */
export const validateRequestBody = (body, type) => {
  const errors = [];

  if (type === 'template') {
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      errors.push('Template name is required');
    }
    if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
      errors.push('Template content is required');
    }
  }

  if (type === 'snippet') {
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      errors.push('Snippet name is required');
    }
    if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
      errors.push('Snippet content is required');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate template content syntax
 */
export const validateTemplateContent = (content) => {
  return validateTemplate(content);
};

/**
 * Validate snippet content syntax
 */
export const validateSnippetContent = (content) => {
  return validateSnippet(content);
};
