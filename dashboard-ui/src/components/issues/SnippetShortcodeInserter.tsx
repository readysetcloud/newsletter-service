import { useCallback, useRef, useState } from 'react';
import { Code2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import { snippetService } from '@/services/snippetService';
import type { SnippetSummary } from '@/types/api';
import { buildShortcodeInsertion, filterSnippetsByName } from './snippetShortcode';

interface SnippetShortcodeInserterProps {
  /** Called with the shortcode text to insert at the editor cursor. */
  onInsert: (text: string) => void;
  disabled?: boolean;
}

/**
 * A small "Insert snippet" control for the issue body editor. It lists the
 * tenant's snippets and, on selection, inserts a Hugo-style shortcode
 * (`{{< name param="..." >}}`) scaffolded from the snippet's parameters at the
 * editor cursor.
 *
 * The snippet list is fetched lazily the first time the panel is opened, so the
 * issue form pays no cost (or network call) unless the author reaches for it.
 */
export function SnippetShortcodeInserter({ onInsert, disabled }: SnippetShortcodeInserterProps) {
  const [open, setOpen] = useState(false);
  const [snippets, setSnippets] = useState<SnippetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const loadingRef = useRef(false);

  const loadSnippets = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    const response = await snippetService.listSnippets();
    if (response.success) {
      setSnippets(response.data?.snippets ?? []);
    } else {
      setError(response.error ?? 'Failed to load snippets');
    }
    setLoading(false);
    setLoaded(true);
    loadingRef.current = false;
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next && !loaded) {
        void loadSnippets();
      }
      return next;
    });
  }, [loaded, loadSnippets]);

  const handleSelect = useCallback(
    async (summary: SnippetSummary) => {
      // Fetch the full snippet so the inserted shortcode can scaffold its
      // declared parameters; fall back to a bare shortcode if that read fails.
      const response = await snippetService.getSnippet(summary.snippetId);
      const text = response.success && response.data
        ? buildShortcodeInsertion(response.data)
        : buildShortcodeInsertion({ name: summary.name });
      onInsert(text);
      setOpen(false);
      setQuery('');
    },
    [onInsert],
  );

  const filtered = filterSnippetsByName(snippets, query);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Code2 className="w-4 h-4 mr-2" />
        Insert snippet
      </Button>

      {open && (
        <div
          className={cn(
            'absolute right-0 z-20 mt-1 w-72 rounded-md border border-border',
            'bg-background shadow-lg',
          )}
        >
          <div className="border-b border-border p-2">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search snippets…"
              aria-label="Search snippets"
              className={cn(
                'w-full rounded border border-border bg-background px-2 py-1.5 text-sm',
                'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500',
              )}
            />
          </div>
          <div className="max-h-56 overflow-auto p-2">
            {loading ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">Loading snippets…</p>
            ) : error ? (
              <p className="px-1 py-2 text-sm text-error-600" role="alert">{error}</p>
            ) : snippets.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                No snippets yet. Create snippets to reuse blocks in your content with{' '}
                <code className="font-mono">{'{{< name >}}'}</code>.
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">No snippets match “{query}”.</p>
            ) : (
              <ul className="space-y-1">
                {filtered.map((snippet) => (
                  <li key={snippet.snippetId}>
                    <button
                      type="button"
                      onClick={() => void handleSelect(snippet)}
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
      )}
    </div>
  );
}
