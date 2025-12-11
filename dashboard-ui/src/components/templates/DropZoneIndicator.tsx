import React from 'react';
import { PlusIcon, ArrowDownIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

export interface DropZoneIndicatorProps {
  isActive: boolean;
  position: 'top' | 'bottom' | 'center';
  label: string;
  size: 'compact' | 'expanded';
  className?: string;
}

export const DropZoneIndicator: React.FC<DropZoneIndicatorProps> = ({
  isActive,
  position,
  label,
  size,
  className
}) => {
  const renderIcon = () => {
    if (position === 'center') {
      return <PlusIcon className={cn('w-5 h-5', size === 'expanded' && 'w-8 h-8')} />;
    }
    return <ArrowDownIcon className="w-4 h-4" />;
  };

  const getAnimationClass = () => {
    if (!isActive) return '';

    switch (position) {
      case 'center':
        return 'drop-zone-pulse';
      case 'top':
      case 'bottom':
        return 'drop-indicator-bounce';
      default:
        return '';
    }
  };

  const getLayoutClass = () => {
    if (position === 'center') {
      return size === 'expanded'
        ? 'flex-col space-y-3'
        : 'flex-col space-y-2';
    }
    return 'flex-row space-x-2';
  };

  return (
    <div
      className={cn(
        'flex items-center justify-center transition-all duration-200',
        getLayoutClass(),
        getAnimationClass(),
        className
      )}
    >
      {renderIcon()}
      {label && (
        <span
          className={cn(
            'font-medium select-none',
            size === 'expanded' ? 'text-sm' : 'text-xs',
            position === 'center' && size === 'expanded' && 'text-base'
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
};
