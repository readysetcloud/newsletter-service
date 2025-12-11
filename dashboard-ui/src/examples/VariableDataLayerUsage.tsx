import React from 'react';
import {
  VARIABLE_DEFINITIONS,
getVariablesByCategory,
  getVariableById,
  searchVariables,
  getContextualVariables
} from '../data/variableDefinitions';
import {
  SAMPLE_DATA,
  getSampleValueForPath,
  formatSampleValue,
  generateVariablePreview
} from '../data/sampleData';
import { VariableValidator } from '../utils/variableValidator';
import { VariableCategory, CustomVariable } from '../types/variable';

/**
 * Example component demonstrating usage of the Variable Data Layer
 * This shows how to integrate the variable system into UI components
 */
export const VariableDataLayerUsage: React.FC = () => {
  const validator = new VariableValidator();

  // Example 1: Get variables by category
  const newsletterVariables = getVariablesByCategory(VariableCategory.NEWSLETTER);
  const subscriberVariables = getVariablesByCategory(VariableCategory.SUBSCRIBER);

  // Example 2: Search for variables
  const titleVariables = searchVariables('title');
  const emailVariables = searchVariables('email');

  // Example 3: Get contextual variables for a component
  const headingContext = getContextualVariables('heading');
  const buttonContext = getContextualVariables('button');

  // Example 4: Get sample values
  const newsletterTitle = getSampleValueForPath('newsletter.title');
  const subscriberName = getSampleValueForPath('subscriber.firstName');

  // Example 5: Format sample values for display
  const formattedArticles = formatSampleValue(SAMPLE_DATA.newsletter.articles, 100);
  const formattedSponsors = formatSampleValue(SAMPLE_DATA.newsletter.sponsors);

  // Example 6: Generate variable previews
  const titlePreview = generateVariablePreview('newsletter.title', 'heading');
  const urlPreview = generateVariablePreview('newsletter.url', 'button');

  // Example 7: Validate a custom variable
  const customVariable: CustomVariable = {
    id: 'custom-1',
    name: 'companyName',
    path: 'custom.companyName',
    defaultValue: 'Acme Corp',
    type: 'string',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const validationResult = validator.validateCustomVariable(customVariable);

  // Example 8: Validate handlebars syntax
  const templateSyntax = '{{#if newsletter.hasSponsors}}{{#each newsletter.sponsors}}<div>{{this.name}}</div>{{/each}}{{/if}}';
  const syntaxValidation = validator.validateHandlebarsSyntax(templateSyntax);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Variable Data Layer Usage Examples</h1>

      {/* Example 1: Variables by Category */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">1. Variables by Category</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Newsletter Variables ({newsletterVariables.length})</h3>
            <ul className="text-sm space-y-1">
              {newsletterVariables.slice(0, 5).map(variable => (
                <li key={variable.id} className="flex justify-between">
                  <span>{variable.name}</span>
                  <code className="text-blue-600">{variable.path}</code>
                </li>
              ))}
              {newsletterVariables.length > 5 && (
                <li className="text-gray-500">...and {newsletterVariables.length - 5} more</li>
              )}
            </ul>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Subscriber Variables ({subscriberVariables.length})</h3>
            <ul className="text-sm space-y-1">
              {subscriberVariables.map(variable => (
                <li key={variable.id} className="flex justify-between">
                  <span>{variable.name}</span>
                  <code className="text-blue-600">{variable.path}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Example 2: Search Results */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">2. Variable Search</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Search: "title" ({titleVariables.length} results)</h3>
            <ul className="text-sm space-y-1">
              {titleVariables.map(variable => (
                <li key={variable.id} className="flex justify-between">
                  <span>{variable.name}</span>
                  <code className="text-blue-600">{variable.path}</code>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Search: "email" ({emailVariables.length} results)</h3>
            <ul className="text-sm space-y-1">
              {emailVariables.map(variable => (
                <li key={variable.id} className="flex justify-between">
                  <span>{variable.name}</span>
                  <code className="text-blue-600">{variable.path}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Example 3: Contextual Variables */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">3. Contextual Variables</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Heading Component Priority</h3>
            <ul className="text-sm space-y-1">
              {headingContext.priority.map((variable, index) => (
                <li key={variable.id} className="flex justify-between">
                  <span>#{index + 1} {variable.name}</span>
                  <code className="text-blue-600">{variable.path}</code>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Button Component Priority</h3>
            <ul className="text-sm space-y-1">
              {buttonContext.priority.map((variable, index) => (
                <li key={variable.id} className="flex justify-between">
                  <span>#{index + 1} {variable.name}</span>
                  <code className="text-blue-600">{variable.path}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Example 4: Sample Data Values */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">4. Sample Data Values</h2>
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-medium mb-2">Raw Values</h3>
              <ul className="text-sm space-y-1">
                <li><strong>Newsletter Title:</strong> {newsletterTitle}</li>
                <li><strong>Subscriber Name:</strong> {subscriberName}</li>
                <li><strong>Has Sponsors:</strong> {SAMPLE_DATA.newsletter.hasSponsors ? 'Yes' : 'No'}</li>
                <li><strong>Article Count:</strong> {SAMPLE_DATA.newsletter.articles.length}</li>
              </ul>
            </div>
            <div>
              <h3 className="font-medium mb-2">Formatted Values</h3>
              <ul className="text-sm space-y-1">
                <li><strong>Articles:</strong> {formattedArticles}</li>
                <li><strong>Sponsors:</strong> {formattedSponsors}</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Example 5: Variable Previews */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">5. Variable Previews</h2>
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="space-y-2">
            <div>
              <strong>Heading Context:</strong> <code>newsletter.title</code> → "{titlePreview}"
            </div>
            <div>
              <strong>Button Context:</strong> <code>newsletter.url</code> → "{urlPreview}"
            </div>
          </div>
        </div>
      </section>

      {/* Example 6: Control Flow Helpers */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">6. Control Flow Helpers</h2>
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-medium mb-2">Available Helpers ({VARIABLE_DEFINITIONS.controlFlowHelpers.length})</h3>
          <div className="space-y-3">
            {VARIABLE_DEFINITIONS.controlFlowHelpers.map(helper => (
              <div key={helper.id} className="border-l-4 border-blue-500 pl-3">
                <div className="font-medium">{helper.name}</div>
                <div className="text-sm text-gray-600">{helper.description}</div>
                <code className="text-xs bg-gray-200 px-2 py-1 rounded">
                  {helper.syntax} ... {helper.closingSyntax}
                </code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Example 7: Validation Results */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">7. Validation Examples</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Custom Variable Validation</h3>
            <div className="text-sm space-y-1">
              <div><strong>Variable:</strong> {customVariable.name} ({customVariable.path})</div>
              <div><strong>Valid:</strong> {validationResult.isValid ? '✅ Yes' : '❌ No'}</div>
              {validationResult.errors.length > 0 && (
                <div><strong>Errors:</strong> {validationResult.errors.length}</div>
              )}
              {validationResult.warnings.length > 0 && (
                <div><strong>Warnings:</strong> {validationResult.warnings.length}</div>
              )}
            </div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Handlebars Syntax Validation</h3>
            <div className="text-sm space-y-1">
              <div><strong>Template:</strong> <code className="text-xs">{templateSyntax.substring(0, 50)}...</code></div>
              <div><strong>Valid:</strong> {syntaxValidation.isValid ? '✅ Yes' : '❌ No'}</div>
              {syntaxValidation.errors.length > 0 && (
                <div><strong>Errors:</strong> {syntaxValidation.errors.length}</div>
              )}
              {syntaxValidation.warnings.length > 0 && (
                <div><strong>Warnings:</strong> {syntaxValidation.warnings.length}</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Example 8: Integration Tips */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">8. Integration Tips</h2>
        <div className="bg-blue-50 p-4 rounded-lg">
          <h3 className="font-medium mb-2">How to Use This Data Layer</h3>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>Import variable definitions and sample data in your components</li>
            <li>Use <code>searchVariables()</code> for autocomplete functionality</li>
            <li>Use <code>getContextualVariables()</code> to show relevant variables per component</li>
            <li>Use <code>generateVariablePreview()</code> to show live previews</li>
            <li>Use <code>VariableValidator</code> to validate user input</li>
            <li>Use control flow helpers for conditional content</li>
          </ul>
        </div>
      </section>
    </div>
  );
};

export default VariableDataLayerUsage;
