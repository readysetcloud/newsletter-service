import React, { useState, useRef } from 'react';
import {
  ControlFlowPicker,
  ControlFlowAutocomplete,
  VariableInputButton
} from '../components/templates';
import { useControlFlow } from '../hooks/useControlFlow';
import { VARIABLE_DEFINITIONS } from '../data/variableDefinitions';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { TextArea } from '../components/ui/TextArea';
import { Badge } from '../components/ui/Badge';

/**
 * Examp of the Control Flow System components
 * Demonstrates how to use ControlFlowPicker, ControlFlowAutocomplete, and related hooks
 */
export const ControlFlowSystemUsage: React.FC = () => {
  const [textValue, setTextValue] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Get all available variables for the control flow system
  const availableVariables = Object.values(VARIABLE_DEFINITIONS.categories)
    .flatMap(category => category.variables)
    .filter(variable => variable.category !== 'control_flow');

  const {
    helpers,
    insertHelper,
    validateSyntax,
    formatCode,
    extractHelpers,
    isInserting,
    lastError
  } = useControlFlow({
    availableVariables,
    onInsert: (insertion) => {
      console.log('Control flow inserted:', insertion);
      if (textAreaRef.current) {
        const start = textAreaRef.current.selectionStart || 0;
        const end = textAreaRef.current.selectionEnd || 0;
        const currentValue = textAreaRef.current.value;

        const newValue =
          currentValue.substring(0, start) +
          insertion.openingTag +
          currentValue.substring(end);

        setTextValue(newValue);

        // Position cursor
        setTimeout(() => {
          if (textAreaRef.current) {
            const newCursorPosition = start + insertion.cursorPosition;
            textAreaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
            textAreaRef.current.focus();
          }
        }, 0);
      }
    },
    onError: (error) => {
      console.error('Control flow error:', error);
    }
  });

  const handleHelperSelect = (helper: any, parameters: Record<string, string>) => {
    insertHelper(helper, parameters, textAreaRef.current || undefined);
    setShowPicker(false);
  };

  const handleValidate = () => {
    const result = validateSyntax(textValue);
    setValidationResult(result);
  };

  const handleFormat = () => {
    const formatted = formatCode(textValue);
    setTextValue(formatted);
  };

  const handleExtractHelpers = () => {
    const extracted = extractHelpers(textValue);
    console.log('Extracted helpers:', extracted);
  };

  const detectedHelpers = extractHelpers(textValue);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Control Flow System Usage Examples
        </h2>
        <p className="text-gray-600 mb-6">
          This page demonstrates the control flow helper system for template building.
        </p>
      </div>

      {/* Text Editor with Control Flow Support */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Template Editor with Control Flow
        </h3>

        <div className="space-y-4">
          <div className="relative">
            <TextArea
              ref={textAreaRef}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Type your template here... Use {{ for variables or {{# for control flow helpers"
              className="min-h-48 font-mono text-sm"
            />

            {/* Control Flow Autocomplete */}
            {showAutocomplete && (
              <div className="absolute top-full left-0 mt-1 z-10">
                <ControlFlowAutocomplete
                  inputValue={textValue}
                  onSuggestionSelect={(variable) => {
                    console.log('Variable selected:', variable);
                  }}
                  onControlFlowInsert={(insertion) => {
                    console.log('Control flow inserted:', insertion);
                    setShowAutocomplete(false);
                  }}
                  availableVariables={availableVariables}
                  onClose={() => setShowAutocomplete(false)}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setShowPicker(!showPicker)}
              variant="outline"
            >
              {showPicker ? 'Hide' : 'Show'} Control Flow Picker
            </Button>

            <Button
              onClick={() => setShowAutocomplete(!showAutocomplete)}
              variant="outline"
            >
              {showAutocomplete ? 'Hide' : 'Show'} Autocomplete
            </Button>

            <Button onClick={handleValidate} variant="outline">
              Validate Syntax
            </Button>

            <Button onClick={handleFormat} variant="outline">
              Format Code
            </Button>

            <Button onClick={handleExtractHelpers} variant="outline">
              Extract Helpers
            </Button>
          </div>

          {isInserting && (
            <div className="text-sm text-blue-600">
              Inserting control flow helper...
            </div>
          )}

          {lastError && (
            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
              Error: {lastError}
            </div>
          )}
        </div>
      </Card>

      {/* Control Flow Picker */}
      {showPicker && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Control Flow Picker
          </h3>
          <ControlFlowPicker
            onHelperSelect={handleHelperSelect}
            availableVariables={availableVariables}
            contextType="text"
          />
        </Card>
      )}

      {/* Validation Results */}
      {validationResult && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Validation Results
          </h3>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Badge variant={validationResult.isValid ? 'success' : 'error'}>
                {validationResult.isValid ? 'Valid' : 'Invalid'}
              </Badge>
              <span className="text-sm text-gray-600">
                {validationResult.errors.length} error(s) found
              </span>
            </div>

            {validationResult.errors.length > 0 && (
              <div className="space-y-2">
                {validationResult.errors.map((error: any, index: number) => (
                  <div key={index} className="text-sm text-red-600 bg-red-50 p-2 rounded">
                    Line {error.line}, Column {error.column}: {error.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Detected Helpers */}
      {detectedHelpers.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Detected Control Flow Helpers
          </h3>

          <div className="space-y-2">
            {detectedHelpers.map((helper, index) => (
              <div key={index} className="flex items-center space-x-2 text-sm">
                <Badge variant="outline">{helper.type}</Badge>
                <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                  {helper.openingTag}
                </code>
                <span className="text-gray-500">
                  at line {helper.line}, column {helper.column}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Available Helpers Reference */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Available Control Flow Helpers
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {helpers.map((helper) => (
            <div key={helper.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Badge variant="outline">{helper.category}</Badge>
                <h4 className="font-medium">{helper.name}</h4>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium">Syntax:</span>
                  <code className="ml-2 bg-gray-100 px-2 py-1 rounded text-xs">
                    {helper.syntax}
                  </code>
                  {helper.closingSyntax && (
                    <>
                      <span className="mx-2">...</span>
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                        {helper.closingSyntax}
                      </code>
                    </>
                  )}
                </div>

                <p className="text-gray-600">{helper.description}</p>

                {helper.parameters.length > 0 && (
                  <div>
                    <span className="font-medium">Parameters:</span>
                    <ul className="ml-4 mt-1 space-y-1">
                      {helper.parameters.map((param) => (
                        <li key={param.name} className="text-xs">
                          <span className="font-medium">{param.name}</span>
                          {param.required && <span className="text-red-500">*</span>}
                          <span className="text-gray-500"> - {param.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default ControlFlowSystemUsage;
