import {
  ControlFlowHelper,
  ControlFlowInsertion,
  ControlFlowPlaceholder
} from '../types/variable';

/**
 * Generates a control flow insertion with proper opening/closing tags and cursor positioning
 */
export const generateControlFlowInsertion = (
  helper: ControlFlowHelper,
  parameters: Record<string, string>
): ControlFlowInsertion => {
  let openingTag = helper.syntax;
  const placeholders: ControlFlowPlaceholder[] = [];
  let currentPosition = 0;

  // Replace parameter placeholders in the syntax
  helper.parameters.forEach(param => {
    const value = parameters[param.name] || '';
    const placeholder = param.name;

    if (openingTag.includes(placeholder)) {
      const beforeReplacement = openingTag.substring(0, openingTag.indexOf(placeholder));
      currentPosition = beforeReplacement.length;

      if (!value) {
        // Create placeholder for empty parameters
        placeholders.push({
          name: param.name,
          position: currentPosition,
          length: placeholder.length,
          type: param.type === 'variable' ? 'variable' : 'expression'
        });
        openingTag = openingTag.replace(placeholder, `[${placeholder}]`);
      } else {
        openingTag = openingTag.replace(placeholder, value);
      }
    }
  });

  // Generate content template based on helper type
  let contentTemplate = '';
  let cursorPosition = openingTag.length;

  switch (helper.category) {
    case 'conditional':
      contentTemplate = '\n  <!-- Content shown when condition is true -->\n  ';
      cursorPosition = openingTag.length + contentTemplate.length;
      break;
    case 'iterator':
      contentTemplate = '\n  <!-- Content repeated for each item -->\n  ';
      cursorPosition = openingTag.length + contentTemplate.length;
      break;
    case 'custom':
      contentTemplate = '\n  <!-- Content within this context -->\n  ';
      cursorPosition = openingTag.length + contentTemplate.length;
      break;
    default:
      contentTemplate = '\n  ';
      cursorPosition = openingTag.length + contentTemplate.length;
  }

  const closingTag = helper.closingSyntax;
  let fullInsertion = openingTag + contentTemplate;

  if (closingTag) {
    fullInsertion += `\n${closingTag}`;
  }

  return {
    openingTag: fullInsertion,
    closingTag,
    cursorPosition,
    placeholders
  };
};

/**
 * Inserts control flow helper into a text input at the current cursor position
 */
export const insertControlFlowIntoInput = (
  input: HTMLInputElement | HTMLTextAreaElement,
  insertion: ControlFlowInsertion
): void => {
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const currentValue = input.value;

  // Insert the control flow helper
  const newValue =
    currentValue.substring(0, start) +
    insertion.openingTag +
    currentValue.substring(end);

  input.value = newValue;

  // Position cursor appropriately
  const newCursorPosition = start + insertion.cursorPosition;
  input.setSelectionRange(newCursorPosition, newCursorPosition);

  // Trigger input event to notify React of the change
  const event = new Event('input', { bubbles: true });
  input.dispatchEvent(event);

  // Focus the input
  input.focus();
};

/**
 * Validates control flow syntax in a text string
 */
export const validateControlFlowSyntax = (text: string): {
  isValid: boolean;
  errors: Array<{
    line: number;
    column: number;
    message: string;
    type: 'missing_closing' | 'missing_opening' | 'invalid_syntax';
  }>;
} => {
  const errors: Array<{
    line: number;
    column: number;
    message: string;
    type: 'missing_closing' | 'missing_opening' | 'invalid_syntax';
  }> = [];

  const lines = text.split('\n');
  const stack: Array<{ tag: string; line: number; column: number }> = [];

  // Regular expressions for matching handlebars helpers
  const openingTagRegex = /\{\{#(\w+)(?:\s+[^}]+)?\}\}/g;
  const closingTagRegex = /\{\{\/(\w+)\}\}/g;

  lines.forEach((line, lineIndex) => {
    let match;

    // Find opening tags
    openingTagRegex.lastIndex = 0;
    while ((match = openingTagRegex.exec(line)) !== null) {
      const tagName = match[1];
      const column = match.index;

      stack.push({
        tag: tagName,
        line: lineIndex + 1,
        column: column + 1
      });
    }

    // Find closing tags
    closingTagRegex.lastIndex = 0;
    while ((match = closingTagRegex.exec(line)) !== null) {
      const tagName = match[1];
      const column = match.index;

      if (stack.length === 0) {
        errors.push({
          line: lineIndex + 1,
          column: column + 1,
          message: `Closing tag {{/${tagName}}} has no matching opening tag`,
          type: 'missing_opening'
        });
      } else {
        const lastOpening = stack.pop()!;
        if (lastOpening.tag !== tagName) {
          errors.push({
            line: lineIndex + 1,
            column: column + 1,
            message: `Closing tag {{/${tagName}}} does not match opening tag {{#${lastOpening.tag}}} at line ${lastOpening.line}`,
            type: 'invalid_syntax'
          });
        }
      }
    }
  });

  // Check for unclosed opening tags
  stack.forEach(openTag => {
    errors.push({
      line: openTag.line,
      column: openTag.column,
      message: `Opening tag {{#${openTag.tag}}} is missing a closing tag {{/${openTag.tag}}}`,
      type: 'missing_closing'
    });
  });

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Extracts all control flow helpers used in a text string
 */
export const extractControlFlowHelpers = (text: string): Array<{
  type: string;
  openingTag: string;
  closingTag?: string;
  parameters: Record<string, string>;
  line: number;
  column: number;
}> => {
  const helpers: Array<{
    type: string;
    openingTag: string;
    closingTag?: string;
    parameters: Record<string, string>;
    line: number;
    column: number;
  }> = [];

  const lines = text.split('\n');
  const openingTagRegex = /\{\{#(\w+)(?:\s+([^}]+))?\}\}/g;

  lines.forEach((line, lineIndex) => {
    let match;
    openingTagRegex.lastIndex = 0;

    while ((match = openingTagRegex.exec(line)) !== null) {
      const type = match[1];
      const paramString = match[2] || '';
      const column = match.index;

      // Parse parameters (simple implementation)
      const parameters: Record<string, string> = {};
      if (paramString.trim()) {
        // For now, treat the entire parameter string as a single parameter
        // This could be enhanced to parse multiple parameters
        parameters.condition = paramString.trim();
      }

      helpers.push({
        type,
        openingTag: match[0],
        parameters,
        line: lineIndex + 1,
        column: column + 1
      });
    }
  });

  return helpers;
};

/**
 * Formats control flow helper code with proper indentation
 */
export const formatControlFlowCode = (
  code: string,
  indentSize: number = 2
): string => {
  const lines = code.split('\n');
  const formattedLines: string[] = [];
  let indentLevel = 0;

  const openingTagRegex = /\{\{#\w+/;
  const closingTagRegex = /\{\{\/\w+/;

  lines.forEach(line => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      formattedLines.push('');
      return;
    }

    // Decrease indent for closing tags
    if (closingTagRegex.test(trimmedLine)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // Add indentation
    const indent = ' '.repeat(indentLevel * indentSize);
    formattedLines.push(indent + trimmedLine);

    // Increase indent for opening tags
    if (openingTagRegex.test(trimmedLine)) {
      indentLevel++;
    }
  });

  return formattedLines.join('\n');
};

/**
 * Generates sample data for control flow helper preview
 */
export const generateControlFlowPreviewData = (
  helper: ControlFlowHelper,
  parameters: Record<string, string>
): Record<string, any> => {
  const sampleData: Record<string, any> = {};

  helper.parameters.forEach(param => {
    const value = parameters[param.name];
    if (!value) return;

    switch (param.type) {
      case 'variable':
        // Generate sample data based on the variable path
        if (value.includes('hasSponsors')) {
          sampleData[value] = true;
        } else if (value.includes('articles')) {
          sampleData[value] = [
            { title: 'Sample Article 1', summary: 'Article summary...' },
            { title: 'Sample Article 2', summary: 'Another summary...' }
          ];
        } else if (value.includes('isPremium')) {
          sampleData[value] = true;
        } else {
          sampleData[value] = 'Sample Value';
        }
        break;
      case 'expression':
        // For expressions, we can't easily generate sample data
        sampleData[value] = true;
        break;
      default:
        sampleData[value] = value;
    }
  });

  return sampleData;
};

/**
 * Checks if a control flow helper requires closing tags
 */
export const requiresClosingTag = (helperType: string): boolean => {
  const helpersRequiringClosing = ['if', 'unless', 'each', 'with'];
  return helpersRequiringClosing.includes(helperType.toLowerCase());
};

/**
 * Gets the appropriate closing tag for a control flow helper
 */
export const getClosingTag = (helperType: string): string => {
  return `{{/${helperType}}}`;
};

/**
 * Wraps selected text with control flow helper tags
 */
export const wrapTextWithControlFlow = (
  selectedText: string,
  helper: ControlFlowHelper,
  parameters: Record<string, string>
): string => {
  const insertion = generateControlFlowInsertion(helper, parameters);

  if (helper.closingSyntax) {
    // Replace the content template with the selected text
    const openingTag = helper.syntax;
    let processedOpeningTag = openingTag;

    // Replace parameters in opening tag
    helper.parameters.forEach(param => {
      const value = parameters[param.name] || '';
      processedOpeningTag = processedOpeningTag.replace(param.name, value);
    });

    return `${processedOpeningTag}\n${selectedText}\n${helper.closingSyntax}`;
  }

  return insertion.openingTag + selectedText;
};
