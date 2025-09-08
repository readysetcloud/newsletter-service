import React, { useState, useEffect, useCallback } from 'react';
import {
  ClockIcon,
  ArrowPathIcon,
  EyeIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { ConfirmationDialog, useConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { templateService } from '@/services/templateService';
import { cn } from '@/utils/cn';
import type {
  Template,
  TemplateVersion,
  TemplateVersionsResponse,
  TemplateVersionResponse
} from '@/types/template';

interface TemplateVersionHistoryProps {
  template: Template;
  onVersionRestore?: (template: Template) => void;
  className?: string;
}

interface VersionHistoryState {
  versions: TemplateVersion[];
  loading: boolean;
  error?: string;
  selectedVersion?: TemplateVersionResponse;
  loadingVersion?: string;
  restoring?: string;
}

export const TemplateVersionHistory: React.FC<TemplateVersionHistoryProps> = ({
  template,
  onVersionRestore,
  className
}) => {
  const [state, setState] = useState<VersionHistoryState>({
    versions: [],
    loading: true
  });

  const { showConfirmation, ConfirmationDialog } = useConfirmationDialog();

  // Load version history
  const loadVersions = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const response = await templateService.getTemplateVersions(template.id);

      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          versions: response.data!.versions,
          loading: false
        }));
      } else {
        setState(prev => ({
          ...prev,
          loading: false,
          error: response.error || 'Failed to load version history'
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load version history'
      }));
    }
  }, [template.id]);

  // Load specific version content
  const loadVersionContent = useCallback(async (versionId: string) => {
    setState(prev => ({ ...prev, loadingVersion: versionId }));

    try {
      const response = await templateService.getTemplateVersion(template.id, versionId);

      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          selectedVersion: response.data!,
          loadingVersion: undefined
        }));
      } else {
        setState(prev => ({
          ...prev,
          loadingVersion: undefined,
          error: response.error || 'Failed to load version content'
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        loadingVersion: undefined,
        error: error instanceof Error ? error.message : 'Failed to load version content'
      }));
    }
  }, [template.id]);

  // Restore version
  const handleRestoreVersion = useCallback(async (version: TemplateVersion) => {
    try {
      await showConfirmation({
        title: 'Restore Template Version',
        description: `Are you sure you want to restore "${template.name}" to this version? This will create a new version with the restored content.`,
        confirmText: 'Restore Version',
        type: 'warning',
        consequences: [
          'A new version will be created with the restored content',
          'The current version will be preserved in history',
          'This action cannot be undone'
        ],
        details: [
          { label: 'Template Name', value: template.name },
          { label: 'Version Date', value: new Date(version.lastModified).toLocaleString() },
          { label: 'Version Size', value: `${(version.size / 1024).toFixed(1)} KB` }
        ],
        onConfirm: async () => {
          setState(prev => ({ ...prev, restoring: version.versionId }));

          try {
            const response = await templateService.restoreTemplateVersion(template.id, version.versionId);

            if (response.success) {
              // Reload versions to show the new restored version
              await loadVersions();

              // Notify parent component
              if (onVersionRestore) {
                onVersionRestore({
                  ...template,
                  version: template.version + 1,
                  updatedAt: response.data!.restoredAt
                });
              }
            } else {
              throw new Error(response.error || 'Failed to restore version');
            }
          } catch (error) {
            setState(prev => ({
              ...prev,
              error: error instanceof Error ? error.message : 'Failed to restore version'
            }));
          } finally {
            setState(prev => ({ ...prev, restoring: undefined }));
          }
        }
      });
    } catch (error) {
      console.error('Error restoring version:', error);
    }
  }, [template, showConfirmation, loadVersions, onVersionRestore]);

  // Format file size
  const formatFileSize = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  // Format date
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString(),
      relative: getRelativeTime(date)
    };
  }, []);

  // Get relative time
  const getRelativeTime = useCallback((date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  }, []);

  // Initial load
  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  if (state.loading && state.versions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Version History</h2>
          <p className="text-slate-600 mt-1">
            View and restore previous versions of "{template.name}"
          </p>
        </div>
        <Button variant="outline" onClick={loadVersions} disabled={state.loading}>
          <ArrowPathIcon className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Error Display */}
      {state.error && (
        <ErrorDisplay
          title="Error Loading Version History"
          message={state.error}
          severity="error"
          retryable={true}
          onRetry={loadVersions}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Version List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <ClockIcon className="w-5 h-5 mr-2" />
              Versions ({state.versions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {state.versions.length === 0 ? (
              <div className="text-center py-8">
                <DocumentTextIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  No versions found
                </h3>
                <p className="text-slate-600">
                  Version history will appear here as you make changes to the template.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {state.versions.map((version, index) => {
                  const formatted = formatDate(version.lastModified);
                  const isSelected = state.selectedVersion?.versionId === version.versionId;
                  const isLoading = state.loadingVersion === version.versionId;
                  const isRestoring = state.restoring === version.versionId;

                  return (
                    <div
                      key={version.versionId}
                      className={cn(
                        'p-4 border rounded-lg transition-colors cursor-pointer',
                        isSelected
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      )}
                      onClick={() => !isLoading && loadVersionContent(version.versionId)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            {version.isLatest && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                <CheckCircleIcon className="w-3 h-3 mr-1" />
                                Current
                              </span>
                            )}
                            <span className="text-sm font-medium text-slate-900">
                              Version {state.versions.length - index}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-slate-600">
                            <div>{formatted.relative}</div>
                            <div className="text-xs text-slate-500">
                              {formatted.date} at {formatted.time} • {formatFileSize(version.size)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          {isLoading ? (
                            <Loading size="sm" />
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  loadVersionContent(version.versionId);
                                }}
                                className="flex items-center"
                              >
                                <EyeIcon className="w-4 h-4 mr-1" />
                                View
                              </Button>
                              {!version.isLatest && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRestoreVersion(version);
                                  }}
                                  disabled={isRestoring}
                                  className="flex items-center"
                                >
                                  {isRestoring ? (
                                    <Loading size="sm" className="mr-1" />
                                  ) : (
                                    <ArrowPathIcon className="w-4 h-4 mr-1" />
                                  )}
                                  Restore
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Version Content Preview */}
        <Card>
          <CardHeader>
            <CardTitle>Version Content</CardTitle>
          </CardHeader>
          <CardContent>
            {state.selectedVersion ? (
              <div className="space-y-4">
                {/* Version Info */}
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-slate-700">Version ID:</span>
                      <div className="text-slate-600 font-mono text-xs mt-1">
                        {state.selectedVersion.versionId}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700">Size:</span>
                      <div className="text-slate-600 mt-1">
                        {formatFileSize(state.selectedVersion.size)}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700">Last Modified:</span>
                      <div className="text-slate-600 mt-1">
                        {formatDate(state.selectedVersion.lastModified).relative}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700">ETag:</span>
                      <div className="text-slate-600 font-mono text-xs mt-1">
                        {state.selectedVersion.etag.replace(/"/g, '')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Content Preview */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Template Content
                  </label>
                  <div className="bg-slate-900 rounded-lg p-4 max-h-96 overflow-auto">
                    <pre className="text-sm text-slate-100 whitespace-pre-wrap">
                      {state.selectedVersion.content}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <DocumentTextIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  Select a version
                </h3>
                <p className="text-slate-600">
                  Click on a version from the list to view its content.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmationDialog />
    </div>
  );
};
