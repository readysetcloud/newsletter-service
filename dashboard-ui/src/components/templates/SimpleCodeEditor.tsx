import React, { useRef, useCallback, forwardRef, useImperativeHandle, useState, useEffect } from 'react';
import { CodeBracketIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface SimpleCodeEditorRef {
  insertTextAtCursor: (text: string) => void;
  getCursorPosition: () => { line: number; column: number } | null;
  getSelectedText: () => string | null;
  focus: () => void;
}

interface SimpleCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'handlebars' | 'html' | 'javascript';
  height?: string;
  readOnly?: boolean;
  testData?: string;
  onValidationChange?: (errors: ValidationError[]) => void;
  className?: string;
  placeholder?: string;
  theme?: 'light' | 'dark';
}

const SimpleCodeEditorComponent: React.ForwardRefRenderFunction<SimpleCodeEditorRef, SimpleCodeEditorProps> = ({
  value,
  onChange,
  language = 'handlebars',
  height = '400px',
  readOnly = false,
  testData,
  onValidationChange,
  className,
  placeholder,
  theme = 'light'
}, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showVariableTooltip, setShowVariableTooltip] = useState(false);
  const [parsedTestData, setParsedTestData] = useState<any>(null);

  // Parse test data for variable suggestions
  useEffect(() => {
    if (testData) {
      try {
        const parsed = JSON.parse(testData);
        setParsedTestData(parsed);
      } catch (error) {
        setParsedTestData(null);
      }
    } else {
      setParsedTestData(null);
    }
  }, [testData]);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    insertTextAtCursor: (text: string) => {
      if (textareaRef.current) {
        const start = textareaRef.current.selectionStart;
        const end = textareaRef.current.selectionEnd;
        const newValue = value.substring(0, start) + text + value.substring(end);
        onChange(newValue);

        // Set cursor position after inserted text
        setTimeout(() => {
          if (textareaRef.current) {
            const newPos = start + text.length;
            textareaRef.current.setSelectionRange(newPos, newPos);
            textareaRef.current.focus();
          }
        }, 0);
      }
    },

    getCursorPosition: () => {
      if (textareaRef.current) {
        const lines = value.substring(0, textareaRef.current.selectionStart).split('\n');
        return { line: lines.length, column: lines[lines.length - 1].length + 1 };
      }
      return null;
    },

    getSelectedText: () => {
      if (textareaRef.current) {
        const start = textareaRef.current.selectionStart;
        const end = textareaRef.current.selectionEnd;
        if (start !== end) {
          return value.substring(start, end);
        }
      }
      return null;
    },

    focus: () => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }), [value, onChange]);

  // Get available variables and Handlebars helpers
  const getAvailableVariables = useCallback(() => {
    const handlebarsHelpers = [
      // Conditional helpers
      '#if condition',
      '#unless condition',
      '#with object',

      // Loop helpers
      '#each array',

      // Comparison helpers
      '#eq value1 value2',
      '#ne value1 value2',
      '#lt value1 value2',
      '#gt value1 value2',

      // Logical helpers
      '#and condition1 condition2',
      '#or condition1 condition2',

      // Built-in variables
      '@index',
      '@first',
      '@last',
      '@key',
      'this',
      '../',

      // Closing tags
      'else',
      '/if',
      '/unless',
      '/each',
      '/with'
    ];

    const defaultVars = ['newsletter.title', 'newsletter.issue', 'subscriber.name', 'subscriber.email'];

    let dataVars: string[] = [];
    if (parsedTestData) {
      const extractFromData = (data: any, prefix = ''): string[] => {
        const vars: string[] = [];
        Object.keys(data).forEach(key => {
          const path = prefix ? `${prefix}.${key}` : key;
          if (data[key] && typeof data[key] === 'object' && !Array.isArray(data[key])) {
            vars.push(...extractFromData(data[key], path));
          } else {
            vars.push(path);
          }
        });
        return vars;
      };

      dataVars = extractFromData(parsedTestData);
    } else {
      dataVars = defaultVars;
    }

    // Combine helpers first, then data variables
    return [...handlebarsHelpers, ...dataVars];
  }, [parsedTestData]);

  // Handle variable tooltip
  const showVariableTooltipHandler = useCallback(() => {
    const vars = getAvailableVariables();
    console.log('showVariableTooltipHandler called, availableVariables:', vars);
    console.log('Setting showVariableTooltip to true');
    setShowVariableTooltip(true);
    setTimeout(() => {
      console.log('Hiding tooltip after 3 seconds');
      setShowVariableTooltip(false);
    }, 5000); // Increased timeout to 5 seconds for testing
  }, [getAvailableVariables]);

  // Handle input changes to detect {{
  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    const cursorPos = target.selectionStart;
    const textBeforeCursor = target.value.substring(0, cursorPos);

    // Check if the last two characters are {{
    if (textBeforeCursor.endsWith('{{')) {
      console.log('Detected {{ - showing variables');
      showVariableTooltipHandler();
    }
  }, [showVariableTooltipHandler]);

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      onChange(newValue);

      // Set cursor position after the inserted spaces
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }

    // Show variable tooltip when typing the second {
    if (e.key === '{') {
      const cursorPos = e.currentTarget.selectionStart;
      const prevChar = value.charAt(cursorPos - 1);
      if (prevChar === '{') {
        showVariableTooltipHandler();
      }
    }

    // Show variables with Ctrl+Space
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      showVariableTooltipHandler();
    }
  }, [value, onChange, showVariableTooltipHandler]);

  // Basic validation
  useEffect(() => {
    if (onValidationChange) {
      const errors: ValidationError[] = [];
      const lines = value.split('\n');

      lines.forEach((line, lineIndex) => {
        // Check for unmatched handlebars brackets
        const openBrackets = (line.match(/\{\{/g) || []).length;
        const closeBrackets = (line.match(/\}\}/g) || []).length;

        if (openBrackets !== closeBrackets) {
          errors.push({
            line: lineIndex + 1,
            column: 1,
            message: 'Unmatched handlebars brackets',
            severity: 'error'
          });
        }
      });

      onValidationChange(errors);
    }
  }, [value, onValidationChange]);

  const availableVariables = getAvailableVariables();

  return (
    <div className={cn('relative border border-slate-200 rounded-lg', className)}>
      {/* Simple Textarea Editor */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          readOnly={readOnly}
          className={cn(
            'w-full resize-none border-0 bg-slate-50 font-mono text-sm leading-relaxed',
            'focus:outline-none focus:ring-0 focus:bg-white',
            'p-4 rounded-md',
            theme === 'dark' ? 'bg-slate-800 text-slate-100' : 'bg-slate-50 text-slate-900'
          )}
          style={{
            height,
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
            fontSize: '14px',
            lineHeight: '1.5',
            tabSize: 2
          }}
        />

        {/* Language indicator and variable helper */}
        <div className="absolute bottom-2 right-2 flex items-center space-x-2">
          <button
            onClick={() => {
              console.log('Variables button clicked');
              showVariableTooltipHandler();
            }}
            className={cn(
              "px-2 py-1 text-white text-xs rounded transition-colors",
              showVariableTooltip ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"
            )}
            title="Show available variables (or type {{)"
            type="button"
          >
            Variables {showVariableTooltip ? '✓' : ''}
          </button>
          <div className="px-2 py-1 bg-slate-800 text-white text-xs rounded flex items-center">
            <CodeBracketIcon className="w-3 h-3 mr-1" />
            {language}
          </div>
        </div>

        {/* Debug info (remove in production) */}
        {process.env.NODE_ENV === 'development' && (
          <div className="absolute top-2 left-2 bg-yellow-100 border border-yellow-300 rounded px-2 py-1 text-xs">
            Tooltip: {showVariableTooltip ? 'VISIBLE' : 'HIDDEN'} |
            Vars: {availableVariables.length} |
            TestData: {testData ? 'YES' : 'NO'}
          </div>
        )}

        {/* Variable tooltip */}
        {showVariableTooltip && (
          <div className="fixed bg-white border-2 border-blue-500 rounded-md shadow-xl p-3 z-[9999] max-w-xs min-w-64"
               style={{
                 top: textareaRef.current ?
                   textareaRef.current.getBoundingClientRect().bottom + window.scrollY + 4 :
                   '50%',
                 left: textareaRef.current ?
                   textareaRef.current.getBoundingClientRect().left + window.scrollX :
                   '50%',
                 transform: textareaRef.current ? 'none' : 'translate(-50%, -50%)'
               }}>
            <div className="text-xs font-medium text-gray-700 mb-2">
              Available Variables ({availableVariables.length}):
            </div>
            <div className="space-y-1 text-xs max-h-32 overflow-y-auto">
              {availableVariables.length > 0 ? (
                availableVariables.map((variable, index) => (
                  <div key={index} className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded cursor-pointer border border-transparent hover:border-blue-200"
                       onClick={() => {
                         console.log('Variable clicked:', variable);
                         if (textareaRef.current) {
                           const start = textareaRef.current.selectionStart;
                           const textBeforeCursor = value.substring(0, start);

                           // Check if we're already inside {{ }}
                           let insertText = variable;
                           if (!textBeforeCursor.endsWith('{{')) {
                             insertText = '{{' + variable + '}}';
                           } else {
                             insertText = variable + '}}';
                           }

                           const newValue = value.substring(0, start) + insertText + value.substring(start);
                           onChange(newValue);
                           setShowVariableTooltip(false);

                           // Focus back to textarea
                           setTimeout(() => {
                             if (textareaRef.current) {
                               textareaRef.current.focus();
                               const newPos = start + insertText.length;
                               textareaRef.current.setSelectionRange(newPos, newPos);
                             }
                           }, 0);
                         }
                       }}>
                    <code className="font-mono">{variable}</code>
                  </div>
                ))
              ) : (
                <div className="text-gray-500 italic">No variables available</div>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-2 pt-2 border-t">
              Click to insert | Type {`{{`} | Ctrl+Space | Variables button
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const SimpleCodeEditor = forwardRef<SimpleCodeEditorRef, SimpleCodeEditorProps>(SimpleCodeEditorComponent);
