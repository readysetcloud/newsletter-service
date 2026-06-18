import type { SnippetSummary } from '@/types/api';
import { cn } from '@/utils/cn';

interface SnippetBrowserProps {
  snippets: SnippetSummary[];
  isLoading: boolean;
  /** Called with the snippet name; the parent inserts `{{> name }}` at the cursor. */
  onInsert: (name: string) => void;
}

/**
 * Lists the tenant's snippets and lets the user insert a `{{> name }}`
 * reference at the editor cursor. Degrades to an explanatory empty state when
 * no snippets exist (or the snippets endpoint is unavailable).
 */
export function SnippetBrowser({ snippets, isLoading, onInsert }: SnippetBrowserProps) {
  return (
    <div className="rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-foreground">Snippets</span>
      </div>
      <div className="max-h-48 overflow-auto p-2">
        {isLoading ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">Loading snippets…</p>
        ) : snippets.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            No snippets available. Create snippets to reuse blocks with{' '}
            <code className="font-mono">{'{{> name }}'}</code>.
          </p>
        ) : (
          <ul className="space-y-1">
            {snippets.map((snippet) => (
              <li key={snippet.snippetId}>
                <button
                  type="button"
                  onClick={() => onInsert(snippet.name)}
                  title={snippet.description}
                  className={cn(
                    'flex w-full flex-col items-start rounded px-2 py-1.5 text-left',
                    'hover:bg-primary-50 focus:bg-primary-50 focus:outline-none',
                  )}
                >
                  <span className="font-mono text-sm text-foreground">{snippet.name}</span>
                  {snippet.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {snippet.description}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
