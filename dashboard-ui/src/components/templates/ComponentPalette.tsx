import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  DocumentTextIcon,
  PaintBrushIcon,
  PlusIcon,
  BeakerIcon,
  CodeBracketIcon
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { cn } from '@/utils/cn';

interface Component {
  type: 'heading' | 'text' | 'image' | 'button' | 'divider';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface ComponentPaletteProps {
  tab: 'build' | 'test' | 'email-preview';
  onTabChange: (tab: 'build' | 'test' | 'email-preview') => void;
  editMode: 'visual' | 'code';
  onEditModeChange: (mode: 'visual' | 'code') => void;
  testData: string;
  onTestDataChange: (data: string) => void;
  testError?: string | null;
  onComponentDragStart: (e: React.DragEvent, componentType: string) => void;
  onComponentDragEnd: () => void;
  onComponentClick: (e: React.MouseEvent, componentType: Component['type']) => void;
  onPreview: () => void;
  onSave: () => void;
  draggedComponent: string | null;
  templateName?: string;
  onTemplateNameChange?: (name: string) => void;
  templateDescription?: string;
  onTemplateDescriptionChange?: (description: string) => void;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
  lastSaved?: Date | null;
  lastAutoSaved?: Date | null;
  className?: string;
}

const COMPONENTS: Component[] = [
  { type: 'heading', label: 'Heading', icon: DocumentTextIcon },
  { type: 'text', label: 'Text', icon: DocumentTextIcon },
  { type: 'image', label: 'Image', icon: PaintBrushIcon },
  { type: 'button', label: 'Button', icon: PlusIcon },
  { type: 'divider', label: 'Divider', icon: PaintBrushIcon }
];

const MIN_WIDTH = 64; // Collapsed width (icon-only mode)
const MAX_WIDTH = 400; // Maximum sidebar width
const DEFAULT_WIDTH = 256; // Default expanded width
const COLLAPSE_THRESHOLD = 120; // Width below which sidebar collapses to icon-only

export const ComponentPalette: React.FC<ComponentPaletteProps> = ({
  tab,
  onTabChange,
  editMode,
  onEditModeChange,
  testData,
  onTestDataChange,
  testError,
  onComponentDragStart,
  onComponentDragEnd,
  onComponentClick,
  onPreview,
  onSave,
  draggedComponent,
  templateName = '',
  onTemplateNameChange,
  templateDescription = '',
  onTemplateDescriptionChange,
  hasUnsavedChanges = false,
  isSaving = false,
  lastSaved,
  lastAutoSaved,
  className
}) => {
  const [width, setWidth] = useState(() => {
    // Load saved width from localStorage
    const saved = localStorage.getItem('template-builder-sidebar-width');
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(width <= COLLAPSE_THRESHOLD);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragImageRef = useRef<HTMLDivElement>(null);

  // Save width to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('template-builder-sidebar-width', width.toString());
  }, [width]);

  // Update collapsed state when width changes
  useEffect(() => {
    setIsCollapsed(width <= COLLAPSE_THRESHOLD);
  }, [width]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [width]);

  const toggleCollapse = useCallback(() => {
    if (isCollapsed) {
      // Expand to default width
      setWidth(DEFAULT_WIDTH);
    } else {
      // Collapse to minimum width
      setWidth(MIN_WIDTH);
    }
  }, [isCollapsed]);

  const handleComponentDragStart = useCallback((e: React.DragEvent, componentType: string) => {
    // Create custom drag image for better visual feedback
    if (dragImageRef.current) {
      const dragImage = dragImageRef.current.cloneNode(true) as HTMLElement;
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      dragImage.style.left = '-1000px';
      dragImage.style.opacity = '0.8';
      dragImage.style.transform = 'rotate(2deg)';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 50, 25);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }

    onComponentDragStart(e, componentType);
  }, [onComponentDragStart]);

  return (
    <div
      ref={sidebarRef}
      className={cn(
        "bg-white border-r flex flex-col transition-all duration-300 relative",
        isResizing && "select-none",
        className
      )}
      style={{ width: `${width}px` }}
    >
      {/* Resize Handle */}
      <div
        className={cn(
          "absolute top-0 right-0 w-1 h-full cursor-col-resize bg-transparent hover:bg-blue-300 transition-colors z-10",
          isResizing && "bg-blue-400"
        )}
        onMouseDown={handleMouseDown}
        title="Drag to resize sidebar"
      />

      {/* Sidebar Header with Toggle */}
      <div className="border-b p-2 flex items-center justify-between">
        {!isCollapsed && <span className="font-medium text-sm">Template Builder</span>}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleCollapse}
          className="p-1"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          )}
        </Button>
      </div>

      {/* Expanded Sidebar Content */}
      {!isCollapsed && (
        <>
          {/* Tabs */}
          <div className="border-b">
            <div className="flex">
              <button
                className={cn('flex-1 px-3 py-3 text-xs font-medium border-b-2',
                  tab === 'build' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500')}
                onClick={() => onTabChange('build')}
              >
                <PaintBrushIcon className="w-3 h-3 mr-1 inline" />
                Build
              </button>
              <button
                className={cn('flex-1 px-3 py-3 text-xs font-medium border-b-2',
                  tab === 'test' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500')}
                onClick={() => onTabChange('test')}
              >
                <BeakerIcon className="w-3 h-3 mr-1 inline" />
                Test
              </button>
              <button
                className={cn('flex-1 px-3 py-3 text-xs font-medium border-b-2',
                  tab === 'email-preview' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500')}
                onClick={() => onTabChange('email-preview')}
              >
                📧
                Email
              </button>

            </div>
          </div>

          {/* Edit Mode Toggle (only show in build tab) */}
          {tab === 'build' && (
            <div className="border-b bg-gray-50">
              <div className="flex p-2">
                <button
                  className={cn('flex-1 px-3 py-2 text-xs font-medium rounded-md mr-1',
                    editMode === 'visual' ? 'bg-white text-blue-600 shadow-sm border border-blue-200' : 'text-gray-600 hover:text-gray-800')}
                  onClick={() => onEditModeChange('visual')}
                >
                  <PaintBrushIcon className="w-3 h-3 mr-1 inline" />
                  Visual
                </button>
                <button
                  className={cn('flex-1 px-3 py-2 text-xs font-medium rounded-md ml-1',
                    editMode === 'code' ? 'bg-white text-blue-600 shadow-sm border border-blue-200' : 'text-gray-600 hover:text-gray-800')}
                  onClick={() => onEditModeChange('code')}
                >
                  <CodeBracketIcon className="w-3 h-3 mr-1 inline" />
                  Code
                </button>
              </div>
            </div>
          )}

          {/* Tab Content */}
          <div className="flex-1 p-4 overflow-y-auto">
            {tab === 'build' ? (
              <>
                {/* Template Metadata */}
                <div className="mb-6">
                  <h3 className="font-semibold mb-4">Template Details</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name *
                      </label>
                      <input
                        type="text"
                        value={templateName}
                        onChange={(e) => onTemplateNameChange?.(e.target.value)}
                        placeholder="Enter template name..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        value={templateDescription}
                        onChange={(e) => onTemplateDescriptionChange?.(e.target.value)}
                        placeholder="Describe this template..."
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      />
                    </div>

                    {/* Save Status */}
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <div className="flex flex-col space-y-1">
                        <div className="flex items-center space-x-2">
                          {hasUnsavedChanges && (
                            <span className="text-amber-600 font-medium">Unsaved changes</span>
                          )}
                          {isSaving && (
                            <span className="text-blue-600 font-medium">Saving...</span>
                          )}
                          {lastSaved && !hasUnsavedChanges && !isSaving && (
                            <span className="text-green-600 font-medium">
                              Saved {lastSaved.toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                        {lastAutoSaved && (
                          <div className="text-xs text-gray-500">
                            Auto-saved {lastAutoSaved.toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {editMode === 'visual' ? (
                  <>
                    <h3 className="font-semibold mb-4">Components</h3>
                    <div className="space-y-2 mb-6">
                      {COMPONENTS.map(({ type, label, icon: Icon }) => (
                        <div
                          key={type}
                          className="relative group"
                        >
                          <div
                            ref={type === 'heading' ? dragImageRef : undefined}
                            draggable
                            onDragStart={(e) => handleComponentDragStart(e, type)}
                            onDragEnd={onComponentDragEnd}
                            className={cn(
                              "cursor-move border border-gray-300 rounded-md p-3 transition-all duration-200 flex items-center",
                              "hover:bg-blue-50 hover:border-blue-300 hover:shadow-sm",
                              "active:scale-95 active:shadow-lg",
                              draggedComponent === type && "bg-blue-100 border-blue-400 shadow-md"
                            )}
                            onClick={(e) => onComponentClick(e, type)}
                          >
                            <Icon className="w-5 h-5 mr-3 text-gray-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-700 block">{label}</span>
                              <div className="text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                Drag to canvas or click to add
                              </div>
                            </div>
                            <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <PlusIcon className="w-4 h-4 text-gray-400" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="font-semibold mb-4">Handlebars Template</h3>
                    <div className="text-sm text-gray-600 mb-4">
                      Edit your template using Handlebars syntax. Type &quot;&#123;&#123;&quot; to see available variables.
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Button onClick={onPreview} variant="outline" className="w-full">
                    <BeakerIcon className="w-4 h-4 mr-2" />
                    Preview
                  </Button>
                  <Button
                    onClick={onSave}
                    variant="primary"
                    className="w-full"
                    disabled={isSaving || !templateName.trim()}
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
                </div>
              </>
            ) : tab === 'test' ? (
              <>
                <h3 className="font-semibold mb-4">Test Data</h3>
                <TextArea
                  value={testData}
                  onChange={(e) => onTestDataChange(e.target.value)}
                  rows={15}
                  className="font-mono text-sm"
                />
                {testError && (
                  <p className="text-red-600 text-sm mt-2">{testError}</p>
                )}
              </>
            ) : null}
          </div>
        </>
      )}

      {/* Collapsed Sidebar Icons */}
      {isCollapsed && (
        <div className="flex flex-col p-2 space-y-2">
          <Button
            variant={tab === 'build' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onTabChange('build')}
            className="p-2"
            title="Build"
          >
            <PaintBrushIcon className="w-4 h-4" />
          </Button>
          <Button
            variant={tab === 'test' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onTabChange('test')}
            className="p-2"
            title="Test"
          >
            <BeakerIcon className="w-4 h-4" />
          </Button>


          {/* Edit Mode Toggle (collapsed) */}
          {tab === 'build' && (
            <div className="border-t pt-2 space-y-1">
              <Button
                variant={editMode === 'visual' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => onEditModeChange('visual')}
                className="p-2 w-full"
                title="Visual Mode"
              >
                <PaintBrushIcon className="w-3 h-3" />
              </Button>
              <Button
                variant={editMode === 'code' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => onEditModeChange('code')}
                className="p-2 w-full"
                title="Code Mode"
              >
                <CodeBracketIcon className="w-3 h-3" />
              </Button>
            </div>
          )}

          {/* Collapsed Component Icons (only in visual mode) */}
          {tab === 'build' && editMode === 'visual' && (
            <div className="border-t pt-2 space-y-1">
              {COMPONENTS.map(({ type, label, icon: Icon }) => (
                <div
                  key={type}
                  draggable
                  onDragStart={(e) => handleComponentDragStart(e, type)}
                  onDragEnd={onComponentDragEnd}
                  className={cn(
                    "cursor-move p-2 rounded transition-all duration-200",
                    "hover:bg-blue-50 hover:shadow-sm active:scale-95",
                    draggedComponent === type && "bg-blue-100 shadow-md"
                  )}
                  title={`${label} - Drag to canvas or click to add`}
                  onClick={(e) => onComponentClick(e, type)}
                >
                  <Icon className="w-4 h-4 mx-auto text-gray-600" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
