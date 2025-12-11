import React, { useState, useCallback, useMemo } from 'react';
import { ControlFlowHelper, Variable, ComponentType } from '../../types/variable';
import { VARIABLE_DEFINITIONS } from '../../data/variableDefinitions';
import { useControlFlow } from '../../hooks/useControlFlow';
import { VariableAutocomplete } from './VariableAutocomplete';
import { ControlFlowPicker } from './ControlFlowPicker';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { X, ArrowLeft } from 'lucide-react';

interface ControlFlowAutocompleteProps {
  inputValue: string;
  onSuggestionSelect: (variable: Variable) => void;
  onControlFlowInsert: (insertion: string) => void;
  contextType?: ComponentType;
  availableVariables: Variable[];
  className?: string;
  position?: { top: number; left: number };
  onClose?: () => void;
  targetInput?: HTMLInputElement | HTMLTextAreaElement;
}

interface ControlFlowState {
  mode: 'autocomplete' | 'parameter_form';
  selectedHelper: ControlFlowHelper | null;
}

export const ControlFlowAutocomplete: React.FC<ControlFlowAutocompleteProps> = ({
  inputValue,
  onSuggestionSelect,
  onControlFlowInsert,
  contextType,
  availableVariables,
  className = '',
  position,
  onClose,
  targetInput
}) => {
  const [state, setState] = useState<ControlFlowState>({
    mode: 'autocomplete',
    selectedHelper: null
  });

  const { insertHelper, wrapSelectedText } = useControlFlow({
    availableVariables,
    onInsert: (insertion) => {
      onControlFlowInsert(insertion.openingTag);
    },
    onError: (error) => {
      console.error('Control flow error:', error);
    }
  });

  // Handle control flow helper selection from autocomplete
  const handleControlFlowSelect = useCallback((helper: ControlFlowHelper) => {
    if (helper.parameters.length === 0) {
      // No parameters needed, insert immediately
      const insertion = `${helper.syntax}${helper.closingSyntax ? `\n  \n${helper.closingSyntax}` : ''}`;
      onControlFlowInsert(insertion);
      onClose?.();
    } else {
      // Show parameter form
      setState({
        mode: 'parameter_form',
        selectedHelper: helper
      });
    }
  }, [onControlFlowInsert, onClose]);

  // Handle parameter form submission
  const handleParameterSubmit = useCallback((helper: ControlFlowHelper, parameters: Record<string, string>) => {
    // Generate the control flow insertion
    let openingTag = helper.syntax;

    // Replace parameter placeholders
    helper.parameters.forEach(param => {
      const value = parameters[param.name] || '';
      openingTag = openingTag.replace(param.name, value);
    });

    // Create full insertion with content template and closing tag
    let fullInsertion = openingTag;

    // Add content template based on helper type
    switch (helper.category) {
      case 'conditional':
        fullInsertion += '\n  <!-- Content shown when condition is true -->\n  ';
        break;
      case 'iterator':
        fullInsertion += '\n  <!-- Content repeated for each item -->\n  ';
        break;
      case 'custom':
        fullInsertion += '\n  <!-- Content within this context -->\n  ';
        break;
      default:
        fullInsertion += '\n  ';
    }

    if (helper.closingSyntax) {
      fullInsertion += `\n${helper.closingSyntax}`;
    }

    onControlFlowInsert(fullInsertion);
    onClose?.();
  }, [onControlFlowInsert, onClose]);

  // Handle back to autocomplete
  const handleBackToAutocomplete = useCallback(() => {
    setState({
      mode: 'autocomplete',
      selectedHelper: null
    });
  }, []);

  // Handle close
  const handleClose = useCallback(() => {
    setState({
      mode: 'autocomplete',
      selectedHelper: null
    });
    onClose?.();
  }, [onClose]);

  const containerStyle = position ? {
    position: 'absolute' as const,
    top: position.top,
    left: position.left,
    zIndex: 1000
  } : {};

  if (state.mode === 'parameter_form' && state.selectedHelper) {
    return (
      <div className={className} style={containerStyle}>
        <Card className="w-96 shadow-lg border border-gray-200">
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBackToAutocomplete}
                  className="h-6 w-6 p-0"
                >
                  <ArrowLeft className="w-3 h-3" />
                </Button>
                <h3 className="text-sm font-medium text-gray-900">
                  Configure {state.selectedHelper.name}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                className="h-6 w-6 p-0"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {state.selectedHelper.description}
            </p>
          </div>

          <div className="p-4">
            <ControlFlowPicker
              onHelperSelect={handleParameterSubmit}
              availableVariables={availableVariables}
              contextType={contextType}
              className="border-0 shadow-none"
            />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={className} style={containerStyle}>
      <VariableAutocomplete
        inputValue={inputValue}
        onSuggestionSelect={onSuggestionSelect}
        onControlFlowInsert={handleControlFlowSelect}
        contextType={contextType}
        onClose={handleClose}
      />
    </div>
  );
};

export default ControlFlowAutocomplete;
