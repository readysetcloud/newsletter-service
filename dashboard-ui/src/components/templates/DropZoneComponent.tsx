import React, { useState, useCallback } from 'react';
import { cn } from '@/utils/cn';
import { DropZoneIndicator } from './DropZoneIndicator';

export interface DropZoneProps {
  index: number;
  isActive: boolean;
  isHovered: boolean;
  onDrop: (e: DragEvent, index: number) => void;
  onDragOver: (e: DragEvent, index: number) => void;
  size: 'small' | 'medium' | 'large';
  showLabel?: boolean;
  className?: string;
}

export interface DropZoneState {
  isDragOver: boolean;
  dragOverIndex: number | null;
  showDropIndicator: boolean;
}

export const DropZoneComponent: React.FC<DropZoneProps> = ({
  index,
  isActive,
  isHovered,
  onDrop,
  onDragOver,
  size = 'medium',
  showLabel = true,
  className
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => {
      const newCount = prev - 1;
      if (newCount === 0) {
        setIsDragOver(false);
      }
      return newCount;
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    onDragOver(e.nativeEvent as DragEvent, index);
  }, [onDragOver, index]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragCounter(0);
    onDrop(e.nativeEvent as DragEvent, index);
  }, [onDrop, index]);

  // Size configurations
  const sizeConfig = {
    small: {
      height: 'h-12', // 48px minimum
      padding: 'p-2',
      text: 'text-xs',
      spacing: 'space-y-1'
    },
    medium: {
      height: 'h-16', // 64px
      padding: 'p-4',
      text: 'text-sm',
      spacing: 'space-y-2'
    },
    large: {
      height: 'h-24', // 96px for empty canvas
      padding: 'p-6',
      text: 'text-base',
      spacing: 'space-y-3'
    }
  };

  const config = sizeConfig[size];

  // Determine visual state
  const getDropZoneStyles = () => {
    if (isDragOver || isActive) {
      return {
        background: 'bg-blue-50',
        border: 'border-blue-400 border-2 border-dashed',
        text: 'text-blue-600'
      };
    }

    if (isHovered) {
      return {
        background: 'bg-slate-50',
        border: 'border-slate-300 border-2 border-dashed',
        text: 'text-slate-600'
      };
    }

    return {
      background: 'bg-transparent hover:bg-slate-50',
      border: 'border-transparent hover:border-slate-300 hover:border-2 hover:border-dashed',
      text: 'text-slate-400 hover:text-slate-600'
    };
  };

  const styles = getDropZoneStyles();

  return (
    <div
      className={cn(
        'drop-zone-transition rounded-lg flex items-center justify-center',
        config.height,
        config.padding,
        styles.background,
        styles.border,
        'group cursor-pointer',
        isDragOver && 'drop-zone-glow drop-zone-pulse',
        isHovered && 'drop-zone-hover',
        'focus:drop-zone-focus focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
        'drop-zone-height-transition',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="button"
      aria-label={`Drop zone ${index + 1}. ${showLabel ? 'Drop component here or press Enter to add component' : 'Press Enter to add component'}`}
      aria-describedby={showLabel ? `dropzone-help-${index}` : undefined}
      aria-dropeffect="copy"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          // Announce activation for screen readers
          const event = new CustomEvent('dropzone-activate', {
            detail: { index, showLabel }
          });
          e.currentTarget.dispatchEvent(event);
        }
      }}
    >
      <DropZoneIndicator
        isActive={isDragOver || isActive}
        position="center"
        label={showLabel ? "Drop component here" : ""}
        size={size === 'large' ? 'expanded' : 'compact'}
        className={cn(config.text, styles.text)}
      />
      {showLabel && (
        <div id={`dropzone-help-${index}`} className="sr-only">
          Drag and drop a component from the palette to add it to your template at this position
        </div>
      )}
    </div>
  );
};
