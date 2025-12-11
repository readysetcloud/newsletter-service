import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  EyeIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  PlusIcon,
  TrashIcon,
  ArrowLeftIcon,
  CloudArrowUpIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Select } from '@/components/ui/Select';
import { Loading } from '@/components/ui/Loading';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { SimpleCodeEditor } from './SimpleCodeEditor';
import { SnippetHelpContent, SnippetQuickTips } from './SnippetHelpContent';
import { templateService } from '@/services/templateService';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/utils/cn';
import type {
  Snippet,
  Template,
  SnippetParameter,
  CreateSnippetRequest,
  UpdateSnippetRequest,
  PreviewSnippetRequest,
  PreviewResponse
} from '@/types/template';

interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface SnippetBuilderProps {
  snippet?: Snippet;
  onSave?: (snippet: Snippet) => void;
  onCancel?: () => void;
  onPreview?: (snippet: Snippet) => void;
  className?: string;
}

interface SnippetFormData {
  name: string;
  description: string;
  content: string;
  parameters: SnippetParameter[];
}

interface ParameterFormData extends SnippetParameter {
  id: string; // Temporary ID for form management
}

export const SnippetBuilder: React.FC<SnippetBuilderProps> = ({
  snippet,
  onSave,
  onCancel,
  onPreview,
  className
}) => {
  const [formData, setFormData] = useState<SnippetFormData>({
    name: '',
    description: '',
    content: '',
    parameters: []
  });

  const [parameterFormData, setParameterFormData] = useState<ParameterFormData[]>([]);
  const [dependentTemplates, setDependentTemplates] = useState<Template[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [testParameters, setTestParameters] = useState<Record<string, any>>({});

  const debouncedContent = useDebounce(formData.content, 500);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout>();

  // Initialize form data
  useEffect(() => {
    if (snippet) {
      setFormData({
        name: snippet.name,
        description: snippet.description || '',
        content: snippet.content || '',
        parameters: snippet.parameters || []
      });

      // Convert parameters to form data with temporary IDs
      const paramFormData = (snippet.parameters || []).map((param, index) => ({
        ...param,
        id: `param-${index}`
      }));
      setParameterFormData(paramFormData);

      // Initialize test parameters with default values
      const testParams: Record<string, any> = {};
      (snippet.parameters || []).forEach(param => {
        testParams[param.name] = param.defaultValue || getDefaultValueForType(param.type);
      });
      setTestParameters(testParams);

      setLastSaved(new Date(snippet.updatedAt));
    }
  }, [snippet]);

  // Load dependent templates
  useEffect(() => {
    const loadDependentTemplates = async () => {
      if (snippet) {
        setLoading(true);
        try {
          const templates = await templateService.getSnippetUsage(snippet.id);
          setDependentTemplates(templates);
        } catch (error) {
          console.error('Error loading dependent templates:', error);
        } finally {
          setLoading(false);
        }
      }
    };

    loadDependentTemplates();
  }, [snippet]);

  // Track unsaved changes
  useEffect(() => {
    if (snippet) {
      const hasChanges = (
        formData.name !== snippet.name ||
        formData.description !== (snippet.description || '') ||
        formData.content !== (snippet.content || '') ||
        JSON.stringify(formData.parameters) !== JSON.stringify(snippet.parameters || [])
      );
      setHasUnsavedChanges(hasChanges);
    } else {
      const hasContent = formData.name || formData.description || formData.content || formData.parameters.length > 0;
      setHasUnsavedChanges(!!hasContent);
    }
  }, [formData, snippet]);

  // Auto-save functionality
  useEffect(() => {
    if (hasUnsavedChanges && snippet && debouncedContent) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      autoSaveTimeoutRef.current = setTimeout(() => {
        handleAutoSave();
      }, 2000);
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [debouncedContent, hasUnsavedChanges, snippet]);

  // Get default value for parameter type
  const getDefaultValueForType = useCallback((type: string): any => {
    switch (type) {
      case 'string':
        return '';
      case 'number':
        return 0;
      case 'boolean':
        return false;
      default:
        return '';
    }
  }, []);

  // Handle auto-save
  const handleAutoSave = useCallback(async () => {
    if (!snippet || !hasUnsavedChanges) return;

    try {
      const updateData: UpdateSnippetRequest = {
        name: formData.name,
        description: formData.description,
        content: formData.content,
        parameters: formData.parameters
      };

      await templateService.updateSnippetWithRetry(snippet.id, updateData);
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }, [snippet, formData, hasUnsavedChanges]);

  // Handle form field changes
  const handleFieldChange = useCallback((field: keyof SnippetFormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);

  // Handle validation changes
  const handleValidationChange = useCallback((errors: ValidationError[]) => {
    setValidationErrors(errors);
  }, []);

  // Parameter management
  const addParameter = useCallback(() => {
    const newParam: ParameterFormData = {
      id: `param-${Date.now()}`,
      name: '',
      type: 'string',
      required: false,
      defaultValue: '',
      description: ''
    };
    setParameterFormData(prev => [...prev, newParam]);
  }, []);

  const updateParameter = useCallback((id: string, field: keyof ParameterFormData, value: any) => {
    setParameterFormData(prev => prev.map(param =>
      param.id === id ? { ...param, [field]: value } : param
    ));

    // Update form data parameters
    const updatedParams = parameterFormData.map(param => {
      if (param.id === id) {
        const updated = { ...param, [field]: value };
        // Remove temporary ID when converting to SnippetParameter
        const { id: _, ...paramWithoutId } = updated;
        return paramWithoutId;
      }
      const { id: _, ...paramWithoutId } = param;
      return paramWithoutId;
    });
    handleFieldChange('parameters', updatedParams);
  }, [parameterFormData, handleFieldChange]);

  const removeParameter = useCallback((id: string) => {
    setParameterFormData(prev => prev.filter(param => param.id !== id));

    // Update form data parameters
    const updatedParams = parameterFormData
      .filter(param => param.id !== id)
      .map(param => {
        const { id: _, ...paramWithoutId } = param;
        return paramWithoutId;
      });
    handleFieldChange('parameters', updatedParams);
  }, [parameterFormData, handleFieldChange]);

  // Test parameter management
  const updateTestParameter = useCallback((paramName: string, value: any) => {
    setTestParameters(prev => ({
      ...prev,
      [paramName]: value
    }));
  }, []);

  // Handle preview
  const handlePreview = useCallback(async () => {
    if (!formData.content) {
      setError('Snippet content is required for preview');
      return;
    }

    setPreviewing(true);
    setError(null);

    try {
      // Create a temporary snippet for preview
      const previewSnippet: Snippet = {
        ...(snippet || {} as Snippet),
        name: formData.name,
        description: formData.description,
        content: formData.content,
        parameters: formData.parameters
      };

      if (snippet) {
        // Use existing snippet ID for preview
        const previewRequest: PreviewSnippetRequest = {
          parameters: testParameters
        };

        const response = await templateService.previewSnippet(snippet.id, previewRequest);
        if (response.success) {
          setPreviewData(response);
        } else {
          setError(response.message || 'Failed to preview snippet');
        }
      } else {
        // For new snippets, we'll need to create a temporary preview
        // This would require a special preview endpoint or client-side rendering
        setError('Preview is only available for saved snippets');
      }

      if (onPreview) {
        onPreview(previewSnippet);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to preview snippet');
    } finally {
      setPreviewing(false);
    }
  }, [formData, testParameters, snippet, onPreview]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (validationErrors.some(e => e.severity === 'error')) {
      setError('Please fix validation errors before saving');
      return;
    }

    if (!formData.name.trim()) {
      setError('Snippet name is required');
      return;
    }

    if (!formData.content.trim()) {
      setError('Snippet content is required');
      return;
    }

    // Validate parameters
    for (const param of parameterFormData) {
      if (!param.name.trim()) {
        setError('All parameters must have a name');
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      if (snippet) {
        // Update existing snippet
        const updateData: UpdateSnippetRequest = {
          name: formData.name,
          description: formData.description,
          content: formData.content,
          parameters: formData.parameters
        };

        const response = await templateService.updateSnippetWithRetry(snippet.id, updateData);
        if (response.success && response.data) {
          setLastSaved(new Date());
          setHasUnsavedChanges(false);
          onSave?.(response.data);
        } else {
          setError(response.error || 'Failed to update snippet');
        }
      } else {
        // Create new snippet
        const createData: CreateSnippetRequest = {
          name: formData.name,
          description: formData.description,
          content: formData.content,
          parameters: formData.parameters
        };

        const response = await templateService.createSnippetWithRetry(createData);
        if (response.success && response.data) {
          setLastSaved(new Date());
          setHasUnsavedChanges(false);
          onSave?.(response.data);
        } else {
          setError(response.error || 'Failed to create snippet');
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save snippet');
    } finally {
      setSaving(false);
    }
  }, [snippet, formData, parameterFormData, validationErrors, onSave]);

  // Validation summary
  const getValidationSummary = useCallback(() => {
    const errors = validationErrors.filter(e => e.severity === 'error').length;
    const warnings = validationErrors.filter(e => e.severity === 'warning').length;
    return { errors, warnings, hasErrors: errors > 0 };
  }, [validationErrors]);

  const { errors, warnings, hasErrors } = getValidationSummary();

  if (loading && !snippet) {
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
        <div className="flex items-center space-x-4">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} className="flex items-center">
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {snippet ? 'Edit Snippet' : 'Create Snippet'}
            </h1>
            <div className="flex items-center space-x-4 text-sm text-slate-600 mt-1">
              {lastSaved && (
                <div className="flex items-center">
                  <ClockIcon className="w-4 h-4 mr-1" />
                  Last saved: {lastSaved.toLocaleTimeString()}
                </div>
              )}
              {hasUnsavedChanges && (
                <span className="text-amber-600">Unsaved changes</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Validation Status */}
          {validationErrors.length > 0 && (
            <div className="flex items-center space-x-2 text-sm">
              {hasErrors ? (
                <div className="flex items-center text-red-600">
                  <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                  {errors} error{errors !== 1 ? 's' : ''}
                </div>
              ) : (
                <div className="flex items-center text-green-600">
                  <CheckCircleIcon className="w-4 h-4 mr-1" />
                  No errors
                </div>
              )}
              {warnings > 0 && (
                <div className="flex items-center text-amber-600">
                  <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                  {warnings} warning{warnings !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <SnippetQuickTips.PreviewButton>
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={previewing || !formData.content}
              className="flex items-center"
            >
              {previewing ? (
                <Loading size="sm" className="mr-2" />
              ) : (
                <EyeIcon className="w-4 h-4 mr-2" />
              )}
              {previewing ? 'Previewing...' : 'Preview'}
            </Button>
          </SnippetQuickTips.PreviewButton>

          <SnippetQuickTips.SaveButton>
            <Button
              onClick={handleSave}
              disabled={saving || hasErrors || !formData.name || !formData.content}
              className="flex items-center"
            >
              {saving ? (
                <Loading size="sm" className="mr-2" />
              ) : (
                <CloudArrowUpIcon className="w-4 h-4 mr-2" />
              )}
              {saving ? 'Saving...' : snippet ? 'Update Snippet' : 'Create Snippet'}
            </Button>
          </SnippetQuickTips.SaveButton>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <ErrorDisplay
          title="Save Error"
          message={error}
          severity="error"
          onDismiss={() => setError(null)}
        />
      )}

      {/* Help Content */}
      <div className="mb-6">
        <SnippetHelpContent
          context="builder"
          isFirstTime={!snippet}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Snippet Settings */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <DocumentTextIcon className="w-5 h-5 mr-2" />
                Snippet Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Snippet Name *
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleFieldChange('name', e.target.value)}
                  placeholder="Enter snippet name..."
                  maxLength={100}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Description
                </label>
                <TextArea
                  value={formData.description}
                  onChange={(e) => handleFieldChange('description', e.target.value)}
                  placeholder="Describe your snippet..."
                  rows={3}
                  maxLength={500}
                />
              </div>
            </CardContent>
          </Card>

          {/* Parameters */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center">
                  <CodeBracketIcon className="w-5 h-5 mr-2" />
                  Parameters
                </CardTitle>
                <SnippetQuickTips.AddParameter>
                  <Button size="sm" onClick={addParameter} className="flex items-center">
                    <PlusIcon className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </SnippetQuickTips.AddParameter>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {parameterFormData.length === 0 ? (
                <div className="space-y-4">
                  <div className="text-center py-6 text-slate-500">
                    <CodeBracketIcon className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                    <p className="text-sm">No parameters defined</p>
                    <p className="text-xs mt-1">Add parameters to make your snippet configurable</p>
                  </div>
                  <SnippetHelpContent
                    context="parameters"
                    parameterCount={0}
                  />
                </div>
              ) : (
                parameterFormData.map((param) => (
                  <div key={param.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-slate-900">Parameter</h4>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeParameter(param.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Parameter Name */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Name *
                      </label>
                      <Input
                        value={param.name}
                        onChange={(e) => updateParameter(param.id, 'name', e.target.value)}
                        placeholder="Parameter name..."
                        maxLength={50}
                      />
                    </div>

                    {/* Parameter Type */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Type
                      </label>
                      <Select
                        value={param.type}
                        onChange={(e) => updateParameter(param.id, 'type', e.target.value)}
                        options={[
                          { value: 'string', label: 'String' },
                          { value: 'number', label: 'Number' },
                          { value: 'boolean', label: 'Boolean' }
                        ]}
                      />
                    </div>

                    {/* Required */}
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id={`required-${param.id}`}
                        checked={param.required}
                        onChange={(e) => updateParameter(param.id, 'required', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <label htmlFor={`required-${param.id}`} className="ml-2 text-xs text-slate-700">
                        Required
                      </label>
                    </div>

                    {/* Default Value */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Default Value
                      </label>
                      {param.type === 'boolean' ? (
                        <Select
                          value={param.defaultValue?.toString() || 'false'}
                          onChange={(e) => updateParameter(param.id, 'defaultValue', e.target.value === 'true')}
                          options={[
                            { value: 'false', label: 'False' },
                            { value: 'true', label: 'True' }
                          ]}
                        />
                      ) : (
                        <Input
                          value={param.defaultValue?.toString() || ''}
                          onChange={(e) => {
                            const value = param.type === 'number' ?
                              (e.target.value ? Number(e.target.value) : '') :
                              e.target.value;
                            updateParameter(param.id, 'defaultValue', value);
                          }}
                          placeholder={`Default ${param.type} value...`}
                          type={param.type === 'number' ? 'number' : 'text'}
                        />
                      )}
                    </div>

                    {/* Description */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Description
                      </label>
                      <TextArea
                        value={param.description || ''}
                        onChange={(e) => updateParameter(param.id, 'description', e.target.value)}
                        placeholder="Parameter description..."
                        rows={2}
                        maxLength={200}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Dependency Tracking */}
          {dependentTemplates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <InformationCircleIcon className="w-5 h-5 mr-2" />
                  Template Dependencies
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <p className="text-sm text-slate-600">
                    This snippet is used by {dependentTemplates.length} template{dependentTemplates.length !== 1 ? 's' : ''}:
                  </p>
                  <div className="space-y-1">
                    {dependentTemplates.map(template => (
                      <div key={template.id} className="text-sm text-slate-700 bg-slate-50 px-2 py-1 rounded">
                        {template.name}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-amber-600 mt-2">
                    Changes to this snippet will affect all dependent templates.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Snippet Editor and Preview */}
        <div className="lg:col-span-2 space-y-6">
          {/* Code Editor */}
          <Card>
            <CardHeader>
              <CardTitle>Snippet Content</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleCodeEditor
                value={formData.content}
                onChange={(value) => handleFieldChange('content', value)}
                language="handlebars"
                height="400px"
                onValidationChange={handleValidationChange}
                placeholder="Enter your snippet content using handlebars syntax..."
              />
            </CardContent>
          </Card>

          {/* Preview Section */}
          {formData.parameters.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <EyeIcon className="w-5 h-5 mr-2" />
                  Preview with Test Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Test Parameter Inputs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formData.parameters.map(param => (
                    <div key={param.name}>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        {param.name}
                        {param.required && <span className="text-red-500 ml-1">*</span>}
                        <span className="text-xs text-slate-500 ml-1">({param.type})</span>
                      </label>
                      {param.type === 'boolean' ? (
                        <Select
                          value={testParameters[param.name]?.toString() || 'false'}
                          onChange={(e) => updateTestParameter(param.name, e.target.value === 'true')}
                          options={[
                            { value: 'false', label: 'False' },
                            { value: 'true', label: 'True' }
                          ]}
                        />
                      ) : (
                        <Input
                          value={testParameters[param.name]?.toString() || ''}
                          onChange={(e) => {
                            const value = param.type === 'number' ?
                              (e.target.value ? Number(e.target.value) : '') :
                              e.target.value;
                            updateTestParameter(param.name, value);
                          }}
                          placeholder={param.description || `Enter ${param.type} value...`}
                          type={param.type === 'number' ? 'number' : 'text'}
                        />
                      )}
                    </div>
                  ))}
                </div>

                {/* Preview Output */}
                {previewData && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Preview Output
                    </label>
                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                      {previewData.success ? (
                        <div
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: previewData.html }}
                        />
                      ) : (
                        <div className="text-red-600 text-sm">
                          <ExclamationTriangleIcon className="w-4 h-4 inline mr-1" />
                          {previewData.error || 'Preview failed'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
