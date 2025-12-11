import React, { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from 'react';
import {
  DocumentTextIcon,
  PaintBrushIcon,
  PlusIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  EyeIcon,
  BeakerIcon,
  Bars3Icon,
  CodeBracketIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Select } from '@/components/ui/Select';
import { cn } from '@/utils/cn';
import { EnhancedImageComponent } from './EnhancedImageComponent';
import { DropZoneComponent } from './DropZoneComponent';
import { EnhancedDropZones } from './EnhancedDropZones';
import { SimpleCodeEditor } from './SimpleCodeEditor';
import { InputWithVariables } from './InputWithVariables';
import { ComponentPalette } from './ComponentPalette';
import { EmailCompatibleRenderer } from './EmailCompatibleRenderer';

import { useTemplateNotifications } from '@/components/ui/Notifications';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { templateService } from '@/services/templateService';
import { TemplateHelpContent, TemplateQuickTips } from './TemplateHelpContent';
import type { Template, Snippet } from '@/types/template';

interface Component {
  id: string;
  type: 'heading' | 'text' | 'image' | 'button' | 'divider';
  properties: Record<string, any>;
}

interface TemplateBuilderProps {
  template?: Template;
  onSave?: (template: Template) => void;
  onPreview?: (template: Template) => void;
  onCancel?: () => void;
  className?: string;
  autoSave?: boolean;
  autoSaveInterval?: number;

}

export interface TemplateBuilderRef {
  // Reserved for future functionality
}

const COMPONENTS = [
  { type: 'heading', label: 'Heading', icon: DocumentTextIcon },
  { type: 'text', label: 'Text', icon: DocumentTextIcon },
  { type: 'image', label: 'Image', icon: PaintBrushIcon },
  { type: 'button', label: 'Button', icon: PlusIcon },
  { type: 'divider', label: 'Divider', icon: PaintBrushIcon }
];

const DEFAULT_PROPS = {
  heading: { text: 'Heading', level: 'h2', align: 'left' },
  text: { content: 'Text content...', align: 'left' },
  image: { src: '', alt: '', width: '100%' },
  button: { text: 'Button', url: '', color: '#007bff' },
  divider: { style: 'solid', color: '#ccc' }
};

const TEST_DATA = `{
  "newsletter": {
    "title": "Weekly Newsletter",
    "issue": 42
  },
  "articles": [
    {
      "title": "Sample Article",
      "url": "https://example.com"
    }
  ],
  "subscriber": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}`;

export const TemplateBuilder = forwardRef<TemplateBuilderRef, TemplateBuilderProps>(({
  template,
  onSave,
  onPreview,
  onCancel,
  className,
  autoSave = false,
  autoSaveInterval = 30000 // 30 seconds
}, ref) => {
  const [tab, setTab] = useState<'build' | 'test' | 'email-preview'>('build');
  const [editMode, setEditMode] = useState<'visual' | 'code'>('visual');
  const [components, setComponents] = useState<Component[]>(
    template?.visualConfig?.components || []
  );
  const [handlebarsContent, setHandlebarsContent] = useState<string>(
    template?.content || ''
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [componentEditMode, setComponentEditMode] = useState<'visual' | 'code'>('visual');
  const [componentCodeContent, setComponentCodeContent] = useState<string>('');
  const [componentCodeErrors, setComponentCodeErrors] = useState<any[]>([]);
  const [testData, setTestData] = useState(TEST_DATA);
  const [draggedComponent, setDraggedComponent] = useState<string | null>(null);
  const [draggedComponentId, setDraggedComponentId] = useState<string | null>(null);
  const [dropZoneIndex, setDropZoneIndex] = useState<number | null>(null);
  const [isDraggingFromCanvas, setIsDraggingFromCanvas] = useState(false);

  // Resizable panel state
  const [propertiesPanelWidth, setPropertiesPanelWidth] = useState(320); // 320px = w-80
  const [codeEditorHeight, setCodeEditorHeight] = useState(300);
  const [mainEditorHeight, setMainEditorHeight] = useState(500);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [isResizingEditor, setIsResizingEditor] = useState(false);
  const [isResizingMainEditor, setIsResizingMainEditor] = useState(false);



  // Save state management
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [templateName, setTemplateName] = useState(template?.name || '');
  const [templateDescription, setTemplateDescription] = useState(template?.description || '');
  const [lastAutoSaved, setLastAutoSaved] = useState<Date | null>(null);

  const notifications = useTemplateNotifications();
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout>();
  const localStorageTimeoutRef = useRef<NodeJS.Timeout>();

  // Local storage key for work in progress
  const getLocalStorageKey = useCallback(() => {
    return template?.id ? `template-wip-${template.id}` : 'template-wip-new';
  }, [template?.id]);

  // Save to local storage
  const saveToLocalStorage = useCallback(() => {
    try {
      const wipData = {
        templateName,
        templateDescription,
        components,
        handlebarsContent,
        editMode,
        componentEditMode,
        propertiesPanelWidth,
        codeEditorHeight,
        mainEditorHeight,
        testData,
        timestamp: new Date().toISOString(),
        templateId: template?.id || null
      };

      localStorage.setItem(getLocalStorageKey(), JSON.stringify(wipData));
      setLastAutoSaved(new Date());
      console.log('Template auto-saved');
    } catch (error) {
      console.warn('Failed to auto-save template:', error);
    }
  }, [
    templateName,
    templateDescription,
    components,
    handlebarsContent,
    editMode,
    componentEditMode,
    propertiesPanelWidth,
    codeEditorHeight,
    mainEditorHeight,
    testData,
    template?.id,
    getLocalStorageKey
  ]);

  // Load from local storage
  const loadFromLocalStorage = useCallback(() => {
    try {
      const saved = localStorage.getItem(getLocalStorageKey());
      if (saved) {
        const wipData = JSON.parse(saved);

        // Only restore if it's newer than 24 hours and not for an existing template that's been saved
        const savedTime = new Date(wipData.timestamp);
        const hoursSinceLastSave = (Date.now() - savedTime.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastSave < 24) {
          // Ask user if they want to restore
          const shouldRestore = window.confirm(
            `Found unsaved work from ${savedTime.toLocaleString()}. Would you like to restore it?`
          );

          if (shouldRestore) {
            setTemplateName(wipData.templateName || '');
            setTemplateDescription(wipData.templateDescription || '');
            setComponents(wipData.components || []);
            setHandlebarsContent(wipData.handlebarsContent || '');
            setEditMode(wipData.editMode || 'visual');
            setComponentEditMode(wipData.componentEditMode || 'visual');
            setPropertiesPanelWidth(wipData.propertiesPanelWidth || 320);
            setCodeEditorHeight(wipData.codeEditorHeight || 300);
            setMainEditorHeight(wipData.mainEditorHeight || 500);
            setTestData(wipData.testData || TEST_DATA);
            setLastAutoSaved(savedTime);

            return true;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to restore template:', error);
    }
    return false;
  }, [getLocalStorageKey, notifications]);

  // Clear local storage when template is saved
  const clearLocalStorage = useCallback(() => {
    try {
      localStorage.removeItem(getLocalStorageKey());
      setLastAutoSaved(null);
      console.log('Cleared auto-saved template');
    } catch (error) {
      console.warn('Failed to clear auto-saved template:', error);
    }
  }, [getLocalStorageKey]);

  // Handle unsaved changes navigation warning
  const { navigateWithConfirmation } = useUnsavedChanges({
    hasUnsavedChanges,
    message: 'You have unsaved template changes. Are you sure you want to leave?',
    onNavigateAway: () => {
      // Save to localStorage before leaving
      saveToLocalStorage();

      // Clear any pending auto-save
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      if (localStorageTimeoutRef.current) {
        clearTimeout(localStorageTimeoutRef.current);
      }
    }
  });

  // Load from localStorage on mount and save on unmount
  useEffect(() => {
    if (!template) {
      // Only try to restore for new templates
      loadFromLocalStorage();
    }

    // Save to localStorage when component unmounts
    return () => {
      if (hasUnsavedChanges) {
        saveToLocalStorage();
      }
    };
  }, []); // Only run on mount/unmount

  const dragImageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const generateId = () => `comp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  // Sync handlebars content when switching from visual to code mode
  useEffect(() => {
    if (editMode === 'code' && components.length > 0) {
      const generatedContent = components.map(c => componentToHandlebars(c)).join('\n\n');
      setHandlebarsContent(generatedContent);
    }
  }, [editMode, components, componentToHandlebars]);

  // Track unsaved changes
  useEffect(() => {
    if (!template) {
      // New template - has changes if there's any content
      const hasContent = templateName || templateDescription || components.length > 0 || handlebarsContent;
      setHasUnsavedChanges(!!hasContent);
    } else {
      // Existing template - compare with original
      const hasChanges = (
        templateName !== (template.name || '') ||
        templateDescription !== (template.description || '') ||
        JSON.stringify(components) !== JSON.stringify(template.visualConfig?.components || []) ||
        handlebarsContent !== (template.content || '')
      );
      setHasUnsavedChanges(hasChanges);
    }
  }, [templateName, templateDescription, components, handlebarsContent, template]);

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

  // Auto-save to localStorage (more frequent than server auto-save)
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    if (localStorageTimeoutRef.current) {
      clearTimeout(localStorageTimeoutRef.current);
    }

    // Save to localStorage every 5 seconds when there are changes
    localStorageTimeoutRef.current = setTimeout(() => {
      saveToLocalStorage();
    }, 5000);

    return () => {
      if (localStorageTimeoutRef.current) {
        clearTimeout(localStorageTimeoutRef.current);
      }
    };
  }, [hasUnsavedChanges, saveToLocalStorage]);



  const addComponent = useCallback((type: Component['type'], insertIndex?: number) => {
    const component: Component = {
      id: generateId(),
      type,
      properties: { ...DEFAULT_PROPS[type] }
    };

    setComponents(prev => {
      if (insertIndex !== undefined) {
        const newComponents = [...prev];
        newComponents.splice(insertIndex, 0, component);
        return newComponents;
      }
      return [...prev, component];
    });
    setSelected(component.id);
  }, []);

  const removeComponent = useCallback((id: string) => {
    setComponents(prev => prev.filter(c => c.id !== id));
    setSelected(null);
  }, []);

  const moveComponent = useCallback((id: string, direction: 'up' | 'down') => {
    setComponents(prev => {
      const index = prev.findIndex(c => c.id === id);
      if (index === -1) return prev;

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;

      const newComponents = [...prev];
      [newComponents[index], newComponents[newIndex]] = [newComponents[newIndex], newComponents[index]];
      return newComponents;
    });
  }, []);

  const moveComponentToIndex = useCallback((componentId: string, targetIndex: number) => {
    setComponents(prev => {
      const sourceIndex = prev.findIndex(c => c.id === componentId);
      if (sourceIndex === -1 || sourceIndex === targetIndex) return prev;

      const newComponents = [...prev];
      const [movedComponent] = newComponents.splice(sourceIndex, 1);

      // Adjust target index if moving from before to after
      const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      newComponents.splice(adjustedIndex, 0, movedComponent);

      return newComponents;
    });
  }, []);

  const updateProperty = useCallback((id: string, prop: string, value: any) => {
    setComponents(prev => prev.map(c =>
      c.id === id ? { ...c, properties: { ...c.properties, [prop]: value } } : c
    ));
  }, []);

  // Convert component to email-compatible handlebars code
  const componentToHandlebars = useCallback((component: Component): string => {
    switch (component.type) {
      case 'heading':
        const fontSizeMap = {
          h1: '24px',
          h2: '20px',
          h3: '18px',
          h4: '16px',
          h5: '14px',
          h6: '12px'
        } as const;
        const fontSize = fontSizeMap[component.properties.level as keyof typeof fontSizeMap] || '20px';

        return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0 8px 0;">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: ${fontSize}; font-weight: bold; color: ${component.properties.color || '#000000'}; text-align: ${component.properties.align}; line-height: 1.2;">
      ${component.properties.text}
    </td>
  </tr>
</table>`;

      case 'text':
        return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 8px 0;">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: ${component.properties.fontSize || '14px'}; color: ${component.properties.color || '#000000'}; text-align: ${component.properties.align}; line-height: 1.4; padding: 8px 0;">
      ${component.properties.content}
    </td>
  </tr>
</table>`;

      case 'image':
        return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td align="${component.properties.align || 'center'}">
      <img src="${component.properties.src}" alt="${component.properties.alt}" style="display: block; max-width: ${component.properties.width || '100%'}; height: auto; border: 0;" />
    </td>
  </tr>
</table>`;

      case 'button':
        return `<table cellpadding="0" cellspacing="0" border="0" style="margin: 16px auto;">
  <tr>
    <td style="background-color: ${component.properties.color || '#007bff'}; border-radius: 4px; padding: 12px 24px; text-align: center;">
      <a href="${component.properties.url}" style="color: ${component.properties.textColor || '#ffffff'}; text-decoration: none; font-weight: bold; display: inline-block; font-family: Arial, sans-serif;">
        ${component.properties.text}
      </a>
    </td>
  </tr>
</table>`;

      case 'divider':
        return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td style="border-top: ${component.properties.height || '1px'} ${component.properties.style || 'solid'} ${component.properties.color || '#cccccc'}; font-size: 0; line-height: 0;">&nbsp;</td>
  </tr>
</table>`;

      default:
        return '';
    }
  }, []);

  // Parse handlebars code back to component properties
  const handlebarsToComponent = useCallback((code: string, componentType: Component['type']): Partial<Component['properties']> => {
    const properties: Record<string, any> = {};

    try {
      switch (componentType) {
        case 'heading': {
          const levelMatch = code.match(/<(h[1-6])/i);
          const textMatch = code.match(/>([^<]+)</);
          const alignMatch = code.match(/text-align:\s*([^;"]+)/);

          if (levelMatch) properties.level = levelMatch[1].toLowerCase();
          if (textMatch) properties.text = textMatch[1].trim();
          if (alignMatch) properties.align = alignMatch[1].trim();
          break;
        }
        case 'text': {
          const contentMatch = code.match(/<p[^>]*>([^<]+)<\/p>/);
          const alignMatch = code.match(/text-align:\s*([^;"]+)/);

          if (contentMatch) properties.content = contentMatch[1].trim();
          if (alignMatch) properties.align = alignMatch[1].trim();
          break;
        }
        case 'image': {
          const srcMatch = code.match(/src="([^"]+)"/);
          const altMatch = code.match(/alt="([^"]+)"/);
          const widthMatch = code.match(/width:\s*([^;"]+)/);

          if (srcMatch) properties.src = srcMatch[1];
          if (altMatch) properties.alt = altMatch[1];
          if (widthMatch) properties.width = widthMatch[1].trim();
          break;
        }
        case 'button': {
          const textMatch = code.match(/<a[^>]*>([^<]+)<\/a>/);
          const urlMatch = code.match(/href="([^"]+)"/);
          const colorMatch = code.match(/background-color:\s*([^;"]+)/);

          if (textMatch) properties.text = textMatch[1].trim();
          if (urlMatch) properties.url = urlMatch[1];
          if (colorMatch) properties.color = colorMatch[1].trim();
          break;
        }
        case 'divider': {
          const styleMatch = code.match(/border:\s*[^;]*\s+(solid|dashed|dotted)/);
          const colorMatch = code.match(/border:\s*[^;]*\s+([^;"]+)/);

          if (styleMatch) properties.style = styleMatch[1];
          if (colorMatch) properties.color = colorMatch[1].trim();
          break;
        }
      }
    } catch (error) {
      console.warn('Failed to parse handlebars code:', error);
    }

    return properties;
  }, []);

  // Update component from handlebars code
  const updateComponentFromCode = useCallback((id: string, code: string) => {
    setComponents(prev => prev.map(c => {
      if (c.id === id) {
        const parsedProperties = handlebarsToComponent(code, c.type);
        return {
          ...c,
          properties: { ...c.properties, ...parsedProperties }
        };
      }
      return c;
    }));
  }, [handlebarsToComponent]);

  const generateTemplate = useCallback((): Template => {
    let content: string;
    let isVisualMode: boolean;
    let visualConfig: any;

    if (editMode === 'visual') {
      content = components.map(c => componentToHandlebars(c)).join('\n\n');
      isVisualMode = true;
      visualConfig = { components };
    } else {
      content = handlebarsContent;
      isVisualMode = false;
      visualConfig = template?.visualConfig || null;
    }

    return {
      id: template?.id || '',
      tenantId: template?.tenantId || '',
      name: templateName || 'New Template',
      description: templateDescription || '',
      type: 'template' as const,
      content,
      isVisualMode,
      visualConfig,
      snippets: template?.snippets || [],
      s3Key: template?.s3Key || '',
      s3VersionId: template?.s3VersionId || '',
      version: template?.version || 1,
      createdAt: template?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: template?.createdBy || '',
      isActive: template?.isActive ?? true
    };
  }, [components, handlebarsContent, editMode, template, templateName, templateDescription, componentToHandlebars]);

  // Enhanced Drag and Drop Handlers
  const handlePaletteDragStart = (e: React.DragEvent, componentType: string) => {
    e.dataTransfer.setData('application/component-type', componentType);
    e.dataTransfer.effectAllowed = 'copy';
    setDraggedComponent(componentType);
    setIsDraggingFromCanvas(false);

    // Create custom drag image
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
  };

  const handleCanvasComponentDragStart = (e: React.DragEvent, componentId: string) => {
    e.dataTransfer.setData('application/component-id', componentId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedComponentId(componentId);
    setIsDraggingFromCanvas(true);

    // Add visual feedback to the dragged component
    const target = e.target as HTMLElement;
    target.style.opacity = '0.5';
  };

  const handleCanvasComponentDragEnd = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    target.style.opacity = '1';
    setDraggedComponentId(null);
    setIsDraggingFromCanvas(false);
    setDropZoneIndex(null);
  };

  const handleComponentClick = (e: React.MouseEvent, componentType: Component['type']) => {
    // Only add component if we're not in the middle of a drag operation
    if (!draggedComponent) {
      addComponent(componentType);
    }
  };

  const handleDropZoneDrop = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();

    const componentType = e.dataTransfer?.getData('application/component-type');
    const componentId = e.dataTransfer?.getData('application/component-id');

    if (componentType && COMPONENTS.find(c => c.type === componentType)) {
      // Adding new component from palette
      addComponent(componentType as Component['type'], index);
    } else if (componentId && isDraggingFromCanvas) {
      // Moving existing component
      moveComponentToIndex(componentId, index);
    }

    setDraggedComponent(null);
    setDraggedComponentId(null);
    setDropZoneIndex(null);
    setIsDraggingFromCanvas(false);
  }, [addComponent, moveComponentToIndex, isDraggingFromCanvas]);

  const handleDropZoneDragOver = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    setDropZoneIndex(index);

    if (isDraggingFromCanvas) {
      e.dataTransfer!.dropEffect = 'move';
    } else {
      e.dataTransfer!.dropEffect = 'copy';
    }
  }, [isDraggingFromCanvas]);



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

  // Real-time preview update effect
  useEffect(() => {
    // Trigger preview update when components change
    if (onPreview) {
      const template = generateTemplate();
      // Debounce the preview update to avoid excessive re-renders
      const timeoutId = setTimeout(() => {
        // Only update if we're in build mode and have components
        if (tab === 'build' && components.length > 0) {
          // Could emit a preview update event here
        }
      }, 300);

      return () => clearTimeout(timeoutId);
    }
  }, [components, tab, onPreview, generateTemplate]);

  const handleSave = useCallback(async () => {
    if (!templateName.trim()) {
      notifications.validationError('Template name is required');
      return;
    }

    if (isSaving) return;

    try {
      setIsSaving(true);
      const updatedTemplate = generateTemplate();

      let response;
      if (template?.id) {
        // Update existing template
        response = await templateService.updateTemplateWithRetry(template.id, {
          name: updatedTemplate.name,
          description: updatedTemplate.description,
          content: updatedTemplate.content,
          isVisualMode: updatedTemplate.isVisualMode,
          visualConfig: updatedTemplate.visualConfig
        });
      } else {
        // Create new template
        response = await templateService.createTemplateWithRetry({
          name: updatedTemplate.name,
          description: updatedTemplate.description,
          content: updatedTemplate.content || '',
          isVisualMode: updatedTemplate.isVisualMode,
          visualConfig: updatedTemplate.visualConfig
        });
      }

      if (response.success && response.data) {
        setLastSaved(new Date());
        setHasUnsavedChanges(false);

        // Clear localStorage since template is now saved
        clearLocalStorage();

        notifications.templateSaved(updatedTemplate.name);

        // Call the parent onSave callback if provided
        if (onSave) {
          onSave(response.data);
        }
      } else {
        throw new Error(response.error || 'Failed to save template');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save template';
      notifications.templateError(templateName || 'Template', errorMessage);
    } finally {
      setIsSaving(false);
    }
  }, [templateName, isSaving, generateTemplate, template, notifications, onSave]);

  const handlePreview = () => {
    if (onPreview) {
      onPreview(generateTemplate());
    }
  };



  // Resize handlers
  const handlePanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPanel(true);
  }, []);

  const handleEditorResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingEditor(true);
  }, []);

  const handleMainEditorResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingMainEditor(true);
  }, []);

  // Mouse move handler for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingPanel) {
        const newWidth = window.innerWidth - e.clientX;
        setPropertiesPanelWidth(Math.max(280, Math.min(600, newWidth))); // Min 280px, max 600px
      }
      if (isResizingEditor) {
        // Calculate relative to the code editor container
        const editorContainer = document.querySelector('.code-editor-container');
        if (editorContainer) {
          const rect = editorContainer.getBoundingClientRect();
          const newHeight = e.clientY - rect.top;
          setCodeEditorHeight(Math.max(200, Math.min(800, newHeight))); // Min 200px, max 800px
        }
      }
      if (isResizingMainEditor) {
        // Calculate relative to the main editor container
        const mainEditorContainer = document.querySelector('.main-editor-container');
        if (mainEditorContainer) {
          const rect = mainEditorContainer.getBoundingClientRect();
          const newHeight = e.clientY - rect.top;
          setMainEditorHeight(Math.max(300, Math.min(1000, newHeight))); // Min 300px, max 1000px
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingPanel(false);
      setIsResizingEditor(false);
      setIsResizingMainEditor(false);
    };

    if (isResizingPanel || isResizingEditor || isResizingMainEditor) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isResizingPanel ? 'ew-resize' : 'ns-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizingPanel, isResizingEditor, isResizingMainEditor]);



  // Render template with test data using proper Handlebars compilation
  const renderWithData = (html: string, data: any) => {
    if (!data) return html;

    try {
      // For now, we'll use a more sophisticated regex-based approach
      // that handles basic Handlebars helpers until we can add the full Handlebars library

      let rendered = html;

      // Handle {{#each}} loops
      rendered = rendered.replace(/\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayPath, content) => {
        const keys = arrayPath.trim().split('.');
        let array = data;
        for (const key of keys) {
          if (array && typeof array === 'object' && key in array) {
            array = array[key];
          } else {
            return match; // Return original if path not found
          }
        }

        if (Array.isArray(array)) {
          return array.map((item, index) => {
            let itemContent = content;
            // Replace {{this}} with current item
            itemContent = itemContent.replace(/\{\{this\}\}/g, String(item));
            // Replace {{@index}} with current index
            itemContent = itemContent.replace(/\{\{@index\}\}/g, String(index));
            // Replace {{@first}} with boolean
            itemContent = itemContent.replace(/\{\{@first\}\}/g, index === 0 ? 'true' : '');
            // Replace {{@last}} with boolean
            itemContent = itemContent.replace(/\{\{@last\}\}/g, index === array.length - 1 ? 'true' : '');

            // Handle object properties if item is an object
            if (typeof item === 'object' && item !== null) {
              itemContent = itemContent.replace(/\{\{([^}@#/]+)\}\}/g, (propMatch: string, propPath: string) => {
                const propKeys = propPath.trim().split('.');
                let propValue = item;
                for (const propKey of propKeys) {
                  if (propValue && typeof propValue === 'object' && propKey in propValue) {
                    propValue = propValue[propKey];
                  } else {
                    return propMatch;
                  }
                }
                return String(propValue);
              });
            }

            return itemContent;
          }).join('');
        }

        return match;
      });

      // Handle {{#if}} conditions (basic implementation)
      rendered = rendered.replace(/\{\{#if\s+([^}]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (match, condition, ifContent, elseContent = '') => {
        const keys = condition.trim().split('.');
        let value = data;
        for (const key of keys) {
          if (value && typeof value === 'object' && key in value) {
            value = value[key];
          } else {
            value = null;
            break;
          }
        }

        // Truthy check
        const isTruthy = value && value !== '' && value !== 0 && value !== false;
        return isTruthy ? ifContent : elseContent;
      });

      // Handle simple variable substitution
      rendered = rendered.replace(/\{\{([^}#/@]+)\}\}/g, (match, path) => {
        const keys = path.trim().split('.');
        let value = data;
        for (const key of keys) {
          if (value && typeof value === 'object' && key in value) {
            value = value[key];
          } else {
            return match;
          }
        }
        return String(value);
      });

      return rendered;
    } catch (error) {
      console.warn('Error rendering template:', error);
      return html; // Return original on error
    }
  };

  const selectedComponent = selected ? components.find(c => c.id === selected) : null;

  // Update component code content when selection changes
  useEffect(() => {
    if (selectedComponent) {
      const code = componentToHandlebars(selectedComponent);
      setComponentCodeContent(code);
      setComponentEditMode('visual'); // Reset to visual mode when selecting a new component
    } else {
      setComponentCodeContent('');
    }
  }, [selected]); // Only depend on selected component ID, not the component object or componentToHandlebars

  // Sync code content when switching from visual to code mode
  const handleComponentEditModeChange = useCallback((mode: 'visual' | 'code') => {
    if (selectedComponent) {
      if (mode === 'code' && componentEditMode === 'visual') {
        // Switching to code mode - update code content from current properties
        const code = componentToHandlebars(selectedComponent);
        setComponentCodeContent(code);
      } else if (mode === 'visual' && componentEditMode === 'code') {
        // Switching to visual mode - ensure properties are up to date from code
        if (componentCodeContent.trim()) {
          updateComponentFromCode(selectedComponent.id, componentCodeContent);
        }
      }
    }
    setComponentEditMode(mode);
  }, [selectedComponent, componentEditMode, componentCodeContent, componentToHandlebars, updateComponentFromCode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Toggle between visual and code modes (Ctrl+E)
      if (selectedComponent && event.ctrlKey && event.key === 'e') {
        event.preventDefault();
        const newMode = componentEditMode === 'visual' ? 'code' : 'visual';
        handleComponentEditModeChange(newMode);
      }

      // Manual save to localStorage (Ctrl+Shift+S)
      if (event.ctrlKey && event.shiftKey && event.key === 'S') {
        event.preventDefault();
        saveToLocalStorage();
        notifications.success('Work saved');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedComponent, componentEditMode, handleComponentEditModeChange, saveToLocalStorage, notifications]);

  let parsedTestData = null;
  let testError = null;
  try {
    parsedTestData = JSON.parse(testData);
  } catch (e) {
    testError = e instanceof Error ? e.message : 'Invalid JSON';
  }

  const renderedHtml = useMemo(() => {
    if (!parsedTestData) return null;

    let templateContent = '';
    if (editMode === 'visual') {
      // In visual mode, generate HTML from components
      templateContent = generateTemplate().content || '';
    } else {
      // In code mode, use the handlebars content directly
      templateContent = handlebarsContent;
    }

    return renderWithData(templateContent, parsedTestData);
  }, [parsedTestData, editMode, generateTemplate, handlebarsContent]);

  // Expose functionality via ref
  useImperativeHandle(ref, () => ({
    // Reserved for future functionality
  }), []);

  return (
    <div className={cn("flex h-full bg-gray-50", className)}>
      {/* Sidebar */}
      <ComponentPalette
        tab={tab}
        onTabChange={setTab}
        editMode={editMode}
        onEditModeChange={setEditMode}
        testData={testData}
        onTestDataChange={setTestData}
        testError={testError}
        onComponentDragStart={handlePaletteDragStart}
        onComponentDragEnd={() => setDraggedComponent(null)}
        onComponentClick={handleComponentClick}
        onPreview={handlePreview}
        onSave={handleSave}
        draggedComponent={draggedComponent}
        templateName={templateName}
        onTemplateNameChange={setTemplateName}
        templateDescription={templateDescription}
        onTemplateDescriptionChange={setTemplateDescription}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isSaving}
        lastSaved={lastSaved}
        lastAutoSaved={lastAutoSaved}
      />

      {/* Canvas */}
      <div className="flex-1 flex">
        {/* Canvas Area */}
        <div
          ref={canvasRef}
          className={cn("flex-1 p-6 overflow-y-auto transition-colors",
            (draggedComponent || draggedComponentId) && "bg-blue-50")}
        >
          <div className="max-w-2xl mx-auto">
            {tab === 'build' ? (
              <>
                {editMode === 'visual' ? (
                  <>
                    <h2 className="text-xl font-semibold mb-4">Canvas</h2>

                    {/* Help Content for Visual Builder */}
                    <div className="mb-6">
                      <TemplateHelpContent
                        context="visual"
                        isFirstTime={components.length === 0}
                      />
                    </div>

                    {/* Empty state when no components and not dragging */}
                    {components.length === 0 && !draggedComponent && !draggedComponentId && (
                      <div className="text-center py-12">
                        <DocumentTextIcon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Start Building Your Template</h3>
                        <p className="text-gray-600 mb-4">
                          Drag components from the left sidebar to begin creating your template.
                        </p>
                      </div>
                    )}

                    {/* Component List with Drag and Drop */}
                    {components.length > 0 ? (
                      <div className="space-y-2">
                        {/* Drop zone before first component */}
                        {(draggedComponent || draggedComponentId) && (
                          <DropZoneComponent
                            index={0}
                            isActive={dropZoneIndex === 0}
                            isHovered={false}
                            onDrop={handleDropZoneDrop}
                            onDragOver={handleDropZoneDragOver}
                            size="small"
                            showLabel={dropZoneIndex === 0}
                            className="my-2"
                          />
                        )}

                        {components.map((component, index) => (
                          <React.Fragment key={component.id}>

                            {/* Draggable Component */}
                            <Card
                              className={cn(
                                'p-4 cursor-pointer transition-all group',
                                selected === component.id && 'ring-2 ring-blue-500',
                                draggedComponentId === component.id && 'opacity-50 transform rotate-1',
                                'hover:shadow-md'
                              )}
                              draggable
                              onDragStart={(e) => handleCanvasComponentDragStart(e, component.id)}
                              onDragEnd={handleCanvasComponentDragEnd}
                              onClick={() => setSelected(component.id)}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center space-x-2">
                                  <Bars3Icon className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" />
                                  <span className="text-sm font-medium text-gray-600">
                                    {COMPONENTS.find(c => c.type === component.type)?.label}
                                  </span>
                                </div>
                                <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => { e.stopPropagation(); moveComponent(component.id, 'up'); }}
                                    disabled={index === 0}
                                    title="Move up"
                                  >
                                    <ArrowUpIcon className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => { e.stopPropagation(); moveComponent(component.id, 'down'); }}
                                    disabled={index === components.length - 1}
                                    title="Move down"
                                  >
                                    <ArrowDownIcon className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => { e.stopPropagation(); removeComponent(component.id); }}
                                    title="Delete component"
                                  >
                                    <TrashIcon className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>

                              <div className="bg-gray-50 p-3 rounded pointer-events-none">
                                {component.type === 'heading' && (
                                  React.createElement(component.properties.level,
                                    { style: { textAlign: component.properties.align } },
                                    component.properties.text)
                                )}
                                {component.type === 'text' && (
                                  <p style={{ textAlign: component.properties.align }}>{component.properties.content}</p>
                                )}
                                {component.type === 'image' && (
                                  component.properties.src ? (
                                    <img src={component.properties.src} alt={component.properties.alt} className="max-w-full" />
                                  ) : (
                                    <div className="bg-gray-200 p-4 text-center text-gray-500">Image</div>
                                  )
                                )}
                                {component.type === 'button' && (
                                  <span className="inline-block px-4 py-2 rounded text-white" style={{ backgroundColor: component.properties.color }}>
                                    {component.properties.text}
                                  </span>
                                )}
                                {component.type === 'divider' && (
                                  <hr style={{ border: `1px ${component.properties.style} ${component.properties.color}` }} />
                                )}
                              </div>
                            </Card>

                            {/* Drop zone after each component */}
                            {(draggedComponent || draggedComponentId) && (
                              <DropZoneComponent
                                index={index + 1}
                                isActive={dropZoneIndex === index + 1}
                                isHovered={false}
                                onDrop={handleDropZoneDrop}
                                onDragOver={handleDropZoneDragOver}
                                size={index === components.length - 1 ? "medium" : "small"}
                                showLabel={dropZoneIndex === index + 1}
                                className="my-2"
                              />
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    ) : (
                      /* Empty state with drop zone when dragging */
                      (draggedComponent || draggedComponentId) && (
                        <DropZoneComponent
                          index={0}
                          isActive={dropZoneIndex === 0}
                          isHovered={false}
                          onDrop={handleDropZoneDrop}
                          onDragOver={handleDropZoneDragOver}
                          size="large"
                          showLabel={true}
                          className="my-8"
                        />
                      )
                    )}
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-semibold mb-4">Handlebars Editor</h2>

                    {/* Help Content for Code Editor */}
                    <div className="mb-6">
                      <TemplateHelpContent context="code" />
                    </div>

                    <Card className="p-0 overflow-hidden">
                      <div className="main-editor-container relative">
                        <SimpleCodeEditor
                          value={handlebarsContent}
                          onChange={setHandlebarsContent}
                          language="handlebars"
                          height={`${mainEditorHeight}px`}
                          testData={testData}
                          placeholder="Enter your Handlebars template here..."
                          theme="light"
                        />
                        {/* Resize handle for main editor */}
                        <div
                          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500 hover:bg-opacity-20 transition-colors flex items-center justify-center"
                          onMouseDown={handleMainEditorResizeStart}
                          title="Drag to resize editor"
                        >
                          <div className="w-8 h-0.5 bg-gray-400 rounded"></div>
                        </div>
                      </div>
                    </Card>
                  </>
                )}
              </>
            ) : tab === 'test' ? (
              <>
                <h2 className="text-xl font-semibold mb-4">Preview</h2>

                {/* Help Content for Preview */}
                <div className="mb-6">
                  <TemplateHelpContent context="preview" />
                </div>

                {testError ? (
                  <Card className="p-8 text-center">
                    <p className="text-red-600">Fix JSON syntax to see preview</p>
                  </Card>
                ) : (
                  <Card className="p-6">
                    <div
                      className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900"
                      dangerouslySetInnerHTML={{ __html: renderedHtml || '' }}
                    />
                  </Card>
                )}
              </>
            ) : tab === 'email-preview' ? (
              <EmailCompatibleRenderer
                components={components}
                showWarnings={true}
                showClientPreviews={true}
                className="space-y-4"
              />
            ) : null}
          </div>
        </div>

        {/* Properties Panel */}
        {selectedComponent && (
          <div
            className="bg-white border-l p-4 overflow-y-auto relative"
            style={{ width: propertiesPanelWidth }}
          >
            {/* Resize handle for properties panel */}
            <div
              className="absolute left-0 top-0 w-2 h-full cursor-ew-resize hover:bg-blue-500 transition-colors z-10 group"
              onMouseDown={handlePanelResizeStart}
              title="Drag to resize properties panel"
            >
              <div className="w-0.5 h-8 bg-gray-300 group-hover:bg-blue-500 transition-colors absolute left-0.5 top-1/2 transform -translate-y-1/2"></div>
            </div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Properties</h3>
              <div className="flex bg-gray-100 rounded-lg p-1" title="Toggle with Ctrl+E">
                <Button
                  size="sm"
                  variant={componentEditMode === 'visual' ? 'default' : 'ghost'}
                  onClick={() => handleComponentEditModeChange('visual')}
                  className="px-3 py-1 text-xs"
                >
                  <PaintBrushIcon className="w-3 h-3 mr-1" />
                  Visual
                </Button>
                <Button
                  size="sm"
                  variant={componentEditMode === 'code' ? 'default' : 'ghost'}
                  onClick={() => handleComponentEditModeChange('code')}
                  className="px-3 py-1 text-xs"
                >
                  <CodeBracketIcon className="w-3 h-3 mr-1" />
                  Code
                </Button>
              </div>
            </div>

            {componentEditMode === 'visual' ? (
              <div className="space-y-4">
              {selectedComponent.type === 'heading' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Text</label>
                    <InputWithVariables
                      value={selectedComponent.properties.text}
                      onChange={(e) => updateProperty(selectedComponent.id, 'text', e.target.value)}
                      placeholder="Enter heading text..."
                      testData={testData}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Level</label>
                    <Select
                      value={selectedComponent.properties.level}
                      onChange={(value) => updateProperty(selectedComponent.id, 'level', value)}
                      options={[
                        { value: 'h1', label: 'H1' },
                        { value: 'h2', label: 'H2' },
                        { value: 'h3', label: 'H3' },
                        { value: 'h4', label: 'H4' }
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Alignment</label>
                    <Select
                      value={selectedComponent.properties.align}
                      onChange={(value) => updateProperty(selectedComponent.id, 'align', value)}
                      options={[
                        { value: 'left', label: 'Left' },
                        { value: 'center', label: 'Center' },
                        { value: 'right', label: 'Right' }
                      ]}
                    />
                  </div>
                </>
              )}

              {selectedComponent.type === 'text' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Content</label>
                    <InputWithVariables
                      value={selectedComponent.properties.content}
                      onChange={(e) => updateProperty(selectedComponent.id, 'content', e.target.value)}
                      placeholder="Enter text content..."
                      testData={testData}
                      multiline={true}
                      rows={4}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Alignment</label>
                    <Select
                      value={selectedComponent.properties.align}
                      onChange={(value) => updateProperty(selectedComponent.id, 'align', value)}
                      options={[
                        { value: 'left', label: 'Left' },
                        { value: 'center', label: 'Center' },
                        { value: 'right', label: 'Right' }
                      ]}
                    />
                  </div>
                </>
              )}

              {selectedComponent.type === 'image' && (
                <EnhancedImageComponent
                  src={selectedComponent.properties.src}
                  alt={selectedComponent.properties.alt}
                  width={selectedComponent.properties.width}
                  onSrcChange={(src) => updateProperty(selectedComponent.id, 'src', src)}
                  onAltChange={(alt) => updateProperty(selectedComponent.id, 'alt', alt)}
                  onWidthChange={(width) => updateProperty(selectedComponent.id, 'width', width)}
                />
              )}

              {selectedComponent.type === 'button' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Text</label>
                    <InputWithVariables
                      value={selectedComponent.properties.text}
                      onChange={(e) => updateProperty(selectedComponent.id, 'text', e.target.value)}
                      placeholder="Enter button text..."
                      testData={testData}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">URL</label>
                    <Input
                      value={selectedComponent.properties.url}
                      onChange={(e) => updateProperty(selectedComponent.id, 'url', e.target.value)}
                      placeholder="https://example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Color</label>
                    <Input
                      type="color"
                      value={selectedComponent.properties.color}
                      onChange={(e) => updateProperty(selectedComponent.id, 'color', e.target.value)}
                    />
                  </div>
                </>
              )}

              {selectedComponent.type === 'divider' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Style</label>
                    <Select
                      value={selectedComponent.properties.style}
                      onChange={(value) => updateProperty(selectedComponent.id, 'style', value)}
                      options={[
                        { value: 'solid', label: 'Solid' },
                        { value: 'dashed', label: 'Dashed' },
                        { value: 'dotted', label: 'Dotted' }
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Color</label>
                    <Input
                      type="color"
                      value={selectedComponent.properties.color}
                      onChange={(e) => updateProperty(selectedComponent.id, 'color', e.target.value)}
                    />
                  </div>
                </>
              )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Component Code ({COMPONENTS.find(c => c.type === selectedComponent.type)?.label})
                  </label>
                  <Card className="p-0 overflow-hidden">
                    <div className="code-editor-container relative">
                      <SimpleCodeEditor
                        value={componentCodeContent}
                        onChange={(newCode) => {
                          setComponentCodeContent(newCode);
                          updateComponentFromCode(selectedComponent.id, newCode);
                        }}
                        language="handlebars"
                        height={`${codeEditorHeight}px`}
                        testData={testData}
                        onValidationChange={setComponentCodeErrors}
                        placeholder={`Enter handlebars code for ${selectedComponent.type} component...`}
                        theme="light"
                      />
                      {/* Resize handle for code editor */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500 hover:bg-opacity-20 transition-colors flex items-center justify-center"
                        onMouseDown={handleEditorResizeStart}
                        title="Drag to resize code editor"
                      >
                        <div className="w-8 h-0.5 bg-gray-400 rounded"></div>
                      </div>
                    </div>
                  </Card>
                  {componentCodeErrors.length > 0 ? (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
                      <div className="flex items-center text-red-600 mb-1">
                        <ExclamationTriangleIcon className="w-3 h-3 mr-1" />
                        <span className="font-medium">
                          {componentCodeErrors.filter(e => e.severity === 'error').length} error(s),
                          {componentCodeErrors.filter(e => e.severity === 'warning').length} warning(s)
                        </span>
                      </div>
                      {componentCodeErrors.slice(0, 3).map((error, index) => (
                        <div key={index} className="text-red-600">
                          Line {error.line}: {error.message}
                        </div>
                      ))}
                      {componentCodeErrors.length > 3 && (
                        <div className="text-red-500">
                          ... and {componentCodeErrors.length - 3} more
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 mt-2">
                      Edit the handlebars code directly. Changes will be reflected in the visual properties.
                    </p>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium mb-2">Live Preview</h4>
                  <Card className="p-3 bg-gray-50 min-h-[60px] flex items-center justify-center">
                    {componentCodeErrors.filter(e => e.severity === 'error').length > 0 ? (
                      <div className="text-red-500 text-sm flex items-center">
                        <ExclamationTriangleIcon className="w-4 h-4 mr-2" />
                        Fix errors to see preview
                      </div>
                    ) : componentCodeContent.trim() ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: parsedTestData ? renderWithData(componentCodeContent, parsedTestData) : componentCodeContent
                        }}
                        className="w-full"
                      />
                    ) : (
                      <div className="text-gray-400 text-sm">
                        Enter code to see preview
                      </div>
                    )}
                  </Card>
                  {parsedTestData && componentCodeContent.trim() && (
                    <p className="text-xs text-gray-500 mt-1">
                      Preview with test data - variables are resolved
                    </p>
                  )}
                </div>

                <div className="border-t pt-4 space-y-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const defaultCode = componentToHandlebars(selectedComponent);
                      setComponentCodeContent(defaultCode);
                      updateComponentFromCode(selectedComponent.id, defaultCode);
                    }}
                    className="w-full"
                  >
                    Reset to Default
                  </Button>

                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                      Show code template for {selectedComponent.type}
                    </summary>
                    <div className="mt-2 p-2 bg-gray-100 rounded font-mono text-xs overflow-x-auto">
                      <pre>{componentToHandlebars({
                        ...selectedComponent,
                        properties: {
                          ...DEFAULT_PROPS[selectedComponent.type],
                          ...Object.fromEntries(
                            Object.keys(selectedComponent.properties).map(key => [
                              key,
                              `{{${key}}}`
                            ])
                          )
                        }
                      })}</pre>
                    </div>
                  </details>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Enhanced Drag and Drop Styles */}
      <style>{`
        /* Template Preview Styles */
        .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 {
          font-weight: 600;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
          line-height: 1.2;
        }

        .prose h1 { font-size: 2em; color: #1f2937; }
        .prose h2 { font-size: 1.5em; color: #1f2937; }
        .prose h3 { font-size: 1.25em; color: #1f2937; }
        .prose h4 { font-size: 1.125em; color: #1f2937; }
        .prose h5 { font-size: 1em; color: #1f2937; }
        .prose h6 { font-size: 0.875em; color: #1f2937; }

        .prose p {
          margin-top: 1em;
          margin-bottom: 1em;
          color: #374151;
          line-height: 1.6;
        }

        .prose a {
          color: #2563eb;
          text-decoration: none;
        }

        .prose a:hover {
          text-decoration: underline;
        }

        .prose strong {
          font-weight: 600;
          color: #1f2937;
        }

        .prose em {
          font-style: italic;
        }

        .prose ul, .prose ol {
          margin-top: 1em;
          margin-bottom: 1em;
          padding-left: 1.5em;
        }

        .prose li {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
        }

        .prose img {
          max-width: 100%;
          height: auto;
          margin: 1em 0;
        }

        .prose hr {
          margin: 2em 0;
          border: none;
          border-top: 1px solid #e5e7eb;
        }

        /* Drop zone transitions and animations */
        .drop-zone-transition {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .drop-zone-glow {
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5), 0 0 20px rgba(59, 130, 246, 0.3);
        }

        .drop-zone-pulse {
          animation: drop-zone-pulse 1.5s ease-in-out infinite;
        }

        .drop-zone-hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .drop-zone-focus {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }

        .drop-zone-height-transition {
          transition: height 0.3s ease, min-height 0.3s ease;
        }

        .drop-zone-shimmer {
          background: linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.1), transparent);
          background-size: 200% 100%;
          animation: shimmer 2s ease-in-out infinite;
        }

        .drop-zone-scale-in {
          animation: scale-in 0.3s ease-out;
        }

        .drop-indicator-bounce {
          animation: bounce-gentle 0.6s ease-in-out;
        }

        .enhanced-drop-zone-item {
          transition: all 0.2s ease;
        }

        .enhanced-drop-zones-container.drop-zones-dragging .enhanced-drop-zone-item {
          opacity: 1;
          visibility: visible;
        }

        .drop-zone-mobile {
          min-height: 120px;
        }

        @media (min-width: 768px) {
          .drop-zone-mobile {
            min-height: 200px;
          }
        }

        /* Component drag animations */
        .cursor-grab {
          cursor: grab;
        }

        .cursor-grabbing {
          cursor: grabbing;
        }

        /* Keyframe animations */
        @keyframes drop-zone-pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.02);
            opacity: 0.8;
          }
        }

        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }

        @keyframes scale-in {
          0% {
            transform: scale(0.95);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes bounce-gentle {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-4px);
          }
        }

        /* Accessibility: Respect reduced motion preference */
        @media (prefers-reduced-motion: reduce) {
          .drop-zone-transition,
          .enhanced-drop-zone-item,
          .drop-zone-pulse,
          .drop-indicator-bounce,
          .drop-zone-scale-in {
            animation: none !important;
            transition: none !important;
          }

          .drop-zone-hover {
            transform: none;
          }
        }

        /* High contrast mode support */
        @media (prefers-contrast: high) {
          .drop-zone-glow {
            box-shadow: 0 0 0 3px currentColor;
          }
        }
      `}</style>
    </div>
  );
});

TemplateBuilder.displayName = 'TemplateBuilder';
