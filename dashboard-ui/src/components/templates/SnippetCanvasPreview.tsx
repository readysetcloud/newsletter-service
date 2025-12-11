import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Handlebars from 'handlebars';
import {
  ArrowLeftIcon,
  EyeIcon,
  CodeBracketIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { cn } from '@/utils/cn';
import type { Snippet, SnippetParameter } from '@/types/template';

interface SnippetCanvasPreviewProps {
  snippet: Snippet;
  parameters?: Record<string, any>;
  onParameterChange?: (paramName: string, value: any) => void;
  onExit?: () => void;
  className?: string;
}

export const SnippetCanvasPreview: React.FC<SnippetCanvasPreviewProps> = ({
  snippet,
  parameters = {},
  onParameterChange,
  onExit,
  className
}) => {
  const [renderedHtml, setRenderedHtml] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');

  // Get default value for parameter type
  const getDefaultValueForType = useCallback((type: string): any => {
    switch (type) {
      case 'string':
        return '';
      case 'number':
        return 0;
      case 'boolean':
        return false;
      default:
        return '';
    }
  }, []);

  // Initialize parameters with defaults
  const initializedParameters = useMemo(() => {
    const params = { ...parameters };

    if (snippet.parameters) {
      snippet.parameters.forEach(param => {
        if (params[param.name] === undefined) {
          params[param.name] = param.defaultValue !== undefined
            ? param.defaultValue
            : getDefaultValueForType(param.type);
        }
      });
    }

    return params;
  }, [snippet.parameters, parameters, getDefaultValueForType]);

  // Client-side snippet rendering
  const renderSnippet = useCallback(async () => {
    if (!snippet.content) {
      setRenderError('Snippet content is not available');
      return;
    }

    setIsLoading(true);
    setRenderError(null);

    try {
      // Compile and render snippet
      const compiledSnippet = Handlebars.compile(snippet.content);
      const html = compiledSnippet(initializedParameters);
      setRenderedHtml(html);
    } catch (error) {
      console.error('Snippet rendering error:', error);
      setRenderError(error instanceof Error ? error.message : 'Failed to render snippet');
    } finally {
      setIsLoading(false);
    }
  }, [snippet.content, initializedParameters]);

  // Re-render when snippet or parameters change
  useEffect(() => {
    renderSnippet();
  }, [renderSnippet]);

  // Handle parameter changes
  const handleParameterChange = useCallback((paramName: string, value: any) => {
    onParameterChange?.(paramName, value);
  }, [onParameterChange]);

  // Render parameter input based on type
  const renderParameterInput = useCallback((param: SnippetParameter) => {
    const value = initializedParameters[param.name];

    switch (param.type) {
      case 'boolean':
        return (
          <Select
            value={value?.toString() || 'false'}
            onChange={(e) => handleParameterChange(param.name, e.target.value === 'true')}
            options={[
              { value: 'false', label: 'False' },
              { value: 'true', label: 'True' }
            ]}
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            value={value?.toString() || ''}
            onChange={(e) => {
              const numValue = e.target.value ? Number(e.target.value) : '';
              handleParameterChange(param.name, numValue);
            }}
            placeholder={param.description || `Enter ${param.type} value...`}
          />
        );
      default: // string
        return (
          <Input
            type="text"
            value={value?.toString() || ''}
            onChange={(e) => handleParameterChange(param.name, e.target.value)}
            placeholder={param.description || `Enter ${param.type} value...`}
          />
        );
    }
  }, [initializedParameters, handleParameterChange]);

  // Preview content
  const previewContent = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full min-h-[400px] bg-slate-50 border border-slate-200 rounded-lg">
          <div className="text-center p-6">
            <Loading size="lg" />
            <p className="text-slate-600 mt-4">Rendering snippet...</p>
          </div>
        </div>
      );
    }

    if (renderError) {
      return (
        <div className="flex items-center justify-center h-full min-h-[400px] bg-red-50 border border-red-200 rounded-lg">
          <div className="text-center p-6">
            <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-red-900 mb-2">Rendering Error</h3>
            <p className="text-red-700 text-sm max-w-md">{renderError}</p>
            <Button
              onClick={renderSnippet}
              variant="outline"
              size="sm"
              className="mt-4"
            >
              <ArrowPathIcon className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      );
    }

    if (!renderedHtml) {
      return (
        <div className="flex items-center justify-center h-full min-h-[400px] bg-slate-50 border border-slate-200 rounded-lg">
          <div className="text-center p-6">
            <EyeIcon className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600">No preview available</p>
          </div>
        </div>
      );
    }

    if (viewMode === 'code') {
      return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
            <h4 className="text-sm font-medium text-slate-700">Generated HTML</h4>
          </div>
          <div className="p-4">
            <pre className="text-sm text-slate-600 whitespace-pre-wrap overflow-x-auto bg-slate-50 p-4 rounded">
              {renderedHtml}
            </pre>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h4 className="text-sm font-medium text-slate-700">Snippet Preview</h4>
        </div>
        <div className="p-6 min-h-[400px]">
          <div
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
            className="snippet-preview-content"
          />
        </div>
      </div>
    );
  }, [isLoading, renderError, renderedHtml, viewMode, renderSnippet]);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            onClick={onExit}
            className="flex items-center"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-2" />
            Back to Template
          </Button>
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Snippet Preview: {snippet.name}
            </h2>
            {snippet.description && (
              <p className="text-sm text-slate-600 mt-1">{snippet.description}</p>
            )}
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center space-x-2">
          <div className="flex rounded-md border border-slate-300 bg-white">
            <button
              onClick={() => setViewMode('preview')}
              className={cn(
                'flex items-center px-3 py-2 text-sm font-medium transition-colors rounded-l-md',
                viewMode === 'preview'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-700 hover:bg-slate-50'
              )}
            >
              <EyeIcon className="h-4 w-4 mr-2" />
              Preview
            </button>
            <button
              onClick={() => setViewMode('code')}
              className={cn(
                'flex items-center px-3 py-2 text-sm font-medium transition-colors rounded-r-md',
                viewMode === 'code'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-700 hover:bg-slate-50'
              )}
            >
              <CodeBracketIcon className="h-4 w-4 mr-2" />
              Code
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Parameters Panel */}
        {snippet.parameters && snippet.parameters.length > 0 && (
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {snippet.parameters.map((param) => (
                  <div key={param.name}>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {param.name}
                      {param.required && <span className="text-red-500 ml-1">*</span>}
                      <span className="text-xs text-slate-500 ml-1">({param.type})</span>
                    </label>
                    {renderParameterInput(param)}
                    {param.description && (
                      <p className="text-xs text-slate-500 mt-1">{param.description}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Preview Area */}
        <div className={cn(
          snippet.parameters && snippet.parameters.length > 0
            ? 'lg:col-span-3'
            : 'lg:col-span-4'
        )}>
          {previewContent}
        </div>
      </div>

      {/* Status Indicator */}
      {!isLoading && !renderError && renderedHtml && (
        <div className="flex items-center justify-center">
          <div className="flex items-center text-green-600 text-sm">
            <CheckCircleIcon className="w-4 h-4 mr-2" />
            Snippet rendered successfully
          </div>
        </div>
      )}
    </div>
  );
};

export default SnippetCanvasPreview;
