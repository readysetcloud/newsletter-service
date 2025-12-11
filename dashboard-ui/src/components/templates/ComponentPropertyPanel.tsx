import React, { useState, useCallback, useMemo } from 'react';
import { Variable, ComponentType, EnhancedComponentProperty, PropertySection } from '../../types/variable';
import { VariableInput } from './VariableInput';
import { VariableTextArea } from './VariableTextArea';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Select } from '../ui/Select';
import { cn } from '../../utils/cn';
import {
  getFilteredVariablesForProperty,
  validatePropertyValue,
  getDefaultPropertiesForComponent
} from '../../utils/propertyVariableFilter';
import { getAllVariables } from '../../data/variableDefinitions';

export interface ComponentPropertyPanelProps {
  /**
   * Type of component being edited
   */
  componentType: ComponentType;

  /**
   * Component properties configuration
   */
  properties: EnhancedComponentProperty[];

  /**
   * Current property values
   */
  values: Record<string, any>;

  /**
   * Callback when property values change
   */
  onValuesChange: (values: Record<string, any>) => void;

  /**
   * Whether the panel is in read-only mode
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * Component property panel with integrated variable support
 *
 * This component provides a property editing interface for visual builder components
 * with integrated variable picker buttons for text-based properties.
 */
export const ComponentPropertyPanel: React.FC<ComponentPropertyPanelProps> = ({
  componentType,
  properties: providedProperties,
  values,
  onValuesChange,
  readOnly = false,
  className = ''
}) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic']));
  const [validationErrors, setValidationErrors] = useState<Record<string, string[]>>({});
  const [validationWarnings, setValidationWarnings] = useState<Record<string, string[]>>({});

  // Use provided properties or get defaults for the component type
  const properties = useMemo(() => {
    return providedProperties?.length > 0
      ? providedProperties
      : getDefaultPropertiesForComponent(componentType);
  }, [providedProperties, componentType]);

  // Get all available variables for validation and filtering
  const allVariables = useMemo(() => getAllVariables(), []);

  const handlePropertyChange = useCallback((propertyId: string, value: any) => {
    const newValues = { ...values, [propertyId]: value };
    onValuesChange(newValues);

    // Validate the property value
    const property = properties.find(p => p.id === propertyId);
    if (property) {
      const validation = validatePropertyValue(property, value, allVariables);

      setValidationErrors(prev => ({
        ...prev,
        [propertyId]: validation.errors
      }));

      setValidationWarnings(prev => ({
        ...prev,
        [propertyId]: validation.warnings
      }));
    }
  }, [values, onValuesChange, properties, allVariables]);

  const handleVariableInsert = useCallback((propertyId: string, variable: Variable) => {
    const currentValue = values[propertyId] || '';
    const variableSyntax = `{{${variable.path}}}`;

    // Insert variable at the end of current value
    const newValue = currentValue + variableSyntax;
    handlePropertyChange(propertyId, newValue);
  }, [values, handlePropertyChange]);

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  }, []);

  const renderValidationMessages = (errors: string[], warnings: string[]) => {
    if (errors.length === 0 && warnings.length === 0) return null;

    return (
      <div className="mt-1 space-y-1">
        {errors.map((error, index) => (
          <p key={`error-${index}`} className="text-xs text-red-600 flex items-center">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </p>
        ))}
        {warnings.map((warning, index) => (
          <p key={`warning-${index}`} className="text-xs text-amber-600 flex items-center">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {warning}
          </p>
        ))}
      </div>
    );
  };

  const renderPropertyInput = (property: EnhancedComponentProperty) => {
    const value = values[property.id] || property.value || '';
    const isDisabled = readOnly;
    const errors = validationErrors[property.id] || [];
    const warnings = validationWarnings[property.id] || [];
    const hasError = errors.length > 0;

    const commonProps = {
      id: property.id,
      value,
      disabled: isDisabled,
      placeholder: property.placeholder,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        handlePropertyChange(property.id, e.target.value)
    };

    // Get filtered variables for this property (moved outside to avoid hooks violation)
    const filteredVariables = property.supportsVariables
      ? getFilteredVariablesForProperty(property, componentType, allVariables)
      : [];

    const variableProps = property.supportsVariables ? {
      contextType: property.variableContext || componentType,
      showVariableButton: true,
      onVariableInsert: (variable: Variable) => handleVariableInsert(property.id, variable),
      variableButtonDisabled: isDisabled,
      availableVariables: filteredVariables
    } : {
      showVariableButton: false
    };

    switch (property.type) {
      case 'text':
        return (
          <div>
            <VariableInput
              {...commonProps}
              {...variableProps}
              type="text"
              label={property.label}
              error={undefined} // We'll show errors separately
              helperText={property.helpText}
            />
            {renderValidationMessages(errors, warnings)}
          </div>
        );

      case 'textarea':
        return (
          <div>
            <VariableTextArea
              {...commonProps}
              {...variableProps}
              label={property.label}
              error={undefined} // We'll show errors separately
              helperText={property.helpText}
              rows={4}
            />
            {renderValidationMessages(errors, warnings)}
          </div>
        );

      case 'url':
        return (
          <div>
            <VariableInput
              {...commonProps}
              {...variableProps}
              type="url"
              label={property.label}
              error={undefined} // We'll show errors separately
              helperText={property.helpText || "Enter a valid URL or use variables"}
            />
            {renderValidationMessages(errors, warnings)}
          </div>
        );

      case 'color':
        return (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {property.label}
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="color"
                value={value || '#000000'}
                onChange={(e) => handlePropertyChange(property.id, e.target.value)}
                disabled={isDisabled}
                className="h-10 w-20 rounded border border-slate-300 disabled:opacity-50"
              />
              <VariableInput
                value={value}
                onChange={(e) => handlePropertyChange(property.id, e.target.value)}
                placeholder="#000000"
                disabled={isDisabled}
                {...variableProps}
                className="flex-1"
              />
            </div>
            {renderValidationMessages(errors, warnings)}
          </div>
        );

      case 'number':
        return (
          <div>
            <VariableInput
              {...commonProps}
              {...variableProps}
              type="number"
              label={property.label}
              error={undefined} // We'll show errors separately
              helperText={property.helpText}
            />
            {renderValidationMessages(errors, warnings)}
          </div>
        );

      case 'boolean':
        return (
          <div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={property.id}
                checked={!!value}
                onChange={(e) => handlePropertyChange(property.id, e.target.checked)}
                disabled={isDisabled}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <label htmlFor={property.id} className="text-sm font-medium text-slate-700">
                {property.label}
              </label>
            </div>
            {property.helpText && (
              <p className="text-xs text-gray-500 mt-1">{property.helpText}</p>
            )}
            {renderValidationMessages(errors, warnings)}
          </div>
        );

      case 'conditional':
        return (
          <div>
            <VariableInput
              {...commonProps}
              {...variableProps}
              type="text"
              label={property.label}
              error={undefined} // We'll show errors separately
              helperText={property.helpText || "Use boolean variables or control flow helpers"}
            />
            {renderValidationMessages(errors, warnings)}
          </div>
        );

      case 'select':
        return (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {property.label}
            </label>
            <Select
              value={value}
              onChange={(newValue) => handlePropertyChange(property.id, newValue)}
              disabled={isDisabled}
              options={[]} // TODO: Add options based on property configuration
              placeholder="Select an option"
            />
            {property.helpText && (
              <p className="text-xs text-gray-500 mt-1">{property.helpText}</p>
            )}
            {renderValidationMessages(errors, warnings)}
          </div>
        );

      default:
        return (
          <VariableInput
            {...commonProps}
            {...variableProps}
            label={property.label}
          />
        );
    }
  };

  // Group properties by section
  const groupedProperties = useMemo(() => {
    return properties.reduce((groups, property) => {
      const section = property.section || 'basic';

      if (!groups[section]) {
        groups[section] = [];
      }
      groups[section].push(property);
      return groups;
    }, {} as Record<PropertySection, EnhancedComponentProperty[]>);
  }, [properties]);

  const getSectionTitle = (sectionId: PropertySection) => {
    switch (sectionId) {
      case 'basic': return 'Basic Properties';
      case 'styling': return 'Styling';
      case 'links': return 'Links & URLs';
      case 'advanced': return 'Advanced';
      case 'conditional': return 'Conditional Logic';
      default: return (sectionId as string).charAt(0).toUpperCase() + (sectionId as string).slice(1);
    }
  };

  const getSectionDescription = (sectionId: PropertySection) => {
    switch (sectionId) {
      case 'basic': return 'Core component properties';
      case 'styling': return 'Visual appearance and layout';
      case 'links': return 'URLs and navigation';
      case 'advanced': return 'Advanced configuration options';
      case 'conditional': return 'Dynamic content and logic';
      default: return '';
    }
  };

  return (
    <Card className={cn('w-full max-w-md', className)}>
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">
            Component Properties
          </h3>
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 capitalize">
            {componentType}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Configure properties for this component. Use the variable button to insert dynamic content.
        </p>
      </div>

      <div className="divide-y divide-gray-100">
        {Object.entries(groupedProperties).map(([sectionId, sectionProperties]) => {
          const section = sectionId as PropertySection;
          const hasErrors = sectionProperties.some(prop =>
            validationErrors[prop.id]?.length > 0
          );

          return (
            <div key={sectionId} className="p-4">
              <button
                className="w-full flex items-center justify-between text-left mb-3"
                onClick={() => toggleSection(sectionId)}
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <h4 className="text-sm font-medium text-gray-900">
                      {getSectionTitle(section)}
                    </h4>
                    {hasErrors && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        {sectionProperties.filter(prop => validationErrors[prop.id]?.length > 0).length} error{sectionProperties.filter(prop => validationErrors[prop.id]?.length > 0).length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {getSectionDescription(section)}
                  </p>
                </div>
                <div className={`transform transition-transform ${
                  expandedSections.has(sectionId) ? 'rotate-90' : ''
                }`}>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {expandedSections.has(sectionId) && (
                <div className="space-y-4">
                  {sectionProperties.map((property) => (
                    <div key={property.id}>
                      {renderPropertyInput(property)}
                      {property.supportsVariables && !readOnly && (
                        <div className="mt-1 flex items-center justify-between">
                          <p className="text-xs text-gray-500">
                            Click the <span className="inline-flex items-center px-1 py-0 rounded border text-xs font-mono">
                              {'{}'}
                            </span> button to insert variables
                          </p>
                          {property.variableFilter && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {getFilteredVariablesForProperty(property, componentType, allVariables).length} available
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {readOnly && (
        <div className="p-4 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-500 text-center">
            Properties are read-only in preview mode
          </p>
        </div>
      )}
    </Card>
  );
};

export default ComponentPropertyPanel;
