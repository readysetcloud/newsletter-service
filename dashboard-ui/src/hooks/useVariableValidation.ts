import { useMemo, useCallback } from 'react';
import { ValidationResult, Variable, CustomVariable, VariableType } from '../types/variable';
import { VariableValidator } from '../utils/variableValidator';

interface UseVariableValidationOptions {
  validateSyntax?: boolean;
  validateVariables?: boolean;
  existingVariables?: CustomVariable[];
  realTime?: boolean;
}

interface VariableValidationHook {
  validateContent: (content: string) => ValidationResult;
  validateVariable: (variable: CustomVariable) => ValidationResult;
  validateName: (name: string) => ValidationResult;
  validatePath: (path: string) => ValidationResult;
  validateValue: (value: any, type: VariableType) => ValidationResult;
  isValidSyntax: (content: string) => boolean;
  getValidationErrors: (content: string) => string[];
  getValidationWarnings: (content: string) => string[];
}

export const useVariableValidation = (
  options: UseVariableValidationOptions = {}
): VariableValidationHook => {
  const {
    validateSyntax = true,
    validateVariables = true,
    existingVariables = [],
    realTime = true
  } = options;

  const validator = useMemo(() => new VariableValidator(), []);

  const validateContent = useCallback((content: string): ValidationResult => {
    if (!content || content.trim().length === 0) {
      return {
        isValid: true,
        errors: [],
        warnings: []
      };
    }

    let result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    if (validateSyntax) {
      const syntaxValidation = validator.validateHandlebarsSyntax(content);
      result.errors.push(...syntaxValidation.errors);
      result.warnings.push(...syntaxValidation.warnings);
      result.isValid = result.isValid && syntaxValidation.isValid;
    }

    return result;
  }, [validator, validateSyntax]);

  const validateVariable = useCallback((variable: CustomVariable): ValidationResult => {
    return validator.validateCustomVariable(variable, existingVariables);
  }, [validator, existingVariables]);

  const validateName = useCallback((name: string): ValidationResult => {
    return validator.validateName(name);
  }, [validator]);

  const validatePath = useCallback((path: string): ValidationResult => {
    return validator.validatePath(path);
  }, [validator]);

  const validateValue = useCallback((value: any, type: VariableType): ValidationResult => {
    return validator.validateValue(value, type);
  }, [validator]);

  const isValidSyntax = useCallback((content: string): boolean => {
    const result = validateContent(content);
    return result.isValid;
  }, [validateContent]);

  const getValidationErrors = useCallback((content: string): string[] => {
    const result = validateContent(content);
    return result.errors.map(error => error.message);
  }, [validateContent]);

  const getValidationWarnings = useCallback((content: string): string[] => {
    const result = validateContent(content);
    return result.warnings.map(warning => warning.message);
  }, [validateContent]);

  return {
    validateContent,
    validateVariable,
    validateName,
    validatePath,
    validateValue,
    isValidSyntax,
    getValidationErrors,
    getValidationWarnings
  };
};

// Hook for real-time variable validation with debouncing
export const useRealTimeVariableValidation = (
  content: string,
  debounceMs: number = 300,
  options: UseVariableValidationOptions = {}
) => {
  const { validateContent } = useVariableValidation(options);

  const debouncedValidation = useMemo(() => {
    let timeoutId: NodeJS.Timeout;
    let lastResult: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    return {
      validate: (newContent: string): Promise<ValidationResult> => {
        return new Promise((resolve) => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            lastResult = validateContent(newContent);
            resolve(lastResult);
          }, debounceMs);
        });
      },
      getLastResult: () => lastResult
    };
  }, [validateContent, debounceMs]);

  const validation = useMemo(() => {
    return validateContent(content);
  }, [content, validateContent]);

  return {
    validation,
    debouncedValidate: debouncedValidation.validate,
    isValidating: false // Could be enhanced with actual loading state
  };
};

// Hook for validating variable references in content
export const useVariableReferenceValidation = (
  content: string,
  availableVariables: Variable[]
) => {
  const variableMap = useMemo(() => {
    const map = new Map<string, Variable>();
    availableVariables.forEach(variable => {
      map.set(variable.path, variable);
    });
    return map;
  }, [availableVariables]);

  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const usedVariables: Variable[] = [];

    if (!content) {
      return {
        isValid: true,
        errors: [],
        warnings: [],
        usedVariables: []
      };
    }

    // Find all variable references
    const variableMatches = content.match(/\{\{(?!#|\/)[^}]+\}\}/g) || [];

    variableMatches.forEach(match => {
      const variablePath = match.replace(/\{\{|\}\}/g, '').trim();

      // Skip 'this' references as they're context-dependent
      if (variablePath.startsWith('this.') || variablePath === 'this') {
        return;
      }

      const variable = variableMap.get(variablePath);

      if (!variable) {
        errors.push(`Unknown variable: ${variablePath}`);
      } else {
        usedVariables.push(variable);
      }
    });

    // Find block helper references
    const blockHelperMatches = content.match(/\{\{#(\w+)[^}]*\}\}/g) || [];

    blockHelperMatches.forEach(match => {
      const helperMatch = match.match(/\{\{#(\w+)/);
      if (helperMatch) {
        const helperName = helperMatch[1];
        const validHelpers = ['if', 'unless', 'each', 'with'];

        if (!validHelpers.includes(helperName)) {
          warnings.push(`Unknown block helper: ${helperName}`);
        }
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      usedVariables
    };
  }, [content, variableMap]);

  return validation;
};

export default useVariableValidation;
