import React, { useState, useRef, useEffect } from 'react';
import { Variable, SampleDataSet } from '../../types/variable';
import { getSampleValueForPath, formatSampleValue } from '../../data/sampleData';
import { cn } from '../../utils/cn';

interface VariableTooltipProps {
  variable: Variable;
  sampleData?: SampleDataSet;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  delay?: number;
  className?: string;
}

export const VariableTooltip: React.FC<VariableTooltipProps> = ({
  variable,
  sampleData,
  children,
  position = 'auto',
  delay = 500,
  className
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState(position);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const sampleValue = sampleData
    ? getSampleValueForPath(variable.path, sampleData)
    : variable.sampleValue;

  const formattedValue = formatSampleValue(sampleValue, 100);

  const showTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      if (position === 'auto') {
        calculateOptimalPosition();
      }
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  const calculateOptimalPosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let optimalPosition = 'top';

    // Check if there's space above
    if (triggerRect.top - tooltipRect.height - 10 < 0) {
      optimalPosition = 'bottom';
    }

    // Check if there's space below
    if (triggerRect.bottom + tooltipRect.height + 10 > viewportHeight) {
      optimalPosition = 'top';
    }

    // Check if there's space on the right
    if (triggerRect.right + tooltipRect.width + 10 > viewportWidth) {
      optimalPosition = 'left';
    }

    // Check if there's space on the left
    if (triggerRect.left - tooltipRect.width - 10 < 0) {
      optimalPosition = 'right';
    }

    setTooltipPosition(optimalPosition as any);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getTooltipClasses = () => {
    const baseClasses = 'absolute z-50 bg-gray-900 text-white text-sm rounded-lg shadow-lg p-3 max-w-xs';

    switch (tooltipPosition) {
      case 'top':
        return cn(baseClasses, 'bottom-full left-1/2 transform -translate-x-1/2 mb-2');
      case 'bottom':
        return cn(baseClasses, 'top-full left-1/2 transform -translate-x-1/2 mt-2');
      case 'left':
        return cn(baseClasses, 'right-full top-1/2 transform -translate-y-1/2 mr-2');
      case 'right':
        return cn(baseClasses, 'left-full top-1/2 transform -translate-y-1/2 ml-2');
      default:
        return cn(baseClasses, 'bottom-full left-1/2 transform -translate-x-1/2 mb-2');
    }
  };

  const getArrowClasses = () => {
    const baseArrowClasses = 'absolute w-2 h-2 bg-gray-900 transform rotate-45';

    switch (tooltipPosition) {
      case 'top':
        return cn(baseArrowClasses, 'top-full left-1/2 transform -translate-x-1/2 -mt-1');
      case 'bottom':
        return cn(baseArrowClasses, 'bottom-full left-1/2 transform -translate-x-1/2 -mb-1');
      case 'left':
        return cn(baseArrowClasses, 'left-full top-1/2 transform -translate-y-1/2 -ml-1');
      case 'right':
        return cn(baseArrowClasses, 'right-full top-1/2 transform -translate-y-1/2 -mr-1');
      default:
        return cn(baseArrowClasses, 'top-full left-1/2 transform -translate-x-1/2 -mt-1');
    }
  };

  return (
    <div
      ref={triggerRef}
      className={cn('relative inline-block', className)}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}

      {isVisible && (
        <div
          ref={tooltipRef}
          className={getTooltipClasses()}
          role="tooltip"
          aria-label={`Variable: ${variable.name}`}
        >
          {/* Arrow */}
          <div className={getArrowClasses()} />

          {/* Tooltip Content */}
          <div className="space-y-2">
            {/* Variable Name and Type */}
            <div className="flex items-center justify-between">
              <span className="font-medium text-white">
                {variable.name}
              </span>
              <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-300">
                {variable.type}
              </span>
            </div>

            {/* Variable Path */}
            <div className="space-y-1">
              <div className="text-xs text-gray-300">Path:</div>
              <code className="text-xs font-mono bg-gray-800 px-2 py-1 rounded text-gray-200 block">
                {`{{${variable.path}}}`}
              </code>
            </div>

            {/* Sample Value */}
            <div className="space-y-1">
              <div className="text-xs text-gray-300">Sample Value:</div>
              <div className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-200">
                {sampleValue !== undefined ? (
                  <span className="font-medium">{formattedValue}</span>
                ) : (
                  <span className="italic text-gray-400">No sample data</span>
                )}
              </div>
            </div>

            {/* Description */}
            {variable.description && (
              <div className="space-y-1">
                <div className="text-xs text-gray-300">Description:</div>
                <div className="text-xs text-gray-200">
                  {variable.description}
                </div>
              </div>
            )}

            {/* Block Helper Info */}
            {variable.isBlockHelper && (
              <div className="bg-yellow-900 bg-opacity-50 border border-yellow-700 rounded p-2">
                <div className="text-xs text-yellow-200 font-medium">
                  Block Helper
                  {variable.requiresClosing && (
                    <span className="text-yellow-300 ml-1">(requires closing)</span>
                  )}
                </div>
                {variable.blockType && (
                  <div className="text-xs text-yellow-300 capitalize">
                    Type: {variable.blockType}
                  </div>
                )}
              </div>
            )}

            {/* Custom Variable Badge */}
            {variable.isCustom && (
              <div className="flex justify-end">
                <span className="text-xs bg-blue-700 px-2 py-1 rounded text-blue-200">
                  Custom Variable
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VariableTooltip;
