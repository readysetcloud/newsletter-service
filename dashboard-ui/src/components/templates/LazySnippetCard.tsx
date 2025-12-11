import React, { useState, useCallback, useMemo } from 'react';
import { StarIcon, EyeIcon, ClockIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { Button } from '@/components/ui/Button';
import { useIntersectionObserver, useLazyImage } from '@/utils/performanceOptimizations';
import { snippetCacheManager } from '@/utils/snippetCacheManager';
import { cn } from '@/utils/cn';
import type { Snippet } from '@/types/template';

interface LazySnippetCardProps {
  snippet: Snippet;
  viewMode: 'grid' | 'list';
  isFavorite: boolean;
  onInsert: (snippet: Snippet, parameters: Record<string, any>) => void;
  onToggleFavorite: (snippetId: string) => void;
  showPreview?: boolean;
  className?: string;
  lazy?: boolean;
}

interface SnippetThumbnailProps {
  snippet: Snippet;
  className?: string;
  lazy?: boolean;
}

const SnippetThumbnail: React.FC<SnippetThumbnailProps> = ({
  snippet,
  className = '',
  lazy = true
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(false);

  // Intersection observer for lazy loading
  const [ref, isVisible] = useIntersectionObserver({
    threshold: 0.1,
    rootMargin: '50px'
  });

  // Check cache first
  React.useEffect(() => {
    if (!lazy || isVisible) {
      const cachedThumbnail = snippetCacheManager.getThumbnail(snippet.id, {});
      if (cachedThumbnail) {
        setThumbnailUrl(cachedThumbnail);
      } else {
        generateThumbnail();
      }
    }
  }, [snippet.id, isVisible, lazy]);

  const generateThumbnail = useCallback(async () => {
    if (isGenerating) return;

    setIsGenerating(true);
    setError(false);

    try {
      // Generate a simple placeholder thumbnail
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        // Background
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Border
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

        // Icon/Symbol
        ctx.fillStyle = '#64748b';
        ctx.font = '24px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('📄', canvas.width / 2, 60);

        // Title
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 16px Arial, sans-serif';
        ctx.textAlign = 'center';

        const title = snippet.name.length > 20
          ? snippet.name.substring(0, 20) + '...'
          : snippet.name;
        ctx.fillText(title, canvas.width / 2, 100);

        // Description
        if (snippet.description) {
          ctx.fillStyle = '#64748b';
          ctx.font = '12px Arial, sans-serif';

          const description = snippet.description.length > 40
            ? snippet.description.substring(0, 40) + '...'
            : snippet.description;

          // Word wrap description
          const words = description.split(' ');
          let line = '';
          let y = 125;

          for (const word of words) {
            const testLine = line + word + ' ';
            const metrics = ctx.measureText(testLine);

            if (metrics.width > canvas.width - 40 && line !== '') {
              ctx.fillText(line, canvas.width / 2, y);
              line = word + ' ';
              y += 15;
              if (y > 170) break; // Don't overflow
            } else {
              line = testLine;
            }
          }

          if (line && y <= 170) {
            ctx.fillText(line, canvas.width / 2, y);
          }
        }

        // Parameters count
        if (snippet.parameters && snippet.parameters.length > 0) {
          ctx.fillStyle = '#3b82f6';
          ctx.font = '10px Arial, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(
            `${snippet.parameters.length} parameter${snippet.parameters.length !== 1 ? 's' : ''}`,
            10,
            canvas.height - 10
          );
        }

        const thumbnailDataUrl = canvas.toDataURL('image/png', 0.8);
        setThumbnailUrl(thumbnailDataUrl);

        // Cache the thumbnail
        snippetCacheManager.cacheThumbnail(snippet.id, {}, thumbnailDataUrl, 'png');
      } else {
        throw new Error('Could not get canvas context');
      }
    } catch (err) {
      console.error('Failed to generate thumbnail:', err);
      setError(true);
    } finally {
      setIsGenerating(false);
    }
  }, [snippet, isGenerating]);

  // Lazy image loading
  const { imageSrc, isLoaded } = useLazyImage(
    thumbnailUrl || '',
    '' // No placeholder initially
  );

  if (!lazy || isVisible) {
    return (
      <div
        ref={ref}
        className={cn(
          'relative overflow-hidden rounded-lg bg-slate-50 border border-slate-200',
          className
        )}
      >
        {isGenerating ? (
          <div className="flex items-center justify-center h-32 bg-slate-100">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 bg-slate-100 text-slate-500">
            <div className="text-center">
              <div className="text-2xl mb-2">📄</div>
              <div className="text-xs">Preview unavailable</div>
            </div>
          </div>
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt={`Preview of ${snippet.name}`}
            className={cn(
              'w-full h-32 object-cover transition-opacity duration-200',
              isLoaded ? 'opacity-100' : 'opacity-0'
            )}
            loading="lazy"
          />
        ) : (
          <div className="flex items-center justify-center h-32 bg-slate-100">
            <div className="animate-pulse bg-slate-200 w-full h-full"></div>
          </div>
        )}
      </div>
    );
  }

  // Placeholder when not visible
  return (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-lg bg-slate-100 border border-slate-200',
        className
      )}
    >
      <div className="flex items-center justify-center h-32 bg-slate-100">
        <div className="animate-pulse bg-slate-200 w-16 h-16 rounded"></div>
      </div>
    </div>
  );
};

export const LazySnippetCard: React.FC<LazySnippetCardProps> = ({
  snippet,
  viewMode,
  isFavorite,
  onInsert,
  onToggleFavorite,
  showPreview = true,
  className = '',
  lazy = true
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Intersection observer for lazy loading
  const [ref, isVisible] = useIntersectionObserver({
    threshold: 0.1,
    rootMargin: '100px'
  });

  const handleInsert = useCallback(() => {
    onInsert(snippet, {});
  }, [snippet, onInsert]);

  const handleToggleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite(snippet.id);
  }, [snippet.id, onToggleFavorite]);

  const parameterCount = snippet.parameters?.length || 0;
  const hasRequiredParams = snippet.parameters?.some(p => p.required) || false;

  // Memoize expensive calculations
  const cardContent = useMemo(() => {
    if (viewMode === 'grid') {
      return (
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <h3 className="font-semibold text-slate-900 text-sm leading-tight">
              {snippet.name}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleFavorite}
              className="ml-2 p-1 h-auto text-slate-400 hover:text-yellow-500"
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              {isFavorite ? (
                <StarIconSolid className="w-4 h-4 text-yellow-500" />
              ) : (
                <StarIcon className="w-4 h-4" />
              )}
            </Button>
          </div>

          {snippet.description && (
            <p className="text-slate-600 text-xs mb-3 line-clamp-2">
              {snippet.description}
            </p>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {parameterCount > 0 && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {parameterCount} param{parameterCount !== 1 ? 's' : ''}
                </span>
              )}
              {hasRequiredParams && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                  Required
                </span>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleInsert}
              className="text-xs px-3 py-1"
            >
              Insert
            </Button>
          </div>
        </div>
      );
    } else {
      return (
        <div className="flex items-center p-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-900 text-sm truncate">
                {snippet.name}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleFavorite}
                className="ml-2 p-1 h-auto text-slate-400 hover:text-yellow-500"
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                {isFavorite ? (
                  <StarIconSolid className="w-4 h-4 text-yellow-500" />
                ) : (
                  <StarIcon className="w-4 h-4" />
                )}
              </Button>
            </div>

            {snippet.description && (
              <p className="text-slate-600 text-xs mb-2 line-clamp-1">
                {snippet.description}
              </p>
            )}

            <div className="flex items-center gap-2">
              {parameterCount > 0 && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {parameterCount} param{parameterCount !== 1 ? 's' : ''}
                </span>
              )}
              {hasRequiredParams && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                  Required
                </span>
              )}
            </div>
          </div>

          <div className="ml-4 flex-shrink-0">
            <Button
              size="sm"
              onClick={handleInsert}
              className="text-xs px-3 py-1"
            >
              Insert
            </Button>
          </div>
        </div>
      );
    }
  }, [viewMode, snippet, parameterCount, hasRequiredParams, isFavorite, handleInsert, handleToggleFavorite]);

  return (
    <div
      ref={ref}
      className={cn(
        'bg-white border border-slate-200 rounded-lg shadow-sm transition-all duration-200',
        'hover:shadow-md hover:border-slate-300',
        isHovered && 'ring-2 ring-blue-500 ring-opacity-20',
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="article"
      aria-label={`Snippet: ${snippet.name}`}
    >
      {/* Thumbnail for grid view */}
      {viewMode === 'grid' && showPreview && (
        <SnippetThumbnail
          snippet={snippet}
          lazy={lazy}
          className="rounded-t-lg"
        />
      )}

      {/* Card content */}
      {cardContent}
    </div>
  );
};
