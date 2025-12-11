import { useState, useCallback, useRef, useEffect } from 'react';
import { Variable, ControlFlowHelper, ComponentType } from '../types/variable';

interface UseVariableAutocompleteOptions {
  contextType?: ComponentType;
  onVariableInsert?: (variable: Variable, insertPosition: number) => void;
  onControlFlowInsert?: (helper: ControlFlowHelper, insertPosition: number) => void;
  disabled?: boolean;
}

interface AutocompletePosition {
  top: number;
  left: number;
}

export const useVariableAutocomplete = ({
  contextType,
  onVariableInsert,
  onControlFlowInsert,
  disabled = false
}: UseVariableAutocompleteOptions = {}) => {
  const [inputValue, setInputValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [autocompletePosition, setAutocompletePosition] = useState<AutocompletePosition | null>(null);
  const [isAutocompleteVisible, setIsAutocompleteVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Calculate autocomplete position based on cursor
  const calculateAutocompletePosition = useCallback(() => {
    if (!inputRef.current) return null;

    const input = inputRef.current;
    const rect = input.getBoundingClientRect();

    // Create a temporary element to measure text width
    const temp = document.createElement('div');
    temp.style.position = 'absolute';
    temp.style.visibility = 'hidden';
    temp.style.whiteSpace = 'pre';
    temp.style.font = window.getComputedStyle(input).font;
    temp.textContent = inputValue.slice(0, cursorPosition);
    document.body.appendChild(temp);

    const textWidth = temp.offsetWidth;
    document.body.removeChild(temp);

    // Calculate position
    const lineHeight = parseInt(window.getComputedStyle(input).lineHeight) || 20;
    const paddingLeft = parseInt(window.getComputedStyle(input).paddingLeft) || 0;

    return {
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX + paddingLeft + Math.min(textWidth, rect.width - paddingLeft - 20)
    };
  }, [inputValue, cursorPosition]);

  // Handle input value changes
  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);

    if (!disabled) {
      // Check if we should show autocomplete
      const triggerPattern = /\{\{[\w.#]*$/;
      const match = value.match(triggerPattern);

      if (match) {
        const position = calculateAutocompletePosition();
        if (position) {
          setAutocompletePosition(position);
          setIsAutocompleteVisible(true);
        }
      } else {
        setIsAutocompleteVisible(false);
        setAutocompletePosition(null);
      }
    }
  }, [disabled, calculateAutocompletePosition]);

  // Handle cursor position changes
  const handleCursorPositionChange = useCallback((position: number) => {
    setCursorPosition(position);
  }, []);

  // Handle variable selection from autocomplete
  const handleVariableSelect = useCallback((variable: Variable) => {
    if (!inputRef.current) return;

    const input = inputRef.current;
    const value = input.value;

    // Find the trigger pattern position
    const beforeCursor = value.slice(0, cursorPosition);
    const triggerMatch = beforeCursor.match(/\{\{[\w.#]*$/);

    if (triggerMatch) {
      const triggerStart = beforeCursor.length - triggerMatch[0].length;
      const variableSyntax = `{{${variable.path}}}`;

      // Replace the trigger pattern with the variable syntax
      const newValue =
        value.slice(0, triggerStart) +
        variableSyntax +
        value.slice(cursorPosition);

      const newCursorPosition = triggerStart + variableSyntax.length;

      setInputValue(newValue);
      setIsAutocompleteVisible(false);
      setAutocompletePosition(null);

      // Update the actual input element
      input.value = newValue;
      input.setSelectionRange(newCursorPosition, newCursorPosition);
      input.focus();

      // Trigger change event
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);

      // Call the callback
      onVariableInsert?.(variable, newCursorPosition);
    }
  }, [cursorPosition, onVariableInsert]);

  // Handle control flow selection from autocomplete
  const handleControlFlowSelect = useCallback((helper: ControlFlowHelper) => {
    if (!inputRef.current) return;

    const input = inputRef.current;
    const value = input.value;

    // Find the trigger pattern position
    const beforeCursor = value.slice(0, cursorPosition);
    const triggerMatch = beforeCursor.match(/\{\{#[\w]*$/);

    if (triggerMatch) {
      const triggerStart = beforeCursor.length - triggerMatch[0].length;

      // Create the control flow insertion
      const openingTag = helper.syntax.replace('condition', 'your.condition').replace('items', 'your.items').replace('object', 'your.object');
      const closingTag = helper.closingSyntax || '';

      let insertion: string;
      let newCursorPosition: number;

      if (closingTag) {
        // Block helper with closing tag
        insertion = `${openingTag}\n  \n${closingTag}`;
        newCursorPosition = triggerStart + openingTag.length + 3; // Position inside the block
      } else {
        // Simple helper
        insertion = openingTag;
        newCursorPosition = triggerStart + insertion.length;
      }

      // Replace the trigger pattern with the control flow syntax
      const newValue =
        value.slice(0, triggerStart) +
        insertion +
        value.slice(cursorPosition);

      setInputValue(newValue);
      setIsAutocompleteVisible(false);
      setAutocompletePosition(null);

      // Update the actual input element
      input.value = newValue;
      input.setSelectionRange(newCursorPosition, newCursorPosition);
      input.focus();

      // Trigger change event
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);

      // Call the callback
      onControlFlowInsert?.(helper, newCursorPosition);
    }
  }, [cursorPosition, onControlFlowInsert]);

  // Handle autocomplete close
  const handleAutocompleteClose = useCallback(() => {
    setIsAutocompleteVisible(false);
    setAutocompletePosition(null);
  }, []);

  // Set up input event listeners
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      handleInputChange(target.value);
      handleCursorPositionChange(target.selectionStart || 0);
    };

    const handleSelectionChange = () => {
      handleCursorPositionChange(input.selectionStart || 0);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Update cursor position on key navigation
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        handleCursorPositionChange(input.selectionStart || 0);
      }
    };

    const handleClick = () => {
      handleCursorPositionChange(input.selectionStart || 0);
    };

    input.addEventListener('input', handleInput);
    input.addEventListener('selectionchange', handleSelectionChange);
    input.addEventListener('keyup', handleKeyUp as EventListener);
    input.addEventListener('click', handleClick);

    return () => {
      input.removeEventListener('input', handleInput);
      input.removeEventListener('selectionchange', handleSelectionChange);
      input.removeEventListener('keyup', handleKeyUp as EventListener);
      input.removeEventListener('click', handleClick);
    };
  }, [handleInputChange, handleCursorPositionChange]);

  // Update autocomplete position when window resizes
  useEffect(() => {
    const handleResize = () => {
      if (isAutocompleteVisible) {
        const position = calculateAutocompletePosition();
        if (position) {
          setAutocompletePosition(position);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isAutocompleteVisible, calculateAutocompletePosition]);

  return {
    inputRef,
    inputValue,
    isAutocompleteVisible,
    autocompletePosition,
    contextType,
    handleVariableSelect,
    handleControlFlowSelect,
    handleAutocompleteClose,
    setInputValue: handleInputChange,
    setCursorPosition: handleCursorPositionChange
  };
};

export default useVariableAutocomplete;
