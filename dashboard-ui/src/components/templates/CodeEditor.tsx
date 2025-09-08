import React, { useRef, useEffect, useState, useCallback } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  CodeBracketIcon
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import type { Snippet } from '@/types/template';

interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'handlebars' | 'html' | 'javascript';
  height?: string;
  readOnly?: boolean;
  snippets?: Snippet[];
  onValidationChange?: (errors: ValidationError[]) => void;
  className?: string;
  placeholder?: string;
  showMinimap?: boolean;
  theme?: 'light' | 'dark';
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language = 'handlebars',
  height = '400px',
  readOnly = false,
  snippets = [],
  onValidationChange,
  className,
  placeholder,
  showMinimap = false,
  theme = 'light'
}) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isEditorReady, setIsEditorReady] = useState(false);

  // Handle editor mount
  const handleEditorDidMount = useCallback((editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setIsEditorReady(true);

    // Configure handlebars language
    if (language === 'handlebars') {
      setupHandlebarsLanguage(monaco);
    }

    // Setup snippet autocomplete
    if (snippets.length > 0) {
      setupSnippetAutocomplete(monaco, snippets);
    }

    // Setup validation
    setupValidation(monaco, editor);

    // Configure editor options
    editor.updateOptions({
      minimap: { enabled: showMinimap },
      wordWrap: 'on',
      lineNumbers: 'on',
      folding: true,
      bracketMatching: 'always',
      autoIndent: 'full',
      formatOnPaste: true,
      formatOnType: true,
      suggestOnTriggerCharacters: true,
      quickSuggestions: {
        other: true,
        comments: false,
        strings: true
      }
    });

    // Add placeholder support
    if (placeholder && !value) {
      showPlaceholder(editor, placeholder);
    }
  }, [language, snippets, showMinimap, placeholder, value]);

  // Setup handlebars language support
  const setupHandlebarsLanguage = useCallback((monaco: Monaco) => {
    // Register handlebars language if not already registered
    const languages = monaco.languages.getLanguages();
    const handlebarsExists = languages.some(lang => lang.id === 'handlebars');

    if (!handlebarsExists) {
      monaco.languages.register({ id: 'handlebars' });

      // Define handlebars syntax highlighting
      monaco.languages.setMonarchTokensProvider('handlebars', {
        tokenizer: {
          root: [
            // Handlebars expressions
            [/\{\{\{[^}]*\}\}\}/, 'string.handlebars.triple'],
            [/\{\{[^}]*\}\}/, 'string.handlebars.double'],

            // HTML tags
            [/<\/?[a-zA-Z][\w-]*/, 'tag'],
            [/[<>]/, 'tag.bracket'],

            // HTML attributes
            [/\s+[a-zA-Z-]+(?=\s*=)/, 'attribute.name'],
            [/=/, 'attribute.delimiter'],
            [/"[^"]*"/, 'attribute.value'],
            [/'[^']*'/, 'attribute.value'],

            // Comments
            [/<!--/, 'comment', '@comment'],
            [/\{\{!--/, 'comment.handlebars', '@handlebarsComment'],
            [/\{\{!/, 'comment.handlebars', '@handlebarsInlineComment'],

            // Text content
            [/[^<{]+/, 'text']
          ],

          comment: [
            [/-->/, 'comment', '@pop'],
            [/./, 'comment']
          ],

          handlebarsComment: [
            [/--\}\}/, 'comment.handlebars', '@pop'],
            [/./, 'comment.handlebars']
          ],

          handlebarsInlineComment: [
            [/\}\}/, 'comment.handlebars', '@pop'],
            [/./, 'comment.handlebars']
          ]
        }
      });

      // Define theme colors for handlebars
      monaco.editor.defineTheme('handlebars-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'string.handlebars.triple', foreground: '0066cc', fontStyle: 'bold' },
          { token: 'string.handlebars.double', foreground: '0066cc' },
          { token: 'comment.handlebars', foreground: '008000', fontStyle: 'italic' },
          { token: 'tag', foreground: '800080' },
          { token: 'attribute.name', foreground: 'ff0000' },
          { token: 'attribute.value', foreground: '0000ff' }
        ],
        colors: {}
      });

      monaco.editor.defineTheme('handlebars-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'string.handlebars.triple', foreground: '4fc3f7', fontStyle: 'bold' },
          { token: 'string.handlebars.double', foreground: '4fc3f7' },
          { token: 'comment.handlebars', foreground: '6a994e', fontStyle: 'italic' },
          { token: 'tag', foreground: 'f06292' },
          { token: 'attribute.name', foreground: 'ff8a65' },
          { token: 'attribute.value', foreground: '81c784' }
        ],
        colors: {}
      });
    }
  }, []);

  // Setup snippet autocomplete
  const setupSnippetAutocomplete = useCallback((monaco: Monaco, snippets: Snippet[]) => {
    const completionProvider = monaco.languages.registerCompletionItemProvider('handlebars', {
      triggerCharacters: ['{', '>', ' '],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions = snippets.map(snippet => ({
          label: snippet.name,
          kind: monaco.languages.CompletionItemKind.Snippet,
          documentation: snippet.description || `Snippet: ${snippet.name}`,
          detail: `Parameters: ${snippet.parameters?.map(p => p.name).join(', ') || 'none'}`,
          insertText: generateSnippetInsertText(snippet),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: range
        }));

        // Add handlebars helpers
        const handlebarsHelpers = [
          {
            label: 'if',
            kind: monaco.languages.CompletionItemKind.Keyword,
            documentation: 'Conditional block helper',
            insertText: '{{#if ${1:condition}}}${2:content}{{/if}}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range
          },
          {
            label: 'each',
            kind: monaco.languages.CompletionItemKind.Keyword,
            documentation: 'Iteration block helper',
            insertText: '{{#each ${1:array}}}${2:content}{{/each}}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range
          },
          {
            label: 'unless',
            kind: monaco.languages.CompletionItemKind.Keyword,
            documentation: 'Inverse conditional block helper',
            insertText: '{{#unless ${1:condition}}}${2:content}{{/unless}}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range
          },
          {
            label: 'with',
            kind: monaco.languages.CompletionItemKind.Keyword,
            documentation: 'Context block helper',
            insertText: '{{#with ${1:context}}}${2:content}{{/with}}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range
          }
        ];

        return {
          suggestions: [...suggestions, ...handlebarsHelpers]
        };
      }
    });

    return () => completionProvider.dispose();
  }, []);

  // Generate snippet insert text with parameters
  const generateSnippetInsertText = useCallback((snippet: Snippet): string => {
    if (!snippet.parameters || snippet.parameters.length === 0) {
      return `{{> ${snippet.name}}}`;
    }

    const params = snippet.parameters.map((param, index) => {
      const placeholder = `\${${index + 1}:${param.defaultValue || param.name}}`;
      return `${param.name}="${placeholder}"`;
    }).join(' ');

    return `{{> ${snippet.name} ${params}}}`;
  }, []);

  // Setup validation
  const setupValidation = useCallback((monaco: Monaco, editor: any) => {
    const validateContent = (content: string) => {
      const errors: ValidationError[] = [];
      const lines = content.split('\n');

      lines.forEach((line, lineIndex) => {
        // Check for unmatched handlebars braces
        const openBraces = (line.match(/\{\{/g) || []).length;
        const closeBraces = (line.match(/\}\}/g) || []).length;

        if (openBraces !== closeBraces) {
          errors.push({
            line: lineIndex + 1,
            column: 1,
            message: 'Unmatched handlebars braces',
            severity: 'error'
          });
        }

        // Check for invalid handlebars syntax
        const handlebarsMatches = line.match(/\{\{[^}]*\}\}/g);
        if (handlebarsMatches) {
          handlebarsMatches.forEach(match => {
            const content = match.slice(2, -2).trim();

            // Check for empty expressions
            if (!content) {
              errors.push({
                line: lineIndex + 1,
                column: line.indexOf(match) + 1,
                message: 'Empty handlebars expression',
                severity: 'error'
              });
            }

            // Check for invalid characters in variable names
            if (content.includes(' ') && !content.startsWith('#') && !content.startsWith('/') && !content.startsWith('>')) {
              const hasValidHelper = ['if', 'each', 'unless', 'with'].some(helper =>
                content.startsWith(`#${helper} `) || content.startsWith(`/${helper}`)
              );

              if (!hasValidHelper && !content.includes('=')) {
                errors.push({
                  line: lineIndex + 1,
                  column: line.indexOf(match) + 1,
                  message: 'Invalid handlebars expression syntax',
                  severity: 'warning'
                });
              }
            }
          });
        }

        // Check for unclosed HTML tags (basic check)
        const htmlTags = line.match(/<[^/>][^>]*>/g);
        if (htmlTags) {
          htmlTags.forEach(tag => {
            const tagName = tag.match(/<(\w+)/)?.[1];
            if (tagName && !['img', 'br', 'hr', 'input', 'meta', 'link'].includes(tagName.toLowerCase())) {
              const closingTag = `</${tagName}>`;
              if (!content.includes(closingTag)) {
                errors.push({
                  line: lineIndex + 1,
                  column: line.indexOf(tag) + 1,
                  message: `Unclosed HTML tag: ${tagName}`,
                  severity: 'warning'
                });
              }
            }
          });
        }
      });

      return errors;
    };

    // Initial validation
    const initialErrors = validateContent(value);
    setValidationErrors(initialErrors);
    onValidationChange?.(initialErrors);

    // Setup real-time validation
    const disposable = editor.onDidChangeModelContent(() => {
      const currentValue = editor.getValue();
      const errors = validateContent(currentValue);
      setValidationErrors(errors);
      onValidationChange?.(errors);

      // Update Monaco markers
      const markers = errors.map(error => ({
        startLineNumber: error.line,
        startColumn: error.column,
        endLineNumber: error.line,
        endColumn: error.column + 10,
        message: error.message,
        severity: error.severity === 'error' ? monaco.MarkerSeverity.Error :
                 error.severity === 'warning' ? monaco.MarkerSeverity.Warning :
                 monaco.MarkerSeverity.Info
      }));

      monaco.editor.setModelMarkers(editor.getModel(), 'handlebars-validation', markers);
    });

    return () => disposable.dispose();
  }, [value, onValidationChange]);

  // Show placeholder
  const showPlaceholder = useCallback((editor: any, placeholderText: string) => {
    const placeholderDecorations = editor.deltaDecorations([], [
      {
        range: new monacoRef.current!.Range(1, 1, 1, 1),
        options: {
          afterContentClassName: 'monaco-placeholder',
          after: {
            content: placeholderText,
            inlineClassName: 'monaco-placeholder-text'
          }
        }
      }
    ]);

    const disposable = editor.onDidChangeModelContent(() => {
      const currentValue = editor.getValue();
      if (currentValue) {
        editor.deltaDecorations(placeholderDecorations, []);
        disposable.dispose();
      }
    });
  }, []);

  // Handle value change
  const handleChange = useCallback((newValue: string | undefined) => {
    onChange(newValue || '');
  }, [onChange]);

  // Update snippets when they change
  useEffect(() => {
    if (isEditorReady && monacoRef.current && snippets.length > 0) {
      setupSnippetAutocomplete(monacoRef.current, snippets);
    }
  }, [snippets, isEditorReady, setupSnippetAutocomplete]);

  // Get validation summary
  const getValidationSummary = useCallback(() => {
    const errors = validationErrors.filter(e => e.severity === 'error').length;
    const warnings = validationErrors.filter(e => e.severity === 'warning').length;
    const infos = validationErrors.filter(e => e.severity === 'info').length;

    return { errors, warnings, infos };
  }, [validationErrors]);

  const { errors, warnings, infos } = getValidationSummary();

  return (
    <div className={cn('relative border border-slate-200 rounded-lg overflow-hidden', className)}>
      {/* Validation Status Bar */}
      {validationErrors.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm">
          <div className="flex items-center space-x-4">
            {errors > 0 && (
              <div className="flex items-center text-red-600">
                <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                <span>{errors} error{errors !== 1 ? 's' : ''}</span>
              </div>
            )}
            {warnings > 0 && (
              <div className="flex items-center text-amber-600">
                <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                <span>{warnings} warning{warnings !== 1 ? 's' : ''}</span>
              </div>
            )}
            {infos > 0 && (
              <div className="flex items-center text-blue-600">
                <InformationCircleIcon className="w-4 h-4 mr-1" />
                <span>{infos} info</span>
              </div>
            )}
          </div>
          {errors === 0 && warnings === 0 && (
            <div className="flex items-center text-green-600">
              <CheckCircleIcon className="w-4 h-4 mr-1" />
              <span>No issues found</span>
            </div>
          )}
        </div>
      )}

      {/* Editor */}
      <div className="relative">
        <Editor
          height={height}
          language={language}
          value={value}
          onChange={handleChange}
          onMount={handleEditorDidMount}
          theme={theme === 'dark' ? 'handlebars-dark' : 'handlebars-light'}
          options={{
            readOnly,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            renderWhitespace: 'selection',
            renderControlCharacters: false,
            guides: { indentation: true },
            selectOnLineNumbers: true,
            matchBrackets: 'always',
            glyphMargin: true,
            folding: true,
            foldingStrategy: 'indentation',
            showFoldingControls: 'mouseover',
            contextmenu: true,
            mouseWheelZoom: true,
            smoothScrolling: true,
            cursorBlinking: 'blink',
            cursorSmoothCaretAnimation: 'on'
          }}
        />

        {/* Language indicator */}
        <div className="absolute bottom-2 right-2 px-2 py-1 bg-slate-800 text-white text-xs rounded flex items-center">
          <CodeBracketIcon className="w-3 h-3 mr-1" />
          {language}
        </div>
      </div>

      {/* Custom CSS for placeholder - handled by Monaco editor internally */}
    </div>
  );
};
