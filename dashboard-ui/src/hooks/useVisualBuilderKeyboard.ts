import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccessibility } from './useAccessibility';

export interface VisualBuilderKeyboardOptions {
  /**
   * Enable component palette navigation
   */
  enablePaletteNavigation?: boolean;

  /**
   * Enable drop zone navigation
   */
  enableDropZoneNavigation?: boolean;

  /**
   * Enable property panel navigation
   */
  enablePropertyNavigation?: boolean;

  /**
   * Enable variable picker navigation
   */
  enableVariableNavigation?: boolean;

  /**
   * Callback when component is selected via keyboard
   */
  onComponentSelect?: (componentId: string) => void;

  /**
   * Callback when drop zone is activatvia keyboard
   */
  onDropZoneActivate?: (index: number) => void;

  /**
   * Callback when variable is selected via keyboard
   */
  onVariableSelect?: (variableId: string) => void;
}

export interface NavigationContext {
  area: 'palette' | 'canvas' | 'properties' | 'variable-picker';
  index: number;
  itemId?: string;
}

/**
 * Enhanced keyboard navigation hook specifically for the Visual Builder
 */
export const useVisualBuilderKeyboard = (options: VisualBuilderKeyboardOptions = {}) => {
  const {
    enablePaletteNavigation = true,
    enableDropZoneNavigation = true,
    enablePropertyNavigation = true,
    enableVariableNavigation = true,
    onComponentSelect,
    onDropZoneActivate,
    onVariableSelect
  } = options;

  const { announce, generateId } = useAccessibility();

  const [currentContext, setCurrentContext] = useState<NavigationContext>({
    area: 'palette',
    index: 0
  });

  const [isNavigationMode, setIsNavigationMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const skipLinksRef = useRef<HTMLDivElement>(null);

  /**
   * Navigate between main areas of the visual builder
   */
  const navigateToArea = useCallback((area: NavigationContext['area']) => {
    setCurrentContext(prev => ({
      ...prev,
      area,
      index: 0
    }));

    setIsNavigationMode(true);

    // Announce the area change
    const areaNames = {
      palette: 'Component Palette',
      canvas: 'Template Canvas',
      properties: 'Properties Panel',
      'variable-picker': 'Variable Picker'
    };

    announce(`Navigated to ${areaNames[area]}`);
  }, [announce]);

  /**
   * Navigate within the current area
   */
  const navigateWithinArea = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    setCurrentContext(prev => {
      let newIndex = prev.index;

      // Area-specific navigation logic
      switch (prev.area) {
        case 'palette':
          if (direction === 'up') {
            newIndex = Math.max(0, prev.index - 1);
          } else if (direction === 'down') {
            // This would need to be bounded by actual component count
            newIndex = prev.index + 1;
          }
          break;

        case 'canvas':
          // Navigate between components and drop zones
          if (direction === 'up') {
            newIndex = Math.max(0, prev.index - 1);
          } else if (direction === 'down') {
            newIndex = prev.index + 1;
          }
          break;

        case 'properties':
          // Navigate between property fields
          if (direction === 'up') {
            newIndex = Math.max(0, prev.index - 1);
          } else if (direction === 'down') {
            newIndex = prev.index + 1;
          }
          break;

        case 'variable-picker':
          // Navigate between variable categories and items
          if (direction === 'up') {
            newIndex = Math.max(0, prev.index - 1);
          } else if (direction === 'down') {
            newIndex = prev.index + 1;
          }
          break;
      }

      return {
        ...prev,
        index: newIndex
      };
    });
  }, []);

  /**
   * Activate the currently focused item
   */
  const activateCurrentItem = useCallback(() => {
    switch (currentContext.area) {
      case 'palette':
        // Add component to canvas
        announce('Component added to template');
        break;

      case 'canvas':
        if (currentContext.itemId) {
          onComponentSelect?.(currentContext.itemId);
          announce('Component selected');
        } else {
          onDropZoneActivate?.(currentContext.index);
          announce('Drop zone activated');
        }
        break;

      case 'properties':
        // Focus on property field
        announce('Property field focused');
        break;

      case 'variable-picker':
        if (currentContext.itemId) {
          onVariableSelect?.(currentContext.itemId);
          announce('Variable selected');
        }
        break;
    }
  }, [currentContext, onComponentSelect, onDropZoneActivate, onVariableSelect, announce]);

  /**
   * Handle keyboard events for the visual builder
   */
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Skip if user is typing in an input field
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target as HTMLElement)?.contentEditable === 'true'
    ) {
      return;
    }

    switch (event.key) {
      case 'F6':
        // Cycle through main areas
        event.preventDefault();
        const areas: NavigationContext['area'][] = ['palette', 'canvas', 'properties'];
        const currentAreaIndex = areas.indexOf(currentContext.area);
        const nextAreaIndex = (currentAreaIndex + 1) % areas.length;
        navigateToArea(areas[nextAreaIndex]);
        break;

      case 'ArrowUp':
        if (isNavigationMode) {
          event.preventDefault();
          navigateWithinArea('up');
        }
        break;

      case 'ArrowDown':
        if (isNavigationMode) {
          event.preventDefault();
          navigateWithinArea('down');
        }
        break;

      case 'ArrowLeft':
        if (isNavigationMode) {
          event.preventDefault();
          navigateWithinArea('left');
        }
        break;

      case 'ArrowRight':
        if (isNavigationMode) {
          event.preventDefault();
          navigateWithinArea('right');
        }
        break;

      case 'Enter':
      case ' ':
        if (isNavigationMode) {
          event.preventDefault();
          activateCurrentItem();
        }
        break;

      case 'Escape':
        event.preventDefault();
        setIsNavigationMode(false);
        announce('Navigation mode disabled');
        break;

      case '?':
        // Show keyboard shortcuts help
        if (event.shiftKey) {
          event.preventDefault();
          showKeyboardHelp();
        }
        break;
    }
  }, [currentContext, isNavigationMode, navigateToArea, navigateWithinArea, activateCurrentItem, announce]);

  /**
   * Show keyboard shortcuts help
   */
  const showKeyboardHelp = useCallback(() => {
    const shortcuts = [
      'F6: Navigate between areas',
      'Arrow keys: Navigate within area',
      'Enter/Space: Activate item',
      'Escape: Exit navigation mode',
      'Shift+?: Show this help'
    ];

    announce(`Keyboard shortcuts: ${shortcuts.join(', ')}`);
  }, [announce]);

  /**
   * Create skip links for screen readers
   */
  const createSkipLinks = useCallback(() => {
    const skipLinks = [
      { href: '#component-palette', text: 'Skip to component palette' },
      { href: '#template-canvas', text: 'Skip to template canvas' },
      { href: '#properties-panel', text: 'Skip to properties panel' }
    ];

    return skipLinks.map((link, index) => ({
      id: generateId('skip-link'),
      href: link.href,
      text: link.text,
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        const target = document.querySelector(link.href);
        if (target instanceof HTMLElement) {
          target.focus();
          navigateToArea(index === 0 ? 'palette' : index === 1 ? 'canvas' : 'properties');
        }
      }
    }));
  }, [generateId, navigateToArea]);

  /**
   * Get ARIA attributes for navigation areas
   */
  const getAreaAriaAttributes = useCallback((area: NavigationContext['area']) => {
    const isCurrentArea = currentContext.area === area;

    return {
      'aria-label': getAreaLabel(area),
      'aria-current': isCurrentArea ? ('page' as const) : undefined,
      tabIndex: isCurrentArea && isNavigationMode ? 0 : -1,
      role: getAreaRole(area)
    };
  }, [currentContext.area, isNavigationMode]);

  /**
   * Get area label for screen readers
   */
  const getAreaLabel = (area: NavigationContext['area']): string => {
    switch (area) {
      case 'palette':
        return 'Component palette - drag components to add them to your template';
      case 'canvas':
        return 'Template canvas - your template components and drop zones';
      case 'properties':
        return 'Properties panel - edit selected component properties';
      case 'variable-picker':
        return 'Variable picker - insert dynamic variables into your template';
      default:
        return '';
    }
  };

  /**
   * Get appropriate ARIA role for area
   */
  const getAreaRole = (area: NavigationContext['area']): string => {
    switch (area) {
      case 'palette':
        return 'toolbar';
      case 'canvas':
        return 'main';
      case 'properties':
        return 'form';
      case 'variable-picker':
        return 'listbox';
      default:
        return 'region';
    }
  };

  // Set up keyboard event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Announce when navigation mode changes
  useEffect(() => {
    if (isNavigationMode) {
      announce('Navigation mode enabled. Use arrow keys to navigate, Enter to activate, Escape to exit.');
    }
  }, [isNavigationMode, announce]);

  return {
    // State
    currentContext,
    isNavigationMode,

    // Functions
    navigateToArea,
    navigateWithinArea,
    activateCurrentItem,
    showKeyboardHelp,
    createSkipLinks,
    getAreaAriaAttributes,

    // Refs
    containerRef,
    skipLinksRef
  };
};

export default useVisualBuilderKeyboard;
