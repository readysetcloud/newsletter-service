import React, { useState, useRef, useCallback } from 'react';
import { Variable, ControlFlowHelper, ComponentType } from '../types/variable';
import { VariableAutocomplete, VariableAutocompleteInput } from '../components/templates';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { TextArea } from '../components/ui/TextArea';

/**
 * Example component demonstrating VariableAutocomplete usage
 */
export const VariableAutocompleteUsage: React.FC = () => {
  const [contextType, setContextType] = useState<ComponentType>('heading');
  const [maxSuggestions, setMaxSuggestions] = useState(10);
  const [selectedVariable, setSelectedVariable] = useState<Variable | null>(null);
  const [selectedControlFlow, setSelectedControlFlow] = useState<ControlFlowHelper | null>(null);

  // Basic input example
  const [basicInputValue, setBasicInputValue] = useState('Welcome to {{');
  const [basicInputPosition, setBasicInputPosition] = useState({ top: 0, left: 0 });
  const [showBasicAutocomplete, setShowBasicAutocomplete] = useState(false);
  const basicInputRef = useRef<HTMLInputElement>(null);

  // Enhanced input example
  const [enhancedInputValue, setEnhancedInputValue] = useState('Hello {{subscriber.firstName}}, check out {{#if newsletter.hasSponsors}}our sponsors{{/if}}!');

  // Textarea example
  const [textareaValue, setTextareaValue] = useState(`Subject: {{newsletter.title}}

Hello {{subscriber.firstName}},

{{#if newsletter.featuredArticle}}
Featured Article: {{newsletter.featuredArticle.title}}
{{newsletter.featuredArticle.description}}
{{/if}}

{{#each newsletter.articles}}
- {{this.title}} by {{this.author}}
{{/each}}

Best regards,
{{brand.name}} Team`);

  const [insertionLog, setInsertionLog] = useState<Array<{
    type: 'variable' | 'control_flow';
    item: Variable | ControlFlowHelper;
    position: number;
    timestamp: Date;
  }>>([]);

  // Handle variable selection for basic autocomplete
  const handleBasicVariableSelect = useCallback((variable: Variable) => {
    setSelectedVariable(variable);
    setShowBasicAutocomplete(false);

    // Insert variable into basic input
    if (basicInputRef.current) {
      const input = basicInputRef.current;
      const cursorPos = input.selectionStart || 0;
      const beforeCursor = input.value.slice(0, cursorPos);
      const afterCursor = input.value.slice(cursorPos);

      // Find and replace the trigger pattern
      const triggerMatch = beforeCursor.match(/\{\{[\w.]*$/);
      if (triggerMatch) {
        const triggerStart = beforeCursor.length - triggerMatch[0].length;
        const newValue =
          input.value.slice(0, triggerStart) +
          `{{${variable.path}}}` +
          afterCursor;

        setBasicInputValue(newValue);

        // Update cursor position
        const newCursorPos = triggerStart + `{{${variable.path}}}`.length;
        setTimeout(() => {
          input.setSelectionRange(newCursorPos, newCursorPos);
          input.focus();
        }, 0);
      }
    }

    // Log the insertion
    setInsertionLog(prev => [...prev, {
      type: 'variable',
      item: variable,
      position: basicInputRef.current?.selectionStart || 0,
      timestamp: new Date()
    }]);
  }, []);

  // Handle control flow selection for basic autocomplete
  const handleBasicControlFlowSelect = useCallback((helper: ControlFlowHelper) => {
    setSelectedControlFlow(helper);
    setShowBasicAutocomplete(false);

    // Insert control flow into basic input
    if (basicInputRef.current) {
      const input = basicInputRef.current;
      const cursorPos = input.selectionStart || 0;
      const beforeCursor = input.value.slice(0, cursorPos);
      const afterCursor = input.value.slice(cursorPos);

      // Find and replace the trigger pattern
      const triggerMatch = beforeCursor.match(/\{\{#[\w]*$/);
      if (triggerMatch) {
        const triggerStart = beforeCursor.length - triggerMatch[0].length;
        const openingTag = helper.syntax.replace('condition', 'your.condition');
        const closingTag = helper.closingSyntax || '';

        const insertion = closingTag
          ? `${openingTag}\n  <!-- content -->\n${closingTag}`
          : openingTag;

        const newValue =
          input.value.slice(0, triggerStart) +
          insertion +
          afterCursor;

        setBasicInputValue(newValue);

        // Update cursor position
        const newCursorPos = triggerStart + openingTag.length + (closingTag ? 3 : 0);
        setTimeout(() => {
          input.setSelectionRange(newCursorPos, newCursorPos);
          input.focus();
        }, 0);
      }
    }

    // Log the insertion
    setInsertionLog(prev => [...prev, {
      type: 'control_flow',
      item: helper,
      position: basicInputRef.current?.selectionStart || 0,
      timestamp: new Date()
    }]);
  }, []);

  // Handle enhanced input variable insertion
  const handleEnhancedVariableInsert = useCallback((variable: Variable, position: number) => {
    setInsertionLog(prev => [...prev, {
      type: 'variable',
      item: variable,
      position,
      timestamp: new Date()
    }]);
  }, []);

  // Handle enhanced input control flow insertion
  const handleEnhancedControlFlowInsert = useCallback((helper: ControlFlowHelper, position: number) => {
    setInsertionLog(prev => [...prev, {
      type: 'control_flow',
      item: helper,
      position,
      timestamp: new Date()
    }]);
  }, []);

  // Simulate basic input changes to trigger autocomplete
  const handleBasicInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setBasicInputValue(value);

    // Check for trigger patterns
    const triggerPattern = /\{\{[\w.#]*$/;
    const match = value.match(triggerPattern);

    if (match && match[0].length >= 3) {
      // Calculate position for autocomplete
      const rect = e.target.getBoundingClientRect();
      setBasicInputPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX + 10
      });
      setShowBasicAutocomplete(true);
    } else {
      setShowBasicAutocomplete(false);
    }
  }, []);

  const clearLog = useCallback(() => {
    setInsertionLog([]);
  }, []);

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Variable Autocomplete System
        </h1>
        <p className="text-gray-600">
          Demonstrates the VariableAutocomplete component with trigger pattern detection,
          keyboard navigation, and support for both regular variables and control flow helpers.
        </p>
      </div>

      {/* Configuration */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-4">Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Context Type
            </label>
            <select
              value={contextType}
              onChange={(e) => setContextType(e.target.value as ComponentType)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="heading">Heading</option>
              <option value="text">Text</option>
              <option value="button">Button</option>
              <option value="image">Image</option>
              <option value="link">Link</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Suggestions
            </label>
            <Input
              type="number"
              min="1"
              max="20"
              value={maxSuggestions}
              onChange={(e) => setMaxSuggestions(parseInt(e.target.value) || 10)}
            />
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={clearLog}
              disabled={insertionLog.length === 0}
            >
              Clear Log
            </Button>
          </div>
        </div>
      </Card>

      {/* Examples */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Basic Autocomplete Example */}
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4">Basic Autocomplete</h2>
          <p className="text-sm text-gray-600 mb-4">
            Type <code className="bg-gray-100 px-1 rounded">{`{{`}</code> for variables or{' '}
            <code className="bg-gray-100 px-1 rounded">{`{{#`}</code> for control flow helpers.
          </p>

          <div className="space-y-4">
            <div className="relative">
              <Input
                ref={basicInputRef}
                value={basicInputValue}
                onChange={handleBasicInputChange}
                placeholder="Type {{ to trigger autocomplete..."
                className="font-mono text-sm"
              />

              {showBasicAutocomplete && (
                <VariableAutocomplete
                  inputValue={basicInputValue}
                  onSuggestionSelect={handleBasicVariableSelect}
                  onControlFlowInsert={handleBasicControlFlowSelect}
                  contextType={contextType}
                  maxSuggestions={maxSuggestions}
                  position={basicInputPosition}
                  onClose={() => setShowBasicAutocomplete(false)}
                />
              )}
            </div>

            <div className="text-xs text-gray-500">
              <strong>Trigger patterns:</strong>
              <ul className="mt-1 space-y-1">
                <li>• <code>{`{{`}</code> - Shows variable suggestions</li>
                <li>• <code>{`{{#`}</code> - Shows control flow helpers</li>
                <li>• Use ↑↓ to navigate, Enter to select, Esc to close</li>
              </ul>
            </div>
          </div>
        </Card>

        {/* Enhanced Input Example */}
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4">Enhanced Input with Autocomplete</h2>
          <p className="text-sm text-gray-600 mb-4">
            Uses the VariableAutocompleteInput component with built-in autocomplete functionality.
          </p>

          <VariableAutocompleteInput
            value={enhancedInputValue}
            onChange={setEnhancedInputValue}
            onVariableInsert={handleEnhancedVariableInsert}
            onControlFlowInsert={handleEnhancedControlFlowInsert}
            contextType={contextType}
            placeholder="Type {{ or {{# to trigger autocomplete..."
            maxSuggestions={maxSuggestions}
            className="font-mono text-sm"
          />
        </Card>
      </div>

      {/* Textarea Example */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-4">Multiline Text with Autocomplete</h2>
        <p className="text-sm text-gray-600 mb-4">
          Demonstrates autocomplete functionality in a textarea for longer content.
        </p>

        <VariableAutocompleteInput
          value={textareaValue}
          onChange={setTextareaValue}
          onVariableInsert={handleEnhancedVariableInsert}
          onControlFlowInsert={handleEnhancedControlFlowInsert}
          contextType={contextType}
          multiline
          rows={12}
          maxSuggestions={maxSuggestions}
          className="font-mono text-sm"
        />
      </Card>

      {/* Selection Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4">Last Selected Items</h2>

          {selectedVariable && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="text-sm font-medium text-green-800 mb-2">
                Last Variable
              </h3>
              <div className="space-y-1 text-sm">
                <div><strong>Name:</strong> {selectedVariable.name}</div>
                <div><strong>Path:</strong> <code className="bg-gray-100 px-1 rounded">{`{{${selectedVariable.path}}}`}</code></div>
                <div><strong>Type:</strong> <Badge variant="secondary">{selectedVariable.type}</Badge></div>
                <div><strong>Category:</strong> <Badge variant="outline">{selectedVariable.category}</Badge></div>
              </div>
            </div>
          )}

          {selectedControlFlow && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-sm font-medium text-blue-800 mb-2">
                Last Control Flow Helper
              </h3>
              <div className="space-y-1 text-sm">
                <div><strong>Name:</strong> {selectedControlFlow.name}</div>
                <div><strong>Syntax:</strong> <code className="bg-gray-100 px-1 rounded">{selectedControlFlow.syntax}</code></div>
                {selectedControlFlow.closingSyntax && (
                  <div><strong>Closing:</strong> <code className="bg-gray-100 px-1 rounded">{selectedControlFlow.closingSyntax}</code></div>
                )}
                <div><strong>Category:</strong> <Badge variant="outline">{selectedControlFlow.category}</Badge></div>
              </div>
            </div>
          )}

          {!selectedVariable && !selectedControlFlow && (
            <div className="text-gray-500 text-sm">
              No items selected yet. Try using the autocomplete above.
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4">Insertion Log</h2>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {insertionLog.length > 0 ? (
              insertionLog.slice(-10).reverse().map((entry, index) => (
                <div key={index} className="p-2 bg-gray-50 rounded text-sm">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${
                      entry.type === 'variable' ? 'text-green-700' : 'text-blue-700'
                    }`}>
                      {entry.type === 'variable' ? 'Variable' : 'Control Flow'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-gray-700">
                    {entry.type === 'variable'
                      ? (entry.item as Variable).name
                      : (entry.item as ControlFlowHelper).name
                    }
                  </div>
                  <div className="text-xs text-gray-500 font-mono">
                    Position: {entry.position}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-gray-500 text-sm">
                No insertions logged yet. Use the autocomplete to insert variables or control flow helpers.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Integration Examples */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-4">Integration Examples</h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-md font-medium mb-2">Basic Usage</h3>
            <pre className="text-sm bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`import { VariableAutocomplete } from '../components/templates';

<VariableAutocomplete
  inputValue={inputValue}
  onSuggestionSelect={(variable) => {
    // Handle variable selection
    insertVariable(variable);
  }}
  onControlFlowInsert={(helper) => {
    // Handle control flow insertion
    insertControlFlow(helper);
  }}
  contextType="heading"
  maxSuggestions={10}
  position={{ top: 100, left: 200 }}
/>`}
            </pre>
          </div>

          <div>
            <h3 className="text-md font-medium mb-2">Enhanced Input Component</h3>
            <pre className="text-sm bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`import { VariableAutocompleteInput } from '../components/templates';

<VariableAutocompleteInput
  value={value}
  onChange={setValue}
  onVariableInsert={(variable, position) => {
    console.log('Variable inserted:', variable, 'at position:', position);
  }}
  onControlFlowInsert={(helper, position) => {
    console.log('Control flow inserted:', helper, 'at position:', position);
  }}
  contextType="text"
  multiline
  rows={5}
/>`}
            </pre>
          </div>

          <div>
            <h3 className="text-md font-medium mb-2">Using the Hook</h3>
            <pre className="text-sm bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`import { useVariableAutocomplete } from '../hooks';

const {
  inputRef,
  isAutocompleteVisible,
  autocompletePosition,
  handleVariableSelect,
  handleControlFlowSelect
} = useVariableAutocomplete({
  contextType: 'heading',
  onVariableInsert: (variable, position) => {
    // Handle variable insertion
  }
});`}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default VariableAutocompleteUsage;
