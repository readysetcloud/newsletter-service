import React, { useState, useCallback } from 'react';
import {
  ChevronRightIcon,
  ChevronDownIcon,
  CodeBracketIcon,
  PlusIcon,
  EyeIcon,
  InformationCircleIcon,
  ClipboardDocumentIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { cn } from '@/utils/cn';
import type { Snippet } from '@/types/template';

interface SnippetPanelProps {
  snippets: Snippet[];
  loading?: boolean;
  onInsertSnippet?: (snippet: Snippet) => void;
  onCreateSnippet?: () => void;
  onEditSnippet?: (snippet: Snippet) => void;
  className?: string;
}

interface SnippetItemProps {
  snippet: Snippet;
  onInsert?: (snippet: Snippet) => void;
  onEdit?: (snippet: Snippet) => void;
}

const SnippetItem: React.FC<SnippetItemProps> = ({
  snippet,
  onInsert,
  onEdit
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleInsert = useCallback(() => {
    onInsert?.(snippet);
  }, [snippet, onInsert]);

  const handleEdit = useCallback(() => {
    onEdit?.(snippet);
  }, [snippet, onEdit]);

  const generateSnippetCode = useCallback((snippet: Snippet): string => {
    if (!snippet.parameters || snippet.parameters.length === 0) {
      return `{{> ${snippet.name}}}`;
    }

    const params = snippet.parameters.map(param => {
      const defaultValue = param.defaultValue !== undefined ?
        param.defaultValue :
        (param.type === 'string' ? '""' : param.type === 'number' ? '0' : 'false');

      return `${param.name}=${defaultValue}`;
    }).join(' ');

    return `{{> ${snippet.name} ${params}}}`;
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

  return (
    <div className="border border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
      {/* Snippet Header */}
      <div className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex-shrink-0 p-1 hover:bg-slate-100 rounded"
            >
              {isExpanded ? (
                <ChevronDownIcon className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronRightIcon className="w-4 h-4 text-slate-500" />
              )}
            </button>

            <CodeBracketIcon className="w-4 h-4 text-slate-500 flex-shrink-0" />

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-medium text-slate-900 truncate">
                {snippet.name}
              </h4>
              {snippet.description && (
                <p className="text-xs text-slate-600 truncate mt-1">
                  {snippet.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleInsert}
              className="h-7 px-2 text-xs"
              title="Insert snippet"
            >
              <PlusIcon className="w-3 h-3" />
            </Button>

            {onEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleEdit}
                className="h-7 px-2 text-xs"
                title="Edit snippet"
              >
                <EyeIcon className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Parameter Count */}
        {snippet.parameters && snippet.parameters.length > 0 && (
          <div className="mt-2 text-xs text-slate-500">
            {snippet.parameters.length} parameter{snippet.parameters.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-slate-200 p-3 bg-slate-50">
          {/* Parameters */}
          {snippet.parameters && snippet.parameters.length > 0 && (
            <div className="mb-3">
              <h5 className="text-xs font-medium text-slate-700 mb-2">Parameters:</h5>
              <div className="space-y-2">
                {snippet.parameters.map(param => (
                  <div key={param.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-slate-900">{param.name}</span>
                      {param.required && (
                        <span className="text-red-500">*</span>
                      )}
                      <span className={cn(
                        'px-1.5 py-0.5 rounded text-xs',
                        getParameterTypeBadgeColor(param.type)
                      )}>
                        {param.type}
                      </span>
                    </div>
                    {param.defaultValue !== undefined && (
                      <span className="text-slate-500 font-mono">
                        = {param.defaultValue.toString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Generated Code Preview */}
          <div className="mb-3">
            <h5 className="text-xs font-medium text-slate-700 mb-2">Usage:</h5>
            <div className="bg-slate-900 text-slate-100 p-2 rounded text-xs font-mono overflow-x-auto">
              {generateSnippetCode(snippet)}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              onClick={handleInsert}
              className="flex items-center text-xs h-7"
            >
              <ClipboardDocumentIcon className="w-3 h-3 mr-1" />
              Insert
            </Button>

            {snippet.content && (
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                {showPreview ? 'Hide' : 'Show'} Content
              </button>
            )}
          </div>

          {/* Content Preview */}
          {showPreview && snippet.content && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <h5 className="text-xs font-medium text-slate-700 mb-2">Content:</h5>
              <div className="bg-white border border-slate-200 rounded p-2 text-xs font-mono max-h-32 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-slate-800">
                  {snippet.content}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const SnippetPanel: React.FC<SnippetPanelProps> = ({
  snippets,
  loading = false,
  onInsertSnippet,
  onCreateSnippet,
  onEditSnippet,
  className
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const filteredSnippets = snippets.filter(snippet =>
    snippet.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (snippet.description && snippet.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (isCollapsed) {
    return (
      <div className={cn('w-12 border-r border-slate-200 bg-slate-50', className)}>
        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(false)}
            className="w-full h-8 p-0"
            title="Expand snippets panel"
          >
            <CodeBracketIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('w-80 border-r border-slate-200 bg-slate-50 flex flex-col', className)}>
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-900 flex items-center">
            <CodeBracketIcon className="w-4 h-4 mr-2" />
            Snippets
          </h3>
          <div className="flex items-center space-x-1">
            {onCreateSnippet && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onCreateSnippet}
                className="h-7 px-2"
                title="Create new snippet"
              >
                <PlusIcon className="w-3 h-3" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsCollapsed(true)}
              className="h-7 px-2"
              title="Collapse panel"
            >
              <ChevronRightIcon className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <Input
          placeholder="Search snippets..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="text-sm"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loading size="sm" />
          </div>
        ) : filteredSnippets.length === 0 ? (
          <div className="text-center py-8">
            <CodeBracketIcon className="w-8 h-8 text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-2">
              {searchTerm ? 'No snippets found' : 'No snippets available'}
            </p>
            <p className="text-xs text-slate-500 mb-4">
              {searchTerm
                ? 'Try adjusting your search terms'
                : 'Create reusable snippets to speed up template creation'
              }
            </p>
            {onCreateSnippet && !searchTerm && (
              <Button size="sm" onClick={onCreateSnippet}>
                Create Snippet
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSnippets.map(snippet => (
              <SnippetItem
                key={snippet.id}
                snippet={snippet}
                onInsert={onInsertSnippet}
                onEdit={onEditSnippet}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-slate-200 bg-white">
        <div className="flex items-center text-xs text-slate-500">
          <InformationCircleIcon className="w-3 h-3 mr-1" />
          Click snippets to insert into template
        </div>
      </div>
    </div>
  );
};
