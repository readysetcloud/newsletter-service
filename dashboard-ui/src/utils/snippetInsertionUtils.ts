import type { Snippet, SnippetParameter } from '@/types/template';

interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

interface InsertionContext {
  cursorPosition: number;
  selectedText?: string;
  lineNumber?: number;
  columnNumber?: number;
  surroundingText?: string;
}

interface InsertionOptions {
  indentLevel?: number;
  preserveSelection?: boolean;
  addNewlines?: boolean;
  formatOutput?: boolean;
}

interface InsertionResult {
  success: boolean;
  insertedText: string;
  newCursorPosition: number;
  error?: string;
}

class SnippetInsertionUtils {
  /**
   * Validate snippet parameters with comprehensive type checking
   */
  static validateParameters(
    parameterDefinitions: SnippetParameter[],
    providedParameters: Record<string, any>
  ): ValidationResult {
    const errors: Record<string, string> = {};
    const warnings: Record<string, string> = {};

    for (const param of parameterDefinitions) {
      const value = providedParameters[param.name];
      const paramKey = param.name;

      // Check required parameters
      if (param.required && this.isEmpty(value)) {
        errors[paramKey] = `${param.name} is required`;
        continue;
      }

      // Skip further validation if parameter is not provided and not required
      if (this.isEmpty(value)) {
        continue;
      }

      // Type-specific validation
      const typeValidation = this.validateParameterType(param, value);
      if (!typeValidation.isValid) {
        errors[paramKey] = typeValidation.error!;
        continue;
      }

      // Custom validation rules
      const customValidation = this.validateCustomRules(param, value);
      if (!customValidation.isValid) {
        errors[paramKey] = customValidation.error!;
      }

      // Generate warnings for potential issues
      const warning = this.generateParameterWarning(param, value);
      if (warning) {
        warnings[paramKey] = warning;
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
      warnings
    };
  }

  /**
   * Check if a value is considered empty
   */
  private static isEmpty(value: any): boolean {
    return value === undefined || value === null || value === '';
  }

  /**
   * Validate parameter type
   */
  private static validateParameterType(
    param: SnippetParameter,
    value: any
  ): { isValid: boolean; error?: string } {
    switch (param.type) {
      case 'string':
        if (typeof value !== 'string') {
          return { isValid: false, error: `${param.name} must be a string` };
        }
        break;

      case 'number':
        const numValue = Number(value);
        if (isNaN(numValue) || !isFinite(numValue)) {
          return { isValid: false, error: `${param.name} must be a valid number` };
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          // Try to convert string representations
          if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lowerValue)) {
              return { isValid: false, error: `${param.name} must be a boolean value` };
            }
          } else {
            return { isValid: false, error: `${param.name} must be a boolean` };
          }
        }
        break;

      default:
        return { isValid: false, error: `Unknown parameter type: ${param.type}` };
    }

    return { isValid: true };
  }

  /**
   * Validate custom parameter rules (if any)
   */
  private static validateCustomRules(
    param: SnippetParameter,
    value: any
  ): { isValid: boolean; error?: string } {
    // Add custom validation logic here based on parameter metadata
    // For now, just return valid
    return { isValid: true };
  }

  /**
   * Generate warnings for parameter values
   */
  private static generateParameterWarning(param: SnippetParameter, value: any): string | null {
    // String length warnings
    if (param.type === 'string' && typeof value === 'string') {
      if (value.length > 1000) {
        return 'Very long text may affect performance';
      }
      if (value.includes('<script>') || value.includes('javascript:')) {
        return 'Potentially unsafe content detected';
      }
    }

    // Number range warnings
    if (param.type === 'number' && typeof value === 'number') {
      if (value < 0 && param.name.toLowerCase().includes('count')) {
        return 'Negative values may not be appropriate for count parameters';
      }
    }

    return null;
  }

  /**
   * Generate handlebars syntax for snippet insertion
   */
  static generateSnippetSyntax(
    snippet: Snippet,
    parameters: Record<string, any> = {},
    options: InsertionOptions = {}
  ): string {
    const { indentLevel = 0, formatOutput = true } = options;

    // Validate parameters first
    const validation = this.validateParameters(snippet.parameters || [], parameters);
    if (!validation.isValid) {
      throw new Error(`Parameter validation failed: ${Object.values(validation.errors).join(', ')}`);
    }

    // Build parameter string
    const parameterPairs: string[] = [];

    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null && value !== '') {
        const formattedValue = this.formatParameterValue(value);
        parameterPairs.push(`${key}=${formattedValue}`);
      }
    }

    // Generate the handlebars syntax
    let syntax = `{{> ${snippet.name}`;

    if (parameterPairs.length > 0) {
      if (formatOutput && parameterPairs.length > 3) {
        // Multi-line format for many parameters
        const indent = '  '.repeat(indentLevel + 1);
        const paramString = parameterPairs
          .map(pair => `${indent}${pair}`)
          .join('\n');
        syntax = `{{> ${snippet.name}\n${paramString}\n${'  '.repeat(indentLevel)}}}`;
      } else {
        // Single line format
        syntax += ` ${parameterPairs.join(' ')}`;
        syntax += ' }}';
      }
    } else {
      syntax += ' }}';
    }

    return syntax;
  }

  /**
   * Format parameter value for handlebars syntax
   */
  private static formatParameterValue(value: any): string {
    if (typeof value === 'string') {
      // Escape quotes and wrap in quotes if contains spaces or special characters
      const escaped = value.replace(/"/g, '\\"');
      if (escaped.includes(' ') || escaped.includes('=') || escaped.includes('}')) {
        return `"${escaped}"`;
      }
      return escaped;
    }

    if (typeof value === 'boolean') {
      return value.toString();
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    // For other types, stringify and quote
    return `"${String(value).replace(/"/g, '\\"')}"`;
  }

  /**
   * Insert snippet at cursor position in text
   */
  static insertSnippetAtPosition(
    originalText: string,
    snippet: Snippet,
    parameters: Record<string, any>,
    context: InsertionContext,
    options: InsertionOptions = {}
  ): InsertionResult {
    try {
      const {
        preserveSelection = false,
        addNewlines = true,
        formatOutput = true,
        indentLevel = 0
      } = options;

      // Generate snippet syntax
      const snippetSyntax = this.generateSnippetSyntax(snippet, parameters, {
        indentLevel,
        formatOutput
      });

      const { cursorPosition, selectedText } = context;

      // Calculate insertion text
      let insertionText = snippetSyntax;

      if (addNewlines) {
        // Add newlines if not at start/end of line
        const beforeCursor = originalText.substring(0, cursorPosition);
        const afterCursor = originalText.substring(cursorPosition);

        const needsNewlineBefore = beforeCursor.length > 0 && !beforeCursor.endsWith('\n');
        const needsNewlineAfter = afterCursor.length > 0 && !afterCursor.startsWith('\n');

        if (needsNewlineBefore) insertionText = '\n' + insertionText;
        if (needsNewlineAfter) insertionText = insertionText + '\n';
      }

      // Handle text replacement vs insertion
      let newText: string;
      let newCursorPosition: number;

      if (selectedText && !preserveSelection) {
        // Replace selected text
        const selectionStart = cursorPosition;
        const selectionEnd = cursorPosition + selectedText.length;

        newText = originalText.substring(0, selectionStart) +
                 insertionText +
                 originalText.substring(selectionEnd);

        newCursorPosition = selectionStart + insertionText.length;
      } else {
        // Insert at cursor position
        newText = originalText.substring(0, cursorPosition) +
                 insertionText +
                 originalText.substring(cursorPosition);

        newCursorPosition = cursorPosition + insertionText.length;
      }

      return {
        success: true,
        insertedText: newText,
        newCursorPosition
      };
    } catch (error) {
      return {
        success: false,
        insertedText: originalText,
        newCursorPosition: context.cursorPosition,
        error: error instanceof Error ? error.message : 'Unknown error during insertion'
      };
    }
  }

  /**
   * Parse existing snippet syntax from text
   */
  static parseSnippetSyntax(text: string): Array<{
    snippetName: string;
    parameters: Record<string, any>;
    startPosition: number;
    endPosition: number;
    fullMatch: string;
  }> {
    const snippetRegex = /\{\{>\s*([a-zA-Z0-9_-]+)([^}]*)\}\}/g;
    const results: Array<{
      snippetName: string;
      parameters: Record<string, any>;
      startPosition: number;
      endPosition: number;
      fullMatch: string;
    }> = [];

    let match;
    while ((match = snippetRegex.exec(text)) !== null) {
      const [fullMatch, snippetName, paramString] = match;
      const parameters = this.parseParameterString(paramString.trim());

      results.push({
        snippetName,
        parameters,
        startPosition: match.index,
        endPosition: match.index + fullMatch.length,
        fullMatch
      });
    }

    return results;
  }

  /**
   * Parse parameter string from handlebars syntax
   */
  private static parseParameterString(paramString: string): Record<string, any> {
    const parameters: Record<string, any> = {};

    if (!paramString.trim()) {
      return parameters;
    }

    // Simple parameter parsing - can be enhanced for complex cases
    const paramRegex = /(\w+)=(?:"([^"]*)"|([^\s]+))/g;
    let match;

    while ((match = paramRegex.exec(paramString)) !== null) {
      const [, key, quotedValue, unquotedValue] = match;
      const value = quotedValue !== undefined ? quotedValue : unquotedValue;

      // Try to parse as appropriate type
      parameters[key] = this.parseParameterValue(value);
    }

    return parameters;
  }

  /**
   * Parse parameter value to appropriate type
   */
  private static parseParameterValue(value: string): any {
    // Boolean values
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Number values
    const numValue = Number(value);
    if (!isNaN(numValue) && isFinite(numValue)) {
      return numValue;
    }

    // String value
    return value;
  }

  /**
   * Find snippet at cursor position
   */
  static findSnippetAtPosition(text: string, cursorPosition: number): {
    snippetName: string;
    parameters: Record<string, any>;
    startPosition: number;
    endPosition: number;
    fullMatch: string;
  } | null {
    const snippets = this.parseSnippetSyntax(text);

    return snippets.find(snippet =>
      cursorPosition >= snippet.startPosition &&
      cursorPosition <= snippet.endPosition
    ) || null;
  }

  /**
   * Get context information around cursor position
   */
  static getInsertionContext(text: string, cursorPosition: number): InsertionContext {
    const lines = text.split('\n');
    let currentPosition = 0;
    let lineNumber = 0;
    let columnNumber = 0;

    // Find line and column
    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length + 1; // +1 for newline
      if (currentPosition + lineLength > cursorPosition) {
        lineNumber = i;
        columnNumber = cursorPosition - currentPosition;
        break;
      }
      currentPosition += lineLength;
    }

    // Get surrounding text for context
    const surroundingStart = Math.max(0, cursorPosition - 100);
    const surroundingEnd = Math.min(text.length, cursorPosition + 100);
    const surroundingText = text.substring(surroundingStart, surroundingEnd);

    return {
      cursorPosition,
      lineNumber,
      columnNumber,
      surroundingText
    };
  }

  /**
   * Sanitize parameter values to prevent XSS
   */
  static sanitizeParameters(parameters: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === 'string') {
        // Basic XSS prevention
        sanitized[key] = value
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '');
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Generate parameter hints for autocomplete
   */
  static generateParameterHints(snippet: Snippet): Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
    defaultValue?: any;
  }> {
    return (snippet.parameters || []).map(param => ({
      name: param.name,
      type: param.type,
      required: param.required,
      description: param.description,
      defaultValue: param.defaultValue
    }));
  }
}

export default SnippetInsertionUtils;
