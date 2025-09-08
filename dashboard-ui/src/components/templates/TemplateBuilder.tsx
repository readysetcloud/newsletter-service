import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  EyeIcon,
  CodeBracketIcon,
  PaintBrushIcon,
  DocumentTextIcon,
  TagIcon,
  FolderIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowLeftIcon,
  CloudArrowUpIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Select } from '@/components/ui/Select';
import { Loading } from '@/components/ui/Loading';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { CodeEditor } from './CodeEditor';
import { VisualBuilder } from './VisualBuilder';
import type { VisualConfig } from '@/utils/templateConverter';
import { templateService } from '@/services/templateService';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/utils/cn';
import { useNotifications } from '@/components/ui/Notifications';
import { FormValidationProvider, useFormValidation, ValidatedField, templateValidationRules } from '@/components/ui/FormValidation';
import { TemplateErrorBoundary } from '@/components/ui/ErrorBoundary';
import { FormLoadingOverlay, AutoSaveIndicator } from '@/components/ui/LoadingStates';
import { getUserFriendlyErrorMessage, getDetailedErrorInfo } from '@/utils/errorHandling';
import { safeValidate, createTemplateSchema, updateTemplateSchema } from '@/schemas/templateValidation';
import {
  visualConfigToHandlebars,
  handlebarsToVisualConfig,
  createEmptyVisualConfig,
  validateVisualConfig
} from '@/utils/templateConverter';
import type {
  Template,
  Snippet,
  CreateTemplateRequest,
  UpdateTemplateRequest
} from '@/types/template';

interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface TemplateBuilderProps {
  template?: Template;
  onSave?: (template: Template) => void;
  onCancel?: () => void;
  onPreview?: (template: Template) => void;
  className?: string;
}

type BuilderMode = 'visual' | 'code';

interface TemplateFormData {
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  isVisualMode: boolean;
  visualConfig?: any;
}

const TemplateBuilderContent: React.FC<TemplateBuilderProps> = ({
  template,
  onSave,
  onCancel,
  onPreview,
  className
}) => {
  const notifications = useNotifications();
  const formValidation = useFormValidation();
  const [mode, setMode] = useState<BuilderMode>('code');
  const [formData, setFormData] = useState<TemplateFormData>({
    name: '',
    description: '',
    content: '',
    category: '',
    tags: [],
    isVisualMode: false
  });

  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const [newTag, setNewTag] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);

  const debouncedContent = useDebounce(formData.content, 500);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout>();

  // Initialize form data
  useEffect(() => {
    if (template) {
      let visualConfig = template.visualConfig;

      // If template has visual mode enabled but no visual config, try to parse from content
      if (template.isVisualMode && !visualConfig && template.content) {
        visualConfig = handlebarsToVisualConfig(template.content, snippets);
      }

      setFormData({
        name: template.name,
        description: template.description || '',
        content: template.content || '',
        category: template.category || '',
        tags: template.tags || [],
        isVisualMode: template.isVisualMode || false,
        visualConfig: visualConfig
      });
      setMode(template.isVisualMode ? 'visual' : 'code');
      setLastSaved(new Date(template.updatedAt));
    }
  }, [template, snippets]);

  // Load metadata
  useEffect(() => {
    const loadMetadata = async () => {
      setLoading(true);
      try {
        const [snippetsResponse, categoriesResponse, tagsResponse] = await Promise.all([
          templateService.getSnippets(),
          templateService.getTemplateCategories(),
          templateService.getTemplateTags()
        ]);

        if (snippetsResponse.success && snippetsResponse.data) {
          setSnippets(snippetsResponse.data.snippets);
        }

        setCategories(categoriesResponse);
        setAvailableTags(tagsResponse);
      } catch (error) {
        console.error('Error loading metadata:', error);
        setError('Failed to load template metadata');
      } finally {
        setLoading(false);
      }
    };

    loadMetadata();
  }, []);

  // Track unsaved changes
  useEffect(() => {
    if (template) {
      const hasChanges = (
        formData.name !== template.name ||
        formData.description !== (template.description || '') ||
        formData.content !== (template.content || '') ||
        formData.category !== (template.category || '') ||
        JSON.stringify(formData.tags) !== JSON.stringify(template.tags || []) ||
        formData.isVisualMode !== (template.isVisualMode || false)
      );
      setHasUnsavedChanges(hasChanges);
    } else {
      const hasContent = formData.name || formData.description || formData.content;
      setHasUnsavedChanges(!!hasContent);
    }
  }, [formData, template]);

  // Auto-save functionality
  useEffect(() => {
    if (hasUnsavedChanges && template && debouncedContent) {
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
  }, [debouncedContent, hasUnsavedChanges, template]);

  // Handle auto-save
  const handleAutoSave = useCallback(async () => {
    if (!template || !hasUnsavedChanges) return;

    try {
      const updateData: UpdateTemplateRequest = {
        name: formData.name,
        description: formData.description,
        content: formData.content,
        category: formData.category,
        tags: formData.tags,
        isVisualMode: formData.isVisualMode,
        visualConfig: formData.visualConfig
      };

      await templateService.updateTemplateWithRetry(template.id, updateData);
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }, [template, formData, hasUnsavedChanges]);

  // Handle form field changes
  const handleFieldChange = useCallback((field: keyof TemplateFormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);

  // Handle mode toggle
  const handleModeToggle = useCallback((newMode: BuilderMode) => {
    if (newMode === 'visual' && !formData.visualConfig) {
      // Initialize visual config if switching to visual mode for the first time
      const visualConfig = formData.content
        ? handlebarsToVisualConfig(formData.content, snippets)
        : createEmptyVisualConfig();

      handleFieldChange('visualConfig', visualConfig);
    } else if (newMode === 'code' && formData.visualConfig) {
      // Convert visual config to handlebars when switching to code mode
      const handlebarsContent = visualConfigToHandlebars(formData.visualConfig, snippets);
      handleFieldChange('content', handlebarsContent);
    }

    setMode(newMode);
    handleFieldChange('isVisualMode', newMode === 'visual');
  }, [handleFieldChange, formData.content, formData.visualConfig, snippets]);

  // Handle validation changes
  const handleValidationChange = useCallback((errors: ValidationError[]) => {
    setValidationErrors(errors);
  }, []);

  // Handle visual config changes
  const handleVisualConfigChange = useCallback((visualConfig: VisualConfig) => {
    handleFieldChange('visualConfig', visualConfig);

    // Also update the handlebars content
    const handlebarsContent = visualConfigToHandlebars(visualConfig, snippets);
    handleFieldChange('content', handlebarsContent);

    // Validate visual config
    const validation = validateVisualConfig(visualConfig);
    if (!validation.isValid) {
      const visualErrors: ValidationError[] = validation.errors.map((error, index) => ({
        line: index + 1,
        column: 1,
        message: error,
        severity: 'error' as const
      }));
      setValidationErrors(visualErrors);
    } else {
      setValidationErrors([]);
    }
  }, [handleFieldChange, snippets]);

  // Handle tag management
  const handleAddTag = useCallback(() => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      handleFieldChange('tags', [...formData.tags, newTag.trim()]);
      setNewTag('');
      setShowTagInput(false);
    }
  }, [newTag, formData.tags, handleFieldChange]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    handleFieldChange('tags', formData.tags.filter(tag => tag !== tagToRemove));
  }, [formData.tags, handleFieldChange]);

  const handleTagKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === 'Escape') {
      setNewTag('');
      setShowTagInput(false);
    }
  }, [handleAddTag]);

  // Handle save with enhanced validation and error handling
  const handleSave = useCallback(async () => {
    if (validationErrors.some(e => e.severity === 'error')) {
      notifications.error('Validation Error', 'Please fix validation errors before saving');
      return;
    }

    // Validate form data using Zod schema
    const schema = template ? updateTemplateSchema : createTemplateSchema;
    const validation = safeValidate(schema, formData);

    if (!validation.success) {
      const firstError = Object.values(validation.errors)[0];
      notifications.error('Validation Error', firstError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (template) {
        // Update existing template
        const updateData: UpdateTemplateRequest = validation.data;
        const response = await templateService.updateTemplateWithRetry(template.id, updateData);

        if (response.success && response.data) {
          setLastSaved(new Date());
          setHasUnsavedChanges(false);
          notifications.success('Template Updated', `${formData.name} has been updated successfully.`);
          onSave?.(response.data);
        } else {
          const errorInfo = getDetailedErrorInfo(response, 'template');
          setError(errorInfo.message);
          notifications.error('Update Failed', errorInfo.message, {
            actions: errorInfo.retryable ? [{
              label: 'Retry',
              onClick: handleSave
            }] : undefined
          });
        }
      } else {
        // Create new template
        const createData: CreateTemplateRequest = {
          name: validation.data.name!,
          content: validation.data.content!,
          description: validation.data.description,
          category: validation.data.category,
          tags: validation.data.tags,
          isVisualMode: validation.data.isVisualMode,
          visualConfig: validation.data.visualConfig
        };
        const response = await templateService.createTemplateWithRetry(createData);

        if (response.success && response.data) {
          setLastSaved(new Date());
          setHasUnsavedChanges(false);
          notifications.success('Template Created', `${formData.name} has been created successfully.`);
          onSave?.(response.data);
        } else {
          const errorInfo = getDetailedErrorInfo(response, 'template');
          setError(errorInfo.message);
          notifications.error('Creation Failed', errorInfo.message, {
            actions: errorInfo.retryable ? [{
              label: 'Retry',
              onClick: handleSave
            }] : undefined
          });
        }
      }
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'template');
      setError(errorMessage);
      notifications.error('Save Failed', errorMessage);
    } finally {
      setSaving(false);
    }
  }, [template, formData, validationErrors, onSave, notifications]);

  // Handle preview
  const handlePreview = useCallback(() => {
    if (onPreview) {
      const previewTemplate: Template = {
        ...(template || {} as Template),
        name: formData.name,
        description: formData.description,
        content: formData.content,
        category: formData.category,
        tags: formData.tags,
        isVisualMode: formData.isVisualMode,
        visualConfig: formData.visualConfig
      };
      onPreview(previewTemplate);
    }
  }, [template, formData, onPreview]);

  // Validation summary
  const getValidationSummary = useCallback(() => {
    const errors = validationErrors.filter(e => e.severity === 'error').length;
    const warnings = validationErrors.filter(e => e.severity === 'warning').length;
    return { errors, warnings, hasErrors: errors > 0 };
  }, [validationErrors]);

  const { errors, warnings, hasErrors } = getValidationSummary();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <FormLoadingOverlay
      isLoading={saving}
      message={template ? 'Updating template...' : 'Creating template...'}
      className={cn('space-y-6', className)}
    >
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
              {template ? 'Edit Template' : 'Create Template'}
            </h1>
            <div className="flex items-center space-x-4 text-sm text-slate-600 mt-1">
              <AutoSaveIndicator
                isSaving={saving}
                lastSaved={lastSaved || undefined}
              />
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
          {onPreview && (
            <Button variant="outline" onClick={handlePreview} className="flex items-center">
              <EyeIcon className="w-4 h-4 mr-2" />
              Preview
            </Button>
          )}

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
            {saving ? 'Saving...' : template ? 'Update Template' : 'Create Template'}
          </Button>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template Settings */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <DocumentTextIcon className="w-5 h-5 mr-2" />
                Template Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Name */}
              <ValidatedField
                name="name"
                value={formData.name}
                rules={templateValidationRules.templateName}
                validateOnChange={true}
                validateOnBlur={true}
              >
                {({ hasError, hasWarning, isValidating, onBlur, onChange }) => (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Template Name *
                    </label>
                    <Input
                      value={formData.name}
                      onChange={(e) => {
                        handleFieldChange('name', e.target.value);
                        onChange(e.target.value);
                      }}
                      onBlur={onBlur}
                      placeholder="Enter template name..."
                      maxLength={100}
                      className={cn(
                        hasError && 'border-red-300 focus:border-red-500 focus:ring-red-500',
                        hasWarning && 'border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500'
                      )}
                    />
                  </div>
                )}
              </ValidatedField>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Description
                </label>
                <TextArea
                  value={formData.description}
                  onChange={(e) => handleFieldChange('description', e.target.value)}
                  placeholder="Describe your template..."
                  rows={3}
                  maxLength={500}
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <FolderIcon className="w-4 h-4 inline mr-1" />
                  Category
                </label>
                <Select
                  value={formData.category}
                  onChange={(e) => handleFieldChange('category', e.target.value)}
                  options={[
                    { value: '', label: 'Select category...' },
                    ...categories.map(cat => ({ value: cat, label: cat })),
                    { value: '__new__', label: 'Create new category...' }
                  ]}
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <TagIcon className="w-4 h-4 inline mr-1" />
                  Tags
                </label>

                {/* Selected Tags */}
                {formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {formData.tags.map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="ml-1 hover:text-blue-600"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add Tag */}
                {showTagInput ? (
                  <div className="flex space-x-2">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={handleTagKeyPress}
                      placeholder="Enter tag name..."
                      className="flex-1"
                      maxLength={30}
                    />
                    <Button size="sm" onClick={handleAddTag} disabled={!newTag.trim()}>
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowTagInput(false);
                        setNewTag('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowTagInput(true)}
                    className="w-full"
                  >
                    Add Tag
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Template Editor */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Template Content</CardTitle>

                {/* Mode Toggle */}
                <div className="flex items-center bg-slate-100 rounded-lg p-1">
                  <button
                    onClick={() => handleModeToggle('code')}
                    className={cn(
                      'flex items-center px-3 py-1 rounded-md text-sm font-medium transition-colors',
                      mode === 'code'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    <CodeBracketIcon className="w-4 h-4 mr-2" />
                    Code Editor
                  </button>
                  <button
                    onClick={() => handleModeToggle('visual')}
                    className={cn(
                      'flex items-center px-3 py-1 rounded-md text-sm font-medium transition-colors',
                      mode === 'visual'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    <PaintBrushIcon className="w-4 h-4 mr-2" />
                    Visual Builder
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {mode === 'code' ? (
                <CodeEditor
                  value={formData.content}
                  onChange={(value) => handleFieldChange('content', value)}
                  language="handlebars"
                  height="500px"
                  snippets={snippets}
                  onValidationChange={handleValidationChange}
                  placeholder="Start typing your handlebars template..."
                  showMinimap={true}
                />
              ) : (
                <div className="h-[500px] border border-slate-200 rounded-lg overflow-hidden">
                  <VisualBuilder
                    config={formData.visualConfig || createEmptyVisualConfig()}
                    onChange={handleVisualConfigChange}
                    snippets={snippets}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </FormLoadingOverlay>
  );
};

// Main component with error boundary and validation provider
export const TemplateBuilder: React.FC<TemplateBuilderProps> = (props) => {
  return (
    <TemplateErrorBoundary templateName={props.template?.name}>
      <FormValidationProvider>
        <TemplateBuilderContent {...props} />
      </FormValidationProvider>
    </TemplateErrorBoundary>
  );
};
