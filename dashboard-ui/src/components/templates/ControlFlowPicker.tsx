import React, { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Code, Info, Copy, Check } from 'lucide-react';
import {
  ControlFlowHelper,
  ControlFlowInsertion,
  ControlFlowPlaceholder,
  Variable,
  ComponentType
} from '../../types/variable';
import { VARIABLE_DEFINITIONS, searchVariables } from '../../data/variableDefinitions';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import { Select } from '../ui/Select';

interface ControlFlowPickerProps {
  onHelperSelect: (helper: ControlFlowHelper, parameters: Record<string, string>) => void;
  availableVariables: Variable[];
  contextType?: ComponentType;
  className?: string;
}

interface ParameterFormProps {
  helper: ControlFlowHelper;
  onSubmit: (parameters: Record<string, string>) => void;
  onCancel: () => void;
  availableVariables: Variable[];
}

interface HelperPreviewProps {
  helper: ControlFlowHelper;
  parameters: Record<string, string>;
}

const HelperPreview: React.FC<HelperPreviewProps> = ({ helper, parameters }) => {
  const [copied, setCopied] = useState(false);

  const generateCode = useCallback(() => {
    let openingTag = helper.syntax;
    let closingTag = helper.closingSyntax || '';

    // Replace parameter placeholders in the syntax
    helper.parameters.forEach(param => {
      const value = parameters[param.name] || `[${param.name}]`;
      openingTag = openingTag.replace(param.name, value);
    });

    // Generate sample content based on helper type
    let content = '';
    switch (helper.category) {
      case 'conditional':
        content = '  <!-- Content shown when condition is true -->\n  <div>Your content here</div>';
        break;
      case 'iterator':
        content = '  <!-- Content repeated for each item -->\n  <div>{{this.property}}</div>';
        break;
      case 'custom':
        content = '  <!-- Content within this context -->\n  <div>{{property}}</div>';
        break;
    }

    if (closingTag) {
      return `${openingTag}\n${content}\n${closingTag}`;
    }
    return openingTag;
  }, [helper, parameters]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generateCode());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  }, [generateCode]);

  return (
    <div className="mt-4 p-3 bg-gray-50 rounded-md border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-700">Preview</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-6 px-2 text-xs"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 mr-1" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="text-xs text-gray-800 font-mono whitespace-pre-wrap overflow-x-auto">
        {generateCode()}
      </pre>
    </div>
  );
};

const ParameterForm: React.FC<ParameterFormProps> = ({
  helper,
  onSubmit,
  onCancel,
  availableVariables
}) => {
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Filter variables based on parameter type
  const getVariablesForParameter = useCallback((paramType: string) => {
    switch (paramType) {
      case 'variable':
        return availableVariables.filter(v =>
          v.type === 'boolean' ||
          v.type === 'array' ||
          v.type === 'object' ||
          v.type === 'string'
        );
      case 'expression':
        return availableVariables;
      default:
        return [];
    }
  }, [availableVariables]);

  const handleParameterChange = useCallback((paramName: string, value: string) => {
    setParameters(prev => ({
      ...prev,
      [paramName]: value
    }));

    // Clear error when user starts typing
    if (errors[paramName]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[paramName];
        return newErrors;
      });
    }
  }, [errors]);

  const validateParameters = useCallback(() => {
    const newErrors: Record<string, string> = {};

    helper.parameters.forEach(param => {
      const value = parameters[param.name];

      if (param.required && (!value || value.trim() === '')) {
        newErrors[param.name] = `${param.name} is required`;
      } else if (value && param.type === 'variable') {
        // Validate that the value is a valid variable path
        const isValidVariable = availableVariables.some(v => v.path === value);
        if (!isValidVariable && !value.includes('.')) {
          newErrors[param.name] = 'Please select a valid variable';
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [helper.parameters, parameters, availableVariables]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();

    if (validateParameters()) {
      onSubmit(parameters);
    }
  }, [parameters, validateParameters, onSubmit]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3">
        {helper.parameters.map((param) => {
          const paramVariables = getVariablesForParameter(param.type);
          const hasError = errors[param.name];

          return (
            <div key={param.name} className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                {param.name}
                {param.required && <span className="text-red-500 ml-1">*</span>}
              </label>

              {param.type === 'variable' && paramVariables.length > 0 ? (
                <Select
                  value={parameters[param.name] || ''}
                  onChange={(e) => handleParameterChange(param.name, e.target.value)}
                  className={hasError ? 'border-red-300' : ''}
                  options={[
                    { value: '', label: 'Select a variable...' },
                    ...paramVariables.map((variable) => ({
                      value: variable.path,
                      label: `${variable.name} (${variable.path})`
                    }))
                  ]}
                />
              ) : (
                <Input
                  type="text"
                  value={parameters[param.name] || ''}
                  onChange={(e) => handleParameterChange(param.name, e.target.value)}
                  placeholder={param.examples[0] || `Enter ${param.name}...`}
                  className={hasError ? 'border-red-300' : ''}
                />
              )}

              {hasError && (
                <p className="text-sm text-red-600">{hasError}</p>
              )}

              <p className="text-xs text-gray-500">{param.description}</p>

              {param.examples.length > 0 && (
                <div className="text-xs text-gray-400">
                  <span className="font-medium">Examples:</span>{' '}
                  {param.examples.slice(0, 2).join(', ')}
                  {param.examples.length > 2 && '...'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <HelperPreview helper={helper} parameters={parameters} />

      <div className="flex justify-end space-x-2 pt-4 border-t border-gray-100">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
        >
          Insert Helper
        </Button>
      </div>
    </form>
  );
};

const HelperCard: React.FC<{
  helper: ControlFlowHelper;
  onSelect: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}> = ({ helper, onSelect, isExpanded, onToggleExpanded }) => {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'conditional':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'iterator':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'custom':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-2">
              <Code className="w-4 h-4 text-gray-500" />
              <h4 className="text-sm font-medium text-gray-900">{helper.name}</h4>
              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(helper.category)}`}>
                {helper.category}
              </span>
            </div>

            <p className="text-sm text-gray-600 mb-3">{helper.description}</p>

            <div className="space-y-2">
              <div>
                <span className="text-xs font-medium text-gray-500">Syntax:</span>
                <code className="ml-2 text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                  {helper.syntax}
                </code>
                {helper.closingSyntax && (
                  <>
                    <span className="mx-2 text-gray-400">...</span>
                    <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                      {helper.closingSyntax}
                    </code>
                  </>
                )}
              </div>

              {helper.parameters.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-gray-500">Parameters:</span>
                  <div className="ml-2 space-y-1">
                    {helper.parameters.map((param) => (
                      <div key={param.name} className="text-xs text-gray-600">
                        <span className="font-medium">{param.name}</span>
                        {param.required && <span className="text-red-500">*</span>}
                        <span className="text-gray-500"> - {param.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col space-y-2 ml-4">
            <Button
              variant="primary"
              size="sm"
              onClick={onSelect}
            >
              Use Helper
            </Button>

            {helper.examples.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleExpanded}
                className="flex items-center"
              >
                {isExpanded ? (
                  <>
                    <ChevronDown className="w-3 h-3 mr-1" />
                    Hide Examples
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-3 h-3 mr-1" />
                    Examples
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {isExpanded && helper.examples.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h5 className="text-xs font-medium text-gray-700 mb-3 flex items-center">
              <Info className="w-3 h-3 mr-1" />
              Examples
            </h5>
            <div className="space-y-3">
              {helper.examples.map((example, index) => (
                <div key={index} className="bg-gray-50 rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h6 className="text-xs font-medium text-gray-800">{example.title}</h6>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{example.description}</p>
                  <pre className="text-xs font-mono text-gray-800 bg-white p-2 rounded border overflow-x-auto">
                    {example.code}
                  </pre>
                  {example.variables.length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      <span className="font-medium">Required variables:</span>{' '}
                      {example.variables.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const ControlFlowPicker: React.FC<ControlFlowPickerProps> = ({
  onHelperSelect,
  availableVariables,
  contextType,
  className = ''
}) => {
  const [selectedHelper, setSelectedHelper] = useState<ControlFlowHelper | null>(null);
  const [expandedHelpers, setExpandedHelpers] = useState<Set<string>>(new Set());

  const controlFlowHelpers = useMemo(() => {
    return VARIABLE_DEFINITIONS.controlFlowHelpers;
  }, []);

  const handleHelperSelect = useCallback((helper: ControlFlowHelper) => {
    if (helper.parameters.length === 0) {
      // If no parameters required, insert immediately
      onHelperSelect(helper, {});
    } else {
      // Show parameter form
      setSelectedHelper(helper);
    }
  }, [onHelperSelect]);

  const handleParameterSubmit = useCallback((parameters: Record<string, string>) => {
    if (selectedHelper) {
      onHelperSelect(selectedHelper, parameters);
      setSelectedHelper(null);
    }
  }, [selectedHelper, onHelperSelect]);

  const handleParameterCancel = useCallback(() => {
    setSelectedHelper(null);
  }, []);

  const toggleHelperExpanded = useCallback((helperId: string) => {
    setExpandedHelpers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(helperId)) {
        newSet.delete(helperId);
      } else {
        newSet.add(helperId);
      }
      return newSet;
    });
  }, []);

  if (selectedHelper) {
    return (
      <Card className={className}>
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-900">
            Configure {selectedHelper.name}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {selectedHelper.description}
          </p>
        </div>
        <div className="p-4">
          <ParameterForm
            helper={selectedHelper}
            onSubmit={handleParameterSubmit}
            onCancel={handleParameterCancel}
            availableVariables={availableVariables}
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <div className="p-4 border-b border-gray-100">
        <h3 className="text-sm font-medium text-gray-900">
          Control Flow Helpers
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Add conditional logic and loops to your templates
        </p>
        {contextType && (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200 capitalize mt-2">
            {contextType} context
          </span>
        )}
      </div>

      <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
        {controlFlowHelpers.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Code className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No control flow helpers available</p>
          </div>
        ) : (
          controlFlowHelpers.map((helper) => (
            <HelperCard
              key={helper.id}
              helper={helper}
              onSelect={() => handleHelperSelect(helper)}
              isExpanded={expandedHelpers.has(helper.id)}
              onToggleExpanded={() => toggleHelperExpanded(helper.id)}
            />
          ))
        )}
      </div>
    </Card>
  );
};

export default ControlFlowPicker;
