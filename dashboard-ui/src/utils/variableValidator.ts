import {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  CustomVariable,
  VariableType
} from '../types/variable';

export class VariableValidator {
  /**
   * Validates a variable name for handlebars compatibility
   */
  validateName(name: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check if name is empty
    if (!name || name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Variable name is required',
        code: 'REQUIRED'
      });
    }

    // Check for valid characters (alphanumeric, underscore, hyphen)
    const validNamePattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (name && !validNamePattern.test(name)) {
      errors.push({
        field: 'name',
        message: 'Variable name must start with a letter and contain only letters, numbers, underscores, and hyphens',
        code: 'INVALID_FORMAT'
      });
    }

    // Check length constraints
    if (name && name.length > 50) {
      errors.push({
        field: 'name',
        message: 'Variable name must be 50 characters or less',
        code: 'TOO_LONG'
      });
    }

    if (name && name.length < 2) {
      errors.push({
        field: 'name',
        message: 'Variable name must be at least 2 characters long',
        code: 'TOO_SHORT'
      });
    }

    // Check for reserved words
    const reservedWords = ['if', 'unless', 'each', 'with', 'this', 'true', 'false', 'null', 'undefined'];
    if (name && reservedWords.includes(name.toLowerCase())) {
      errors.push({
        field: 'name',
        message: `"${name}" is a reserved word and cannot be used as a variable name`,
        code: 'RESERVED_WORD'
      });
    }

    // Warnings for best practices
    if (name && name.includes('-')) {
      warnings.push({
        field: 'name',
        message: 'Consider using underscod of hyphens for better readability',
        code: 'STYLE_SUGGESTION'
      });
    }

    if (name && name.length > 30) {
      warnings.push({
        field: 'name',
        message: 'Consider using a shorter name for better readability',
        code: 'LENGTH_SUGGESTION'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validates a variable path for handlebars compatibility
   */
  validatePath(path: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check if path is empty
    if (!path || path.trim().length === 0) {
      errors.push({
        field: 'path',
        message: 'Variable path is required',
        code: 'REQUIRED'
      });
    }

    // Check for valid path format (dot notation)
    const validPathPattern = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/;
    if (path && !validPathPattern.test(path)) {
      errors.push({
        field: 'path',
        message: 'Variable path must use dot notation (e.g., "custom.myVariable")',
        code: 'INVALID_FORMAT'
      });
    }

    // Check path length
    if (path && path.length > 100) {
      errors.push({
        field: 'path',
        message: 'Variable path must be 100 characters or less',
        code: 'TOO_LONG'
      });
    }

    // Check for reserved paths
    const reservedPaths = [
      'newsletter', 'subscriber', 'brand', 'system',
      'newsletter.title', 'newsletter.issue', 'newsletter.date',
      'subscriber.firstName', 'subscriber.lastName', 'subscriber.email',
      'brand.name', 'brand.logo', 'brand.website',
      'system.unsubscribeUrl', 'system.viewOnlineUrl'
    ];

    if (path && reservedPaths.includes(path)) {
      errors.push({
        field: 'path',
        message: `"${path}" is a reserved path and cannot be used for custom variables`,
        code: 'RESERVED_PATH'
      });
    }

    // Check for valid custom path prefix
    if (path && !path.startsWith('custom.')) {
      warnings.push({
        field: 'path',
        message: 'Custom variables should typically start with "custom." prefix',
        code: 'PATH_CONVENTION'
      });
    }

    // Check path depth
    const pathDepth = path ? path.split('.').length : 0;
    if (pathDepth > 5) {
      warnings.push({
        field: 'path',
        message: 'Consider using a shallower path structure for better performance',
        code: 'DEPTH_SUGGESTION'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validates a variable value based on its type
   */
  validateValue(value: any, type: VariableType): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check if value is provided
    if (value === null || value === undefined) {
      warnings.push({
        field: 'value',
        message: 'No default value provided',
        code: 'NO_DEFAULT'
      });
      return { isValid: true, errors, warnings };
    }

    // Type-specific validation
    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push({
            field: 'value',
            message: 'Value must be a string',
            code: 'TYPE_MISMATCH'
          });
        } else if (value.length > 1000) {
          warnings.push({
            field: 'value',
            message: 'String value is very long and may impact performance',
            code: 'LENGTH_WARNING'
          });
        }
        break;

      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          errors.push({
            field: 'value',
            message: 'Value must be a valid number',
            code: 'TYPE_MISMATCH'
          });
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({
            field: 'value',
            message: 'Value must be true or false',
            code: 'TYPE_MISMATCH'
          });
        }
        break;

      case 'url':
        if (typeof value !== 'string') {
          errors.push({
            field: 'value',
            message: 'URL value must be a string',
            code: 'TYPE_MISMATCH'
          });
        } else {
          try {
            new URL(value);
          } catch {
            errors.push({
              field: 'value',
              message: 'Value must be a valid URL',
              code: 'INVALID_URL'
            });
          }
        }
        break;

      case 'date':
        if (typeof value === 'string') {
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            errors.push({
              field: 'value',
              message: 'Value must be a valid date string',
              code: 'INVALID_DATE'
            });
          }
        } else if (!(value instanceof Date)) {
          errors.push({
            field: 'value',
            message: 'Value must be a date string or Date object',
            code: 'TYPE_MISMATCH'
          });
        }
        break;

      case 'array':
        if (!Array.isArray(value)) {
          errors.push({
            field: 'value',
            message: 'Value must be an array',
            code: 'TYPE_MISMATCH'
          });
        } else if (value.length > 100) {
          warnings.push({
            field: 'value',
            message: 'Array is very large and may impact performance',
            code: 'SIZE_WARNING'
          });
        }
        break;

      case 'object':
        if (typeof value !== 'object' || Array.isArray(value) || value === null) {
          errors.push({
            field: 'value',
            message: 'Value must be an object',
            code: 'TYPE_MISMATCH'
          });
        } else {
          const keys = Object.keys(value);
          if (keys.length > 50) {
            warnings.push({
              field: 'value',
              message: 'Object has many properties and may impact performance',
              code: 'SIZE_WARNING'
            });
          }
        }
        break;

      default:
        warnings.push({
          field: 'value',
          message: `Unknown variable type: ${type}`,
          code: 'UNKNOWN_TYPE'
        });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Checks for conflicts with existing variables
   */
  checkForConflicts(variable: CustomVariable, existing: CustomVariable[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for duplicate names
    const duplicateName = existing.find(v =>
      v.id !== variable.id &&
      v.name.toLowerCase() === variable.name.toLowerCase()
    );

    if (duplicateName) {
      errors.push({
        field: 'name',
        message: `A variable with the name "${variable.name}" already exists`,
        code: 'DUPLICATE_NAME'
      });
    }

    // Check for duplicate paths
    const duplicatePath = existing.find(v =>
      v.id !== variable.id &&
      v.path === variable.path
    );

    if (duplicatePath) {
      errors.push({
        field: 'path',
        message: `A variable with the path "${variable.path}" already exists`,
        code: 'DUPLICATE_PATH'
      });
    }

    // Check for similar names (potential confusion)
    const similarNames = existing.filter(v =>
      v.id !== variable.id &&
      this.calculateSimilarity(v.name.toLowerCase(), variable.name.toLowerCase()) > 0.8
    );

    if (similarNames.length > 0) {
      warnings.push({
        field: 'name',
        message: `Similar variable names exist: ${similarNames.map(v => v.name).join(', ')}`,
        code: 'SIMILAR_NAMES'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validates handlebars syntax in a template string
   */
  validateHandlebarsSyntax(template: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for unmatched braces
    const openBraces = (template.match(/\{\{/g) || []).length;
    const closeBraces = (template.match(/\}\}/g) || []).length;

    if (openBraces !== closeBraces) {
      errors.push({
        field: 'template',
        message: 'Unmatched handlebars braces',
        code: 'UNMATCHED_BRACES'
      });
    }

    // Check for unmatched block helpers
    const blockHelpers = template.match(/\{\{#(\w+)[^}]*\}\}/g) || [];
    const closingHelpers = template.match(/\{\{\/(\w+)\}\}/g) || [];

    const openHelpers = blockHelpers.map(match => {
      const helperMatch = match.match(/\{\{#(\w+)/);
      return helperMatch ? helperMatch[1] : '';
    }).filter(Boolean);

    const closeHelpers = closingHelpers.map(match => {
      const helperMatch = match.match(/\{\{\/(\w+)\}\}/);
      return helperMatch ? helperMatch[1] : '';
    }).filter(Boolean);

    // Check if each opening helper has a corresponding closing helper
    const helperCounts: Record<string, number> = {};

    openHelpers.forEach(helper => {
      helperCounts[helper] = (helperCounts[helper] || 0) + 1;
    });

    closeHelpers.forEach(helper => {
      helperCounts[helper] = (helperCounts[helper] || 0) - 1;
    });

    Object.entries(helperCounts).forEach(([helper, count]) => {
      if (count > 0) {
        errors.push({
          field: 'template',
          message: `Block helper "${helper}" is not properly closed`,
          code: 'UNCLOSED_BLOCK'
        });
      } else if (count < 0) {
        errors.push({
          field: 'template',
          message: `Extra closing tag for block helper "${helper}"`,
          code: 'EXTRA_CLOSING'
        });
      }
    });

    // Check for invalid variable paths
    const variableMatches = template.match(/\{\{(?!#|\/)[^}]+\}\}/g) || [];
    variableMatches.forEach(match => {
      const variable = match.replace(/\{\{|\}\}/g, '').trim();
      if (variable && !this.isValidVariablePath(variable)) {
        warnings.push({
          field: 'template',
          message: `Potentially invalid variable path: "${variable}"`,
          code: 'INVALID_VARIABLE_PATH'
        });
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validates a complete custom variable
   */
  validateCustomVariable(variable: CustomVariable, existing: CustomVariable[] = []): ValidationResult {
    const nameValidation = this.validateName(variable.name);
    const pathValidation = this.validatePath(variable.path);
    const valueValidation = this.validateValue(variable.defaultValue, variable.type);
    const conflictValidation = this.checkForConflicts(variable, existing);

    const allErrors = [
      ...nameValidation.errors,
      ...pathValidation.errors,
      ...valueValidation.errors,
      ...conflictValidation.errors
    ];

    const allWarnings = [
      ...nameValidation.warnings,
      ...pathValidation.warnings,
      ...valueValidation.warnings,
      ...conflictValidation.warnings
    ];

    return {
      isValid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings
    };
  }

  /**
   * Helper method to calculate string similarity
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Helper method to calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Helper method to check if a variable path is valid
   */
  private isValidVariablePath(path: string): boolean {
    // Allow simple variable paths and some common handlebars helpers
    // Reject paths with consecutive dots or starting with numbers
    if (path.includes('..') || /^\d/.test(path)) {
      return false;
    }
    const validPathPattern = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$|^this(\.[a-zA-Z][a-zA-Z0-9_]*)*$/;
    return validPathPattern.test(path.trim());
  }
}
