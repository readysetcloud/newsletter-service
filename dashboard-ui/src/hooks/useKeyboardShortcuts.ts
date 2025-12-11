import { useEffect, useCallback, useRef } from 'react';

export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export interface KeyboardShortcutHandler {
  shortcut: KeyboardShortcut;
  handler: (event: KeyboardEvent) => void;
  description?: string;
  enabled?: boolean;
}

interface UseKeyboardShortcutsOptions {
  target?: HTMLElement | Document | Window;
  enabled?: boolean;
}

export const useKeyboardShortcuts = (
  shortcuts: KeyboardShortcutHandler[],
  options: UseKeyboardShortcutsOptions = {}
) => {
  const { target = document, enabled = true } = options;
  const shortcutsRef = useRef(shortcuts);
  const enabledRef = useRef(enabled);

  // Update refs when props change
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabledRef.current) return;

    const activeElement = document.activeElement;
    const isInputElement = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.hasAttribute('contenteditable')
    );

    for (const shortcutHandler of shortcutsRef.current) {
      if (!shortcutHandler.enabled && shortcutHandler.enabled !== undefined) {
        continue;
      }

      const { shortcut, handler } = shortcutHandler;

      // Check if the key matches
      if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
        continue;
      }

      // Check modifier keys
      const ctrlMatch = shortcut.ctrlKey === undefined || shortcut.ctrlKey === event.ctrlKey;
      const metaMatch = shortcut.metaKey === undefined || shortcut.metaKey === event.metaKey;
      const shiftMatch = shortcut.shiftKey === undefined || shortcut.shiftKey === event.shiftKey;
      const altMatch = shortcut.altKey === undefined || shortcut.altKey === event.altKey;

      if (!ctrlMatch || !metaMatch || !shiftMatch || !altMatch) {
        continue;
      }

      // For certain shortcuts, don't trigger when focused on input elements
      const isGlobalShortcut = shortcut.ctrlKey || shortcut.metaKey;
      if (!isGlobalShortcut && isInputElement) {
        continue;
      }

      // Prevent default and stop propagation if specified
      if (shortcut.preventDefault !== false) {
        event.preventDefault();
      }
      if (shortcut.stopPropagation) {
        event.stopPropagation();
      }

      // Call the handler
      handler(event);
      break; // Only handle the first matching shortcut
    }
  }, []);

  useEffect(() => {
    if (!target || !enabled) return;

    const targetElement = target as EventTarget;
    targetElement.addEventListener('keydown', handleKeyDown as EventListener);

    return () => {
      targetElement.removeEventListener('keydown', handleKeyDown as EventListener);
    };
  }, [target, enabled, handleKeyDown]);

  return {
    addShortcut: useCallback((shortcut: KeyboardShortcutHandler) => {
      shortcutsRef.current = [...shortcutsRef.current, shortcut];
    }, []),

    removeShortcut: useCallback((key: string) => {
      shortcutsRef.current = shortcutsRef.current.filter(s => s.shortcut.key !== key);
    }, []),

    getShortcuts: useCallback(() => shortcutsRef.current, [])
  };
};

export default useKeyboardShortcuts;
