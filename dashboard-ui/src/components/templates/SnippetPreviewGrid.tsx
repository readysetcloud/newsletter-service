import React, { useState, useEffect } from 'react';
import { useBatchSnippetPreview } from '@/hooks/useSnippetPreview';
import type { Snippet } from '@/types/template';

interface SnippetPreviewGridProps {
  snippets: Array<{ snippet: Snippet; parameters?: Record<string, any> }>;
  onPreviewClick?: (snippet: Snippet, html: string) => void;
  onThumbnailClick?: (snippet: Snippet, thumbnailUrl: string) => void;
  className?: string;
  showProgress?: boolean;
  autoGenerate?: boolean;
  batchSize?: number;
}

interface SnippetGridItemProps {
  snippet: Snippet;
  parameters?: Record<string, any>;
  previewState?: {
    html: string;
    loading: boolean;
    error: string | null;
    success: boolean;
    thumbnailUrl?: string;
  };
  onPreviewClick?: (snippet: Snippet, html: string) => void;
  onThumbnailClick?: (snippet: Snippet, thumbnailUrl: string) => void;
}

const SnippetGridItem: React.FC<SnippetGridItemProps> = ({
  snippet,
  parameters = {},
  previewState,
  onPreviewClick,
  onThumbnailClick
}) => {
  const handlePreviewClick = () => {
    if (previewState?.success && previewState.html) {
      onPreviewClick?.(snippet, previewState.html);
    }
  };

  const handleThumbnailClick = () => {
    if (previewState?.thumbnailUrl) {
      onThumbnailClick?.(snippet, previewState.thumbnailUrl);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      {/* Thumbnail Section */}
      <div className="aspect-video bg-gray-50 rounded-t-lg overflow-hidden relative">
        {previewState?.loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        )}

        {previewState?.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50">
            <div className="text-center p-4">
              <svg className="w-8 h-8 text-red-400 mx-auto mb-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <p className="text-xs text-red-600">Preview failed</p>
            </div>
          </div>
        )}

        {previewState?.thumbnailUrl && (
          <img
            src={previewState.thumbnailUrl}
            alt={`Preview of ${snippet.name}`}
            className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
            onClick={handleThumbnailClick}
          />
        )}

        {previewState?.success && !previewState.thumbnailUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="text-center p-4">
              <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <p className="text-xs text-gray-500">No thumbnail</p>
            </div>
          </div>
        )}

        {!previewState && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="text-center p-4">
              <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-xs text-gray-400">No preview</p>
            </div>
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-1 truncate">{snippet.name}</h3>
        {snippet.description && (
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{snippet.description}</p>
        )}

        {/* Parameters Summary */}
        {Object.keys(parameters).length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">Parameters:</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(parameters).slice(0, 3).map(([key, value]) => (
                <span
                  key={key}
                  className="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded"
                  title={`${key}: ${value}`}
                >
                  {key}
                </span>
              ))}
              {Object.keys(parameters).length > 3 && (
                <span className="inline-block px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                  +{Object.keys(parameters).length - 3} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Status and Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {previewState?.success && (
              <span className="inline-flex items-center px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Ready
              </span>
            )}
            {previewState?.error && (
              <span className="inline-flex items-center px-2 py-1 text-xs bg-red-100 text-red-800 rounded">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                Error
              </span>
            )}
            {previewState?.loading && (
              <span className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-600 mr-1"></div>
                Loading
              </span>
            )}
          </div>

          {previewState?.success && previewState.html && (
            <button
              onClick={handlePreviewClick}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              View Preview
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const SnippetPreviewGrid: React.FC<SnippetPreviewGridProps> = ({
  snippets,
  onPreviewClick,
  onThumbnailClick,
  className = '',
  showProgress = true,
  autoGenerate = true,
  batchSize = 5
}) => {
  const {
    state,
    generatePreviews,
    clearResults,
    getPreview
  } = useBatchSnippetPreview({
    batchSize,
    generateThumbnails: true,
    onProgress: showProgress ? undefined : () => {} // Disable progress if not shown
  });

  const [isGenerating, setIsGenerating] = useState(false);

  // Auto-generate previews when snippets change
  useEffect(() => {
    if (autoGenerate && snippets.length > 0) {
      setIsGenerating(true);
      generatePreviews(snippets).finally(() => {
        setIsGenerating(false);
      });
    }
  }, [snippets, autoGenerate, generatePreviews]);

  const handleManualGenerate = async () => {
    setIsGenerating(true);
    try {
      await generatePreviews(snippets);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearResults = () => {
    clearResults();
  };

  const progressPercentage = state.progress.total > 0
    ? Math.round((state.progress.completed / state.progress.total) * 100)
    : 0;

  return (
    <div className={`snippet-preview-grid ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Snippet Previews</h2>
          <p className="text-sm text-gray-600 mt-1">
            {snippets.length} snippet{snippets.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {showProgress && (state.loading || isGenerating) && (
            <div className="flex items-center space-x-2">
              <div className="w-32 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-600">
                {state.progress.completed}/{state.progress.total}
              </span>
            </div>
          )}

          <button
            onClick={handleManualGenerate}
            disabled={state.loading || isGenerating}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.loading || isGenerating ? 'Generating...' : 'Generate Previews'}
          </button>

          <button
            onClick={handleClearResults}
            disabled={state.loading || isGenerating}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Error State */}
      {state.error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-red-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-red-800 font-medium">Batch Preview Generation Failed</span>
          </div>
          <p className="text-red-700 mt-1">{state.error}</p>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {snippets.map(({ snippet, parameters }) => (
          <SnippetGridItem
            key={snippet.id}
            snippet={snippet}
            parameters={parameters}
            previewState={getPreview(snippet.id)}
            onPreviewClick={onPreviewClick}
            onThumbnailClick={onThumbnailClick}
          />
        ))}
      </div>

      {/* Empty State */}
      {snippets.length === 0 && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Snippets</h3>
          <p className="text-gray-600">Add some snippets to see their previews here.</p>
        </div>
      )}
    </div>
  );
};

export default SnippetPreviewGrid;
