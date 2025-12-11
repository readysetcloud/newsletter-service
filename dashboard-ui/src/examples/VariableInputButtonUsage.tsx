import React, { useState, useCallback } from 'react';
import { Variable, ComponentType, EnhancedComponentProperty } from '../types/variable';
import {
  VariableInputButton,
  VariableInput,
  VariableTextArea,
  ComponentPropertyPanel
} from '../components/templates';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';

/**
 * Example component demonstrating VariableInputButton integration
 */
export const VariableInputButtonUsage: React.FC = () => {
  const [basicInputValue, setBasicInputValue] = useState('Welcome to {{newsletter.title}}!');
  const [textareaValue, setTextareaValue] = useState('Dear {{subscriber.firstName}},\n\nThank you for subscribing to {{newsletter.title}}.');
  const [selectedComponentType, setSelectedComponentType] = useState<ComponentType>('heading');
  const [propertyValues, setPropertyValues] = useState({
    title: 'Welcome {{subscriber.firstName}}',
    description: 'This is issue #{{newsletter.issue}} of {{newsletter.title}}',
    url: '{{newsletter.url}}',
    buttonText: 'Read {{newsletter.title}}',
    backgroundColor: '{{brand.primaryColor}}',
    showLogo: true
  });

  // Sample component properties for different component types
  const getPropertiesForComponent = (componentType: ComponentType): EnhancedComponentProperty[] => {
    const baseProperties: EnhancedComponentProperty[] = [];

    switch (componentType) {
      case 'heading':
        return [
          {
            id: 'title',
            label: 'Heading Text',
            type: 'text',
            value: propertyValues.title,
            supportsVariables: true,
            variableContext: 'heading',
            placeholder: 'Enter heading text...',
            validation: { required: true }
          },
          {
            id: 'level',
            label: 'Heading Level',
            type: 'select',
            value: 'h2',
            supportsVariables: false
          }
        ];

      case 'text':
        return [
          {
            id: 'description',
            label: 'Text Content',
            type: 'textarea',
            value: propertyValues.description,
            supportsVariables: true,
            variableContext: 'text',
            placeholder: 'Enter text content...',
            validation: { required: true }
          }
        ];

      case 'button':
        return [
          {
            id: 'buttonText',
            label: 'Button Text',
            type: 'text',
            value: propertyValues.buttonText,
            supportsVariables: true,
            variableContext: 'button',
            placeholder: 'Enter button text...',
            validation: { required: true }
          },
          {
            id: 'url',
            label: 'Button URL',
            type: 'url',
            value: propertyValues.url,
            supportsVariables: true,
            variableContext: 'button',
            placeholder: 'https://example.com',
            validation: { required: true }
          },
          {
            id: 'backgroundColor',
            label: 'Background Color',
            type: 'color',
            value: propertyValues.backgroundColor,
            supportsVariables: true,
            variableContext: 'button'
          }
        ];

      case 'image':
        return [
          {
            id: 'imageUrl',
            label: 'Image URL',
            type: 'url',
            value: '{{brand.logo}}',
            supportsVariables: true,
            variableContext: 'image',
            placeholder: 'https://example.com/image.jpg',
            validation: { required: true }
          },
          {
            id: 'altText',
            label: 'Alt Text',
            type: 'text',
            value: '{{brand.name}} logo',
            supportsVariables: true,
            variableContext: 'image',
            placeholder: 'Describe the image...'
          }
        ];

      default:
        return baseProperties;
    }
  };

  const handleVariableInsert = useCallback((variable: Variable) => {
    console.log('Variable inserted:', variable);
  }, []);

  const handlePropertyValuesChange = useCallback((newValues: Record<string, any>) => {
    setPropertyValues(newValues as any);
  }, []);

  const renderVariablePreview = (text: string) => {
    // Simple preview that shows how variables would be rendered
    return text
      .replace(/\{\{newsletter\.title\}\}/g, 'Serverless Picks of the Week #42')
      .replace(/\{\{newsletter\.issue\}\}/g, '42')
      .replace(/\{\{newsletter\.url\}\}/g, 'https://readysetcloud.io/newsletter/42')
      .replace(/\{\{subscriber\.firstName\}\}/g, 'John')
      .replace(/\{\{brand\.name\}\}/g, 'Ready Set Cloud')
      .replace(/\{\{brand\.primaryColor\}\}/g, '#3B82F6')
      .replace(/\{\{brand\.logo\}\}/g, 'https://readysetcloud.s3.us-east-1.amazonaws.com/newsletter.png');
  };

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Variable Input Button Integration Examples
        </h1>
        <p className="text-gray-600">
          Demonstrates the VariableInputButton component integrated with various input types
          and component property panels for the visual builder.
        </p>
      </div>

      {/* Basic Variable Input Examples */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Basic Variable Input</h2>

          <div className="space-y-4">
            <VariableInput
              label="Newsletter Title"
              value={basicInputValue}
              onChange={(e) => setBasicInputValue(e.target.value)}
              contextType="heading"
              placeholder="Enter newsletter title..."
              onVariableInsert={handleVariableInsert}
            />

            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Preview:</h3>
              <p className="text-sm text-gray-900 font-medium">
                {renderVariablePreview(basicInputValue)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Variable TextArea</h2>

          <div className="space-y-4">
            <VariableTextArea
              label="Email Content"
              value={textareaValue}
              onChange={(e) => setTextareaValue(e.target.value)}
              contextType="text"
              placeholder="Enter email content..."
              onVariableInsert={handleVariableInsert}
              rows={6}
            />

            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Preview:</h3>
              <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                {renderVariablePreview(textareaValue)}
              </pre>
            </div>
          </div>
        </Card>
      </div>

      {/* Component Property Panel Example */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-4">Component Type</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Component Type
                </label>
                <Select
                  value={selectedComponentType}
                  onChange={(value) => setSelectedComponentType((value.target as HTMLSelectElement).value as ComponentType)}
                >
                  <option value="heading">Heading</option>
                  <option value="text">Text</option>
                  <option value="button">Button</option>
                  <option value="image">Image</option>
                  <option value="link">Link</option>
                </Select>
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="text-sm font-medium text-blue-800 mb-2">
                  Contextual Variables
                </h3>
                <p className="text-xs text-blue-700">
                  The variable picker will prioritize variables relevant to the selected component type.
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <ComponentPropertyPanel
            componentType={selectedComponentType}
            properties={getPropertiesForComponent(selectedComponentType)}
            values={propertyValues}
            onValuesChange={handlePropertyValuesChange}
          />
        </div>
      </div>

      {/* Property Values Preview */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Property Values with Variables</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-md font-medium mb-3">Raw Values (with variables)</h3>
            <div className="space-y-2">
              {Object.entries(propertyValues).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <span className="text-sm font-medium text-gray-700 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}:
                  </span>
                  <code className="text-xs bg-white px-2 py-1 rounded border">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </code>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-md font-medium mb-3">Rendered Preview</h3>
            <div className="space-y-2">
              {Object.entries(propertyValues).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between p-2 bg-green-50 rounded">
                  <span className="text-sm font-medium text-gray-700 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}:
                  </span>
                  <span className="text-xs text-gray-900 font-medium">
                    {typeof value === 'string' ? renderVariablePreview(value) : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Integration Code Examples */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Integration Code Examples</h2>

        <div className="space-y-6">
          <div>
            <h3 className="text-md font-medium mb-2">Basic Variable Input</h3>
            <pre className="text-sm bg-gray-100 p-4 rounded-lg overflow-x-auto">
{`import { VariableInput } from '../components/templates';

<VariableInput
  label="Newsletter Title"
  value={value}
  onChange={(e) => setValue(e.target.value)}
  contextType="heading"
  onVariableInsert={(variable) => {
    console.log('Variable inserted:', variable);
  }}
/>`}
            </pre>
          </div>

          <div>
            <h3 className="text-md font-medium mb-2">Component Property Panel</h3>
            <pre className="text-sm bg-gray-100 p-4 rounded-lg overflow-x-auto">
{`import { ComponentPropertyPanel } from '../components/templates';

<ComponentPropertyPanel
  componentType="button"
  properties={[
    {
      id: 'buttonText',
      label: 'Button Text',
      type: 'text',
      supportsVariables: true,
      variableContext: 'button'
    }
  ]}
  values={propertyValues}
  onValuesChange={setPropertyValues}
/>`}
            </pre>
          </div>

          <div>
            <h3 className="text-md font-medium mb-2">Manual Integration with Existing Inputs</h3>
            <pre className="text-sm bg-gray-100 p-4 rounded-lg overflow-x-auto">
{`import { VariableInputButton } from '../components/templates';

<div className="relative">
  <input
    ref={inputRef}
    className="pr-10" // Add padding for button
    // ... other input props
  />
  <VariableInputButton
    inputRef={inputRef}
    contextType="heading"
    onVariableInsert={(variable) => {
      // Handle variable insertion
    }}
  />
</div>`}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default VariableInputButtonUsage;
