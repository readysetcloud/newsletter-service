import React from 'react';
import { Loading, LoadingSkeleton } from './Loading';
import { cn } from '@/utils/cn';
import {
  DocumentTextIcon,
  CodeBracketIcon,
  EyeIcon,
  CloudArrowUpIcon,
  CloudArrowDownIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

/**
 * Loading state for template operations
 */
interface TemplateLoadingProps {
  operation: 'loading' | 'saving' | 'deleting' | 'previewing' | 'exporting' | 'importing';
  templateName?: string;
  progress?: number;
  className?: string;
}

export const TemplateLoading: React.FC<TemplateLoadingProps> = ({
  operation,
  templateName,
  progress,
  className
}) => {
  const getOperationConfig = () => {
    switch (operation) {
      case 'loading':
        return {
          icon: <DocumentTextIcon className="w-5 h-5" />,
          text: templateName ? `Loading ${templateName}...` : 'Loading template...',
          color: 'text-blue-600'
        };
      case 'saving':
        return {
          icon: <CloudArrowUpIcon className="w-5 h-5" />,
          text: templateName ? `Saving ${templateName}...` : 'Saving template...',
          color: 'text-green-600'
        };
      case 'deleting':
        return {
          icon: <ArrowPathIcon className="w-5 h-5" />,
          text: templateName ? `Deleting ${templateName}...` : 'Deleting template...',
          color: 'text-red-600'
        };
      case 'previewing':
        return {
          icon: <EyeIcon className="w-5 h-5" />,
          text: 'Generating preview...',
          color: 'text-purple-600'
        };
      case 'exporting':
        return {
          icon: <CloudArrowDownIcon className="w-5 h-5" />,
          text: 'Exporting templates...',
          color: 'text-indigo-600'
        };
      case 'importing':
        return {
          icon: <CloudArrowUpIcon className="w-5 h-5" />,
          text: 'Importing templates...',
          color: 'text-orange-600'
        };
      default:
        return {
          icon: <Loading size="sm" />,
          text: 'Processing...',
          color: 'text-gray-600'
        };
    }
  };

  const config = getOperationConfig();

  return (
    <div className={cn('flex items-center space-x-3 p-4', className)}>
      <div className={cn('animate-spin', config.color)}>
        {config.icon}
      </div>
      <div className="flex-1">
        <p className={cn('text-sm font-medium', config.color)}>
          {config.text}
        </p>
        {progress !== undefined && (
          <div className="mt-2">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={cn('h-2 rounded-full transition-all duration-300', {
                  'bg-blue-600': operation === 'loading',
                  'bg-green-600': operation === 'saving',
                  'bg-red-600': operation === 'deleting',
                  'bg-purple-600': operation === 'previewing',
                  'bg-indigo-600': operation === 'exporting',
                  'bg-orange-600': operation === 'importing'
                })}
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {Math.round(progress)}% complete
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Loading state for snippet operations
 */
interface SnippetLoadingProps {
  operation: 'loading' | 'saving' | 'deleting' | 'previewing';
  snippetName?: string;
  className?: string;
}

export const SnippetLoading: React.FC<SnippetLoadingProps> = ({
  operation,
  snippetName,
  className
}) => {
  const getOperationConfig = () => {
    switch (operation) {
      case 'loading':
        return {
          icon: <CodeBracketIcon className="w-5 h-5" />,
          text: snippetName ? `Loading ${snippetName}...` : 'Loading snippet...',
          color: 'text-blue-600'
        };
      case 'saving':
        return {
          icon: <CloudArrowUpIcon className="w-5 h-5" />,
          text: snippetName ? `Saving ${snippetName}...` : 'Saving snippet...',
          color: 'text-green-600'
        };
      case 'deleting':
        return {
          icon: <ArrowPathIcon className="w-5 h-5" />,
          text: snippetName ? `Deleting ${snippetName}...` : 'Deleting snippet...',
          color: 'text-red-600'
        };
      case 'previewing':
        return {
          icon: <EyeIcon className="w-5 h-5" />,
          text: 'Generating preview...',
          color: 'text-purple-600'
        };
      default:
        return {
          icon: <Loading size="sm" />,
          text: 'Processing...',
          color: 'text-gray-600'
        };
    }
  };

  const config = getOperationConfig();

  return (
    <div className={cn('flex items-center space-x-3 p-4', className)}>
      <div className={cn('animate-spin', config.color)}>
        {config.icon}
      </div>
      <p className={cn('text-sm font-medium', config.color)}>
        {config.text}
      </p>
    </div>
  );
};

/**
 * Loading skeleton for template list
 */
export const TemplateListSkeleton: React.FC<{
  count?: number;
  className?: string;
}> = ({ count = 5, className }) => {
  return (
    <div className={cn('space-y-4', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="border border-gray-200 rounded-lg p-6 animate-pulse">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-200 rounded w-2/3 mb-3" />
              <div className="flex space-x-2">
                <div className="h-6 bg-gray-200 rounded-full w-16" />
                <div className="h-6 bg-gray-200 rounded-full w-20" />
              </div>
            </div>
            <div className="flex space-x-2">
              <div className="h-8 bg-gray-200 rounded w-16" />
              <div className="h-8 bg-gray-200 rounded w-16" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <div className="h-4 bg-gray-200 rounded w-24" />
            <div className="h-4 bg-gray-200 rounded w-32" />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Loading skeleton for snippet list
 */
export const SnippetListSkeleton: React.FC<{
  count?: number;
  className?: string;
}> = ({ count = 5, className }) => {
  return (
    <div className={cn('space-y-4', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="border border-gray-200 rounded-lg p-4 animate-pulse">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3 flex-1">
              <div className="h-10 w-10 bg-gray-200 rounded" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-1/4 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
            </div>
            <div className="flex space-x-2">
              <div className="h-8 bg-gray-200 rounded w-16" />
              <div className="h-8 bg-gray-200 rounded w-16" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <div className="h-3 bg-gray-200 rounded w-20" />
            <div className="h-3 bg-gray-200 rounded w-28" />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Loading skeleton for template builder
 */
export const TemplateBuilderSkeleton: React.FC<{
  className?: string;
}> = ({ className }) => {
  return (
    <div className={cn('space-y-6 animate-pulse', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="h-8 bg-gray-200 rounded w-16" />
          <div>
            <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
            <div className="h-4 bg-gray-200 rounded w-32" />
          </div>
        </div>
        <div className="flex space-x-3">
          <div className="h-10 bg-gray-200 rounded w-24" />
          <div className="h-10 bg-gray-200 rounded w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="border border-gray-200 rounded-lg p-6">
            <div className="h-6 bg-gray-200 rounded w-32 mb-4" />
            <div className="space-y-4">
              <div>
                <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
                <div className="h-10 bg-gray-200 rounded w-full" />
              </div>
              <div>
                <div className="h-4 bg-gray-200 rounded w-20 mb-2" />
                <div className="h-20 bg-gray-200 rounded w-full" />
              </div>
              <div>
                <div className="h-4 bg-gray-200 rounded w-16 mb-2" />
                <div className="h-10 bg-gray-200 rounded w-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Editor Panel */}
        <div className="lg:col-span-2">
          <div className="border border-gray-200 rounded-lg">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="h-6 bg-gray-200 rounded w-32" />
                <div className="flex bg-gray-100 rounded-lg p-1">
                  <div className="h-8 bg-gray-200 rounded w-24 mr-1" />
                  <div className="h-8 bg-gray-200 rounded w-24" />
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="h-96 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Loading overlay for forms
 */
export const FormLoadingOverlay: React.FC<{
  isLoading: boolean;
  message?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ isLoading, message = 'Processing...', children, className }) => {
  return (
    <div className={cn('relative', className)}>
      {children}
      {isLoading && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
          <div className="flex flex-col items-center space-y-3">
            <Loading size="lg" />
            <p className="text-sm text-gray-600 font-medium">{message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Loading state for validation
 */
export const ValidationLoading: React.FC<{
  className?: string;
}> = ({ className }) => {
  return (
    <div className={cn('flex items-center space-x-2 text-blue-600', className)}>
      <Loading size="sm" />
      <span className="text-sm">Validating...</span>
    </div>
  );
};

/**
 * Loading state for preview generation
 */
export const PreviewLoading: React.FC<{
  className?: string;
}> = ({ className }) => {
  return (
    <div className={cn('flex flex-col items-center justify-center p-8 space-y-4', className)}>
      <div className="relative">
        <EyeIcon className="w-12 h-12 text-purple-300" />
        <div className="absolute inset-0 animate-pulse">
          <EyeIcon className="w-12 h-12 text-purple-600" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-lg font-medium text-purple-600 mb-1">
          Generating Preview
        </p>
        <p className="text-sm text-gray-500">
          Rendering your template with test data...
        </p>
      </div>
    </div>
  );
};

/**
 * Loading state for auto-save
 */
export const AutoSaveIndicator: React.FC<{
  isSaving: boolean;
  lastSaved?: Date;
  className?: string;
}> = ({ isSaving, lastSaved, className }) => {
  if (isSaving) {
    return (
      <div className={cn('flex items-center space-x-2 text-blue-600', className)}>
        <Loading size="sm" />
        <span className="text-sm">Saving...</span>
      </div>
    );
  }

  if (lastSaved) {
    return (
      <div className={cn('flex items-center space-x-2 text-green-600', className)}>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        <span className="text-sm">
          Saved {lastSaved.toLocaleTimeString()}
        </span>
      </div>
    );
  }

  return null;
};

// Additional missing components that are referenced in other files
export const LoadingOverlay = FormLoadingOverlay;
export const InlineLoading = Loading;
export const LoadingSpinner = Loading;
export const SkeletonLoader = LoadingSkeleton;
export const VerificationProgress: React.FC<{ progress: number; className?: string }> = ({ progress, className }) => (
  <div className={cn('w-full bg-gray-200 rounded-full h-2', className)}>
    <div
      className="h-2 bg-blue-600 rounded-full transition-all duration-300"
      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
    />
  </div>
);
export const ProgressIndicator = VerificationProgress;
export const EmptyState: React.FC<{ title: string; description?: string; className?: string }> = ({ title, description, className }) => (
  <div className={cn('text-center py-8', className)}>
    <h3 className="text-lg font-medium text-slate-900 mb-2">{title}</h3>
    {description && <p className="text-slate-600">{description}</p>}
  </div>
);
