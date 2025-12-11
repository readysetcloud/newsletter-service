import React, { useEffect, useState, useMemo } from 'react';
import { cn } from '../../utils/cn';
import SnippetPreviewUtils from '../../utils/snippetPreviewUtils';
import type { Snippet } from '@/types/template';

export interface ParameterPreviewProps {
  snippet: Snippet;
  parameters: Record<string, any>;
  className?: string;
  showError?: boolean;
  onPreviewGenerated?: (html: string, success: boolean) => void;
}

export const ParameterPreview: React.FC<ParameterPreviewProps> = ({
  snippet,
  parameters,
  className,
  showError = true,
  onPreviewGenerated
}) => {
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize parameters to avoid unnecessary re-renders
  const memoizedParameters = useMemo(() => parameters, [JSON.stringify(parameters)]);

  useEffect(() => {
    let isCancelled = false;

    const generatePreview = async () => {
      if (!snippet) return;

      setLoading(true);
      setError(null);

      try {
        const result = await SnippetPreviewUtils.generatePreview(
          snippet,
          memoizedParameters,
          {
            useCache: true,
            fallbackOnError: true,
            maxRenderTime: 3000
          }
        );

        if (isCancelled) return;

        if (result.success) {
          setPreviewHtml(result.html);
          onPreviewGenerated?.(result.html, true);
        } else {
          setError(result.error || 'Failed to generate preview');
          onPreviewGenerated?.('', false);
        }
      } catch (err) {
        if (isCancelled) return;

        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        onPreviewGenerated?.('', false);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    generatePreview();

    return () => {
      isCancelled = true;
    };
  }, [snippet, memoizedParameters, onPreviewGenerated]);

  if (loading) {
    return (
      <div className={cn('border rounded-lg p-4 bg-slate-50', className)}>
        <div className="flex items-center justify-center h-32">
          <div className="flex items-center space-x-2 text-slate-500">
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm">Generating preview...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error && showError) {
    return (
      <div className={cn('border border-red-200 rounded-lg p-4 bg-red-50', className)}>
        <div className="flex items-start space-x-2">
          <svg
            className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h4 className="text-sm font-medium text-red-800">Preview Error</h4>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!previewHtml) {
    return (
      <div className={cn('border border-dashed border-slate-300 rounded-lg p-4 bg-slate-50', className)}>
        <div className="flex items-center justify-center h-32">
          <div className="text-center text-slate-500">
            <svg
              className="h-8 w-8 mx-auto mb-2 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
            <p className="text-sm">No preview available</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('border rounded-lg overflow-hidden bg-white', className)}>
      <div className="bg-slate-50 px-3 py-2 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-slate-700">Preview</h4>
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <span>{snippet.name}</span>
            {Object.keys(memoizedParameters).length > 0 && (
              <>
                <span>•</span>
                <span>{Object.keys(memoizedParameters).length} parameter{Object.keys(memoizedParameters).length !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="p-4">
        <div
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    </div>
  );
};
