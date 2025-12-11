import React, { useState, useCallback } from 'react';
import { VariablePicker, VariableSearch, VariableCategories } from '../components/templates';
import { Variable, ControlFlowHelper, ComponentType } from '../types/variable';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';

/**
 * Example component demonstrating VariablePicker usage
 */
export const VariablePickerUsage: React.FC = () => {
  const [selectedVariable, setSelectedVariable] = useState<Variable | null>(null);
  const [selectedControlFlow, setSelectedControlFlow] = useState<ControlFlowHelper | null>(null);
  const [contextType, setContextType] = useState<ComponentType>('heading');
  const [showControlFlow, setShowControlFlow] = useState(true);
  const [pickerPosition, setPickerPosition] = useState<'inline' | 'modal'>('inline');
  const [searchResults, setSearchResults] = useState<Variable[]>([]);
  const [showSearchExample, setShowSearchExample] = useState(false);
  const [showCategoriesExample, setShowCategoriesExample] = useState(false);

  const handleVariableSelect = useCallback((variable: Variable) => {
    setSelectedVariable(variable);
    console.log('Selected variable:', variable);
  }, []);

  const handleControlFlowSelect = useCallback((helper: ControlFlowHelper) => {
    setSelectedControlFlow(helper);
    console.log('Selected control flow helper:', helper);
  }, []);

  const handleSearchResults = useCallback((results: Variable[]) => {
    setSearchResults(results);
  }, []);

  const insertVariableIntoText = (variable: Variable, text: string, cursorPosition: number): string => {
    const variableSyntax = `{{${variable.path}}}`;
    return text.slice(0, cursorPosition) + variableSyntax + text.slice(cursorPosition);
  };

  const insertControlFlowIntoText = (helper: ControlFlowHelper, text: string, cursorPosition: number): string => {
    const openingTag = helper.syntax.replace('condition', 'your.condition');
    const closingTag = helper.closingSyntax || '';
    const insertion = closingTag
      ? `${openingTag}\n  <!-- Your content here -->\n${closingTag}`
      : openingTag;

    return text.slice(0, cursorPosition) + insertion + text.slice(cursorPosition);
  };

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Variable Picker Component Examples
        </h1>
        <p className="text-gray-600">
          Demonstrates the VariablePicker, VariableSearch, and VariableCategories components
          for inserting dynamic variables into template content.
        </p>
      </div>

      {/* Configuration Controls */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-4">Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Context Type
            </label>
            <Select
              value={contextType}
              onChange={(value) => setContextType((value.target as HTMLSelectElement).value as ComponentType)}
            >
              <option value="heading">Heading</option>
              <option value="text">Text</option>
              <option value="button">Button</option>
              <option value="image">Image</option>
              <option value="link">Link</option>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Position
            </label>
            <Select
              value={pickerPosition}
              onChange={(value) => setPickerPosition((value.target as HTMLSelectElement).value as 'inline' | 'modal')}
            >
              <option value="inline">Inline</option>
              <option value="modal">Modal</option>
            </Select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={showControlFlow}
                onChange={(e) => setShowControlFlow(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Show Control Flow</span>
            </label>
          </div>
        </div>
      </Card>

      {/* Main Variable Picker Example */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4">Variable Picker</h2>
          <VariablePicker
            onVariableSelect={handleVariableSelect}
            onControlFlowSelect={handleControlFlowSelect}
            contextType={contextType}
            position={pickerPosition}
            showControlFlow={showControlFlow}
            maxHeight="400px"
          />
        </Card>

        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4">Selection Results</h2>

          {selectedVariable && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="text-sm font-medium text-green-800 mb-2">
                Selected Variable
              </h3>
              <div className="space-y-1 text-sm">
                <div><strong>Name:</strong> {selectedVariable.name}</div>
                <div><strong>Path:</strong> <code className="bg-gray-100 px-1 rounded">{`{{${selectedVariable.path}}}`}</code></div>
                <div><strong>Type:</strong> <Badge variant="secondary">{selectedVariable.type}</Badge></div>
                <div><strong>Category:</strong> <Badge variant="outline">{selectedVariable.category}</Badge></div>
                {selectedVariable.description && (
                  <div><strong>Description:</strong> {selectedVariable.description}</div>
                )}
                <div><strong>Sample:</strong> <code className="bg-gray-100 px-1 rounded">{JSON.stringify(selectedVariable.sampleValue)}</code></div>
              </div>
            </div>
          )}

          {selectedControlFlow && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-sm font-medium text-blue-800 mb-2">
                Selected Control Flow Helper
              </h3>
              <div className="space-y-1 text-sm">
                <div><strong>Name:</strong> {selectedControlFlow.name}</div>
                <div><strong>Syntax:</strong> <code className="bg-gray-100 px-1 rounded">{selectedControlFlow.syntax}</code></div>
                {selectedControlFlow.closingSyntax && (
                  <div><strong>Closing:</strong> <code className="bg-gray-100 px-1 rounded">{selectedControlFlow.closingSyntax}</code></div>
                )}
                <div><strong>Category:</strong> <Badge variant="outline">{selectedControlFlow.category}</Badge></div>
                <div><strong>Description:</strong> {selectedControlFlow.description}</div>
              </div>
            </div>
          )}

          {!selectedVariable && !selectedControlFlow && (
            <div className="text-gray-500 text-sm">
              Select a variable or control flow helper to see details here.
            </div>
          )}

          {/* Example Text Insertion */}
          {(selectedVariable || selectedControlFlow) && (
            <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Example Text Insertion
              </h3>
              <div className="text-sm font-mono bg-white p-2 border rounded">
                {selectedVariable && (
                  <div>
                    Original: "Welcome to our newsletter!"<br/>
                    With variable: "{insertVariableIntoText(selectedVariable, 'Welcome to our newsletter!', 11)}"
                  </div>
                )}
                {selectedControlFlow && (
                  <div>
                    Original: "Content here"<br/>
                    With control flow:<br/>
                    <pre className="mt-1 text-xs">
                      {insertControlFlowIntoText(selectedControlFlow, 'Content here', 0)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Variable Search Example */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Variable Search Component</h2>
          <Button
            variant="outline"
            onClick={() => setShowSearchExample(!showSearchExample)}
          >
            {showSearchExample ? 'Hide' : 'Show'} Example
          </Button>
        </div>

        {showSearchExample && (
          <div className="space-y-4">
            <VariableSearch
              onResultsChange={handleSearchResults}
              contextType={contextType}
              showFilters={true}
            />

            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Search Results ({searchResults.length})
              </h3>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {searchResults.map(variable => (
                  <div key={variable.id} className="text-sm flex items-center justify-between">
                    <span>{variable.name}</span>
                    <code className="text-xs bg-gray-100 px-1 rounded">{variable.path}</code>
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <div className="text-gray-500 text-sm">No results found</div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Variable Categories Example */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Variable Categories Component</h2>
          <Button
            variant="outline"
            onClick={() => setShowCategoriesExample(!showCategoriesExample)}
          >
            {showCategoriesExample ? 'Hide' : 'Show'} Example
          </Button>
        </div>

        {showCategoriesExample && (
          <VariableCategories
            variables={searchResults.length > 0 ? searchResults : []}
            onVariableSelect={handleVariableSelect}
            contextType={contextType}
            showEmptyCategories={true}
          />
        )}
      </Card>

      {/* Integration Examples */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-4">Integration Examples</h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-md font-medium mb-2">Basic Usage</h3>
            <pre className="text-sm bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`import { VariablePicker } from '../components/templates';

<VariablePicker
  onVariableSelect={(variable) => {
    // Insert variable into your text editor
    insertText(\`{{\${variable.path}}}\`);
  }}
  contextType="heading"
  showControlFlow={true}
/>`}
            </pre>
          </div>

          <div>
            <h3 className="text-md font-medium mb-2">With Control Flow</h3>
            <pre className="text-sm bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`<VariablePicker
  onVariableSelect={handleVariableSelect}
  onControlFlowSelect={(helper) => {
    // Insert control flow helper
    const opening = helper.syntax.replace('condition', 'your.condition');
    const closing = helper.closingSyntax || '';
    insertText(\`\${opening}\\n  <!-- content -->\\n\${closing}\`);
  }}
  showControlFlow={true}
/>`}
            </pre>
          </div>

          <div>
            <h3 className="text-md font-medium mb-2">Contextual Filtering</h3>
            <pre className="text-sm bg-gray-100 p-3 rounded-lg overflow-x-auto">
{`// For a button component, prioritize URL variables
<VariablePicker
  onVariableSelect={handleVariableSelect}
  contextType="button"  // Shows URL variables first
/>

// For a heading component, prioritize title variables
<VariablePicker
  onVariableSelect={handleVariableSelect}
  contextType="heading"  // Shows title variables first
/>`}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default VariablePickerUsage;
