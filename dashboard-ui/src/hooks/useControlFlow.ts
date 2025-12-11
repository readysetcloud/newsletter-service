import { useState, useCallback, useMemo } from 'react';
import {
  ControlFlowHelper,
  ControlFlowInsertion,
  Variable
} from '../types/variable';
import { VARIABLE_DEFINITIONS } from '../data/variableDefinitions';
import {
  generateControlFlowInsertion,
  insertControlFlowIntoInput,
  validateControlFlowSyntax,
  extractControlFlowHelpers,
  formatControlFlowCode,
  wrapTextWithControlFlow
} from '../utils/controlFlowUtils';

interface UseControlFlowOptions {
  availableVariables?: Variable[];
  onInsert?: (insertion: ControlFlowInsertion) => void;
  onError?: (error: string) => void;
}

interface UseControlFlowReturn {
  // Available helpers
  helpers: ControlFlowHelper[];

  // Helper selection and insertion
  insertHelper: (
    helper: ControlFlowHelper,
    parameters: Record<string, string>,
    target?: HTMLInputElement | HTMLTextAreaElement
  ) => void;

  // Text wrapping
  wrapSelectedText: (
    text: string,
    helper: ControlFlowHelper,
    parameters: Record<string, string>
  ) => string;

  // Validation
  validateSyntax: (text: string) => {
    isValid: boolean;
    errors: Array<{
      line: number;
      column: number;
      message: string;
      type: 'missing_closing' | 'missing_opening' | 'invalid_syntax';
    }>;
  };

  // Code formatting
  formatCode: (code: string, indentSize?: number) => string;

  // Helper analysis
  extractHelpers: (text: string) => Array<{
    type: string;
    openingTag: string;
    closingTag?: string;
    parameters: Record<string, string>;
    line: number;
    column: number;
  }>;

  // Helper lookup
  getHelperById: (id: string) => ControlFlowHelper | undefined;
  getHelpersByCategory: (category: string) => ControlFlowHelper[];

  // State
  isInserting: boolean;
  lastError: string | null;
}

export const useControlFlow = (options: UseControlFlowOptions = {}): UseControlFlowReturn => {
  const { availableVariables = [], onInsert, onError } = options;

  const [isInserting, setIsInserting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Get all available control flow helpers
  const helpers = useMemo(() => {
    return VARIABLE_DEFINITIONS.controlFlowHelpers;
  }, []);

  // Clear error when it's accessed
  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  // Insert a control flow helper
  const insertHelper = useCallback((
    helper: ControlFlowHelper,
    parameters: Record<string, string>,
    target?: HTMLInputElement | HTMLTextAreaElement
  ) => {
    setIsInserting(true);
    setLastError(null);

    try {
      // Validate parameters
      const missingRequired = helper.parameters
        .filter(param => param.required && !parameters[param.name])
        .map(param => param.name);

      if (missingRequired.length > 0) {
        const error = `Missing required parameters: ${missingRequired.join(', ')}`;
        setLastError(error);
        onError?.(error);
        return;
      }

      // Generate the insertion
      const insertion = generateControlFlowInsertion(helper, parameters);

      // Insert into target if provided
      if (target) {
        insertControlFlowIntoInput(target, insertion);
      }

      // Call the onInsert callback
      onInsert?.(insertion);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to insert control flow helper';
      setLastError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsInserting(false);
    }
  }, [onInsert, onError]);

  // Wrap selected text with control flow helper
  const wrapSelectedText = useCallback((
    text: string,
    helper: ControlFlowHelper,
    parameters: Record<string, string>
  ): string => {
    try {
      setLastError(null);
      return wrapTextWithControlFlow(text, helper, parameters);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to wrap text with control flow';
      setLastError(errorMessage);
      onError?.(errorMessage);
      return text;
    }
  }, [onError]);

  // Validate control flow syntax
  const validateSyntax = useCallback((text: string) => {
    try {
      setLastError(null);
      return validateControlFlowSyntax(text);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to validate syntax';
      setLastError(errorMessage);
      onError?.(errorMessage);
      return { isValid: false, errors: [] };
    }
  }, [onError]);

  // Format control flow code
  const formatCode = useCallback((code: string, indentSize: number = 2): string => {
    try {
      setLastError(null);
      return formatControlFlowCode(code, indentSize);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to format code';
      setLastError(errorMessage);
      onError?.(errorMessage);
      return code;
    }
  }, [onError]);

  // Extract control flow helpers from text
  const extractHelpers = useCallback((text: string) => {
    try {
      setLastError(null);
      return extractControlFlowHelpers(text);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to extract helpers';
      setLastError(errorMessage);
      onError?.(errorMessage);
      return [];
    }
  }, [onError]);

  // Get helper by ID
  const getHelperById = useCallback((id: string): ControlFlowHelper | undefined => {
    return helpers.find(helper => helper.id === id);
  }, [helpers]);

  // Get helpers by category
  const getHelpersByCategory = useCallback((category: string): ControlFlowHelper[] => {
    return helpers.filter(helper => helper.category === category);
  }, [helpers]);

  return {
    helpers,
    insertHelper,
    wrapSelectedText,
    validateSyntax,
    formatCode,
    extractHelpers,
    getHelperById,
    getHelpersByCategory,
    isInserting,
    lastError
  };
};

export default useControlFlow;
