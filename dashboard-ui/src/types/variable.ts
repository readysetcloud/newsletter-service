// Variable System Types for Visual Builder

export enum VariableCategory {
  NEWSLETTER = 'newsletter',
  SUBSCRIBER = 'subscriber',
  BRAND = 'brand',
  CUSTOM = 'custom',
  SYSTEM = 'system',
  CONTROL_FLOW = 'control_flow'
}

export type VariableType = 'string' | 'number' | 'boolean' | 'url' | 'date' | 'array' | 'object' | 'control_flow';

export interface Variable {
  id: string;
  name: string;
  path: string; // e.g., "newsletter.title" or "#if newsletter.hasSponsors"
  category: VariableCategory;
  type: VariableType;
  sampleValue: any;
  description?: string;
  isCustom: boolean;
  isBlockHelper?: boolean; // true for {{#if}}, {{#each}}, etc.
  requiresClosing?: boolean; // true for block helpers that need {{/if}}, {{/each}}
  blockType?: 'conditional' | 'iterator' | 'custom';
}

export interface ControlFlowParameter {
  name: string;
  type: 'variable' | 'expression' | 'literal';
  required: boolean;
  description: string;
  examples: string[];
}

export interface ControlFlowExample {
  title: string;
  code: string;
  description: string;
  variables: string[]; // required variables for this example
}

export interface ControlFlowHelper {
  id: string;
  name: string;
  syntax: string; // e.g., "{{#if condition}}"
  closingSyntax?: string; // e.g., "{{/if}}"
  description: string;
  parameters: ControlFlowParameter[];
  examples: ControlFlowExample[];
  category: 'conditional' | 'iterator' | 'custom';
}

export interface ControlFlowInsertion {
  openingTag: string;
  closingTag?: string;
  cursorPosition: number; // where to place cursor after insertion
  placeholders: ControlFlowPlaceholder[];
}

export interface ControlFlowPlaceholder {
  name: string;
  position: number;
  length: number;
  type: 'variable' | 'expression';
}

export interface VariableDefinitions {
  categories: {
    [key in VariableCategory]: {
      label: string;
      description: string;
      variables: Variable[];
    }
  };
  contextualMappings: {
    [componentType: string]: {
      priority: string[]; // variable paths in priority order
      excluded: string[]; // variables to hide for this component
    }
  };
  controlFlowHelpers: ControlFlowHelper[];
}

export interface CustomVariable {
  id: string;
  name: string;
  path: string;
  defaultValue: any;
  type: VariableType;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

// Sample Data Types
export interface SampleDataSet {
  newsletter: {
    title: string;
    issue: number;
    date: string;
    description: string;
    url: string;
    hasSponsors: boolean;
    isDraft: boolean;
    articles: Array<{
      title: string;
      summary: string;
      url: string;
      author: string;
    }>;
    sponsors: Array<{
      name: string;
      logo: string;
      url: string;
    }>;
    featuredArticle: {
      title: string;
      description: string;
      url: string;
      image: string;
    };
    tags: string[];
  };
  subscriber: {
    firstName: string;
    lastName: string;
    email: string;
    subscriptionDate: string;
    isPremium: boolean;
    hasUnsubscribed: boolean;
    preferences: {
      frequency: string;
      topics: string[];
    };
  };
  brand: {
    name: string;
    logo: string;
    primaryColor: string;
    website: string;
    showLogo: boolean;
    socialMedia: {
      twitter: string;
      linkedin: string;
      github: string;
    };
  };
  custom: Record<string, any>;
}

// Component Integration Types
export type ComponentType = 'heading' | 'text' | 'button' | 'image' | 'link' | 'divider' | 'spacer' | 'snippet';

export interface EnhancedComponentProperty {
  id: string;
  label: string;
  type: PropertyType;
  value: any;
  supportsVariables: boolean;
  variableContext?: ComponentType;
  validation?: PropertyValidation;
  placeholder?: string;
  section?: PropertySection;
  helpText?: string;
  variableFilter?: VariableFilter;
}

export type PropertyType = 'text' | 'textarea' | 'url' | 'color' | 'number' | 'boolean' | 'select' | 'conditional';

export type PropertySection = 'basic' | 'styling' | 'links' | 'advanced' | 'conditional';

export interface PropertyValidation {
  required?: boolean;
  pattern?: RegExp;
  minLength?: number;
  maxLength?: number;
  variableTypes?: VariableType[];
  customValidator?: (value: any, variables?: Variable[]) => ValidationResult;
}

export interface VariableFilter {
  allowedTypes?: VariableType[];
  allowedCategories?: VariableCategory[];
  excludedPaths?: string[];
  requiresValue?: boolean;
}

// Autocomplete Types
export interface AutocompleteTrigger {
  pattern: RegExp; // /\{\{[\w.#]*$/
  minLength: number; // 2 characters after {{
  controlFlowPattern: RegExp; // /\{\{#[\w]*$/
}

// Variable Picker Props Types
export interface VariablePickerProps {
  onVariableSelect: (variable: Variable) => void;
  contextType?: ComponentType;
  currentValue?: string;
  position: 'inline' | 'modal';
}

export interface VariableInputButtonProps {
  inputRef: React.RefObject<HTMLInputElement>;
  onVariableInsert: (variable: Variable) => void;
  contextType?: ComponentType;
  disabled?: boolean;
  className?: string;
}

export interface VariableAutocompleteProps {
  inputValue: string;
  onSuggestionSelect: (variable: Variable) => void;
  onControlFlowInsert: (helper: ControlFlowHelper) => void;
  contextType?: ComponentType;
  maxSuggestions?: number;
}

export interface ControlFlowPickerProps {
  onHelperSelect: (helper: ControlFlowHelper, parameters: Record<string, string>) => void;
  availableVariables: Variable[];
  contextType?: ComponentType;
}

export interface VariableManagerProps {
  onVariablesChange: (variables: CustomVariable[]) => void;
  existingVariables: CustomVariable[];
  usageMap: Map<string, string[]>; // variable ID -> template IDs
}
