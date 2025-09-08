import React, { useState, useCallback, useRef } from 'react';
import {
  PlusIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  PhotoIcon,
  LinkIcon,
  CodeBracketSquareIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Select } from '@/components/ui/Select';
import { cn } from '@/utils/cn';
import type { Snippet } from '@/types/template';
import type { VisualConfig, VisualComponent } from '@/utils/templateConverter';

interface VisualBuilderProps {
  config: VisualConfig;
  onChange: (config: VisualConfig) => void;
  snippets: Snippet[];
  className?: string;
}

interface ComponentPaletteItem {
  type: VisualComponent['type'];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultProperties: Record<string, any>;
}

const COMPONENT_PALETTE: ComponentPaletteItem[] = [
  {
    type: 'text',
    label: 'Text Block',
    icon: DocumentTextIcon,
    defaultProperties: {
      content: 'Enter your text here...',
      fontSize: '16px',
      color: '#000000',
      textAlign: 'left',
      fontWeight: 'normal',
      marginBottom: '16px'
    }
  },
  {
    type: 'image',
    label: 'Image',
    icon: PhotoIcon,
    defaultProperties: {
      src: '',
      alt: '',
      width: '100%',
      height: 'auto',
      marginBottom: '16px'
    }
  },
  {
    type: 'button',
    label: 'Button',
    icon: LinkIcon,
    defaultProperties: {
      text: 'Click Here',
      href: '#',
      backgroundColor: '#3b82f6',
      color: '#ffffff',
      padding: '12px 24px',
      borderRadius: '6px',
      textAlign: 'center',
      marginBottom: '16px'
    }
  },
  {
    type: 'snippet',
    label: 'Snippet',
    icon: CodeBracketSquareIcon,
    defaultProperties: {
      snippetId: '',
      parameters: {}
    }
  }
];

export const VisualBuilder: React.FC<VisualBuilderProps> = ({
  config,
  onChange,
  snippets,
  className
}) => {
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [draggedComponent, setDraggedComponent] = useState<ComponentPaletteItem | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  // Generate unique ID for components
  const generateId = useCallback(() => {
    return `component_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Add component
  const addComponent = useCallback((type: VisualComponent['type'], index?: number) => {
    const paletteItem = COMPONENT_PALETTE.find(item => item.type === type);
    if (!paletteItem) return;

    const newComponent: VisualComponent = {
      id: generateId(),
      type,
      properties: { ...paletteItem.defaultProperties }
    };

    const newComponents = [...config.components];
    if (typeof index === 'number') {
      newComponents.splice(index, 0, newComponent);
    } else {
      newComponents.push(newComponent);
    }

    onChange({
      ...config,
      components: newComponents
    });

    setSelectedComponentId(newComponent.id);
  }, [config, onChange, generateId]);

  // Remove component
  const removeComponent = useCallback((componentId: string) => {
    const newComponents = config.components.filter(comp => comp.id !== componentId);
    onChange({
      ...config,
      components: newComponents
    });

    if (selectedComponentId === componentId) {
      setSelectedComponentId(null);
    }
  }, [config, onChange, selectedComponentId]);

  // Move component
  const moveComponent = useCallback((componentId: string, direction: 'up' | 'down') => {
    const currentIndex = config.components.findIndex(comp => comp.id === componentId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= config.components.length) return;

    const newComponents = [...config.components];
    const [movedComponent] = newComponents.splice(currentIndex, 1);
    newComponents.splice(newIndex, 0, movedComponent);

    onChange({
      ...config,
      components: newComponents
    });
  }, [config, onChange]);

  // Update component properties
  const updateComponentProperty = useCallback((componentId: string, property: string, value: any) => {
    const newComponents = config.components.map(comp => {
      if (comp.id === componentId) {
        return {
          ...comp,
          properties: {
            ...comp.properties,
            [property]: value
          }
        };
      }
      return comp;
    });

    onChange({
      ...config,
      components: newComponents
    });
  }, [config, onChange]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, item: ComponentPaletteItem) => {
    setDraggedComponent(item);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverIndex(index);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverIndex(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverIndex(null);

    if (draggedComponent) {
      addComponent(draggedComponent.type, index);
      setDraggedComponent(null);
    }
  }, [draggedComponent, addComponent]);

  // Get selected component
  const selectedComponent = selectedComponentId
    ? config.components.find(comp => comp.id === selectedComponentId)
    : null;

  return (
    <div className={cn('flex h-full', className)}>
      {/* Component Palette */}
      <div className="w-64 border-r border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-medium text-slate-900 mb-4">Components</h3>
        <div className="space-y-2">
          {COMPONENT_PALETTE.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.type}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                className="flex items-center p-3 bg-white border border-slate-200 rounded-lg cursor-grab hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <Icon className="w-5 h-5 text-slate-600 mr-3" />
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex">
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-2xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-lg min-h-96">
              {config.components.length === 0 ? (
                <div className="flex items-center justify-center h-96 text-center">
                  <div>
                    <PlusIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">
                      Start Building Your Template
                    </h3>
                    <p className="text-slate-600">
                      Drag components from the palette to begin creating your template.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  {config.components.map((component, index) => (
                    <div key={component.id}>
                      {/* Drop zone above component */}
                      <div
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnter={handleDragEnter}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index)}
                        className={cn(
                          'h-2 transition-all',
                          dragOverIndex === index ? 'bg-blue-200 h-8' : 'hover:bg-slate-100'
                        )}
                      />

                      {/* Component */}
                      <ComponentRenderer
                        component={component}
                        isSelected={selectedComponentId === component.id}
                        onClick={() => setSelectedComponentId(component.id)}
                        onMoveUp={() => moveComponent(component.id, 'up')}
                        onMoveDown={() => moveComponent(component.id, 'down')}
                        onRemove={() => removeComponent(component.id)}
                        canMoveUp={index > 0}
                        canMoveDown={index < config.components.length - 1}
                        snippets={snippets}
                      />
                    </div>
                  ))}

                  {/* Drop zone at the end */}
                  <div
                    onDragOver={(e) => handleDragOver(e, config.components.length)}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, config.components.length)}
                    className={cn(
                      'h-2 transition-all',
                      dragOverIndex === config.components.length ? 'bg-blue-200 h-8' : 'hover:bg-slate-100'
                    )}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Properties Panel */}
        <div className="w-80 border-l border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-medium text-slate-900 mb-4">Properties</h3>
          {selectedComponent ? (
            <ComponentProperties
              component={selectedComponent}
              onChange={(property, value) => updateComponentProperty(selectedComponent.id, property, value)}
              snippets={snippets}
            />
          ) : (
            <div className="text-center text-slate-500 mt-8">
              <Cog6ToothIcon className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">Select a component to edit its properties</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Component Renderer
interface ComponentRendererProps {
  component: VisualComponent;
  isSelected: boolean;
  onClick: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  snippets: Snippet[];
}

const ComponentRenderer: React.FC<ComponentRendererProps> = ({
  component,
  isSelected,
  onClick,
  onMoveUp,
  onMoveDown,
  onRemove,
  canMoveUp,
  canMoveDown,
  snippets
}) => {
  const renderComponent = () => {
    switch (component.type) {
      case 'text':
        return (
          <div
            style={{
              fontSize: component.properties.fontSize,
              color: component.properties.color,
              textAlign: component.properties.textAlign,
              fontWeight: component.properties.fontWeight,
              marginBottom: component.properties.marginBottom
            }}
          >
            {component.properties.content || 'Enter your text here...'}
          </div>
        );

      case 'image':
        return (
          <div style={{ marginBottom: component.properties.marginBottom }}>
            {component.properties.src ? (
              <img
                src={component.properties.src}
                alt={component.properties.alt}
                style={{
                  width: component.properties.width,
                  height: component.properties.height,
                  maxWidth: '100%'
                }}
              />
            ) : (
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                <PhotoIcon className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Add image URL in properties</p>
              </div>
            )}
          </div>
        );

      case 'button':
        return (
          <div style={{ marginBottom: component.properties.marginBottom, textAlign: component.properties.textAlign }}>
            <a
              href={component.properties.href}
              style={{
                display: 'inline-block',
                backgroundColor: component.properties.backgroundColor,
                color: component.properties.color,
                padding: component.properties.padding,
                borderRadius: component.properties.borderRadius,
                textDecoration: 'none',
                fontWeight: '500'
              }}
            >
              {component.properties.text || 'Click Here'}
            </a>
          </div>
        );

      case 'snippet':
        const snippet = snippets.find(s => s.id === component.properties.snippetId);
        return (
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
            <div className="flex items-center mb-2">
              <CodeBracketSquareIcon className="w-4 h-4 text-slate-600 mr-2" />
              <span className="text-sm font-medium text-slate-700">
                {snippet ? snippet.name : 'Select a snippet'}
              </span>
            </div>
            {snippet && (
              <div className="text-xs text-slate-500">
                {snippet.description || 'No description'}
              </div>
            )}
          </div>
        );

      default:
        return <div>Unknown component type</div>;
    }
  };

  return (
    <div
      className={cn(
        'relative group cursor-pointer transition-all',
        isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : 'hover:ring-1 hover:ring-slate-300'
      )}
      onClick={onClick}
    >
      {renderComponent()}

      {/* Component Controls */}
      {isSelected && (
        <div className="absolute -top-2 -right-2 flex items-center space-x-1 bg-white border border-slate-200 rounded-lg shadow-sm p-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp();
            }}
            disabled={!canMoveUp}
            className="w-6 h-6 p-0"
          >
            <ArrowUpIcon className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            disabled={!canMoveDown}
            className="w-6 h-6 p-0"
          >
            <ArrowDownIcon className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="w-6 h-6 p-0 text-red-600 hover:text-red-700"
          >
            <TrashIcon className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
};

// Component Properties Panel
interface ComponentPropertiesProps {
  component: VisualComponent;
  onChange: (property: string, value: any) => void;
  snippets: Snippet[];
}

const ComponentProperties: React.FC<ComponentPropertiesProps> = ({
  component,
  onChange,
  snippets
}) => {
  const renderProperties = () => {
    switch (component.type) {
      case 'text':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Content</label>
              <TextArea
                value={component.properties.content}
                onChange={(e) => onChange('content', e.target.value)}
                rows={3}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Font Size</label>
              <Input
                value={component.properties.fontSize}
                onChange={(e) => onChange('fontSize', e.target.value)}
                placeholder="16px"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Color</label>
              <Input
                type="color"
                value={component.properties.color}
                onChange={(e) => onChange('color', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Text Align</label>
              <Select
                value={component.properties.textAlign}
                onChange={(e) => onChange('textAlign', e.target.value)}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' }
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Font Weight</label>
              <Select
                value={component.properties.fontWeight}
                onChange={(e) => onChange('fontWeight', e.target.value)}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'bold', label: 'Bold' },
                  { value: '500', label: 'Medium' }
                ]}
              />
            </div>
          </div>
        );

      case 'image':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Image URL</label>
              <Input
                value={component.properties.src}
                onChange={(e) => onChange('src', e.target.value)}
                placeholder="https://example.com/image.jpg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Alt Text</label>
              <Input
                value={component.properties.alt}
                onChange={(e) => onChange('alt', e.target.value)}
                placeholder="Image description"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Width</label>
              <Input
                value={component.properties.width}
                onChange={(e) => onChange('width', e.target.value)}
                placeholder="100%"
              />
            </div>
          </div>
        );

      case 'button':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Button Text</label>
              <Input
                value={component.properties.text}
                onChange={(e) => onChange('text', e.target.value)}
                placeholder="Click Here"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Link URL</label>
              <Input
                value={component.properties.href}
                onChange={(e) => onChange('href', e.target.value)}
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Background Color</label>
              <Input
                type="color"
                value={component.properties.backgroundColor}
                onChange={(e) => onChange('backgroundColor', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Text Color</label>
              <Input
                type="color"
                value={component.properties.color}
                onChange={(e) => onChange('color', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Text Align</label>
              <Select
                value={component.properties.textAlign}
                onChange={(e) => onChange('textAlign', e.target.value)}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' }
                ]}
              />
            </div>
          </div>
        );

      case 'snippet':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Snippet</label>
              <Select
                value={component.properties.snippetId}
                onChange={(e) => onChange('snippetId', e.target.value)}
                options={[
                  { value: '', label: 'Select a snippet...' },
                  ...snippets.map(snippet => ({
                    value: snippet.id,
                    label: snippet.name
                  }))
                ]}
              />
            </div>
            {component.properties.snippetId && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Parameters</label>
                <SnippetParameters
                  snippetId={component.properties.snippetId}
                  parameters={component.properties.parameters}
                  onChange={(params) => onChange('parameters', params)}
                  snippets={snippets}
                />
              </div>
            )}
          </div>
        );

      default:
        return <div>No properties available</div>;
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4">
          <h4 className="text-sm font-medium text-slate-900 capitalize">
            {component.type} Properties
          </h4>
        </div>
        {renderProperties()}
      </CardContent>
    </Card>
  );
};

// Snippet Parameters Component
interface SnippetParametersProps {
  snippetId: string;
  parameters: Record<string, any>;
  onChange: (parameters: Record<string, any>) => void;
  snippets: Snippet[];
}

const SnippetParameters: React.FC<SnippetParametersProps> = ({
  snippetId,
  parameters,
  onChange,
  snippets
}) => {
  const snippet = snippets.find(s => s.id === snippetId);

  if (!snippet || !snippet.parameters || snippet.parameters.length === 0) {
    return (
      <div className="text-sm text-slate-500">
        This snippet has no configurable parameters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {snippet.parameters.map((param) => (
        <div key={param.name}>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {param.name}
            {param.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {param.type === 'boolean' ? (
            <Select
              value={parameters[param.name] !== undefined ? String(parameters[param.name]) : String(param.defaultValue || false)}
              onChange={(e) => onChange({
                ...parameters,
                [param.name]: e.target.value === 'true'
              })}
              options={[
                { value: 'true', label: 'True' },
                { value: 'false', label: 'False' }
              ]}
            />
          ) : param.type === 'number' ? (
            <Input
              type="number"
              value={parameters[param.name] !== undefined ? parameters[param.name] : param.defaultValue || ''}
              onChange={(e) => onChange({
                ...parameters,
                [param.name]: parseFloat(e.target.value) || 0
              })}
              placeholder={param.description}
            />
          ) : (
            <Input
              value={parameters[param.name] !== undefined ? parameters[param.name] : param.defaultValue || ''}
              onChange={(e) => onChange({
                ...parameters,
                [param.name]: e.target.value
              })}
              placeholder={param.description}
            />
          )}
        </div>
      ))}
    </div>
  );
};
