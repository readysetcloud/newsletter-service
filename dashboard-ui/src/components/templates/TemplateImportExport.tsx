import React, { useState, useCallback, useRef } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  DocumentArrowDownIcon,
  DocumentArrowUpIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Loading } from '@/components/ui/Loading';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { templateService } from '@/services/templateService';
import { cn } from '@/utils/cn';
import type {
  Template,
  ExportTemplatesResponse,
  ImportTemplatesResponse,
  ExportOptions,
  ImportOptions
} from '@/types/template';

interface TemplateImportExportProps {
  templates: Template[];
  onImportComplete?: (results: ImportTemplatesResponse) => void;
  className?: string;
}

interface ExportState {
  selectedTemplates: string[];
  exporting: boolean;
  exportResult?: ExportTemplatesResponse;
  error?: string;
}

interface ImportState {
  importing: boolean;
  importResult?: ImportTemplatesResponse;
  error?: string;
  dragOver: boolean;
}

export const TemplateImportExport: React.FC<TemplateImportExportProps> = ({
  templates,
  onImportComplete,
  className
}) => {
  const [exportState, setExportState] = useState<ExportState>({
    selectedTemplates: [],
    exporting: false
  });

  const [importState, setImportState] = useState<ImportState>({
    importing: false,
    dragOver: false
  });

  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    includeSnippets: true,
    format: 'zip'
  });

  const [importOptions, setImportOptions] = useState<ImportOptions>({
    format: 'json',
    conflictResolution: 'skip',
    preserveIds: false
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle template selection for export
  const handleTemplateSelection = useCallback((templateId: string, selected: boolean) => {
    setExportState(prev => ({
      ...prev,
      selectedTemplates: selected
        ? [...prev.selectedTemplates, templateId]
        : prev.selectedTemplates.filter(id => id !== templateId)
    }));
  }, []);

  // Select all templates
  const handleSelectAll = useCallback(() => {
    setExportState(prev => ({
      ...prev,
      selectedTemplates: prev.selectedTemplates.length === templates.length
        ? []
        : templates.map(t => t.id)
    }));
  }, [templates]);

  // Export templates
  const handleExport = useCallback(async () => {
    if (exportState.selectedTemplates.length === 0) {
      setExportState(prev => ({ ...prev, error: 'Please select at least one template to export' }));
      return;
    }

    setExportState(prev => ({ ...prev, exporting: true, error: undefined }));

    try {
      const response = await templateService.exportTemplatesWithRetry(
        exportState.selectedTemplates,
        exportOptions
      );

      if (response.success && response.data) {
        setExportState(prev => ({
          ...prev,
          exporting: false,
          exportResult: response.data!
        }));

        // Trigger download
        downloadExportedData(response.data);
      } else {
        setExportState(prev => ({
          ...prev,
          exporting: false,
          error: response.error || 'Failed to export templates'
        }));
      }
    } catch (error) {
      setExportState(prev => ({
        ...prev,
        exporting: false,
        error: error instanceof Error ? error.message : 'Failed to export templates'
      }));
    }
  }, [exportState.selectedTemplates, exportOptions]);

  // Download exported data
  const downloadExportedData = useCallback((exportResult: ExportTemplatesResponse) => {
    try {
      let blob: Blob;
      let mimeType: string;

      if (exportResult.format === 'zip') {
        // Convert base64 to blob
        const binaryString = atob(exportResult.data as string);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: 'application/zip' });
        mimeType = 'application/zip';
      } else {
        // JSON format
        blob = new Blob([JSON.stringify(exportResult.data, null, 2)], { type: 'application/json' });
        mimeType = 'application/json';
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportResult.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading export:', error);
      setExportState(prev => ({
        ...prev,
        error: 'Failed to download exported file'
      }));
    }
  }, []);

  // Handle file selection for import
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processImportFile(file);
    }
  }, []);

  // Handle drag and drop
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setImportState(prev => ({ ...prev, dragOver: true }));
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setImportState(prev => ({ ...prev, dragOver: false }));
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setImportState(prev => ({ ...prev, dragOver: false }));

    const file = event.dataTransfer.files[0];
    if (file) {
      processImportFile(file);
    }
  }, []);

  // Process import file
  const processImportFile = useCallback(async (file: File) => {
    setImportState(prev => ({ ...prev, importing: true, error: undefined, importResult: undefined }));

    try {
      let data: string;
      let format: 'zip' | 'json';

      if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
        // Read as base64 for ZIP files
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        data = btoa(String.fromCharCode(...bytes));
        format = 'zip';
      } else {
        // Read as text for JSON files
        data = await file.text();
        format = 'json';

        // Validate JSON
        try {
          JSON.parse(data);
        } catch {
          throw new Error('Invalid JSON file format');
        }
      }

      const response = await templateService.importTemplatesWithRetry(data, {
        ...importOptions,
        format
      });

      if (response.success && response.data) {
        setImportState(prev => ({
          ...prev,
          importing: false,
          importResult: response.data!
        }));

        // Notify parent component
        if (onImportComplete) {
          onImportComplete(response.data);
        }
      } else {
        setImportState(prev => ({
          ...prev,
          importing: false,
          error: response.error || 'Failed to import templates'
        }));
      }
    } catch (error) {
      setImportState(prev => ({
        ...prev,
        importing: false,
        error: error instanceof Error ? error.message : 'Failed to process import file'
      }));
    }
  }, [importOptions, onImportComplete]);

  // Clear import results
  const clearImportResults = useCallback(() => {
    setImportState(prev => ({
      ...prev,
      importResult: undefined,
      error: undefined
    }));
  }, []);

  // Clear export results
  const clearExportResults = useCallback(() => {
    setExportState(prev => ({
      ...prev,
      exportResult: undefined,
      error: undefined
    }));
  }, []);

  return (
    <div className={cn('space-y-6', className)}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Export Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
              Export Templates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Template Selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-slate-700">
                  Select Templates ({exportState.selectedTemplates.length} of {templates.length})
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                >
                  {exportState.selectedTemplates.length === templates.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                {templates.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">
                    No templates available to export
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {templates.map(template => (
                      <label
                        key={template.id}
                        className="flex items-center p-2 hover:bg-slate-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={exportState.selectedTemplates.includes(template.id)}
                          onChange={(e) => handleTemplateSelection(template.id, e.target.checked)}
                          className="mr-3"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {template.name}
                          </div>
                          {template.description && (
                            <div className="text-xs text-slate-500 truncate">
                              {template.description}
                            </div>
                          )}
                        </div>
                        {template.category && (
                          <span className="ml-2 px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded">
                            {template.category}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Export Options */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Export Format
                </label>
                <Select
                  value={exportOptions.format}
                  onChange={(e) => setExportOptions(prev => ({ ...prev, format: e.target.value as 'zip' | 'json' }))}
                  options={[
                    { value: 'zip', label: 'ZIP Archive (Recommended)' },
                    { value: 'json', label: 'JSON File' }
                  ]}
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="includeSnippets"
                  checked={exportOptions.includeSnippets}
                  onChange={(e) => setExportOptions(prev => ({ ...prev, includeSnippets: e.target.checked }))}
                  className="mr-2"
                />
                <label htmlFor="includeSnippets" className="text-sm text-slate-700">
                  Include used snippets
                </label>
              </div>
            </div>

            {/* Export Button */}
            <Button
              onClick={handleExport}
              disabled={exportState.exporting || exportState.selectedTemplates.length === 0}
              className="w-full flex items-center justify-center"
            >
              {exportState.exporting ? (
                <Loading size="sm" className="mr-2" />
              ) : (
                <DocumentArrowDownIcon className="w-4 h-4 mr-2" />
              )}
              {exportState.exporting ? 'Exporting...' : 'Export Templates'}
            </Button>

            {/* Export Results */}
            {exportState.exportResult && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-start">
                  <CheckCircleIcon className="w-5 h-5 text-green-600 mr-2 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-green-800">Export Successful</h4>
                    <div className="mt-2 text-sm text-green-700">
                      <div>Templates: {exportState.exportResult.templateCount}</div>
                      <div>Snippets: {exportState.exportResult.snippetCount}</div>
                      {exportState.exportResult.size && (
                        <div>Size: {(exportState.exportResult.size / 1024).toFixed(1)} KB</div>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearExportResults}
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Export Error */}
            {exportState.error && (
              <ErrorDisplay
                title="Export Failed"
                message={exportState.error}
                severity="error"
                onDismiss={clearExportResults}
              />
            )}
          </CardContent>
        </Card>

        {/* Import Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <ArrowUpTrayIcon className="w-5 h-5 mr-2" />
              Import Templates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* File Upload Area */}
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                importState.dragOver
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-300 hover:border-slate-400'
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <DocumentArrowUpIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-900">
                  Drop your export file here, or click to browse
                </p>
                <p className="text-xs text-slate-500">
                  Supports ZIP archives and JSON files
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4"
                disabled={importState.importing}
              >
                Choose File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.json"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Import Options */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Conflict Resolution
                </label>
                <Select
                  value={importOptions.conflictResolution}
                  onChange={(e) => setImportOptions(prev => ({
                    ...prev,
                    conflictResolution: e.target.value as 'skip' | 'overwrite' | 'rename'
                  }))}
                  options={[
                    { value: 'skip', label: 'Skip existing templates' },
                    { value: 'rename', label: 'Rename conflicting templates' },
                    { value: 'overwrite', label: 'Overwrite existing templates' }
                  ]}
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="preserveIds"
                  checked={importOptions.preserveIds}
                  onChange={(e) => setImportOptions(prev => ({ ...prev, preserveIds: e.target.checked }))}
                  className="mr-2"
                />
                <label htmlFor="preserveIds" className="text-sm text-slate-700">
                  Preserve original template IDs
                </label>
              </div>
            </div>

            {/* Import Status */}
            {importState.importing && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center">
                  <Loading size="sm" className="mr-2" />
                  <span className="text-sm text-blue-800">Processing import...</span>
                </div>
              </div>
            )}

            {/* Import Results */}
            {importState.importResult && (
              <div className="space-y-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <CheckCircleIcon className="w-5 h-5 text-green-600 mr-2 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-medium text-green-800">Import Completed</h4>
                      <div className="mt-2 text-sm text-green-700">
                        <div>Templates imported: {importState.importResult.summary.templatesImported}</div>
                        <div>Snippets imported: {importState.importResult.summary.snippetsImported}</div>
                        {importState.importResult.summary.templatesSkipped > 0 && (
                          <div>Templates skipped: {importState.importResult.summary.templatesSkipped}</div>
                        )}
                        {importState.importResult.summary.errors > 0 && (
                          <div className="text-amber-700">Errors: {importState.importResult.summary.errors}</div>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearImportResults}
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Show errors if any */}
                {importState.importResult.results.errors.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 mr-2 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-amber-800">Import Errors</h4>
                        <div className="mt-2 space-y-1">
                          {importState.importResult.results.errors.map((error, index) => (
                            <div key={index} className="text-sm text-amber-700">
                              {error.name}: {error.error}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Import Error */}
            {importState.error && (
              <ErrorDisplay
                title="Import Failed"
                message={importState.error}
                severity="error"
                onDismiss={clearImportResults}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Info Section */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start">
            <InformationCircleIcon className="w-5 h-5 text-blue-600 mr-2 mt-0.5" />
            <div className="text-sm text-slate-600">
              <p className="font-medium text-slate-900 mb-2">Import/Export Guidelines</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>ZIP format is recommended for better compression and organization</li>
                <li>Exported files include template metadata, content, and optionally used snippets</li>
                <li>When importing, choose how to handle naming conflicts</li>
                <li>Preserve IDs option maintains original template identifiers (use with caution)</li>
                <li>Maximum 50 templates can be exported at once, 100 templates can be imported</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
