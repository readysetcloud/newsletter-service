import { useCallback, useEffect, useRef, useState } from 'react';

export interface NavigationItem {
  id: string;
  element?: HTMLElement;
  focusable?: boolean;
  disabled?: boolean;
}

interface UseKeyboardNavigationOptions {
  items: NavigationItem[];
  orientation?: 'horizontal' | 'vertical' | 'both';
  loop?: boolean;
  autoFocus?: boolean;
  onSelectionChange?: (selectedId: string | null, selectedIndex: number) => void;
  onActivate?: (selectedId: string, selectedIndex: number) => void;
}

export const useKeyboardNavigation = ({
  items,
  orientation = 'vertical',
  loop = true,
  autoFocus = false,
  onSelectionChange,
  onActivate
}: UseKeyboardNavigationOptions) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<NavigationItem[]>([]);

  // Update items ref when items change
  useEffect(() => {
    itemsRef.current = items.filter(item => !item.disabled);
  }, [items]);

  // Auto focus first item if enabled
  useEffect(() => {
    if (autoFocus && itemsRef.current.length > 0 && selectedIndex === -1) {
      setSelectedIndex(0);
    }
  }, [autoFocus, selectedIndex]);

  // Notify selection changes
  useEffect(() => {
    const selectedItem = itemsRef.current[selectedIndex];
    onSelectionChange?.(selectedItem?.id || null, selectedIndex);
  }, [selectedIndex, onSelectionChange]);

  const moveSelection = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const currentItems = itemsRef.current;
    if (currentItems.length === 0) return;

    let newIndex = selectedIndex;

    switch (direction) {
      case 'up':
        if (orientation === 'vertical' || orientation === 'both') {
          newIndex = selectedIndex <= 0
            ? (loop ? currentItems.length - 1 : 0)
            : selectedIndex - 1;
        }
        break;
      case 'down':
        if (orientation === 'vertical' || orientation === 'both') {
          newIndex = selectedIndex >= currentItems.length - 1
            ? (loop ? 0 : currentItems.length - 1)
            : selectedIndex + 1;
        }
        break;
      case 'left':
        if (orientation === 'horizontal' || orientation === 'both') {
          newIndex = selectedIndex <= 0
            ? (loop ? currentItems.length - 1 : 0)
            : selectedIndex - 1;
        }
        break;
      case 'right':
        if (orientation === 'horizontal' || orientation === 'both') {
          newIndex = selectedIndex >= currentItems.length - 1
            ? (loop ? 0 : currentItems.length - 1)
            : selectedIndex + 1;
        }
        break;
    }

    if (newIndex !== selectedIndex) {
      setSelectedIndex(newIndex);

      // Focus the element if it exists
      const selectedItem = currentItems[newIndex];
      if (selectedItem?.element && selectedItem.focusable !== false) {
        selectedItem.element.focus();
      }
    }
  }, [selectedIndex, orientation, loop]);

  const activateSelection = useCallback(() => {
    const selectedItem = itemsRef.current[selectedIndex];
    if (selectedItem) {
      onActivate?.(selectedItem.id, selectedIndex);
    }
  }, [selectedIndex, onActivate]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveSelection('up');
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveSelection('down');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveSelection('left');
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveSelection('right');
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activateSelection();
        break;
      case 'Home':
        event.preventDefault();
        if (itemsRef.current.length > 0) {
          setSelectedIndex(0);
        }
        break;
      case 'End':
        event.preventDefault();
        if (itemsRef.current.length > 0) {
          setSelectedIndex(itemsRef.current.length - 1);
        }
        break;
    }
  }, [moveSelection, activateSelection]);

  // Set up keyboard event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const setSelectedById = useCallback((id: string) => {
    const index = itemsRef.current.findIndex(item => item.id === id);
    if (index !== -1) {
      setSelectedIndex(index);
    }
  }, []);

  const setSelectedByIndex = useCallback((index: number) => {
    if (index >= 0 && index < itemsRef.current.length) {
      setSelectedIndex(index);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIndex(-1);
  }, []);

  return {
    containerRef,
    selectedIndex,
    selectedId: itemsRef.current[selectedIndex]?.id || null,
    setSelectedById,
    setSelectedByIndex,
    clearSelection,
    moveSelection,
    activateSelection,
    handleKeyDown
  };
};

export default useKeyboardNavigation;
