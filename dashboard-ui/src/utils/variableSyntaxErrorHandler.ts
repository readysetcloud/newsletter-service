import type { ValidationError } from './errorHandling';

/**
 * Variable syntax error types
 */
export type VariableSyntaxErrorType =
  | 'unclosed_variable'
  | 'unclosed_block'
  | 'mismatched_block'
  | 'invalid_variable_path'
  | 'invalid_helper'
  | 'missing_parameter'
  | 'invalid_syntax'
  | 'nested_block_error'
  | 'unknown_variable'
  | 'type_mismatch';

/**
 *led variable syntax error information
 */
export interface VariableSyntaxError {
  type: VariableSyntaxErrorType;
  message: string;
  line?: number;
  column?: number;
  position?: number;
  length?: number;
  context?: string;
  suggestions: string[];
  severity: 'error' | 'warning' | 'info';
  fixable: boolean;
  autoFix?: string;
}

/**
 * Variable syntax validation result
 */
export interface VariableSyntaxValidationResult {
  isValid: boolean;
  errors: VariableSyntaxError[];
  warnings: VariableSyntaxError[];
  suggestions: string[];
}

/**
 * Common variable syntax patterns
 */
const SYNTAX_PATTERNS = {
  // Basic variable: {{variable.path}}
  VARIABLE: /\{\{([^{}#\/\s][^{}]*)\}\}/g,

  // Block helpers: {{#helper param}}...{{/helper}}
  BLOCK_OPEN: /\{\{#(\w+)([^{}]*)\}\}/g,
  BLOCK_CLOSE: /\{\{\/(\w+)\}\}/g,

  // Unclosed variables: {{variable without closing
  UNCLOSED_VARIABLE: /\{\{[^{}]*$/g,

  // Invalid characters in variable paths
  INVALID_PATH_CHARS: /[^a-zA-Z0-9._\-\[\]]/,

  // Valid helper names
  VALID_HELPERS: /^(if|unless|each|with|#if|#unless|#each|#with)$/
};

/**
 * Known control flow helpers and their requirements
 */
const CONTROL_FLOW_HELPERS = {
  'if': { requiresClosing: true, closingTag: '/if', minParams: 1 },
  'unless': { requiresClosing: true, closingTag: '/unless', minParams: 1 },
  'each': { requiresClosing: true, closingTag: '/each', minParams: 1 },
  'with': { requiresClosing: true, closingTag: '/with', minParams: 1 }
};

/**
 * Parse and validate variable syntax in text
 */
export const validateVariableSyntax = (text: string): VariableSyntaxValidationResult => {
  const errors: VariableSyntaxError[] = [];
  const warnings: VariableSyntaxError[] = [];
  const suggestions: string[] = [];

  // Track open blocks for matching
  const openBlocks: Array<{ helper: string; line: number; column: number }> = [];

  // Split text into lines for better error reporting
  const lines = text.split('\n');

  lines.forEach((line, lineIndex) => {
    const lineNumber = lineIndex + 1;

    // Check for unclosed variables
    const unclosedMatches = line.match(/\{\{[^{}]*$/g);
    if (unclosedMatches) {
      unclosedMatches.forEach(match => {
        const column = line.indexOf(match) + 1;
        errors.push({
          type: 'unclosed_variable',
          message: 'Variable is not properly closed',
          line: lineNumber,
          column,
          context: match,
          suggestions: [
            'Add closing braces: }}',
            'Check for missing closing braces',
            'Ensure variable syntax is complete'
          ],
          severity: 'error',
          fixable: true,
          autoFix: match + '}}'
        });
      });
    }

    // Check for block helpers
    const blockOpenMatches = [...line.matchAll(SYNTAX_PATTERNS.BLOCK_OPEN)];
    blockOpenMatches.forEach(match => {
      const [fullMatch, helper, params] = match;
      const column = (match.index || 0) + 1;

      // Validate helper name
      if (!CONTROL_FLOW_HELPERS[helper as keyof typeof CONTROL_FLOW_HELPERS]) {
        errors.push({
          type: 'invalid_helper',
          message: `Unknown block helper: ${helper}`,
          line: lineNumber,
          column,
          context: fullMatch,
          suggestions: [
            'Use a valid helper: if, unless, each, with',
            'Check helper spelling',
            'Remove # if this should be a regular variable'
          ],
          severity: 'error',
          fixable: false
        });
      } else {
        // Track open block
        openBlocks.push({ helper, line: lineNumber, column });

        // Validate parameters
        const helperConfig = CONTROL_FLOW_HELPERS[helper as keyof typeof CONTROL_FLOW_HELPERS];
        const paramCount = params.trim().split(/\s+/).filter(p => p.length > 0).length;

        if (paramCount < helperConfig.minParams) {
          errors.push({
            type: 'missing_parameter',
            message: `Block helper '${helper}' requires at least ${helperConfig.minParams} parameter(s)`,
            line: lineNumber,
            column,
            context: fullMatch,
            suggestions: [
              `Add required parameter: {{#${helper} condition}}`,
              'Check helper documentation for required parameters'
            ],
            severity: 'error',
            fixable: false
          });
        }
      }
    });

    // Check for block closing tags
    const blockCloseMatches = [...line.matchAll(SYNTAX_PATTERNS.BLOCK_CLOSE)];
    blockCloseMatches.forEach(match => {
      const [fullMatch, helper] = match;
      const column = (match.index || 0) + 1;

      // Find matching open block
      const openBlockIndex = openBlocks.findIndex(block => block.helper === helper);

      if (openBlockIndex === -1) {
        errors.push({
          type: 'mismatched_block',
          message: `Closing tag '{{/${helper}}}' has no matching opening tag`,
          line: lineNumber,
          column,
          context: fullMatch,
          suggestions: [
            `Add opening tag: {{#${helper} condition}}`,
            'Remove this closing tag if not needed',
            'Check for typos in helper names'
          ],
          severity: 'error',
          fixable: false
        });
      } else {
        // Remove the matched open block
        openBlocks.splice(openBlockIndex, 1);
      }
    });

    // Check for regular variables
    const variableMatches = [...line.matchAll(SYNTAX_PATTERNS.VARIABLE)];
    variableMatches.forEach(match => {
      const [fullMatch, variablePath] = match;
      const column = (match.index || 0) + 1;

      // Skip if this is actually a block helper
      if (variablePath.startsWith('#') || variablePath.startsWith('/')) {
        return;
      }

      // Validate variable path
      if (SYNTAX_PATTERNS.INVALID_PATH_CHARS.test(variablePath)) {
        warnings.push({
          type: 'invalid_variable_path',
          message: `Variable path contains invalid characters: ${variablePath}`,
          line: lineNumber,
          column,
          context: fullMatch,
          suggestions: [
            'Use only letters, numbers, dots, and underscores',
            'Remove special characters from variable path',
            'Check variable path syntax'
          ],
          severity: 'warning',
          fixable: false
        });
      }

      // Check for common typos
      if (variablePath.includes('..')) {
        warnings.push({
          type: 'invalid_syntax',
          message: 'Variable path contains double dots',
          line: lineNumber,
          column,
          context: fullMatch,
          suggestions: [
            'Remove extra dots from variable path',
            'Check for typos in variable path'
          ],
          severity: 'warning',
          fixable: true,
          autoFix: fullMatch.replace('..', '.')
        });
      }
    });
  });

  // Check for unclosed blocks
  openBlocks.forEach(block => {
    const helperConfig = CONTROL_FLOW_HELPERS[block.helper as keyof typeof CONTROL_FLOW_HELPERS];
    errors.push({
      type: 'unclosed_block',
      message: `Block helper '${block.helper}' is not closed`,
      line: block.line,
      column: block.column,
      context: `{{#${block.helper}}}`,
      suggestions: [
        `Add closing tag: {{/${block.helper}}}`,
        'Check for missing closing tags',
        'Ensure all block helpers are properly closed'
      ],
      severity: 'error',
      fixable: true,
      autoFix: `{{/${block.helper}}}`
    });
  });

  // Generate general suggestions based on errors found
  if (errors.length > 0) {
    suggestions.push('Check variable syntax highlighting for errors');
    suggestions.push('Use the variable picker to insert valid syntax');
    suggestions.push('Refer to the syntax help for correct formatting');
  }

  if (warnings.length > 0) {
    suggestions.push('Review warnings to improve template quality');
    suggestions.push('Consider fixing variable path formatting');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    suggestions
  };
};

/**
 * Get user-friendly error message for variable syntax errors
 */
export const getVariableSyntaxErrorMessage = (
  errors: VariableSyntaxError[],
  context?: string
): string => {
  if (errors.length === 0) {
    return 'No syntax errors found';
  }

  if (errors.length === 1) {
    const error = errors[0];
    const location = error.line ? ` (line ${error.line})` : '';
    return `${error.message}${location}`;
  }

  const errorTypes = errors.reduce((acc, error) => {
    acc[error.type] = (acc[error.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const errorSummary = Object.entries(errorTypes)
    .map(([type, count]) => {
      const typeName = type.replace(/_/g, ' ');
      return count === 1 ? typeName : `${count} ${typeName} errors`;
    })
    .join(', ');

  return `Found ${errors.length} syntax errors: ${errorSummary}`;
};

/**
 * Auto-fix simple variable syntax errors
 */
export const autoFixVariableSyntax = (text: string): { fixed: string; changes: string[] } => {
  let fixed = text;
  const changes: string[] = [];

  // Fix unclosed variables
  fixed = fixed.replace(/\{\{([^{}]*?)$/gm, (match, content) => {
    changes.push(`Added closing braces to: ${match}`);
    return `{{${content}}}`;
  });

  // Fix double dots in variable paths
  fixed = fixed.replace(/\{\{([^{}]*?)\.\.([^{}]*?)\}\}/g, (match, before, after) => {
    const replacement = `{{${before}.${after}}}`;
    changes.push(`Fixed double dots: ${match} → ${replacement}`);
    return replacement;
  });

  // Fix common spacing issues
  fixed = fixed.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, content) => {
    const trimmed = content.trim();
    if (content !== trimmed) {
      const replacement = `{{${trimmed}}}`;
      changes.push(`Trimmed whitespace: ${match} → ${replacement}`);
      return replacement;
    }
    return match;
  });

  return { fixed, changes };
};

/**
 * Extract variables from text (even with syntax errors)
 */
export const extractVariablesFromText = (text: string): Array<{
  path: string;
  line: number;
  column: number;
  isValid: boolean;
}> => {
  const variables: Array<{
    path: string;
    line: number;
    column: number;
    isValid: boolean;
  }> = [];

  const lines = text.split('\n');

  lines.forEach((line, lineIndex) => {
    // Match both valid and potentially invalid variable patterns
    const matches = [...line.matchAll(/\{\{([^{}]*?)\}\}/g)];

    matches.forEach(match => {
      const [, variablePath] = match;
      const column = (match.index || 0) + 1;

      // Skip block helpers
      if (variablePath.startsWith('#') || variablePath.startsWith('/')) {
        return;
      }

      const isValid = !SYNTAX_PATTERNS.INVALID_PATH_CHARS.test(variablePath) &&
                     !variablePath.includes('..');

      variables.push({
        path: variablePath.trim(),
        line: lineIndex + 1,
        column,
        isValid
      });
    });
  });

  return variables;
};

/**
 * Convert validation errors to standard ValidationError format
 */
export const convertToValidationErrors = (
  syntaxErrors: VariableSyntaxError[]
): ValidationError[] => {
  return syntaxErrors.map(error => ({
    field: error.context || 'template',
    message: error.message,
    code: error.type.toUpperCase(),
    value: error.context
  }));
};

/**
 * Check if text contains variable syntax
 */
export const containsVariableSyntax = (text: string): boolean => {
  return /\{\{.*?\}\}/.test(text);
};

/**
 * Get syntax highlighting information for variables
 */
export const getVariableSyntaxHighlighting = (text: string): Array<{
  start: number;
  end: number;
  type: 'variable' | 'block-open' | 'block-close' | 'error';
  severity?: 'error' | 'warning';
}> => {
  const highlights: Array<{
    start: number;
    end: number;
    type: 'variable' | 'block-open' | 'block-close' | 'error';
    severity?: 'error' | 'warning';
  }> = [];

  // Validate syntax to get error positions
  const validation = validateVariableSyntax(text);

  // Add error highlights
  validation.errors.forEach(error => {
    if (error.position !== undefined && error.length !== undefined) {
      highlights.push({
        start: error.position,
        end: error.position + error.length,
        type: 'error',
        severity: 'error'
      });
    }
  });

  validation.warnings.forEach(warning => {
    if (warning.position !== undefined && warning.length !== undefined) {
      highlights.push({
        start: warning.position,
        end: warning.position + warning.length,
        type: 'error',
        severity: 'warning'
      });
    }
  });

  // Add syntax highlights for valid variables
  const variableMatches = [...text.matchAll(/\{\{([^{}]*?)\}\}/g)];
  variableMatches.forEach(match => {
    const [fullMatch, content] = match;
    const start = match.index || 0;
    const end = start + fullMatch.length;

    // Skip if this position already has an error highlight
    const hasError = highlights.some(h =>
      h.type === 'error' && h.start <= start && h.end >= end
    );

    if (!hasError) {
      if (content.startsWith('#')) {
        highlights.push({ start, end, type: 'block-open' });
      } else if (content.startsWith('/')) {
        highlights.push({ start, end, type: 'block-close' });
      } else {
        highlights.push({ start, end, type: 'variable' });
      }
    }
  });

  return highlights.sort((a, b) => a.start - b.start);
};
