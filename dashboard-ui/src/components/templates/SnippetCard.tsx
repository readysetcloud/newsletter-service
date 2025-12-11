import React, { useState, useCallback } from 'react';
import {
  StarIcon,
  CodeBracketIcon,
  EyeIcon,
  ClipboardDocumentIcon,
  CalendarIcon,
  TagIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

import { Loading } from '@/components/ui/Loading';
import { cn } from '@/utils/cn';
import SnippetPreviewUtils from '@/utils/snippetPreviewUtils';
import type { Snippet } from '@/types/template';

interface SnippetCardProps {
  snippet: Snippet;
  viewMode?: 'grid' | 'list';
  isFavorite?: boolean;
  showPreview?: boolean;
  onInsert?: (snippet: Snippet, parameters: Record<string, any>) => void;
  onToggleFavorite?: (snippetId: string) => void;
  onEdit?: (snippet: Snippet) => void;
  className?: string;
}

interface PreviewState {
  html: string;
  loading: boolean;
  error: string | null;
}

export const SnippetCard: React.FC<SnippetCardProps> = ({
  snippet,
  viewMode = 'grid',
  isFavorite = false,
  showPreview = true,
  onInsert,
  onToggleFavorite,
  onEdit,
  className
}) => {
  const [previewState, setPreviewState] = useState<PreviewState>({
    html: '',
    loading: false,
    error: null
  });
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [showParameterDialog, setShowParameterDialog] = useState(false);

  // Generate default parameters for preview
  const getDefaultParameters = useCallback(() => {
    const parameters: Record<string, any> = {};

    if (snippet.parameters) {
      snippet.parameters.forEach(param => {
        if (param.defaultValue !== undefined) {
          parameters[param.name] = param.defaultValue;
        } else {
          // Generate sample values based on type
          switch (param.type) {
            case 'string':
              parameters[param.name] = `Sample ${param.name}`;
              break;
            case 'number':
              parameters[param.name] = 42;
              break;
            case 'boolean':
              parameters[param.name] = true;
              break;
            default:
              parameters[param.name] = '';
          }
        }
      });
    }

    return parameters;
  }, [snippet.parameters]);

  // Load preview
  const loadPreview = useCallback(async () => {
    if (!showPreview || previewState.html || previewState.loading) return;

    setPreviewState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const parameters = getDefaultParameters();
      const result = await SnippetPreviewUtils.generatePreview(snippet, parameters, {
        useCache: true,
        fallbackOnError: true
      });

      setPreviewState({
        html: result.html,
        loading: false,
        error: result.success ? null : result.error || 'Preview generation failed'
      });
    } catch (error) {
      setPreviewState({
        html: '',
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load preview'
      });
    }
  }, [snippet, showPreview, getDefaultParameters, previewState.html, previewState.loading]);

  // Load preview on mount if needed
  React.useEffect(() => {
    if (showPreview && viewMode === 'grid') {
      loadPreview();
    }
  }, [loadPreview, showPreview, viewMode]);

  const handleInsert = useCallback(() => {
    if (!onInsert) return;

    if (snippet.parameters && snippet.parameters.length > 0) {
      // Show parameter configuration dialog
      setShowParameterDialog(true);
    } else {
      // Insert directly with no parameters
      onInsert(snippet, {});
    }
  }, [snippet, onInsert]);

  const handleQuickInsert = useCallback(() => {
    if (!onInsert) return;

    // Insert with default parameters
    const parameters = getDefaultParameters();
    onInsert(snippet, parameters);
  }, [snippet, onInsert, getDefaultParameters]);

  const handleToggleFavorite = useCallback(() => {
    onToggleFavorite?.(snippet.id);
  }, [snippet.id, onToggleFavorite]);

  const handleEdit = useCallback(() => {
    onEdit?.(snippet);
  }, [snippet, onEdit]);

  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }, []);

  const getParameterTypeBadgeColor = useCallback((type: string) => {
    switch (type) {
      case 'string':
        return 'bg-blue-100 text-blue-800';
      case 'number':
        return 'bg-green-100 text-green-800';
      case 'boolean':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  }, []);

  const renderPreview = () => {
    if (!showPreview) return null;

    if (previewState.loading) {
      return (
        <div className="h-24 bg-slate-50 border border-slate-200 rounded flex items-center justify-center">
          <Loading size="sm" />
        </div>
      );
    }

    if (previewState.error) {
      return (
        <div className="h-24 bg-red-50 border border-red-200 rounded flex items-center justify-center">
          <div className="text-center">
            <InformationCircleIcon className="w-5 h-5 text-red-500 mx-auto mb-1" />
            <p className="text-xs text-red-600">Preview unavailable</p>
          </div>
        </div>
      );
    }

    if (previewState.html) {
      return (
        <div
          className="h-24 bg-white border border-slate-200 rounded overflow-hidden cursor-pointer hover:border-slate-300 transition-colors"
          onClick={() => setShowFullPreview(true)}
        >
          <div
            className="w-full h-full scale-50 origin-top-left transform"
            style={{ width: '200%', height: '200%' }}
            dangerouslySetInnerHTML={{ __html: previewState.html }}
          />
        </div>
      );
    }

    return (
      <div className="h-24 bg-slate-50 border border-slate-200 rounded flex items-center justify-center">
        <div className="text-center">
          <CodeBracketIcon className="w-5 h-5 text-slate-400 mx-auto mb-1" />
          <p className="text-xs text-slate-500">No preview</p>
        </div>
      </div>
    );
  };

  if (viewMode === 'list') {
    return (
      <Card className={cn('hover:shadow-md transition-shadow', className)}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 flex-1 min-w-0">
              <CodeBracketIcon className="w-5 h-5 text-slate-500 flex-shrink-0" />

              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-slate-900 truncate">{snippet.name}</h3>
                {snippet.description && (
                  <p className="text-sm text-slate-600 truncate mt-1">{snippet.description}</p>
                )}

                <div className="flex items-center gap-4 text-xs text-slate-500 mt-2">
                  <div className="flex items-center">
                    <CalendarIcon className="w-3 h-3 mr-1" />
                    {formatDate(snippet.updatedAt)}
                  </div>
                  {snippet.parameters && snippet.parameters.length > 0 && (
                    <div className="flex items-center">
                      <TagIcon className="w-3 h-3 mr-1" />
                      {snippet.parameters.length} parameter{snippet.parameters.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 flex-shrink-0">
              {onToggleFavorite && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleToggleFavorite}
                  className="h-8 w-8 p-0"
                >
                  {isFavorite ? (
                    <StarIconSolid className="w-4 h-4 text-yellow-500" />
                  ) : (
                    <StarIcon className="w-4 h-4 text-slate-400" />
                  )}
                </Button>
              )}

              {onEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEdit}
                  className="flex items-center"
                >
                  <EyeIcon className="w-4 h-4 mr-1" />
                  Edit
                </Button>
              )}

              {onInsert && (
                <Button
                  size="sm"
                  onClick={handleInsert}
                  className="flex items-center"
                >
                  <ClipboardDocumentIcon className="w-4 h-4 mr-1" />
                  Insert
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Grid view
  return (
    <Card className={cn('hover:shadow-md transition-shadow h-full', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate flex items-center">
              <CodeBracketIcon className="w-4 h-4 mr-2 text-slate-500" />
              {snippet.name}
            </CardTitle>
            {snippet.description && (
              <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                {snippet.description}
              </p>
            )}
          </div>

          {onToggleFavorite && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleFavorite}
              className="h-8 w-8 p-0 flex-shrink-0 ml-2"
            >
              {isFavorite ? (
                <StarIconSolid className="w-4 h-4 text-yellow-500" />
              ) : (
                <StarIcon className="w-4 h-4 text-slate-400" />
              )}
            </Button>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-xs text-slate-500 mt-2">
          <div className="flex items-center">
            <CalendarIcon className="w-3 h-3 mr-1" />
            {formatDate(snippet.updatedAt)}
          </div>
          {snippet.parameters && snippet.parameters.length > 0 && (
            <div className="flex items-center">
              <TagIcon className="w-3 h-3 mr-1" />
              {snippet.parameters.length} param{snippet.parameters.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Preview */}
        {renderPreview()}

        {/* Parameters */}
        {snippet.parameters && snippet.parameters.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-1">
              {snippet.parameters.slice(0, 3).map(param => (
                <span
                  key={param.name}
                  className={cn(
                    'inline-flex items-center px-2 py-1 text-xs rounded-full',
                    getParameterTypeBadgeColor(param.type)
                  )}
                >
                  {param.name}
                  {param.required && <span className="ml-1 text-red-500">*</span>}
                </span>
              ))}
              {snippet.parameters.length > 3 && (
                <span className="inline-flex items-center px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">
                  +{snippet.parameters.length - 3} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-2">
            {onEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleEdit}
                className="flex items-center"
              >
                <EyeIcon className="w-4 h-4 mr-1" />
                Edit
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onInsert && snippet.parameters && snippet.parameters.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleQuickInsert}
                className="flex items-center"
                title="Insert with default parameters"
              >
                Quick
              </Button>
            )}

            {onInsert && (
              <Button
                size="sm"
                onClick={handleInsert}
                className="flex items-center"
              >
                <ClipboardDocumentIcon className="w-4 h-4 mr-1" />
                Insert
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      {/* Full Preview Modal */}
      {showFullPreview && previewState.html && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowFullPreview(false)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-2xl max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">Preview: {snippet.name}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFullPreview(false)}
              >
                ×
              </Button>
            </div>
            <div
              className="border border-slate-200 rounded p-4"
              dangerouslySetInnerHTML={{ __html: previewState.html }}
            />
          </div>
        </div>
      )}
    </Card>
  );
};
