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
  CodeBracketSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Select } from '@/components/ui/Select';
import { VariableInput } from './VariableInput';
import { VariableTextArea } from './VariableTextArea';
import { SnippetPalette } from './SnippetPalette';
import { ParameterConfigDialog } from './ParameterConfigDialog';
import { EnhancedDropZones } from './EnhancedDropZones';
import { DropZoneComponent } from './DropZoneComponent';
import { SkipLinks } from '../accessibility/SkipLinks';
import { ScreenReaderAnnouncements } from '../accessibility/ScreenReaderAnnouncements';
import { useVisualBuilderKeyboard } from '../../hooks/useVisualBuilderKeyboard';
import { useAccessibility } from '../../hooks/useAccessibility';
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
    type: 'heading',
    label: 'Heading',
    icon: DocumentTextIcon,
    defaultProperties: {
      content: 'Your Heading Here',
      fontSize: '24px',
      color: '#000000',
      textAlign: 'left',
      fontWeight: 'bold',
      marginBottom: '16px',
      level: 'h2'
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
    label: 'Button (CTA)',
    icon: LinkIcon,
    defaultProperties: {
      text: 'Click Here',
      href: '#',
      backgroundColor: '#3b82f6',
      color: '#ffffff',
      padding: '12px 24px',
      borderRadius: '6px',
      textAlign: 'center',
      marginBottom: '16px',
      display: 'table', // Better email compatibility
      margin: '0 auto' // Center the button
    }
  },
  {
    type: 'divider',
    label: 'Horizontal Rule',
    icon: () => <div className="w-4 h-0.5 bg-current" />,
    defaultProperties: {
      height: '1px',
      backgroundColor: '#e2e8f0',
      marginTop: '16px',
      marginBottom: '16px',
      width: '100%'
    }
  },
  {
    type: 'spacer',
    label: 'Spacer',
    icon: () => <div className="w-4 h-4 border border-dashed border-current" />,
    defaultProperties: {
      height: '20px',
      marginBottom: '0px'
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
  const [draggedSnippet, setDraggedSnippet] = useState<Snippet | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [showSnippetPalette, setShowSnippetPalette] = useState(false);
  const [snippetSearchQuery, setSnippetSearchQuery] = useState('');
  const [selectedSnippetForConfig, setSelectedSnippetForConfig] = useState<Snippet | null>(null);
  const [showParameterDialog, setShowParameterDialog] = useState(false);
  const [pendingSnippetIndex, setPendingSnippetIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const dragCounter = useRef(0);

  // Accessibility hooks
  const {
    announce,
    generateId: generateAccessibilityId,
    isHighContrast,
    prefersReducedMotion
  } = useAccessibility({
    announceChanges: true,
    manageFocus: true,
    detectHighContrast: true,
    respectReducedMotion: true
  });

  const {
    containerRef,
    currentContext,
    isNavigationMode,
    createSkipLinks,
    getAreaAriaAttributes,
    navigateToArea
  } = useVisualBuilderKeyboard({
    onComponentSelect: (componentId) => {
      setSelectedComponentId(componentId);
      announce(`Component ${componentId} selected`);
    },
    onDropZoneActivate: (index) => {
      // Could open component picker modal here
      announce(`Drop zone ${index + 1} activated`);
    }
  });

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

    // Announce the addition
    const position = typeof index === 'number' ? `at position ${index + 1}` : 'at the end';
    setAnnouncement(`${paletteItem.label} component added ${position}`);
  }, [config, onChange, generateId]);

  // Add snippet component
  const addSnippetComponent = useCallback((snippet: Snippet, parameters: Record<string, any>, index?: number) => {
    const newComponent: VisualComponent = {
      id: generateId(),
      type: 'snippet',
      properties: {
        snippetId: snippet.id,
        parameters: parameters
      }
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
    const componentToRemove = config.components.find(comp => comp.id === componentId);
    const componentIndex = config.components.findIndex(comp => comp.id === componentId);

    const newComponents = config.components.filter(comp => comp.id !== componentId);
    onChange({
      ...config,
      components: newComponents
    });

    if (selectedComponentId === componentId) {
      setSelectedComponentId(null);
    }

    // Announce the removal
    if (componentToRemove) {
      const componentType = COMPONENT_PALETTE.find(item => item.type === componentToRemove.type)?.label || componentToRemove.type;
      setAnnouncement(`${componentType} component removed from position ${componentIndex + 1}`);
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

    // Announce the move
    const componentType = COMPONENT_PALETTE.find(item => item.type === movedComponent.type)?.label || movedComponent.type;
    setAnnouncement(`${componentType} component moved ${direction} to position ${newIndex + 1}`);
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

  // Enhanced drag and drop handlers with improved targeting
  const handleDragStart = useCallback((e: React.DragEvent, item: ComponentPaletteItem) => {
    console.log('🚀 Drag start - component:', item.type);
    setDraggedComponent(item);
    setDraggedSnippet(null);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'component', item }));

    // Add visual feedback to the canvas
    document.body.classList.add('dragging-component');
  }, []);

  const handleDragEnd = useCallback(() => {
    console.log('🏁 Drag end - clearing dragged component');

    // Remove visual feedback
    document.body.classList.remove('dragging-component');

    // Small delay to ensure drop handler runs first
    setTimeout(() => {
      setDraggedComponent(null);
      setDraggedSnippet(null);
      setDragOverIndex(null);
      dragCounter.current = 0;
    }, 50);
  }, []);

  const handleSnippetDragStart = useCallback((snippet: Snippet) => {
    console.log('Drag start - snippet:', snippet.name);
    setDraggedSnippet(snippet);
    setDraggedComponent(null);

    // Add visual feedback to the canvas
    document.body.classList.add('dragging-snippet');
  }, []);

  const handleDragOver = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }

    // Improved targeting - only update if index actually changed
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  }, [dragOverIndex]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverIndex(null);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('📦 Drop at index:', index);

    // Remove visual feedback classes
    document.body.classList.remove('dragging-component', 'dragging-snippet');

    // Try to get data from dataTransfer first
    let componentData = null;
    try {
      const jsonData = e.dataTransfer?.getData('application/json');
      if (jsonData) {
        const parsed = JSON.parse(jsonData);
        if (parsed.type === 'component') {
          componentData = parsed.item;
        }
      }
    } catch (error) {
      console.log('Could not parse drag data, using state');
    }

    // Fallback to state if no data transfer
    const itemToAdd = componentData || draggedComponent;

    if (itemToAdd) {
      console.log('✅ Adding component:', itemToAdd.type, 'at index:', index);
      addComponent(itemToAdd.type, index);
    } else if (draggedSnippet) {
      console.log('✅ Adding snippet:', draggedSnippet.name);
      if (draggedSnippet.parameters && draggedSnippet.parameters.length > 0) {
        setSelectedSnippetForConfig(draggedSnippet);
        setPendingSnippetIndex(index);
        setShowParameterDialog(true);
      } else {
        addSnippetComponent(draggedSnippet, {}, index);
      }
    } else {
      console.log('❌ No component or snippet to add');
    }

    // Reset drag over state immediately
    setDragOverIndex(null);
    dragCounter.current = 0;
  }, [draggedComponent, draggedSnippet, addComponent, addSnippetComponent]);

  // Snippet parameter configuration handlers
  const handleParameterDialogConfirm = useCallback((parameters: Record<string, any>) => {
    if (selectedSnippetForConfig && pendingSnippetIndex !== null) {
      addSnippetComponent(selectedSnippetForConfig, parameters, pendingSnippetIndex);
    }
    setSelectedSnippetForConfig(null);
    setPendingSnippetIndex(null);
    setShowParameterDialog(false);
  }, [selectedSnippetForConfig, pendingSnippetIndex, addSnippetComponent]);

  const handleParameterDialogCancel = useCallback(() => {
    setSelectedSnippetForConfig(null);
    setPendingSnippetIndex(null);
    setShowParameterDialog(false);
  }, []);

  const handleToggleSnippetPalette = useCallback(() => {
    setShowSnippetPalette(prev => !prev);
  }, []);

  // Get selected component
  const selectedComponent = selectedComponentId
    ? config.components.find(comp => comp.id === selectedComponentId)
    : null;

  // Create skip links for keyboard navigation
  const skipLinks = createSkipLinks();

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full', className)}
      {...getAreaAriaAttributes('canvas')}
    >
      {/* Skip Links for Keyboard Navigation */}
      <SkipLinks links={skipLinks} />

      {/* Screen Reader Announcements */}
      <ScreenReaderAnnouncements
        message={announcement}
        priority="polite"
        clearAfterAnnouncement={true}
      />

      {/* Component Palette */}
      <div
        id="component-palette"
        className="w-64 border-r border-slate-200 bg-slate-50 flex flex-col"
        {...getAreaAriaAttributes('palette')}
      >
        {/* Standard Components */}
        <div className="p-4 border-b border-slate-200">
          <h3
            id="components-heading"
            className="text-sm font-medium text-slate-900 mb-4"
          >
            Components
          </h3>
          <div
            className="space-y-2"
            role="group"
            aria-labelledby="components-heading"
            aria-describedby="components-help"
          >
            {COMPONENT_PALETTE.filter(item => item.type !== 'snippet').map((item, index) => {
              const Icon = item.icon;
              const isSelected = currentContext.area === 'palette' && currentContext.index === index;

              return (
                <div
                  key={item.type}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDragEnd={handleDragEnd}
                  onClick={() => {
                    addComponent(item.type);
                    setAnnouncement(`${item.label} component added to template`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      addComponent(item.type);
                      setAnnouncement(`${item.label} component added to template`);
                    }
                  }}
                  className={cn(
                    "flex items-center p-3 bg-white border border-slate-200 rounded-lg cursor-grab hover:border-blue-300 hover:shadow-sm transition-all select-none",
                    draggedComponent?.type === item.type && "opacity-50 scale-95",
                    isSelected && "ring-2 ring-blue-500 ring-offset-2",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  )}
                  tabIndex={0}
                  role="button"
                  aria-label={`Add ${item.label} component to template. Draggable.`}
                  aria-describedby={`component-${item.type}-desc`}
                >
                  <Icon
                    className="w-5 h-5 text-slate-600 mr-3"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-slate-700">{item.label}</span>
                  <div id={`component-${item.type}-desc`} className="sr-only">
                    Drag this component to the canvas or press Enter to add it to the end of your template
                  </div>
                </div>
              );
            })}
          </div>
          <div id="components-help" className="sr-only">
            Drag components to the canvas to add them to your template, or click to add them at the end
          </div>
        </div>

        {/* Snippet Palette */}
        <div className="flex-1 flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-900">Snippets</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleSnippetPalette}
                className="p-1"
              >
                {showSnippetPalette ? (
                  <ChevronDownIcon className="w-4 h-4" />
                ) : (
                  <ChevronRightIcon className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {showSnippetPalette && (
            <div className="flex-1">
              <SnippetPalette
                snippets={snippets}
                onDragStart={handleSnippetDragStart}
                searchQuery={snippetSearchQuery}
                onSearchChange={setSnippetSearchQuery}
              />
            </div>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex">
        <main
          id="template-canvas"
          className="flex-1 p-6 overflow-auto"
          onClick={(e) => {
            // Deselect component when clicking on empty canvas area
            if (e.target === e.currentTarget) {
              setSelectedComponentId(null);
              setAnnouncement('Component deselected');
            }
          }}
          {...getAreaAriaAttributes('canvas')}
          aria-label="Template canvas - build your email template here"
          aria-describedby="canvas-help"
        >
          <div className="max-w-2xl mx-auto">
            <div
              className="bg-white border border-slate-200 rounded-lg min-h-96"
              onClick={(e) => {
                // Deselect component when clicking on empty canvas area
                if (e.target === e.currentTarget) {
                  setSelectedComponentId(null);
                }
              }}
            >
              {config.components.length === 0 ? (
                <div className="p-6">
                  <EnhancedDropZones
                    componentCount={0}
                    onDrop={handleDrop}
                    draggedItem={draggedComponent || draggedSnippet}
                    className={cn(
                      'transition-all duration-200',
                      (draggedComponent || draggedSnippet) && 'enhanced-drop-zones-active'
                    )}
                  />
                </div>
              ) : (
                <div
                  className="p-6 space-y-4"
                  onClick={(e) => {
                    // Deselect component when clicking on empty canvas area
                    if (e.target === e.currentTarget) {
                      setSelectedComponentId(null);
                    }
                  }}
                >
                  {config.components.map((component, index) => (
                    <div key={component.id} className="relative">
                      {/* Enhanced drop zone above component */}
                      <DropZoneComponent
                        index={index}
                        isActive={dragOverIndex === index}
                        isHovered={false}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        size="small"
                        showLabel={dragOverIndex === index && !!(draggedComponent || draggedSnippet)}
                        className={cn(
                          'my-2 enhanced-drop-zone-item',
                          (draggedComponent || draggedSnippet) && 'opacity-100',
                          !(draggedComponent || draggedSnippet) && 'opacity-0 pointer-events-none'
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

                  {/* Enhanced drop zone at the end */}
                  <DropZoneComponent
                    index={config.components.length}
                    isActive={dragOverIndex === config.components.length}
                    isHovered={false}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    size="medium"
                    showLabel={dragOverIndex === config.components.length && !!(draggedComponent || draggedSnippet)}
                    className={cn(
                      'my-4 enhanced-drop-zone-item',
                      (draggedComponent || draggedSnippet) && 'opacity-100',
                      !(draggedComponent || draggedSnippet) && 'opacity-0 pointer-events-none'
                    )}
                  />
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Properties Panel */}
        <aside
          id="properties-panel"
          className="w-80 border-l border-slate-200 bg-slate-50 p-4"
          {...getAreaAriaAttributes('properties')}
          aria-label="Properties panel - edit component settings"
        >
          <h3
            id="properties-heading"
            className="text-sm font-medium text-slate-900 mb-4"
          >
            Properties
          </h3>
          {selectedComponent ? (
            <div
              role="form"
              aria-labelledby="properties-heading"
              aria-describedby="properties-help"
            >
              <ComponentProperties
                component={selectedComponent}
                onChange={(property, value) => {
                  updateComponentProperty(selectedComponent.id, property, value);
                  setAnnouncement(`${property} property updated`);
                }}
                snippets={snippets}
              />
              <div id="properties-help" className="sr-only">
                Edit the properties of the selected component. Use Tab to navigate between fields.
              </div>
            </div>
          ) : (
            <div
              className="text-center text-slate-500 mt-8"
              role="status"
              aria-live="polite"
            >
              <Cog6ToothIcon
                className="w-8 h-8 mx-auto mb-2"
                aria-hidden="true"
              />
              <p className="text-sm">Select a component to edit its properties</p>
            </div>
          )}
        </aside>

        {/* Canvas Help Text */}
        <div id="canvas-help" className="sr-only">
          This is your template canvas. Components you add will appear here.
          Use drag and drop or keyboard navigation to add and arrange components.
        </div>
      </div>

      {/* Parameter Configuration Dialog */}
      <ParameterConfigDialog
        snippet={selectedSnippetForConfig}
        isOpen={showParameterDialog}
        onConfirm={handleParameterDialogConfirm}
        onCancel={handleParameterDialogCancel}
      />
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

      case 'heading':
        const HeadingTag = component.properties.level || 'h2';
        return (
          <HeadingTag
            style={{
              fontSize: component.properties.fontSize,
              color: component.properties.color,
              textAlign: component.properties.textAlign,
              fontWeight: component.properties.fontWeight,
              marginBottom: component.properties.marginBottom,
              marginTop: 0
            }}
          >
            {component.properties.content || 'Your Heading Here'}
          </HeadingTag>
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
            {/* Email-optimized button using table structure */}
            <table cellPadding="0" cellSpacing="0" style={{ margin: component.properties.textAlign === 'center' ? '0 auto' : '0' }}>
              <tr>
                <td
                  style={{
                    backgroundColor: component.properties.backgroundColor,
                    borderRadius: component.properties.borderRadius,
                    padding: component.properties.padding
                  }}
                >
                  <a
                    href={component.properties.href}
                    style={{
                      color: component.properties.color,
                      textDecoration: 'none',
                      fontWeight: '500',
                      display: 'block'
                    }}
                  >
                    {component.properties.text || 'Click Here'}
                  </a>
                </td>
              </tr>
            </table>
          </div>
        );

      case 'divider':
        return (
          <div style={{ marginTop: component.properties.marginTop, marginBottom: component.properties.marginBottom }}>
            <hr
              style={{
                height: component.properties.height,
                backgroundColor: component.properties.backgroundColor,
                border: 'none',
                width: component.properties.width
              }}
            />
          </div>
        );

      case 'spacer':
        return (
          <div
            style={{
              height: component.properties.height,
              marginBottom: component.properties.marginBottom
            }}
          />
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
      onClick={(e) => {
        e.stopPropagation(); // Prevent event from bubbling up to canvas
        onClick();
      }}
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
              <VariableTextArea
                value={component.properties.content}
                onChange={(e) => onChange('content', e.target.value)}
                rows={3}
                contextType="text"
                placeholder="Enter text content or use variables"
                onVariableInsert={(variable) => {
                  const currentValue = component.properties.content || '';
                  const variableSyntax = `{{${variable.path}}}`;
                  onChange('content', currentValue + variableSyntax);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Font Size</label>
              <VariableInput
                value={component.properties.fontSize}
                onChange={(e) => onChange('fontSize', e.target.value)}
                placeholder="16px"
                contextType="text"
                onVariableInsert={(variable) => {
                  onChange('fontSize', `{{${variable.path}}}`);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={component.properties.color || '#000000'}
                  onChange={(e) => onChange('color', e.target.value)}
                  className="h-10 w-20 rounded border border-slate-300"
                />
                <VariableInput
                  value={component.properties.color}
                  onChange={(e) => onChange('color', e.target.value)}
                  placeholder="#000000"
                  contextType="text"
                  className="flex-1"
                  onVariableInsert={(variable) => {
                    onChange('color', `{{${variable.path}}}`);
                  }}
                />
              </div>
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

      case 'heading':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Heading Text</label>
              <VariableInput
                value={component.properties.content}
                onChange={(e) => onChange('content', e.target.value)}
                placeholder="Your Heading Here"
                contextType="heading"
                onVariableInsert={(variable) => {
                  const currentValue = component.properties.content || '';
                  const variableSyntax = `{{${variable.path}}}`;
                  onChange('content', currentValue + variableSyntax);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Heading Level</label>
              <Select
                value={component.properties.level}
                onChange={(e) => onChange('level', e.target.value)}
                options={[
                  { value: 'h1', label: 'H1 (Largest)' },
                  { value: 'h2', label: 'H2 (Large)' },
                  { value: 'h3', label: 'H3 (Medium)' },
                  { value: 'h4', label: 'H4 (Small)' }
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Font Size</label>
              <VariableInput
                value={component.properties.fontSize}
                onChange={(e) => onChange('fontSize', e.target.value)}
                placeholder="24px"
                contextType="heading"
                onVariableInsert={(variable) => {
                  onChange('fontSize', `{{${variable.path}}}`);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={component.properties.color || '#000000'}
                  onChange={(e) => onChange('color', e.target.value)}
                  className="h-10 w-20 rounded border border-slate-300"
                />
                <VariableInput
                  value={component.properties.color}
                  onChange={(e) => onChange('color', e.target.value)}
                  placeholder="#000000"
                  contextType="heading"
                  className="flex-1"
                  onVariableInsert={(variable) => {
                    onChange('color', `{{${variable.path}}}`);
                  }}
                />
              </div>
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

      case 'image':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Image URL</label>
              <VariableInput
                type="url"
                value={component.properties.src}
                onChange={(e) => onChange('src', e.target.value)}
                placeholder="https://example.com/image.jpg"
                contextType="image"
                onVariableInsert={(variable) => {
                  onChange('src', `{{${variable.path}}}`);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Alt Text</label>
              <VariableInput
                value={component.properties.alt}
                onChange={(e) => onChange('alt', e.target.value)}
                placeholder="Image description"
                contextType="image"
                onVariableInsert={(variable) => {
                  const currentValue = component.properties.alt || '';
                  const variableSyntax = `{{${variable.path}}}`;
                  onChange('alt', currentValue + variableSyntax);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Width</label>
              <VariableInput
                value={component.properties.width}
                onChange={(e) => onChange('width', e.target.value)}
                placeholder="100%"
                contextType="image"
                onVariableInsert={(variable) => {
                  onChange('width', `{{${variable.path}}}`);
                }}
              />
            </div>
          </div>
        );

      case 'button':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Button Text</label>
              <VariableInput
                value={component.properties.text}
                onChange={(e) => onChange('text', e.target.value)}
                placeholder="Click Here"
                contextType="button"
                onVariableInsert={(variable) => {
                  const currentValue = component.properties.text || '';
                  const variableSyntax = `{{${variable.path}}}`;
                  onChange('text', currentValue + variableSyntax);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Link URL</label>
              <VariableInput
                type="url"
                value={component.properties.href}
                onChange={(e) => onChange('href', e.target.value)}
                placeholder="https://example.com"
                contextType="button"
                onVariableInsert={(variable) => {
                  onChange('href', `{{${variable.path}}}`);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Background Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={component.properties.backgroundColor || '#3B82F6'}
                  onChange={(e) => onChange('backgroundColor', e.target.value)}
                  className="h-10 w-20 rounded border border-slate-300"
                />
                <VariableInput
                  value={component.properties.backgroundColor}
                  onChange={(e) => onChange('backgroundColor', e.target.value)}
                  placeholder="#3B82F6"
                  contextType="button"
                  className="flex-1"
                  onVariableInsert={(variable) => {
                    onChange('backgroundColor', `{{${variable.path}}}`);
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Text Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={component.properties.color || '#FFFFFF'}
                  onChange={(e) => onChange('color', e.target.value)}
                  className="h-10 w-20 rounded border border-slate-300"
                />
                <VariableInput
                  value={component.properties.color}
                  onChange={(e) => onChange('color', e.target.value)}
                  placeholder="#FFFFFF"
                  contextType="button"
                  className="flex-1"
                  onVariableInsert={(variable) => {
                    onChange('color', `{{${variable.path}}}`);
                  }}
                />
              </div>
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

      case 'divider':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Line Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={component.properties.backgroundColor || '#E5E7EB'}
                  onChange={(e) => onChange('backgroundColor', e.target.value)}
                  className="h-10 w-20 rounded border border-slate-300"
                />
                <VariableInput
                  value={component.properties.backgroundColor}
                  onChange={(e) => onChange('backgroundColor', e.target.value)}
                  placeholder="#E5E7EB"
                  contextType="divider"
                  className="flex-1"
                  onVariableInsert={(variable) => {
                    onChange('backgroundColor', `{{${variable.path}}}`);
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Line Height</label>
              <VariableInput
                value={component.properties.height}
                onChange={(e) => onChange('height', e.target.value)}
                placeholder="1px"
                contextType="divider"
                onVariableInsert={(variable) => {
                  onChange('height', `{{${variable.path}}}`);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Top Margin</label>
              <VariableInput
                value={component.properties.marginTop}
                onChange={(e) => onChange('marginTop', e.target.value)}
                placeholder="16px"
                contextType="divider"
                onVariableInsert={(variable) => {
                  onChange('marginTop', `{{${variable.path}}}`);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Bottom Margin</label>
              <VariableInput
                value={component.properties.marginBottom}
                onChange={(e) => onChange('marginBottom', e.target.value)}
                placeholder="16px"
                contextType="divider"
                onVariableInsert={(variable) => {
                  onChange('marginBottom', `{{${variable.path}}}`);
                }}
              />
            </div>
          </div>
        );

      case 'spacer':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Height</label>
              <VariableInput
                value={component.properties.height}
                onChange={(e) => onChange('height', e.target.value)}
                placeholder="20px"
                contextType="spacer"
                onVariableInsert={(variable) => {
                  onChange('height', `{{${variable.path}}}`);
                }}
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
      <div className="text-sm text-slate-500 p-3 bg-slate-50 rounded-lg">
        This snippet has no configurable parameters.
      </div>
    );
  }

  const handleParameterChange = (paramName: string, value: any) => {
    onChange({
      ...parameters,
      [paramName]: value
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600 mb-3">
        Configure the parameters for this snippet:
      </div>

      {snippet.parameters.map((param) => (
        <div key={param.name} className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            {param.name}
            {param.required && <span className="text-red-500 ml-1">*</span>}
          </label>

          {param.description && (
            <p className="text-xs text-slate-500">{param.description}</p>
          )}

          {param.type === 'boolean' ? (
            <Select
              value={parameters[param.name] !== undefined ? String(parameters[param.name]) : String(param.defaultValue || false)}
              onChange={(e) => handleParameterChange(param.name, e.target.value === 'true')}
              options={[
                { value: 'true', label: 'True' },
                { value: 'false', label: 'False' }
              ]}
            />
          ) : param.type === 'select' && param.options ? (
            <Select
              value={parameters[param.name] !== undefined ? parameters[param.name] : param.defaultValue || ''}
              onChange={(e) => handleParameterChange(param.name, e.target.value)}
              options={[
                { value: '', label: 'Select an option...' },
                ...param.options.map(option => ({ value: option, label: option }))
              ]}
            />
          ) : param.type === 'textarea' ? (
            <VariableTextArea
              value={parameters[param.name] !== undefined ? parameters[param.name] : param.defaultValue || ''}
              onChange={(e) => handleParameterChange(param.name, e.target.value)}
              placeholder={param.description || `Enter ${param.name}...`}
              rows={3}
              contextType="text"
              onVariableInsert={(variable) => {
                const currentValue = parameters[param.name] || param.defaultValue || '';
                const variableSyntax = `{{${variable.path}}}`;
                handleParameterChange(param.name, currentValue + variableSyntax);
              }}
            />
          ) : param.type === 'number' ? (
            <VariableInput
              type="number"
              value={parameters[param.name] !== undefined ? parameters[param.name] : param.defaultValue || ''}
              onChange={(e) => {
                const numValue = e.target.value === '' ? undefined : parseFloat(e.target.value);
                handleParameterChange(param.name, numValue);
              }}
              placeholder={param.description || `Enter ${param.name}...`}
              min={param.validation?.min}
              max={param.validation?.max}
              contextType="text"
              onVariableInsert={(variable) => {
                handleParameterChange(param.name, `{{${variable.path}}}`);
              }}
            />
          ) : param.type === 'url' ? (
            <VariableInput
              type="url"
              value={parameters[param.name] !== undefined ? parameters[param.name] : param.defaultValue || ''}
              onChange={(e) => handleParameterChange(param.name, e.target.value)}
              placeholder={param.description || `Enter ${param.name}...`}
              pattern={param.validation?.pattern}
              contextType="link"
              onVariableInsert={(variable) => {
                handleParameterChange(param.name, `{{${variable.path}}}`);
              }}
            />
          ) : (
            <VariableInput
              value={parameters[param.name] !== undefined ? parameters[param.name] : param.defaultValue || ''}
              onChange={(e) => handleParameterChange(param.name, e.target.value)}
              placeholder={param.description || `Enter ${param.name}...`}
              pattern={param.validation?.pattern}
              contextType="text"
              onVariableInsert={(variable) => {
                const currentValue = parameters[param.name] || param.defaultValue || '';
                const variableSyntax = `{{${variable.path}}}`;
                handleParameterChange(param.name, currentValue + variableSyntax);
              }}
            />
          )}

          {/* Validation message */}
          {param.validation?.message && param.required && !parameters[param.name] && (
            <p className="text-xs text-red-500">{param.validation.message}</p>
          )}
        </div>
      ))}
    </div>
  );
};
