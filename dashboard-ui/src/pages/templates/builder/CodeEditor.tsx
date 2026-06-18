import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/utils/cn';
import { highlightHandlebars } from './highlight';
import {
  buildSuggestions,
  getAutocompleteContext,
  type Suggestion,
} from './autocomplete';

export interface CodeEditorHandle {
  /** Insert text at the current cursor position (used by the snippet inserter). */
  insertAtCursor: (text: string) => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Dotted data-field paths for autocomplete (derived from sample data). */
  fieldPaths: string[];
  /** Snippet names for `{{> name }}` autocomplete. */
  snippets: { name: string; description?: string }[];
  /** Inline error to surface (e.g. from the preview endpoint). */
  error?: string | null;
  id?: string;
  label?: string;
  rows?: number;
}

/**
 * A lightweight Handlebars code editor: a transparent <textarea> layered over a
 * syntax-highlighted <pre>. No external editor dependency — keeps the bundle
 * small while still giving syntax coloring, inline error surfacing, and
 * data-field / snippet autocomplete.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  ({ value, onChange, fieldPaths, snippets, error, id, label, rows = 18 }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLPreElement>(null);

    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [tokenStart, setTokenStart] = useState(0);
    const [tokenLength, setTokenLength] = useState(0);

    const highlighted = useMemo(() => highlightHandlebars(value), [value]);

    const closeSuggestions = useCallback(() => {
      setSuggestions([]);
      setActiveIndex(0);
    }, []);

    // Keep the highlight layer scrolled in sync with the textarea.
    const syncScroll = useCallback(() => {
      if (highlightRef.current && textareaRef.current) {
        highlightRef.current.scrollTop = textareaRef.current.scrollTop;
        highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      }
    }, []);

    useLayoutEffect(() => {
      syncScroll();
    }, [value, syncScroll]);

    useImperativeHandle(ref, () => ({
      insertAtCursor: (text: string) => {
        const el = textareaRef.current;
        if (!el) {
          onChange(value + text);
          return;
        }
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? value.length;
        const next = value.slice(0, start) + text + value.slice(end);
        onChange(next);
        closeSuggestions();
        // Restore focus and place the cursor after the inserted text.
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + text.length;
          el.setSelectionRange(pos, pos);
        });
      },
    }));

    const refreshSuggestions = useCallback(
      (text: string, cursor: number) => {
        const context = getAutocompleteContext(text, cursor);
        if (!context) {
          closeSuggestions();
          return;
        }
        const next = buildSuggestions(context, fieldPaths, snippets);
        if (next.length === 0) {
          closeSuggestions();
          return;
        }
        setSuggestions(next);
        setActiveIndex(0);
        setTokenStart(context.start);
        setTokenLength(context.query.length);
      },
      [fieldPaths, snippets, closeSuggestions],
    );

    const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      onChange(next);
      refreshSuggestions(next, event.target.selectionStart ?? next.length);
    };

    const applySuggestion = useCallback(
      (suggestion: Suggestion) => {
        const before = value.slice(0, tokenStart);
        const after = value.slice(tokenStart + tokenLength);
        const next = before + suggestion.value + after;
        onChange(next);
        closeSuggestions();
        const el = textareaRef.current;
        if (el) {
          requestAnimationFrame(() => {
            el.focus();
            const pos = tokenStart + suggestion.value.length;
            el.setSelectionRange(pos, pos);
          });
        }
      },
      [value, tokenStart, tokenLength, onChange, closeSuggestions],
    );

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (suggestions.length === 0) {
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applySuggestion(suggestions[activeIndex]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeSuggestions();
      }
    };

    const listboxId = id ? `${id}-suggestions` : 'code-editor-suggestions';

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-muted-foreground mb-1">
            {label}
          </label>
        )}
        <div className="relative">
          <pre
            ref={highlightRef}
            aria-hidden="true"
            className={cn(
              'absolute inset-0 m-0 overflow-auto whitespace-pre-wrap break-words',
              'rounded-md border border-transparent px-3 py-2.5',
              'font-mono text-sm leading-5 pointer-events-none',
            )}
            dangerouslySetInnerHTML={{ __html: `${highlighted}<br/>` }}
          />
          <textarea
            ref={textareaRef}
            id={id}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            onBlur={() => requestAnimationFrame(closeSuggestions)}
            rows={rows}
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            className={cn(
              'relative block w-full resize-vertical rounded-md',
              'border-border shadow-sm focus:border-primary-500 focus:ring-ring',
              'px-3 py-2.5 font-mono text-sm leading-5',
              // Transparent text so the highlight layer shows through; caret stays visible.
              'bg-transparent text-transparent caret-foreground',
              error && 'border-error-300 focus:border-error-500 focus:ring-error-500',
            )}
          />
          {suggestions.length > 0 && (
            <ul
              id={listboxId}
              role="listbox"
              className={cn(
                'absolute z-10 mt-1 max-h-48 w-64 overflow-auto rounded-md border border-border',
                'bg-background shadow-lg text-sm',
              )}
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={`${suggestion.kind}-${suggestion.value}`}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <button
                    type="button"
                    // Use onMouseDown so the textarea blur doesn't close the menu first.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySuggestion(suggestion);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left',
                      index === activeIndex ? 'bg-primary-50 text-primary-700' : 'text-foreground',
                    )}
                  >
                    <span className="font-mono">{suggestion.value}</span>
                    <span className="text-xs text-muted-foreground">
                      {suggestion.kind === 'snippet' ? 'snippet' : 'field'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p id={`${id}-error`} className="mt-1 text-sm text-error-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);

CodeEditor.displayName = 'CodeEditor';
