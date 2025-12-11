import React, { forwardRef, useImperativeHandle } from 'react';
import { Variable, ControlFlowHelper, ComponentType } from '../../types/variable';
import { useVariableAutocomplete } from '../../hooks/useVariableAutocomplete';
import { Input } from '../ui/Input';
import { TextArea } from '../ui/TextArea';
import { VariableAutocomplete } from './VariableAutocomplete';

interface VariableAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onVariableInsert?: (variable: Variable, position: number) => void;
  onControlFlowInsert?: (helper: ControlFlowHelper, position: number) => void;
  contextType?: ComponentType;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  className?: string;
  autoFocus?: boolean;
  maxSuggestions?: number;
}

export interface VariableAutocompleteInputRef {
  focus: () => void;
  blur: () => void;
  insertVariable: (variable: Variable) => void;
  insertControlFlow: (helper: ControlFlowHelper) => void;
}

export const VariableAutocompleteInput = forwardRef<
  VariableAutocompleteInputRef,
  VariableAutocompleteInputProps
>(({
  value,
  onChange,
  onVariableInsert,
  onControlFlowInsert,
  contextType,
  placeholder,
  disabled = false,
  multiline = false,
  rows = 3,
  className = '',
  autoFocus = false,
  maxSuggestions = 10
}, ref) => {
  const {
    inputRef,
    inputValue,
    isAutocompleteVisible,
    autocompletePosition,
    handleVariableSelect,
    handleControlFlowSelect,
    handleAutocompleteClose,
    setInputValue
  } = useVariableAutocomplete({
    contextType,
    onVariableInsert,
    onControlFlowInsert,
    disabled
  });

  // Sync internal value with external value
  React.useEffect(() => {
    if (value !== inputValue) {
      setInputValue(value);
    }
  }, [value, inputValue, setInputValue]);

  // Handle input changes
  const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
  }, [setInputValue, onChange]);

  // Expose methods through ref
  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    },
    blur: () => {
      inputRef.current?.blur();
    },
    insertVariable: (variable: Variable) => {
      handleVariableSelect(variable);
    },
    insertControlFlow: (helper: ControlFlowHelper) => {
      handleControlFlowSelect(helper);
    }
  }), [handleVariableSelect, handleControlFlowSelect]);

  const inputProps = {
    ref: inputRef,
    value: inputValue,
    onChange: handleInputChange,
    placeholder,
    disabled,
    className,
    autoFocus
  };

  return (
    <div className="relative">
      {multiline ? (
        <TextArea
          {...inputProps}
          rows={rows}
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        />
      ) : (
        <Input
          {...inputProps}
          ref={inputRef as React.RefObject<HTMLInputElement>}
        />
      )}

      {isAutocompleteVisible && autocompletePosition && (
        <VariableAutocomplete
          inputValue={inputValue}
          onSuggestionSelect={handleVariableSelect}
          onControlFlowInsert={handleControlFlowSelect}
          contextType={contextType}
          maxSuggestions={maxSuggestions}
          position={autocompletePosition}
          onClose={handleAutocompleteClose}
        />
      )}
    </div>
  );
});

VariableAutocompleteInput.displayName = 'VariableAutocompleteInput';

export default VariableAutocompleteInput;
