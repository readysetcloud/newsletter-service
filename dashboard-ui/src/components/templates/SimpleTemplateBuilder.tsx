import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  EyeIcon,
  CodeBracketIcon,
  PaintBrushIcon,
  DocumentTextIcon,
  PlusIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  BeakerIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Select } from '@/components/ui/Select';
import { VariableInput } from './VariableInput';
import { VariableTextArea } from './VariableTextArea';
import { VariablePicker } from './VariablePicker';
import { TemplateNameInput } from './TemplateNameInput';
import { useTemplateNotifications } from '@/components/ui/Notifications';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';

import { cn } from '@/utils/cn';
import type { Template, Snippet } from '@/types/template';
import type { Variable, ComponentType } from '@/types/variable';

interface TemplateComponent {
  id: string;
  type: 'text' | 'image' | 'button' | 'heading' | 'divider' | 'snippet';
  properties: Record<string, any>;
}

interface SimpleTemplateBuilderProps {
  template?: Template;
  snippets?: Snippet[];
  onSave?: (template: Template) => void;
  onPreview?: (template: Template) => void;
  className?: string;
  autoSave?: boolean;
  autoSaveInterval?: number;
}

const COMPONENT_TYPES = [
  { value: 'heading', label: 'Heading', icon: DocumentTextIcon },
  { value: 'text', label: 'Text Block', icon: DocumentTextIcon },
  { value: 'image', label: 'Image', icon: PaintBrushIcon },
  { value: 'button', label: 'Button', icon: PlusIcon },
  { value: 'divider', label: 'Divider', icon: PaintBrushIcon },
  { value: 'snippet', label: 'Snippet', icon: CodeBracketIcon }
];

const DEFAULT_PROPERTIES = {
  heading: { text: 'Your Heading Here', level: 'h2', align: 'left' },
  text: { content: 'Your text content here...', align: 'left' },
  image: { src: '', alt: '', width: '100%', align: 'center' },
  button: { text: 'Click Here', url: '', backgroundColor: '#007bff', textColor: '#ffffff' },
  divider: { style: 'solid', color: '#cccccc', margin: '20px 0' },
  snippet: { snippetId: '', parameters: {} }
};

type TabType = 'build' | 'test';

export const SimpleTemplateBuilder: React.FC<SimpleTemplateBuilderProps> = ({
  template,
  snippets = [],
  onSave,
  onPreview,
  className,
  autoSave = false,
  autoSaveInterval = 30000
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('build');
  const [components, setComponents] = useState<TemplateComponent[]>(
    template?.visualConfig?.components || []
  );
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [showVariablePicker, setShowVariablePicker] = useState(false);
  const [variableTarget, setVariableTarget] = useState<{
    componentId: string;
    property: string;
  } | null>(null);

  // Template metadata state
  const [templateName, setTemplateName] = useState<string>(template?.name || '');
  const [templateDescription, setTemplateDescription] = useState<string>(template?.description || '');
  const [isNameValid, setIsNameValid] = useState<boolean>(true);
  const [nameError, setNameError] = useState<string>('');
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState<boolean>(false);

  // Save state management
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const notifications = useTemplateNotifications();
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout>();

  // Handle unsaved changes navigation warning
  const { navigateWithConfirmation } = useUnsavedChanges({
    hasUnsavedChanges,
    message: 'You have unsaved template changes. Are you sure you want to leave?',
    onNavigateAway: () => {
      // Clear any pending auto-save
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    }
  });

  // Test tab state with comprehensive newsletter metadata
  const [testData, setTestData] = useState<string>(`{
  "newsletter": {
    "title": "Serverless Picks of the Week #42",
    "issue": 42,
    "date": "2024-01-15",
    "description": "Your weekly dose of serverless insights and tools",
    "url": "https://readysetcloud.io/newsletter/42",
    "hasSponsors": true,
    "isDraft": false,
    "featuredArticle": {
      "title": "Building Scalable APIs with AWS Lambda",
      "description": "Learn how to create high-performance serverless APIs",
      "url": "https://example.com/featured-article",
      "image": "https://via.placeholder.com/600x300"
    },
    "articles": [
      {
        "title": "AWS Lambda Performance Tips",
        "summary": "5 ways to optimize your Lambda functions",
        "url": "https://example.com/lambda-tips",
        "author": "Jane Developer"
      },
      {
        "title": "DynamoDB Best Practices",
        "summary": "How to design efficient NoSQL schemas",
        "url": "https://example.com/dynamodb-guide",
        "author": "Bob Engineer"
      }
    ],
    "sponsors": [
      {
        "name": "CloudTech Solutions",
        "logo": "https://via.placeholder.com/150x60",
        "url": "https://example.com/sponsor1"
      }
    ],
    "tags": ["serverless", "aws", "lambda", "api-gateway"]
  },
  "subscriber": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "subscriptionDate": "2023-06-15",
    "isPremium": false,
    "hasUnsubscribed": false,
    "preferences": {
      "frequency": "weekly",
      "topics": ["serverless", "aws"]
    }
  },
  "brand": {
    "name": "Ready Set Cloud",
    "logo": "https://readysetcloud.s3.us-east-1.amazonaws.com/newsletter.png",
    "primaryColor": "#007bff",
    "website": "https://readysetcloud.io",
    "showLogo": true,
    "socialMedia": {
      "twitter": "https://twitter.com/readysetcloud",
      "linkedin": "https://linkedin.com/company/readysetcloud",
      "github": "https://github.com/readysetcloud"
    }
  },
  "system": {
    "unsubscribeUrl": "https://example.com/unsubscribe?token=abc123",
    "viewOnlineUrl": "https://example.com/newsletter/42",
    "currentDate": "${new Date().toISOString().split('T')[0]}"
  }
}`);
  const [testDataError, setTestDataError] = useState<string | null>(null);

  // Generate unique ID for new components
  const generateId = useCallback(() => {
    return `component_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Track unsaved changes
  useEffect(() => {
    if (!template) {
      // New template - has changes if there's any content
      const hasContent = templateName || templateDescription || components.length > 0;
      setHasUnsavedChanges(!!hasContent);
    } else {
      // Existing template - compare with original
      const hasChanges = (
        templateName !== (template.name || '') ||
        templateDescription !== (template.description || '') ||
        JSON.stringify(components) !== JSON.stringify(template.visualConfig?.components || [])
      );
      setHasUnsavedChanges(hasChanges);
    }
  }, [templateName, templateDescription, components, template]);

  // Auto-save functionality
  useEffect(() => {
    if (!autoSave || !hasUnsavedChanges || !template) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      handleAutoSave();
    }, autoSaveInterval);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [hasUnsavedChanges, autoSave, autoSaveInterval, template]);

  // Add a new component
  const addComponent = useCallback((type: TemplateComponent['type']) => {
    const newComponent: TemplateComponent = {
      id: generateId(),
      type,
      properties: { ...DEFAULT_PROPERTIES[type] }
    };

    setComponents(prev => [...prev, newComponent]);
    setSelectedComponentId(newComponent.id);
  }, [generateId]);

  // Remove a component
  const removeComponent = useCallback((componentId: string) => {
    setComponents(prev => prev.filter(c => c.id !== componentId));
    if (selectedComponentId === componentId) {
      setSelectedComponentId(null);
    }
  }, [selectedComponentId]);

  // Move component up/down
  const moveComponent = useCallback((componentId: string, direction: 'up' | 'down') => {
    setComponents(prev => {
      const index = prev.findIndex(c => c.id === componentId);
      if (index === -1) return prev;

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;

      const newComponents = [...prev];
      [newComponents[index], newComponents[newIndex]] = [newComponents[newIndex], newComponents[index]];
      return newComponents;
    });
  }, []);

  // Update component property
  const updateComponentProperty = useCallback((componentId: string, property: string, value: any) => {
    setComponents(prev => prev.map(component =>
      component.id === componentId
        ? { ...component, properties: { ...component.properties, [property]: value } }
        : component
    ));
  }, []);

  // Handle variable insertion
  const handleVariableInsert = useCallback((variable: Variable) => {
    if (!variableTarget) return;

    const variableReference = `{{${variable.path}}}`;
    const currentValue = components.find(c => c.id === variableTarget.componentId)
      ?.properties[variableTarget.property] || '';

    updateComponentProperty(
      variableTarget.componentId,
      variableTarget.property,
      currentValue + variableReference
    );

    setShowVariablePicker(false);
    setVariableTarget(null);
  }, [variableTarget, components, updateComponentProperty]);

  // Open variable picker for a specific property
  const openVariablePicker = useCallback((componentId: string, property: string) => {
    setVariableTarget({ componentId, property });
    setShowVariablePicker(true);
  }, []);

  // Generate template from components
  const generateTemplate = useCallback((): Template => {
    const handlebarsTemplate = components.map(component => {
      switch (component.type) {
        case 'heading':
          return `<${component.properties.level} style="text-align: ${component.properties.align}">${component.properties.text}</${component.properties.level}>`;

        case 'text':
          return `<p style="text-align: ${component.properties.align}">${component.properties.content}</p>`;

        case 'image':
          return `<img src="${component.properties.src}" alt="${component.properties.alt}" style="width: ${component.properties.width}; display: block; margin: 0 auto;" />`;

        case 'button':
          return `<a href="${component.properties.url}" style="display: inline-block; padding: 12px 24px; background-color: ${component.properties.backgroundColor}; color: ${component.properties.textColor}; text-decoration: none; border-radius: 4px;">${component.properties.text}</a>`;

        case 'divider':
          return `<hr style="border: 1px ${component.properties.style} ${component.properties.color}; margin: ${component.properties.margin};" />`;

        case 'snippet':
          const snippet = snippets.find(s => s.id === component.properties.snippetId);
          return snippet ? `{{> ${snippet.name} ${JSON.stringify(component.properties.parameters)}}}` : '';

        default:
          return '';
      }
    }).join('\n\n');

    return {
      id: template?.id || generateId(),
      tenantId: template?.tenantId || 'demo-tenant',
      name: templateName || 'Untitled Template',
      description: templateDescription,
      type: 'template' as const,
      content: handlebarsTemplate,
      visualConfig: { components },
      s3Key: template?.s3Key || `templates/${generateId()}.hbs`,
      s3VersionId: template?.s3VersionId || '1',
      createdAt: template?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: template?.version || 1,
      isActive: template?.isActive ?? true
    };
  }, [components, snippets, template, templateName, templateDescription, generateId]);

  // Auto-save handler
  const handleAutoSave = useCallback(async () => {
    if (!template || !hasUnsavedChanges || isSaving) return;

    try {
      setIsSaving(true);
      const updatedTemplate = generateTemplate();

      const response = await templateService.updateTemplateWithRetry(template.id, {
        name: updatedTemplate.name,
        description: updatedTemplate.description,
        content: updatedTemplate.content,
        isVisualMode: updatedTemplate.isVisualMode,
        visualConfig: updatedTemplate.visualConfig
      });

      if (response.success && response.data) {
        setLastSaved(new Date());
        setHasUnsavedChanges(false);
        notifications.autoSaved();
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
      // Don't show error notification for auto-save failures to avoid spam
    } finally {
      setIsSaving(false);
    }
  }, [template, hasUnsavedChanges, isSaving, generateTemplate, notifications]);

  // Handle save
  const handleSave = useCallback(async () => {
    // Validate template name before saving
    if (!isNameValid || !templateName.trim()) {
      setActiveTab('build'); // Switch to build tab to show the error
      notifications.validationError('Template name is required');
      return;
    }

    if (isSaving) return;

    try {
      setIsSaving(true);
      const updatedTemplate = generateTemplate();

      // Call the parent onSave callback if provided
      if (onSave) {
        await onSave(updatedTemplate);
        setLastSaved(new Date());
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save template';
      notifications.templateError(templateName || 'Template', errorMessage);
    } finally {
      setIsSaving(false);
    }
  }, [isNameValid, templateName, isSaving, generateTemplate, onSave, notifications, setActiveTab]);

  // Handle preview
  const handlePreview = useCallback(() => {
    const generatedTemplate = generateTemplate();
    onPreview?.(generatedTemplate);
  }, [generateTemplate, onPreview]);

  // Parse test data and validate JSON
  const parsedTestData = useMemo(() => {
    try {
      const parsed = JSON.parse(testData);
      setTestDataError(null);
      return parsed;
    } catch (error) {
      setTestDataError(error instanceof Error ? error.message : 'Invalid JSON');
      return null;
    }
  }, [testData]);

  // Render template with test data
  const renderTemplateWithData = useCallback((templateContent: string, data: any): string => {
    if (!data) return templateContent;

    // Simple Handlebars-like template rendering
    let rendered = templateContent;

    const replaceVariables = (str: string, obj: any, prefix = ''): string => {
      return str.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const cleanPath = path.trim();
        const keys = cleanPath.split('.');
        let value = obj;

        try {
          for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
              value = value[key];
            } else {
              return match; // Keep original if path not found
            }
          }
          return String(value);
        } catch {
          return match; // Keep original if error
        }
      });
    };

    return replaceVariables(rendered, data);
  }, []);

  // Get rendered template content
  const renderedTemplate = useMemo(() => {
    if (!parsedTestData) return null;

    const generatedTemplate = generateTemplate();
    return renderTemplateWithData(generatedTemplate.content || '', parsedTestData);
  }, [parsedTestData, generateTemplate, renderTemplateWithData]);

  const selectedComponent = selectedComponentId
    ? components.find(c => c.id === selectedComponentId)
    : null;

  return (
    <div className={cn('flex h-full bg-gray-50', className)}>
      {/* Left Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <div className="flex">
            <button
              className={cn(
                'flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'build'
                  ? 'border-blue-500 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              )}
              onClick={() => setActiveTab('build')}
            >
              <PaintBrushIcon className="w-4 h-4 mr-2 inline" />
              Build
            </button>
            <button
              className={cn(
                'flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'test'
                  ? 'border-blue-500 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              )}
              onClick={() => setActiveTab('test')}
            >
              <BeakerIcon className="w-4 h-4 mr-2 inline" />
              Test
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 p-4 overflow-y-auto">
          {activeTab === 'build' ? (
            <>
              {/* Template Metadata */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-4">Template Details</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Template Name
                    </label>
                    <TemplateNameInput
                      value={templateName}
                      onChange={setTemplateName}
                      onValidationChange={(valid, error) => {
                        setIsNameValid(valid);
                        setNameError(error || '');
                      }}
                      placeholder="Enter template name..."
                      required={true}
                      showSuggestions={showNameSuggestions}
                      suggestions={nameSuggestions}
                      onSuggestionSelect={(suggestion) => {
                        setTemplateName(suggestion);
                        setShowNameSuggestions(false);
                        setNameSuggestions([]);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description (Optional)
                    </label>
                    <TextArea
                      value={templateDescription}
                      onChange={(e) => setTemplateDescription(e.target.value)}
                      placeholder="Describe what this template is for..."
                      rows={2}
                      maxLength={500}
                    />
                    <div className="text-xs text-gray-500 mt-1">
                      {templateDescription.length}/500 characters
                    </div>
                  </div>
                </div>
              </div>

              <h3 className="text-lg font-semibold mb-4">Components</h3>
              <div className="space-y-2">
                {COMPONENT_TYPES.map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => addComponent(value as TemplateComponent['type'])}
                  >
                    <Icon className="w-4 h-4 mr-2" />
                    {label}
                  </Button>
                ))}
              </div>

              {/* Actions */}
              <div className="mt-6 space-y-2">
                <Button onClick={handlePreview} variant="outline" className="w-full">
                  <EyeIcon className="w-4 h-4 mr-2" />
                  Preview
                </Button>
                <Button
                  onClick={handleSave}
                  variant="primary"
                  className="w-full"
                  disabled={!isNameValid || !templateName.trim() || isSaving}
                >
                  {isSaving ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </>
                  ) : (
                    'Save Template'
                  )}
                </Button>

                {/* Save Status */}
                <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                  <div className="flex items-center space-x-2">
                    {hasUnsavedChanges && !isSaving && (
                      <span className="text-amber-600 font-medium">Unsaved changes</span>
                    )}
                    {lastSaved && !hasUnsavedChanges && !isSaving && (
                      <span className="text-green-600 font-medium">
                        Saved {lastSaved.toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>

                {(!isNameValid || !templateName.trim()) && (
                  <p className="text-xs text-red-600 mt-1">
                    Please provide a valid template name before saving
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold mb-4">Test Data</h3>
              <p className="text-sm text-gray-600 mb-4">
                Enter JSON data to test your template with real values:
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    JSON Data
                  </label>
                  <TextArea
                    value={testData}
                    onChange={(e) => setTestData(e.target.value)}
                    rows={12}
                    className="font-mono text-sm"
                    placeholder="Enter JSON data..."
                  />
                  {testDataError && (
                    <div className="mt-2 flex items-start space-x-2 text-red-600">
                      <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{testDataError}</span>
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => setActiveTab('build')}
                  variant="outline"
                  className="w-full"
                >
                  Back to Builder
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          {activeTab === 'build' ? (
            <>
              <h2 className="text-xl font-semibold mb-4">Template Canvas</h2>

              {components.length === 0 ? (
                <Card className="p-8 text-center text-gray-500">
                  <DocumentTextIcon className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>Start building your template by adding components from the left panel.</p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {components.map((component, index) => (
                    <Card
                      key={component.id}
                      className={cn(
                        'p-4 cursor-pointer transition-colors',
                        selectedComponentId === component.id && 'ring-2 ring-blue-500'
                      )}
                      onClick={() => setSelectedComponentId(component.id)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-600">
                          {COMPONENT_TYPES.find(t => t.value === component.type)?.label}
                        </span>
                        <div className="flex items-center space-x-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveComponent(component.id, 'up');
                            }}
                            disabled={index === 0}
                          >
                            <ArrowUpIcon className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveComponent(component.id, 'down');
                            }}
                            disabled={index === components.length - 1}
                          >
                            <ArrowDownIcon className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeComponent(component.id);
                            }}
                          >
                            <TrashIcon className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Component Preview */}
                      <div className="bg-gray-50 p-3 rounded border">
                        {component.type === 'heading' && (
                          <div style={{ textAlign: component.properties.align }}>
                            {React.createElement(
                              component.properties.level,
                              { className: 'text-lg font-semibold' },
                              component.properties.text
                            )}
                          </div>
                        )}
                        {component.type === 'text' && (
                          <p style={{ textAlign: component.properties.align }}>
                            {component.properties.content}
                          </p>
                        )}
                        {component.type === 'image' && (
                          <div style={{ textAlign: component.properties.align }}>
                            {component.properties.src ? (
                              <img
                                src={component.properties.src}
                                alt={component.properties.alt}
                                className="max-w-full h-auto"
                                style={{ width: component.properties.width }}
                              />
                            ) : (
                              <div className="bg-gray-200 p-4 text-center text-gray-500">
                                Image placeholder
                              </div>
                            )}
                          </div>
                        )}
                        {component.type === 'button' && (
                          <div style={{ textAlign: 'center' }}>
                            <span
                              className="inline-block px-6 py-3 rounded text-white"
                              style={{
                                backgroundColor: component.properties.backgroundColor,
                                color: component.properties.textColor
                              }}
                            >
                              {component.properties.text}
                            </span>
                          </div>
                        )}
                        {component.type === 'divider' && (
                          <hr
                            style={{
                              border: `1px ${component.properties.style} ${component.properties.color}`,
                              margin: component.properties.margin
                            }}
                          />
                        )}
                        {component.type === 'snippet' && (
                          <div className="bg-blue-50 p-2 rounded text-blue-700 text-sm">
                            Snippet: {snippets.find(s => s.id === component.properties.snippetId)?.name || 'Select snippet'}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Template Preview</h2>
                <div className="flex items-center space-x-2">
                  <div className={cn(
                    'px-2 py-1 rounded text-xs font-medium',
                    testDataError
                      ? 'bg-red-100 text-red-800'
                      : 'bg-green-100 text-green-800'
                  )}>
                    {testDataError ? 'Invalid JSON' : 'Valid JSON'}
                  </div>
                </div>
              </div>

              {testDataError ? (
                <Card className="p-8 text-center">
                  <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-4 text-red-400" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Invalid Test Data</h3>
                  <p className="text-gray-600 mb-4">Please fix the JSON syntax in the test data panel.</p>
                  <p className="text-sm text-red-600 font-mono bg-red-50 p-2 rounded">
                    {testDataError}
                  </p>
                </Card>
              ) : components.length === 0 ? (
                <Card className="p-8 text-center text-gray-500">
                  <DocumentTextIcon className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>Add some components to see the preview with test data.</p>
                </Card>
              ) : (
                <div className="space-y-6">
                  {/* Rendered Preview */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-gray-700">
                        Rendered Output
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div
                        className="prose max-w-none"
                        dangerouslySetInnerHTML={{
                          __html: renderedTemplate || 'No preview available'
                        }}
                      />
                    </CardContent>
                  </Card>

                  {/* Raw HTML */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-gray-700">
                        Generated HTML
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs bg-gray-50 p-4 rounded overflow-x-auto">
                        <code>{renderedTemplate}</code>
                      </pre>
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Properties Panel - Only show in build mode */}
      {activeTab === 'build' && (
        <div className="w-80 bg-white border-l border-gray-200 p-4 overflow-y-auto">
          <h3 className="text-lg font-semibold mb-4">Properties</h3>

          {selectedComponent ? (
            <ComponentPropertiesEditor
              component={selectedComponent}
              snippets={snippets}
              onPropertyChange={updateComponentProperty}
              onOpenVariablePicker={openVariablePicker}
            />
          ) : (
            <p className="text-gray-500">Select a component to edit its properties.</p>
          )}
        </div>
      )}

      {/* Variable Picker Modal */}
      {showVariablePicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Insert Variable</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowVariablePicker(false)}
              >
                ×
              </Button>
            </div>
            <VariablePicker
              onVariableSelect={handleVariableInsert}
              contextType="text" // You could make this dynamic based on component type
              position="inline"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Component Properties Editor
interface ComponentPropertiesEditorProps {
  component: TemplateComponent;
  snippets: Snippet[];
  onPropertyChange: (componentId: string, property: string, value: any) => void;
  onOpenVariablePicker: (componentId: string, property: string) => void;
}

const ComponentPropertiesEditor: React.FC<ComponentPropertiesEditorProps> = ({
  component,
  snippets,
  onPropertyChange,
  onOpenVariablePicker
}) => {
  const handleChange = (property: string, value: any) => {
    onPropertyChange(component.id, property, value);
  };

  const renderPropertyField = (property: string, label: string, type: 'text' | 'textarea' | 'select' | 'color' = 'text', options?: any[]) => {
    const value = component.properties[property] || '';

    if (type === 'textarea') {
      return (
        <div key={property} className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
          <div className="relative">
            <VariableTextArea
              value={value}
              onChange={(e) => handleChange(property, e.target.value)}
              contextType="text"
              showVariableButton
              onVariableInsert={(variable) => {
                const variableRef = `{{${variable.path}}}`;
                handleChange(property, value + variableRef);
              }}
              rows={3}
            />
          </div>
        </div>
      );
    }

    if (type === 'select' && options) {
      return (
        <div key={property} className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
          <Select
            value={value}
            onChange={(e) => handleChange(property, e.target.value)}
          >
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      );
    }

    return (
      <div key={property} className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
        <VariableInput
          type={type === 'color' ? 'color' : 'text'}
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange(property, e.target.value)}
          contextType="text"
          showVariableButton={type !== 'color'}
          onVariableInsert={(variable: Variable) => {
            const variableRef = `{{${variable.path}}}`;
            handleChange(property, value + variableRef);
          }}
        />
      </div>
    );
  };

  switch (component.type) {
    case 'heading':
      return (
        <div>
          {renderPropertyField('text', 'Heading Text', 'textarea')}
          {renderPropertyField('level', 'Heading Level', 'select', [
            { value: 'h1', label: 'H1' },
            { value: 'h2', label: 'H2' },
            { value: 'h3', label: 'H3' },
            { value: 'h4', label: 'H4' }
          ])}
          {renderPropertyField('align', 'Alignment', 'select', [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' }
          ])}
        </div>
      );

    case 'text':
      return (
        <div>
          {renderPropertyField('content', 'Text Content', 'textarea')}
          {renderPropertyField('align', 'Alignment', 'select', [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' }
          ])}
        </div>
      );

    case 'image':
      return (
        <div>
          {renderPropertyField('src', 'Image URL', 'text')}
          {renderPropertyField('alt', 'Alt Text', 'text')}
          {renderPropertyField('width', 'Width', 'text')}
          {renderPropertyField('align', 'Alignment', 'select', [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' }
          ])}
        </div>
      );

    case 'button':
      return (
        <div>
          {renderPropertyField('text', 'Button Text', 'text')}
          {renderPropertyField('url', 'Button URL', 'text')}
          {renderPropertyField('backgroundColor', 'Background Color', 'color')}
          {renderPropertyField('textColor', 'Text Color', 'color')}
        </div>
      );

    case 'divider':
      return (
        <div>
          {renderPropertyField('style', 'Style', 'select', [
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
            { value: 'dotted', label: 'Dotted' }
          ])}
          {renderPropertyField('color', 'Color', 'color')}
          {renderPropertyField('margin', 'Margin', 'text')}
        </div>
      );

    case 'snippet':
      return (
        <div>
          {renderPropertyField('snippetId', 'Snippet', 'select',
            snippets.map(s => ({ value: s.id, label: s.name }))
          )}
          {/* TODO: Add parameter configuration for selected snippet */}
        </div>
      );

    default:
      return <p className="text-gray-500">No properties available for this component type.</p>;
  }
};
