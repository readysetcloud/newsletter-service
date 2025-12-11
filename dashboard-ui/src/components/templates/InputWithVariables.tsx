import React, { useRef } from 'react';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { useVariableSuggestions } from '@/hooks/useVariableSuggestions';
import { cn } from '@/utils/cn';

interface Variable {
  path: string;
  name: string;
  type: string;
  sampleValue?: any;
  description?: string;
}

interface InputWithVariablesProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  testData?: string;
  multiline?: boolean;
  rows?: number;
}

export const InputWithVariables: React.FC<InputWithVariablesProps> = ({
  value,
  onChange,
  placeholder,
  className,
  testData,
  multiline = false,
  rows = 1
}) => {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const handleVariableInsert = (variable: Variable) => {
    if (!inputRef.current) return;

    const input = inputRef.current;
    const cursorPos = input.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPos);
    const textAfterCursor = value.substring(cursorPos);
    const match = textBeforeCursor.match(/\{\{([^}]*)$/);

    if (match) {
      const startPos = textBeforeCursor.length - match[0].length;
      const newValue = value.substring(0, startPos) + `{{${variable.path}}}` + textAfterCursor;

      // Create a synthetic event to trigger onChange
      const syntheticEvent = {
        target: { value: newValue },
        currentTarget: { value: newValue }
      } as React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>;

      onChange(syntheticEvent);

      // Set cursor position after insertion
      setTimeout(() => {
        const newCursorPos = startPos + variable.path.length + 4; // 4 for {{}}
        input.setSelectionRange(newCursorPos, newCursorPos);
        input.focus();
      }, 0);
    }
  };

  const {
    showSuggestions,
    suggestions,
    selectedIndex,
    position,
    handleInputChange,
    handleKeyDown,
    selectSuggestion
  } = useVariableSuggestions({
    testData,
    onInsert: handleVariableInsert
  });

  const InputComponent = multiline ? TextArea : Input;

  return (
    <div className="relative">
      <InputComponent
        ref={inputRef as any}
        value={value}
        onChange={(e) => handleInputChange(e, onChange)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        rows={multiline ? rows : undefined}
      />

      {/* Variable Suggestions Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          className="fixed bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-48 overflow-y-auto min-w-80"
          style={{
            top: position.top + 4,
            left: position.left,
            maxWidth: '320px'
          }}
        >
          {suggestions.map((variable, index) => (
            <div
              key={variable.path}
              className={cn(
                'px-3 py-2 cursor-pointer text-sm border-b border-gray-100 last:border-b-0',
                index === selectedIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
              )}
              onClick={() => selectSuggestion(index)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-blue-600">
                    {variable.path}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {variable.description}
                  </div>
                </div>
                <div className="ml-2 text-xs text-gray-400">
                  {variable.type}
                </div>
              </div>
              {variable.sampleValue !== undefined && (
                <div className="text-xs text-gray-600 mt-1 font-mono bg-gray-50 px-2 py-1 rounded">
                  {typeof variable.sampleValue === 'object'
                    ? JSON.stringify(variable.sampleValue).substring(0, 50) + '...'
                    : String(variable.sampleValue)
                  }
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
