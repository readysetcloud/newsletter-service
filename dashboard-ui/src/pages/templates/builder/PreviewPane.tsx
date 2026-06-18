import { LoadingSpinner } from '@/components/ui/LoadingStates';
import { cn } from '@/utils/cn';

interface PreviewPaneProps {
  html: string;
  isLoading: boolean;
  error: string | null;
}

/**
 * Renders preview HTML returned by the server inside a sandboxed iframe.
 *
 * The iframe uses `sandbox` with no allowances (no scripts, no same-origin)
 * which neutralizes any `<script>`/`on*` handlers in the rendered email while
 * still displaying the HTML/CSS exactly as an email client would.
 */
export function PreviewPane({ html, isLoading, error }: PreviewPaneProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between mb-1">
        <span className="block text-sm font-medium text-muted-foreground">Live preview</span>
        {isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoadingSpinner size="sm" />
            Rendering…
          </span>
        )}
      </div>
      <div
        className={cn(
          'relative flex-1 overflow-hidden rounded-md border bg-white',
          error ? 'border-error-300' : 'border-border',
        )}
      >
        {error ? (
          <div className="absolute inset-0 overflow-auto p-4">
            <p className="text-sm font-medium text-error-700">Preview error</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-error-600">
              {error}
            </pre>
          </div>
        ) : (
          <iframe
            title="Template preview"
            sandbox=""
            srcDoc={html}
            className="h-full min-h-[24rem] w-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}
