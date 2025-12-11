import { useState, useCallback, useRef, useEffect } from 'react';

interface Variable {
  path: string;
  name: string;
  type: string;
  sampleValue?: any;
  description?: string;
}

interface UseVariableSuggestionsProps {
  testData?: string;
  onInsert?: (variable: Variable) => void;
}

export const useVariableSuggestions = ({ testData, onInsert }: UseVariableSuggestionsProps = {}) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<Variable[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Extract variables from test data
  const extractVariables = useCallback((data: any, prefix = ''): Variable[] => {
    if (!data || typeof data !== 'object') return [];

    const variables: Variable[] = [];
    Object.keys(data).forEach(key => {
      const path = prefix ? `${prefix}.${key}` : key;
      const val = data[key];

      if (val && typeof val === 'object' && !Array.isArray(val)) {
        variables.push(...extractVariables(val, path));
      } else if (!Array.isArray(val)) {
        variables.push({
          path,
          name: key,
          type: typeof val,
          sampleValue: val,
          description: `${typeof val} value`
        });
      }
    });

    return variables;
  }, []);

  // Get available variables and Handlebars helpers
  const getAvailableVariables = useCallback((): Variable[] => {
    const handlebarsHelpers: Variable[] = [
      // Conditional helpers
      { path: '#if condition', name: 'If Statement', type: 'helper', description: 'Conditional block - shows content if condition is true' },
      { path: '#unless condition', name: 'Unless Statement', type: 'helper', description: 'Conditional block - shows content if condition is false' },
      { path: '#with object', name: 'With Block', type: 'helper', description: 'Changes context to the specified object' },

      // Loop helpers
      { path: '#each array', name: 'Each Loop', type: 'helper', description: 'Iterates over arrays or objects' },

      // Comparison helpers
      { path: '#eq value1 value2', name: 'Equals', type: 'helper', description: 'True if values are equal' },
      { path: '#ne value1 value2', name: 'Not Equals', type: 'helper', description: 'True if values are not equal' },
      { path: '#lt value1 value2', name: 'Less Than', type: 'helper', description: 'True if first value is less than second' },
      { path: '#gt value1 value2', name: 'Greater Than', type: 'helper', description: 'True if first value is greater than second' },

      // Built-in variables
      { path: '@index', name: 'Loop Index', type: 'variable', description: 'Current index in #each loop (0-based)' },
      { path: '@first', name: 'First Item', type: 'variable', description: 'True if current item is first in #each loop' },
      { path: '@last', name: 'Last Item', type: 'variable', description: 'True if current item is last in #each loop' },
      { path: '@key', name: 'Object Key', type: 'variable', description: 'Current key when iterating over objects' },
      { path: 'this', name: 'Current Context', type: 'variable', description: 'Current context object' },
      { path: '../', name: 'Parent Context', type: 'variable', description: 'Access parent context' },

      // Closing tags
      { path: 'else', name: 'Else Block', type: 'helper', description: 'Alternative content for if/unless blocks' },
      { path: '/if', name: 'Close If', type: 'helper', description: 'Closes #if block' },
      { path: '/unless', name: 'Close Unless', type: 'helper', description: 'Closes #unless block' },
      { path: '/each', name: 'Close Each', type: 'helper', description: 'Closes #each loop' },
      { path: '/with', name: 'Close With', type: 'helper', description: 'Closes #with block' }
    ];

    const defaultVars: Variable[] = [
      { path: 'newsletter.title', name: 'Newsletter Title', type: 'string', sampleValue: 'Weekly Newsletter' },
      { path: 'newsletter.issue', name: 'Issue Number', type: 'number', sampleValue: 42 },
      { path: 'newsletter.description', name: 'Description', type: 'string', sampleValue: 'Your weekly insights' },
      { path: 'subscriber.name', name: 'Subscriber Name', type: 'string', sampleValue: 'John Doe' },
      { path: 'subscriber.email', name: 'Subscriber Email', type: 'string', sampleValue: 'john@example.com' }
    ];

    let dataVars: Variable[] = [];
    if (testData) {
      try {
        const parsed = JSON.parse(testData);
        const extractedVars = extractVariables(parsed);

        // Combine and deduplicate by path
        const allDataVars = [...defaultVars, ...extractedVars];
        dataVars = allDataVars.reduce((acc, variable) => {
          if (!acc.find(v => v.path === variable.path)) {
            acc.push(variable);
          }
          return acc;
        }, [] as Variable[]);
      } catch (error) {
        dataVars = defaultVars;
      }
    } else {
      dataVars = defaultVars;
    }

    // Combine helpers first, then data variables
    return [...handlebarsHelpers, ...dataVars];
  }, [testData, extractVariables]);

  // Handle input change to detect {{ trigger
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void) => {
    onChange(e);

    const value = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPos);
    const match = textBeforeCursor.match(/\{\{([^}]*)$/);

    if (match) {
      const partialVariable = match[1];
      const availableVars = getAvailableVariables();

      const filtered = availableVars.filter(variable =>
        variable.path.toLowerCase().includes(partialVariable.toLowerCase()) ||
        variable.name.toLowerCase().includes(partialVariable.toLowerCase())
      );

      if (filtered.length > 0) {
        // Calculate position for suggestions dropdown
        const rect = e.target.getBoundingClientRect();
        setPosition({
          top: rect.bottom + window.scrollY,
          left: rect.left + window.scrollX
        });

        setSuggestions(filtered);
        setSelectedIndex(0);
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  }, [getAvailableVariables]);

  // Handle key navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, originalHandler?: (e: React.KeyboardEvent) => void) => {
    if (!showSuggestions) {
      originalHandler?.(e);
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        if (suggestions[selectedIndex] && onInsert) {
          onInsert(suggestions[selectedIndex]);
        }
        setShowSuggestions(false);
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
      default:
        originalHandler?.(e);
    }
  }, [showSuggestions, suggestions, selectedIndex, onInsert]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowSuggestions(false);
    if (showSuggestions) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showSuggestions]);

  return {
    showSuggestions,
    suggestions,
    selectedIndex,
    position,
    handleInputChange,
    handleKeyDown,
    hideSuggestions: () => setShowSuggestions(false),
    selectSuggestion: (index: number) => {
      if (suggestions[index] && onInsert) {
        onInsert(suggestions[index]);
      }
      setShowSuggestions(false);
    }
  };
};
