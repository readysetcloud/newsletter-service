import React from 'react';
import { Variable, SampleDataSet } from '../../types/variable';
import { getSampleValueForPath, formatSampleValue, generateVariablePreview } from '../../data/sampleData';
import { cn } from '../../utils/cn';

interface VariablePreviewProps {
  variable: Variable;
  sampleData?: SampleDataSet;
  contextType?: string;
  className?: string;
  showPath?: boolean;
  maxLength?: number;
}

export const VariablePreview: React.FC<VariablePreviewProps> = ({
  variable,
  sampleData,
  contextType,
  className,
  showPath = true,
  maxLength = 50
}) => {
  const sampleValue = sampleData
    ? getSampleValueForPath(variable.path, sampleData)
    : variable.sampleValue;

  const previewText = sampleData
    ? generateVariablePreview(variable.path, contextType, sampleData)
    : formatSampleValue(variable.sampleValue, maxLength);

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'string': return 'text-blue-600';
      case 'number': return 'text-green-600';
      case 'boolean': return 'text-purple-600';
      case 'url': return 'text-indigo-600';
      case 'date': return 'text-orange-600';
      case 'array': return 'text-red-600';
      case 'object': return 'text-gray-600';
      default: return 'text-gray-500';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'string': return '"abc"';
      case 'number': return '123';
      case 'boolean': return 'T/F';
      case 'url': return '🔗';
      case 'date': return '📅';
      case 'array': return '[]';
      case 'object': return '{}';
      default: return '?';
    }
  };

  return (
    <div className={cn(
      'bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2',
      className
    )}>
      {/* Variable Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-900">
            {variable.name}
          </span>
          <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
            'bg-gray-100 text-gray-700'
          )}>
            <span className={cn('mr-1', getTypeColor(variable.type))}>
              {getTypeIcon(variable.type)}
            </span>
            {variable.type}
          </span>
        </div>
        {variable.isCustom && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Custom
          </span>
        )}
      </div>

      {/* Variable Path */}
      {showPath && (
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-500">Path:</span>
          <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700">
            {`{{${variable.path}}}`}
          </code>
        </div>
      )}

      {/* Sample Value Preview */}
      <div className="space-y-1">
        <span className="text-xs text-gray-500">Preview:</span>
        <div className="bg-white border border-gray-200 rounded p-2">
          {sampleValue !== undefined ? (
            <span className="text-sm text-gray-900 font-medium">
              {previewText}
            </span>
          ) : (
            <span className="text-sm text-gray-400 italic">
              No sample data available
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {variable.description && (
        <div className="space-y-1">
          <span className="text-xs text-gray-500">Description:</span>
          <p className="text-xs text-gray-600">
            {variable.description}
          </p>
        </div>
      )}

      {/* Block Helper Info */}
      {variable.isBlockHelper && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
          <div className="flex items-center space-x-1">
            <span className="text-xs font-medium text-yellow-800">Block Helper</span>
            {variable.requiresClosing && (
              <span className="text-xs text-yellow-600">
                (requires closing tag)
              </span>
            )}
          </div>
          {variable.blockType && (
            <span className="text-xs text-yellow-600 capitalize">
              Type: {variable.blockType}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default VariablePreview;
