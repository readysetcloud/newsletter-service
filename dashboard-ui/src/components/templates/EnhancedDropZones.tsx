import React, { useState, useCallback, useRef } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { DropZoneComponent } from './DropZoneComponent';

export interface EnhancedDropZonesProps {
  componentCount: number;
  onDrop: (e: DragEvent, index: number) => void;
  draggedItem: any;
  className?: string;
}

export const EnhancedDropZones: React.FC<EnhancedDropZonesProps> = ({
  componentCount,
  onDrop,
  draggedItem,
  className
}) => {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const handleDragOver = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);
    dragCounter.current = 0;
    onDrop(e, index);
  }, [onDrop]);

  const handleGlobalDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverIndex(null);
    }
  }, []);

  const handleGlobalDragEnter = useCallback(() => {
    dragCounter.current++;
  }, []);

  // If no components, show large empty state drop zone
  if (componentCount === 0) {
    return (
      <div className={cn('w-full', className)}>
        <EmptyCanvasDropZone
          onDrop={(e) => handleDrop(e, 0)}
          onDragOver={(e) => handleDragOver(e, 0)}
          isActive={dragOverIndex === 0}
          isDragging={!!draggedItem}
        />
      </div>
    );
  }

  // Render drop zones between and after components
  const dropZones = [];

  // Drop zones between components and at the end
  for (let i = 0; i <= componentCount; i++) {
    const isLastDropZone = i === componentCount;
    const shouldShowLabel = dragOverIndex === i && !!draggedItem;

    dropZones.push(
      <DropZoneComponent
        key={`dropzone-${i}`}
        index={i}
        isActive={dragOverIndex === i}
        isHovered={false}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        size={isLastDropZone ? 'medium' : 'small'}
        showLabel={shouldShowLabel}
        className={cn(
          isLastDropZone ? 'my-4' : 'my-2',
          'enhanced-drop-zone-item'
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        'w-full enhanced-drop-zones-container',
        !!draggedItem && 'drop-zones-dragging',
        className
      )}
      onDragEnter={handleGlobalDragEnter}
      onDragLeave={handleGlobalDragLeave}
    >
      {dropZones}
    </div>
  );
};

// Empty canvas drop zone for when there are no components
interface EmptyCanvasDropZoneProps {
  onDrop: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  isActive: boolean;
  isDragging: boolean;
}

const EmptyCanvasDropZone: React.FC<EmptyCanvasDropZoneProps> = ({
  onDrop,
  onDragOver,
  isActive,
  isDragging
}) => {
  const [dragCounter, setDragCounter] = useState(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev - 1);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    onDragOver(e.nativeEvent as DragEvent);
  }, [onDragOver]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(0);
    onDrop(e.nativeEvent as DragEvent);
  }, [onDrop]);

  const getDropZoneStyles = () => {
    if (isActive || dragCounter > 0) {
      return {
        background: 'bg-blue-50',
        border: 'border-blue-400',
        text: 'text-blue-600',
        icon: 'text-blue-500'
      };
    }

    if (isDragging) {
      return {
        background: 'bg-slate-50',
        border: 'border-slate-300',
        text: 'text-slate-600',
        icon: 'text-slate-400'
      };
    }

    return {
      background: 'bg-white hover:bg-slate-50',
      border: 'border-slate-300 hover:border-slate-400',
      text: 'text-slate-600 hover:text-slate-700',
      icon: 'text-slate-400 hover:text-slate-500'
    };
  };

  const styles = getDropZoneStyles();

  return (
    <div
      className={cn(
        'flex items-center justify-center text-center drop-zone-transition border-2 border-dashed rounded-lg cursor-pointer',
        'min-h-[200px] h-96', // Large target area - 200px minimum, 384px preferred
        styles.background,
        styles.border,
        isActive && 'drop-zone-glow drop-zone-pulse',
        isDragging && !isActive && 'drop-zone-shimmer',
        'focus:drop-zone-focus focus:outline-none',
        'drop-zone-mobile' // Mobile-friendly sizing
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="region"
      aria-label="Empty canvas drop zone - drag components here to start building your template"
      aria-describedby="empty-canvas-help"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          // Could trigger a component picker modal here
        }
      }}
    >
      <div className="space-y-4 drop-zone-scale-in">
        <PlusIcon
          className={cn(
            'w-16 h-16 mx-auto drop-zone-transition',
            styles.icon,
            isActive && 'drop-indicator-bounce scale-110'
          )}
        />
        <div className="space-y-2">
          <h3 className={cn('text-lg font-medium drop-zone-transition', styles.text)}>
            {isActive ? 'Drop your component here!' : 'Start Building Your Template'}
          </h3>
          <p className={cn('text-sm drop-zone-transition', styles.text, 'opacity-75')}>
            {isActive
              ? 'Release to add the component to your template'
              : 'Drag components from the palette to begin creating your template'
            }
          </p>
        </div>
      </div>
      <div id="empty-canvas-help" className="sr-only">
        This is an empty template canvas. Drag components from the left palette to add them to your template.
        You can also use keyboard navigation to access component options.
      </div>
    </div>
  );
};
