import React, { useState } from 'react';
import {
  VariablePreview,
  VariableTooltip,
  VariableValidation,
  VariableSyntaxHighlighter
} from '../components/templates';
import { useVariableValidation, useRealTimeValidation, useVariableReferenceValidation } from '../hooks';
import { VARIABLE_DEFINITIONS, getVariableById } from '../data/variableDefinitions';
import { SAMPLE_DATA } from '../data/sampleData';
import { Variable } from '../types/variable';

const VariablePreviewValidationUsage: React.FC = () => {
  const [selectedVariable, setSelectedVariable] = useState<Variable | null>(
    getVariableById('newsletter-title') || null
  );
  const [templateContent, setTemplateContent] = useState(`
Hello {{subscriber.firstName}},

Welcome to {{newsletter.title}} - Issue #{{newsletter.issue}}!

{{#if newsletter.hasSponsors}}
  <div class="sponsors">
    <h3>Our Sponsors</h3>
    {{#ewsletter.sponsors}}
      <a href="{{this.url}}">{{this.name}}</a>
    {{/each}}
  </div>
{{/if}}

{{#unless subscriber.hasUnsubscribed}}
  <p>Thanks for being a subscriber!</p>
{{/unless}}

Best regards,
{{brand.name}}
  `.trim());

  // Get all available variables for reference validation
  const allVariables: Variable[] = [];
  Object.values(VARIABLE_DEFINITIONS.categories).forEach(category => {
    allVariables.push(...category.variables);
  });

  // Use validation hooks
  const { validateContent, isValidSyntax } = useVariableValidation();
  // Mock validation result for demo
  const realTimeValidation = { isValid: true, errors: [], warnings: [] };
  const referenceValidation = useVariableReferenceValidation(templateContent, allVariables);

  const handleVariableSelect = (variableId: string) => {
    const variable = getVariableById(variableId);
    setSelectedVariable(variable || null);
  };

  const insertVariable = (variable: Variable) => {
    const insertion = `{{${variable.path}}}`;
    setTemplateContent(prev => prev + ' ' + insertion);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Variable Preview & Validation System
        </h1>
        <p className="text-gray-600">
          Demonstration of variable preview, tooltips, and real-time validation
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Variable Selection and Preview */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Variable Preview
            </h2>

            {/* Variable Selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select a Variable:
              </label>
              <select
                value={selectedVariable?.id || ''}
                onChange={(e) => handleVariableSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Choose a variable...</option>
                {Object.entries(VARIABLE_DEFINITIONS.categories).map(([categoryKey, category]) => (
                  <optgroup key={categoryKey} label={category.label}>
                    {category.variables.map(variable => (
                      <option key={variable.id} value={variable.id}>
                        {variable.name} ({variable.path})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Variable Preview Component */}
            {selectedVariable && (
              <div className="space-y-4">
                <VariablePreview
                  variable={selectedVariable}
                  sampleData={SAMPLE_DATA}
                  contextType="text"
                  showPath={true}
                />

                <button
                  onClick={() => insertVariable(selectedVariable)}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Insert into Template
                </button>
              </div>
            )}
          </div>

          {/* Variable Tooltips Demo */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Variable Tooltips
            </h2>
            <p className="text-gray-600 mb-4">
              Hover over the variables below to see tooltips with sample data:
            </p>

            <div className="space-y-2">
              {[
                getVariableById('newsletter-title'),
                getVariableById('subscriber-first-name'),
                getVariableById('brand-name'),
                getVariableById('newsletter-has-sponsors')
              ].filter(Boolean).map(variable => (
                <div key={variable!.id} className="flex items-center space-x-2">
                  <VariableTooltip
                    variable={variable!}
                    sampleData={SAMPLE_DATA}
                    position="right"
                  >
                    <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono cursor-help hover:bg-gray-200 transition-colors">
                      {`{{${variable!.path}}}`}
                    </code>
                  </VariableTooltip>
                  <span className="text-sm text-gray-600">
                    {variable!.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Template Editor and Validation */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Template Editor with Real-time Validation
            </h2>

            {/* Template Content Editor */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Template Content:
              </label>
              <textarea
                value={templateContent}
                onChange={(e) => setTemplateContent(e.target.value)}
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder="Enter your template content with variables..."
              />
            </div>

            {/* Validation Status */}
            <div className="mb-4">
              <VariableValidation
                content={templateContent}
                showWarnings={true}
                inline={false}
              />
            </div>

            {/* Syntax Highlighting Preview */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Syntax Highlighted Preview:
              </label>
              <div className="bg-gray-50 border border-gray-200 rounded-md p-3 max-h-40 overflow-y-auto">
                <VariableSyntaxHighlighter
                  content={templateContent}
                  className="text-sm"
                />
              </div>
            </div>
          </div>

          {/* Variable Reference Validation */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Variable Reference Validation
            </h2>

            <div className="space-y-4">
              {/* Validation Summary */}
              <div className="flex items-center space-x-4">
                <div className={`flex items-center space-x-2 ${
                  referenceValidation.isValid ? 'text-green-600' : 'text-red-600'
                }`}>
                  <div className={`w-3 h-3 rounded-full ${
                    referenceValidation.isValid ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                  <span className="text-sm font-medium">
                    {referenceValidation.isValid ? 'All variables valid' : 'Invalid variables found'}
                  </span>
                </div>

                <div className="text-sm text-gray-600">
                  {referenceValidation.usedVariables.length} variables used
                </div>
              </div>

              {/* Errors */}
              {referenceValidation.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <h4 className="text-sm font-medium text-red-800 mb-2">Errors:</h4>
                  <ul className="text-sm text-red-700 space-y-1">
                    {referenceValidation.errors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {referenceValidation.warnings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <h4 className="text-sm font-medium text-yellow-800 mb-2">Warnings:</h4>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    {referenceValidation.warnings.map((warning, index) => (
                      <li key={index}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Used Variables */}
              {referenceValidation.usedVariables.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <h4 className="text-sm font-medium text-blue-800 mb-2">Used Variables:</h4>
                  <div className="flex flex-wrap gap-2">
                    {referenceValidation.usedVariables.map((variable, index) => (
                      <VariableTooltip
                        key={index}
                        variable={variable}
                        sampleData={SAMPLE_DATA}
                        position="top"
                      >
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 cursor-help">
                          {variable.name}
                        </span>
                      </VariableTooltip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Validation Status */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Real-time Validation Status
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-700 mb-1">Syntax Valid</div>
            <div className={`text-lg font-bold ${
              realTimeValidation.isValid ? 'text-green-600' : 'text-red-600'
            }`}>
              {realTimeValidation.isValid ? 'Yes' : 'No'}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-700 mb-1">Errors</div>
            <div className="text-lg font-bold text-red-600">
              {realTimeValidation.errors.length}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-700 mb-1">Warnings</div>
            <div className="text-lg font-bold text-yellow-600">
              {realTimeValidation.warnings.length}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VariablePreviewValidationUsage;
