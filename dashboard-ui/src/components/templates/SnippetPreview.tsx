import React, { useState, useEffect } from 'react';
import { useSnippetPreview } from '@/hooks/useSnippetPreview';
import type { Snippet } from '@/types/template';

interface SnippetPreviewProps {
  snippet: Snippet;
  parameters?: Record<string, any>;
  showThumbnail?: boolean;
  autoGenerate?: boolean;
  className?: string;
  onPreviewGenerated?: (html: string, thumbnailUrl?: string) => void;
  onError?: (error: string) => void;
}

export const SnippetPreview: React.FC<SnippetPreviewProps> = ({
  snippet,
  parameters = {},
  showThumbnail = false,
  autoGenerate = true,
  className = '',
  onPreviewGenerated,
  onError
}) => {
  const {
    preview,
    generatePreview,
    generateThumbnail,
    clearPreview,
    retryPreview,
    validateParameters
  } = useSnippetPreview({
    autoGenerate,
    generateThumbnail: showThumbnail,
    enableRetry: true,
    maxRetries: 2
  });

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  // Validate parameters when they change
  useEffect(() => {
    const validation = validateParameters(snippet, parameters);
    setValidationErrors(validation.errors);
    setValidationWarnings(validation.warnings);
  }, [snippet, parameters, validateParameters]);

  // Auto-generate preview when snippet or parameters change
  useEffect(() => {
    if (autoGenerate && validationErrors.length === 0) {
      generatePreview(snippet, parameters);
    }
  }, [snippet, parameters, autoGenerate, validationErrors.length, generatePreview]);

  // Notify parent when preview is generated
  useEffect(() => {
    if (preview.success && preview.html) {
      onPreviewGenerated?.(preview.html, preview.thumbnailUrl);
    }
  }, [preview.success, preview.html, preview.thumbnailUrl, onPreviewGenerated]);

  // Notify parent of errors
  useEffect(() => {
    if (preview.error) {
      onError?.(preview.error);
    }
  }, [preview.error, onError]);

  const handleManualGenerate = () => {
    if (validationErrors.length === 0) {
      generatePreview(snippet, parameters);
    }
  };

  const handleGenerateThumbnail = async () => {
    if (validationErrors.length === 0) {
      await generateThumbnail(snippet, parameters);
    }
  };

  return (
    <div className={`snippet-preview ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Preview: {snippet.name}
        </h3>
        <div className="flex items-center space-x-2">
          {preview.fromCache && (
            <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
              Cached
            </span>
          )}
          {preview.renderTime && (
            <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
              {preview.renderTime}ms
            </span>
          )}
        </div>
      </div>

      {/* Validation Messages */}
      {validationErrors.length > 0 && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <h4 className="text-sm font-medium text-red-800 mb-2">Validation Errors:</h4>
          <ul className="text-sm text-red-700 space-y-1">
            {validationErrors.map((error, index) => (
              <li key={index}>• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {validationWarnings.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <h4 className="text-sm font-medium text-yellow-800 mb-2">Warnings:</h4>
          <ul className="text-sm text-yellow-700 space-y-1">
            {validationWarnings.map((warning, index) => (
              <li key={index}>• {warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center space-x-2 mb-4">
        <button
          onClick={handleManualGenerate}
          disabled={preview.loading || validationErrors.length > 0}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {preview.loading ? 'Generating...' : 'Generate Preview'}
        </button>

        {showThumbnail && (
          <button
            onClick={handleGenerateThumbnail}
            disabled={preview.loading || validationErrors.length > 0}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Generate Thumbnail
          </button>
        )}

        {preview.error && (
          <button
            onClick={retryPreview}
            disabled={preview.loading}
            className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Retry
          </button>
        )}

        <button
          onClick={clearPreview}
          disabled={preview.loading}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Clear
        </button>
      </div>

      {/* Loading State */}
      {preview.loading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">Generating preview...</span>
        </div>
      )}

      {/* Error State */}
      {preview.error && !preview.loading && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-red-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-red-800 font-medium">Preview Generation Failed</span>
          </div>
          <p className="text-red-700 mt-1">{preview.error}</p>
        </div>
      )}

      {/* Preview Content */}
      {preview.success && preview.html && !preview.loading && (
        <div className="space-y-4">
          {/* Thumbnail */}
          {showThumbnail && preview.thumbnailUrl && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Thumbnail:</h4>
              <img
                src={preview.thumbnailUrl}
                alt={`Thumbnail for ${snippet.name}`}
                className="border border-gray-200 rounded-md shadow-sm"
                style={{ maxWidth: '300px', maxHeight: '200px' }}
              />
            </div>
          )}

          {/* HTML Preview */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">HTML Preview:</h4>
            <div className="border border-gray-200 rounded-md overflow-hidden">
              {/* Preview iframe */}
              <div className="bg-white p-4 min-h-[200px]">
                <div
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                  className="snippet-preview-content"
                />
              </div>

              {/* HTML source toggle */}
              <details className="border-t border-gray-200">
                <summary className="px-4 py-2 bg-gray-50 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-100">
                  View HTML Source
                </summary>
                <div className="p-4 bg-gray-50">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-x-auto">
                    {preview.html}
                  </pre>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!preview.loading && !preview.error && !preview.html && (
        <div className="text-center py-8 text-gray-500">
          <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p>No preview available</p>
          <p className="text-sm">Click "Generate Preview" to create a preview</p>
        </div>
      )}
    </div>
  );
};

export default SnippetPreview;
