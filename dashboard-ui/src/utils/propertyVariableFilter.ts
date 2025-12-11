import {
  Variable,
  VariableType,
  VariableCategory,
  ComponentType,
  PropertyType,
  VariableFilter,
  EnhancedComponentProperty
} from '../types/variable';
import { VARIABLE_DEFINITIONS, getContextualVariables } from '../data/variableDefinitions';

/**
 * Utility functions for filtering variables based on component properties
 */

/**
 * Get filtered variables for a specific property
 */
export const getFilteredVariablesForProperty = (
  property: EnhancedComponentProperty,
  componentType: ComponentType,
  allVariables?: Variable[]
): Variable[] => {
  // Get all available variables if not provided
  const variables = allVariables || getAllVariables();

  // Start with contextual filtering based on component type
  const contextual = getContextualVariables(componentType);
  const excludedPaths = new Set(contextual.excluded);

  let filteredVariables = variables.filter(variable =>
    !excludedPaths.has(variable.path)
  );

  // Apply property-specific filtering
  if (property.variableFilter) {
    filteredVariables = applyVariableFilter(filteredVariables, property.variableFilter);
  }

  // Apply type-based filtering based on property type
  filteredVariables = applyPropertyTypeFilter(filteredVariables, property.type);

  // Apply validation-based filtering
  if (property.validation?.variableTypes) {
    filteredVariables = filteredVariables.filter(variable =>
      property.validation!.variableTypes!.includes(variable.type)
    );
  }

  // Sort by contextual priority, then alphabetically
  return sortVariablesByPriority(filteredVariables, contextual.priority);
};

/**
 * Apply a variable filter to a list of variables
 */
export const applyVariableFilter = (
  variables: Variable[],
  filter: VariableFilter
): Variable[] => {
  let filtered = [...variables];

  // Filter by allowed types
  if (filter.allowedTypes && filter.allowedTypes.length > 0) {
    filtered = filtered.filter(variable =>
      filter.allowedTypes!.includes(variable.type)
    );
  }

  // Filter by allowed categories
  if (filter.allowedCategories && filter.allowedCategories.length > 0) {
    filtered = filtered.filter(variable =>
      filter.allowedCategories!.includes(variable.category)
    );
  }

  // Exclude specific paths
  if (filter.excludedPaths && filter.excludedPaths.length > 0) {
    const excludedSet = new Set(filter.excludedPaths);
    filtered = filtered.filter(variable =>
      !excludedSet.has(variable.path)
    );
  }

  // Filter variables that require values (non-empty sample values)
  if (filter.requiresValue) {
    filtered = filtered.filter(variable => {
      const value = variable.sampleValue;
      return value !== null && value !== undefined && value !== '';
    });
  }

  return filtered;
};

/**
 * Apply property type-based filtering
 */
export const applyPropertyTypeFilter = (
  variables: Variable[],
  propertyType: PropertyType
): Variable[] => {
  switch (propertyType) {
    case 'url':
      return variables.filter(variable =>
        variable.type === 'url' ||
        variable.path.includes('url') ||
        variable.path.includes('link') ||
        variable.path.includes('website')
      );

    case 'number':
      return variables.filter(variable =>
        variable.type === 'number'
      );

    case 'boolean':
    case 'conditional':
      return variables.filter(variable =>
        variable.type === 'boolean' ||
        variable.isBlockHelper ||
        variable.category === VariableCategory.CONTROL_FLOW
      );

    case 'color':
      return variables.filter(variable =>
        variable.type === 'string' &&
        (variable.path.includes('color') || variable.path.includes('theme'))
      );

    case 'text':
    case 'textarea':
      // Text fields can use most variable types
      return variables.filter(variable =>
        variable.type === 'string' ||
        variable.type === 'number' ||
        variable.type === 'date' ||
        variable.type === 'url'
      );

    case 'select':
      return variables.filter(variable =>
        variable.type === 'string' ||
        variable.type === 'boolean'
      );

    default:
      return variables;
  }
};

/**
 * Sort variables by contextual priority
 */
export const sortVariablesByPriority = (
  variables: Variable[],
  priorityPaths: Variable[]
): Variable[] => {
  const priorityMap = new Map(
    priorityPaths.map((variable, index) => [variable.id, index])
  );

  return variables.sort((a, b) => {
    const aPriority = priorityMap.get(a.id);
    const bPriority = priorityMap.get(b.id);

    // Both have priority - sort by priority order
    if (aPriority !== undefined && bPriority !== undefined) {
      return aPriority - bPriority;
    }

    // Only a has priority
    if (aPriority !== undefined) return -1;

    // Only b has priority
    if (bPriority !== undefined) return 1;

    // Neither has priority - sort alphabetically
    return a.name.localeCompare(b.name);
  });
};

/**
 * Get all available variables from all categories
 */
export const getAllVariables = (): Variable[] => {
  const allVariables: Variable[] = [];

  Object.values(VARIABLE_DEFINITIONS.categories).forEach(category => {
    allVariables.push(...category.variables);
  });

  return allVariables;
};

/**
 * Get default property configuration for a component type
 */
export const getDefaultPropertiesForComponent = (
  componentType: ComponentType
): EnhancedComponentProperty[] => {
  const baseProperties: Partial<Record<ComponentType, EnhancedComponentProperty[]>> = {
    heading: [
      {
        id: 'text',
        label: 'Heading Text',
        type: 'text',
        value: '',
        supportsVariables: true,
        section: 'basic',
        placeholder: 'Enter heading text or use variables',
        validation: { required: true },
        variableFilter: {
          allowedTypes: ['string', 'number'],
          excludedPaths: ['system.unsubscribeUrl']
        }
      },
      {
        id: 'level',
        label: 'Heading Level',
        type: 'select',
        value: 'h2',
        supportsVariables: false,
        section: 'basic',
        validation: { required: true }
      },
      {
        id: 'color',
        label: 'Text Color',
        type: 'color',
        value: '#000000',
        supportsVariables: true,
        section: 'styling',
        variableFilter: {
          allowedTypes: ['string']
        }
      }
    ],

    text: [
      {
        id: 'content',
        label: 'Text Content',
        type: 'textarea',
        value: '',
        supportsVariables: true,
        section: 'basic',
        placeholder: 'Enter text content or use variables',
        validation: { required: true },
        variableFilter: {
          allowedTypes: ['string', 'number', 'date']
        }
      },
      {
        id: 'fontSize',
        label: 'Font Size',
        type: 'number',
        value: 16,
        supportsVariables: true,
        section: 'styling',
        variableFilter: {
          allowedTypes: ['number']
        }
      }
    ],

    button: [
      {
        id: 'text',
        label: 'Button Text',
        type: 'text',
        value: '',
        supportsVariables: true,
        section: 'basic',
        placeholder: 'Enter button text',
        validation: { required: true },
        variableFilter: {
          allowedTypes: ['string']
        }
      },
      {
        id: 'url',
        label: 'Button URL',
        type: 'url',
        value: '',
        supportsVariables: true,
        section: 'links',
        placeholder: 'Enter URL or use variables',
        validation: {
          required: true,
          variableTypes: ['url', 'string']
        },
        variableFilter: {
          allowedTypes: ['url', 'string'],
          requiresValue: true
        }
      },
      {
        id: 'backgroundColor',
        label: 'Background Color',
        type: 'color',
        value: '#3B82F6',
        supportsVariables: true,
        section: 'styling'
      }
    ],

    image: [
      {
        id: 'src',
        label: 'Image URL',
        type: 'url',
        value: '',
        supportsVariables: true,
        section: 'basic',
        placeholder: 'Enter image URL or use variables',
        validation: {
          required: true,
          variableTypes: ['url', 'string']
        },
        variableFilter: {
          allowedTypes: ['url', 'string'],
          requiresValue: true
        }
      },
      {
        id: 'alt',
        label: 'Alt Text',
        type: 'text',
        value: '',
        supportsVariables: true,
        section: 'basic',
        placeholder: 'Describe the image',
        validation: { required: true },
        variableFilter: {
          allowedTypes: ['string']
        }
      },
      {
        id: 'width',
        label: 'Width',
        type: 'number',
        value: 300,
        supportsVariables: true,
        section: 'styling',
        variableFilter: {
          allowedTypes: ['number']
        }
      }
    ],

    link: [
      {
        id: 'text',
        label: 'Link Text',
        type: 'text',
        value: '',
        supportsVariables: true,
        section: 'basic',
        placeholder: 'Enter link text',
        validation: { required: true },
        variableFilter: {
          allowedTypes: ['string']
        }
      },
      {
        id: 'url',
        label: 'Link URL',
        type: 'url',
        value: '',
        supportsVariables: true,
        section: 'links',
        placeholder: 'Enter URL or use variables',
        validation: {
          required: true,
          variableTypes: ['url', 'string']
        },
        variableFilter: {
          allowedTypes: ['url', 'string'],
          requiresValue: true
        }
      }
    ],

    divider: [
      {
        id: 'style',
        label: 'Divider Style',
        type: 'select',
        value: 'solid',
        supportsVariables: false,
        section: 'styling'
      },
      {
        id: 'color',
        label: 'Divider Color',
        type: 'color',
        value: '#E5E7EB',
        supportsVariables: true,
        section: 'styling'
      }
    ],

    spacer: [
      {
        id: 'height',
        label: 'Spacer Height',
        type: 'number',
        value: 20,
        supportsVariables: true,
        section: 'styling',
        variableFilter: {
          allowedTypes: ['number']
        }
      }
    ],



    snippet: [
      {
        id: 'snippetId',
        label: 'Snippet',
        type: 'select',
        value: '',
        supportsVariables: false,
        section: 'basic',
        validation: { required: true }
      }
    ]
  };

  return baseProperties[componentType] || [];
};

/**
 * Validate a property value with variable support
 */
export const validatePropertyValue = (
  property: EnhancedComponentProperty,
  value: any,
  variables?: Variable[]
): { isValid: boolean; errors: string[]; warnings: string[] } => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if value is required
  if (property.validation?.required && (!value || value.toString().trim() === '')) {
    errors.push(`${property.label} is required`);
    return { isValid: false, errors, warnings };
  }

  // Skip further validation if value is empty and not required
  if (!value || value.toString().trim() === '') {
    return { isValid: true, errors, warnings };
  }

  const stringValue = value.toString();

  // Check for variable syntax
  const hasVariables = /\{\{[^}]+\}\}/.test(stringValue);

  if (hasVariables) {
    // Validate variable syntax
    const variableMatches = stringValue.match(/\{\{([^}]+)\}\}/g);
    if (variableMatches) {
      for (const match of variableMatches) {
        const variablePath = match.slice(2, -2).trim();

        // Check if variable exists
        if (variables) {
          const variable = variables.find(v => v.path === variablePath);
          if (!variable) {
            warnings.push(`Variable "${variablePath}" not found`);
          } else {
            // Check if variable type is allowed for this property
            if (property.validation?.variableTypes) {
              if (!property.validation.variableTypes.includes(variable.type)) {
                errors.push(`Variable "${variablePath}" type "${variable.type}" is not allowed for ${property.label}`);
              }
            }
          }
        }
      }
    }
  } else {
    // Validate non-variable values
    switch (property.type) {
      case 'url':
        try {
          new URL(stringValue);
        } catch {
          errors.push(`${property.label} must be a valid URL`);
        }
        break;

      case 'number':
        if (isNaN(Number(stringValue))) {
          errors.push(`${property.label} must be a valid number`);
        }
        break;

      case 'color':
        if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(stringValue)) {
          errors.push(`${property.label} must be a valid hex color`);
        }
        break;
    }

    // Apply pattern validation
    if (property.validation?.pattern && !property.validation.pattern.test(stringValue)) {
      errors.push(`${property.label} format is invalid`);
    }

    // Apply length validation
    if (property.validation?.minLength && stringValue.length < property.validation.minLength) {
      errors.push(`${property.label} must be at least ${property.validation.minLength} characters`);
    }

    if (property.validation?.maxLength && stringValue.length > property.validation.maxLength) {
      errors.push(`${property.label} must be no more than ${property.validation.maxLength} characters`);
    }
  }

  // Apply custom validation
  if (property.validation?.customValidator) {
    const customResult = property.validation.customValidator(value, variables);
    errors.push(...customResult.errors.map(e => e.message));
    warnings.push(...customResult.warnings.map(w => w.message));
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};
