import React, { useState, useCallback } from 'react';
import {
  CodeBracketSquareIcon,
  StarIcon,
  InformationCircleIcon,
  Cog6ToothIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import type { Snippet } from '@/types/template';

interface DragDropSnippetProps {
  snippet: Snippet;
  onDragStart: (snippet: Snippet) => void;
  isFavorite: boolean;
  onToggleFavorite: (event: React.MouseEvent) => void;
  className?: string;
}

export const DragDropSnippet: React.FC<DragDropSnippetProps> = ({
  snippet,
  onDragStart,
  isFavorite,
  onToggleFavorite,
  className
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    console.log('DragDropSnippet: Starting drag for snippet:', snippet.name);
    setIsDragging(true);
    onDragStart(snippet);

    // Set drag data for potential use by drop targets
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'snippet',
      snippet: snippet
    }));
    e.dataTransfer.setData('text/plain', snippet.name); // Fallback for compatibility
    e.dataTransfer.effectAllowed = 'copy';

    // Create a custom drag image
    const dragImage = createDragImage(snippet);
    e.dataTransfer.setDragImage(dragImage, 10, 10);
  }, [snippet, onDragStart]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const createDragImage = (snippet: Snippet): HTMLElement => {
    const dragImage = document.createElement('div');
    dragImage.className = 'bg-white border border-slate-300 rounded-lg p-3 shadow-lg';
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.left = '-1000px';
    dragImage.style.width = '200px';
    dragImage.style.zIndex = '9999';

    dragImage.innerHTML = `
      <div class="flex items-center">
        <svg class="w-4 h-4 text-slate-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3"></path>
        </svg>
        <span class="text-sm font-medium text-slate-700 truncate">${snippet.name}</span>
      </div>
    `;

    document.body.appendChild(dragImage);

    // Clean up after a short delay
    setTimeout(() => {
      if (document.body.contains(dragImage)) {
        document.body.removeChild(dragImage);
      }
    }, 100);

    return dragImage;
  };

  const hasParameters = snippet.parameters && snippet.parameters.length > 0;
  const requiredParams = snippet.parameters?.filter(p => p.required).length || 0;

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      className={cn(
        'relative group cursor-grab active:cursor-grabbing',
        'bg-white border border-slate-200 rounded-lg p-3',
        'hover:border-blue-300 hover:shadow-sm transition-all duration-200',
        'select-none',
        isDragging && 'opacity-50 scale-95',
        className
      )}
    >
      {/* Main Content */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center mb-1">
            <CodeBracketSquareIcon className="w-4 h-4 text-slate-600 mr-2 flex-shrink-0" />
            <h4 className="text-sm font-medium text-slate-900 truncate">
              {snippet.name}
            </h4>
          </div>

          {snippet.description && (
            <p className="text-xs text-slate-600 line-clamp-2 mb-2">
              {snippet.description}
            </p>
          )}

          {/* Parameter Info */}
          {hasParameters && (
            <div className="flex items-center text-xs text-slate-500">
              <Cog6ToothIcon className="w-3 h-3 mr-1" />
              <span>
                {snippet.parameters!.length} parameter{snippet.parameters!.length !== 1 ? 's' : ''}
                {requiredParams > 0 && (
                  <span className="text-red-500 ml-1">
                    ({requiredParams} required)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center ml-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleFavorite}
            className="p-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {isFavorite ? (
              <StarIconSolid className="w-4 h-4 text-yellow-500" />
            ) : (
              <StarIcon className="w-4 h-4 text-slate-400 hover:text-yellow-500" />
            )}
          </Button>
        </div>
      </div>

      {/* Drag Indicator */}
      <div className="absolute inset-0 border-2 border-dashed border-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

      {/* Tooltip */}
      {showTooltip && snippet.description && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-64 p-3 bg-slate-900 text-white text-xs rounded-lg shadow-lg">
          <div className="font-medium mb-1">{snippet.name}</div>
          <div className="text-slate-300 mb-2">{snippet.description}</div>

          {hasParameters && (
            <div className="border-t border-slate-700 pt-2">
              <div className="font-medium mb-1">Parameters:</div>
              <div className="space-y-1">
                {snippet.parameters!.slice(0, 3).map(param => (
                  <div key={param.name} className="flex items-center justify-between">
                    <span className="text-slate-300">
                      {param.name}
                      {param.required && <span className="text-red-400 ml-1">*</span>}
                    </span>
                    <span className="text-slate-400 text-xs">{param.type}</span>
                  </div>
                ))}
                {snippet.parameters!.length > 3 && (
                  <div className="text-slate-400 text-xs">
                    +{snippet.parameters!.length - 3} more...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tooltip Arrow */}
          <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-900" />
        </div>
      )}

      {/* Drag Instructions */}
      <div className="absolute inset-0 flex items-center justify-center bg-blue-50 bg-opacity-90 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="text-xs text-blue-700 font-medium">
          Drag to canvas
        </div>
      </div>
    </div>
  );
};
