import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Braces, X } from 'lucide-react';
import { Variable, ComponentType, VariableInputButtonProps } from '../../types/variable';
import { VariablePicker } from './VariablePicker';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';

/**
 * VariableInputButton component for integrating variable picker with text input fields
 *
 * Features:
 * - Positioned at the right edge of input fields
 * - Opens variable picker in modal or dropdown mode
 * - Inserts variable syntax at cursor position
 * - Supports contextual variable filtering
 * - Handles both regular variables and control flow helpers
 */
export const VariableInputButton: React.FC<VariableInputButtonProps & { availableVariables?: Variable[] }> = ({
  inputRef,
  onVariableInsert,
  contextType,
  disabled = false,
  className = '',
  availableVariables
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 320
  });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Calculate picker position relative to the button
  const calculatePickerPosition = useCallback(() => {
    if (!buttonRef.current || !inputRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const inputRect = inputRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Preferred width for the picker
    const pickerWidth = 320;

    // Calculate horizontal position
    let left = buttonRect.right - pickerWidth;

    // Ensure picker doesn't go off-screen horizontally
    if (left < 10) {
      left = Math.min(buttonRect.left, viewportWidth - pickerWidth - 10);
    }

    // Calculate vertical position
    let top = buttonRect.bottom + 4;

    // If picker would go off-screen vertically, position it above the input
    const pickerHeight = 400; // Approximate picker height
    if (top + pickerHeight > viewportHeight - 20) {
      top = buttonRect.top - pickerHeight - 4;
    }

    setPickerPosition({
      top: Math.max(10, top),
      left: Math.max(10, left),
      width: pickerWidth
    });
  }, [inputRef]);

  // Handle opening the picker
  const handleOpenPicker = useCallback(() => {
    if (disabled) return;

    calculatePickerPosition();
    setIsPickerOpen(true);
  }, [disabled, calculatePickerPosition]);

  // Handle closing the picker
  const handleClosePicker = useCallback(() => {
    setIsPickerOpen(false);
  }, []);

  // Handle variable selection
  const handleVariableSelect = useCallback((variable: Variable) => {
    // Insert variable at current cursor position or at the end
    if (inputRef.current) {
      const input = inputRef.current;
      const cursorPosition = input.selectionStart || input.value.length;
      const variableSyntax = `{{${variable.path}}}`;

      // Create new value with variable inserted
      const newValue =
        input.value.slice(0, cursorPosition) +
        variableSyntax +
        input.value.slice(input.selectionEnd || cursorPosition);

      // Update input value
      input.value = newValue;

      // Set cursor position after the inserted variable
      const newCursorPosition = cursorPosition + variableSyntax.length;
      setTimeout(() => {
        input.setSelectionRange(newCursorPosition, newCursorPosition);
        input.focus();
      }, 0);

      // Trigger change event for form libraries
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);
    }

    // Call the provided callback
    onVariableInsert(variable);

    // Close the picker
    handleClosePicker();
  }, [inputRef, onVariableInsert, handleClosePicker]);

  // Handle control flow helper selection
  const handleControlFlowSelect = useCallback((helper: any) => {
    if (inputRef.current) {
      const input = inputRef.current;
      const cursorPosition = input.selectionStart || input.value.length;

      // Create control flow insertion
      const openingTag = helper.syntax.replace('condition', 'your.condition').replace('items', 'your.items').replace('object', 'your.object');
      const closingTag = helper.closingSyntax || '';

      let insertion: string;
      let newCursorPosition: number;

      if (closingTag) {
        // Block helper with opening and closing tags
        insertion = `${openingTag}\n  \n${closingTag}`;
        newCursorPosition = cursorPosition + openingTag.length + 3; // Position inside the block
      } else {
        // Simple helper
        insertion = openingTag;
        newCursorPosition = cursorPosition + insertion.length;
      }

      // Create new value with control flow inserted
      const newValue =
        input.value.slice(0, cursorPosition) +
        insertion +
        input.value.slice(input.selectionEnd || cursorPosition);

      // Update input value
      input.value = newValue;

      // Set cursor position
      setTimeout(() => {
        input.setSelectionRange(newCursorPosition, newCursorPosition);
        input.focus();
      }, 0);

      // Trigger change event for form libraries
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);
    }

    // Close the picker
    handleClosePicker();
  }, [inputRef, handleClosePicker]);

  // Handle clicks outside the picker to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isPickerOpen &&
        pickerRef.current &&
        buttonRef.current &&
        !pickerRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        handleClosePicker();
      }
    };

    if (isPickerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('scroll', handleClosePicker, true);
      window.addEventListener('resize', handleClosePicker);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleClosePicker, true);
      window.removeEventListener('resize', handleClosePicker);
    };
  }, [isPickerOpen, handleClosePicker]);

  // Handle escape key to close picker
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isPickerOpen) {
        handleClosePicker();
      }
    };

    if (isPickerOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPickerOpen, handleClosePicker]);

  return (
    <>
      {/* Variable Input Button */}
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleOpenPicker}
        className={cn(
          'absolute right-1 top-1/2 -translate-y-1/2',
          'h-8 w-8 p-0 rounded-md',
          'text-gray-400 hover:text-gray-600 hover:bg-gray-100',
          'focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
          'transition-all duration-200',
          'z-10',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        title="Insert variable"
        aria-label="Insert variable"
      >
        <Braces className="h-4 w-4" />
      </Button>

      {/* Variable Picker Modal/Dropdown */}
      {isPickerOpen && (
        <>
          {/* Backdrop for mobile */}
          <div
            className="fixed inset-0 bg-black bg-opacity-25 z-40 md:hidden"
            onClick={handleClosePicker}
          />

          {/* Picker Container */}
          <div
            ref={pickerRef}
            className="fixed z-50 shadow-lg rounded-lg border border-gray-200 bg-white"
            style={{
              top: `${pickerPosition.top}px`,
              left: `${pickerPosition.left}px`,
              width: `${pickerPosition.width}px`,
              maxHeight: '400px'
            }}
          >
            {/* Close button for mobile */}
            <div className="flex items-center justify-between p-3 border-b border-gray-100 md:hidden">
              <h3 className="text-sm font-medium text-gray-900">Insert Variable</h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClosePicker}
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Variable Picker */}
            <VariablePicker
              onVariableSelect={handleVariableSelect}
              onControlFlowSelect={handleControlFlowSelect}
              contextType={contextType}
              position="inline"
              showControlFlow={true}
              maxHeight="350px"
              className="border-0 shadow-none"
              availableVariables={availableVariables}
            />
          </div>
        </>
      )}
    </>
  );
};

export default VariableInputButton;
