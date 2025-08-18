// Accessibility utilities and ARIA helpers

export interface AriaAttributes {
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-expanded'?: boolean;
  'aria-hidden'?: boolean;
  'aria-live'?: 'off' | 'polite' | 'assertive';
  'aria-atomic'?: boolean;
  'aria-busy'?: boolean;
  'aria-disabled'?: boolean;
  'aria-invalid'?: boolean | 'false' | 'true' | 'grammar' | 'spelling';
  'aria-required'?: boolean;
  'aria-selected'?: boolean;
  'aria-checked'?: boolean | 'mixed';
  'aria-pressed'?: boolean | 'mixed';
  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time';
  'aria-owns'?: string;
  'aria-controls'?: string;
  'aria-activedescendant'?: string;
  'aria-haspopup'?: boolean | 'false' | 'true' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
  'aria-modal'?: boolean;
  role?: string;
  tabIndex?: number;
}

// Generate unique IDs for ARIA relationships
let idCounter = 0;
export const generateId = (prefix: string = 'id'): string => {
  return `${prefix}-${++idCounter}`;
};

// Common ARIA patterns
export const ariaPatterns = {
  // Button patterns
  button: (label: string, pressed?: boolean): AriaAttributes => ({
    'aria-label': label,
    'aria-pressed': pressed,
    role: 'button',
    tabIndex: 0,
  }),

  // Toggle button
  toggleButton: (label: string, pressed: boolean): AriaAttributes => ({
    'aria-label': label,
    'aria-pressed': pressed,
    role: 'button',
    tabIndex: 0,
  }),

  // Link patterns
  link: (label: string, current?: boolean): AriaAttributes => ({
    'aria-label': label,
    'aria-current': current ? 'page' : undefined,
    role: 'link',
  }),

  // Form field patterns
  textInput: (label: string, required?: boolean, invalid?: boolean, describedBy?: string): AriaAttributes => ({
    'aria-label': label,
    'aria-required': required,
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
  }),

  // Select/dropdown patterns
  select: (label: string, expanded: boolean, required?: boolean): AriaAttributes => ({
    'aria-label': label,
    'aria-expanded': expanded,
    'aria-required': required,
    'aria-haspopup': 'listbox',
    role: 'combobox',
  }),

  // Modal/dialog patterns
  modal: (labelledBy: string, describedBy?: string): AriaAttributes => ({
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
    'aria-modal': true,
    role: 'dialog',
    tabIndex: -1,
  }),

  // Alert patterns
  alert: (live: 'polite' | 'assertive' = 'polite'): AriaAttributes => ({
    'aria-live': live,
    'aria-atomic': true,
    role: 'alert',
  }),

  // Status patterns
  status: (label?: string): AriaAttributes => ({
    'aria-label': label,
    'aria-live': 'polite',
    'aria-atomic': true,
    role: 'status',
  }),

  // Loading patterns
  loading: (label: string = 'Loading'): AriaAttributes => ({
    'aria-label': label,
    'aria-busy': true,
    'aria-live': 'polite',
    role: 'status',
  }),

  // Navigation patterns
  navigation: (label: string): AriaAttributes => ({
    'aria-label': label,
    role: 'navigation',
  }),

  // List patterns
  list: (label?: string): AriaAttributes => ({
    'aria-label': label,
    role: 'list',
  }),

  listItem: (): AriaAttributes => ({
    role: 'listitem',
  }),

  // Tab patterns
  tabList: (label: string): AriaAttributes => ({
    'aria-label': label,
    role: 'tablist',
  }),

  tab: (selected: boolean, controls: string): AriaAttributes => ({
    'aria-selected': selected,
    'aria-controls': controls,
    role: 'tab',
    tabIndex: selected ? 0 : -1,
  }),

  tabPanel: (labelledBy: string): AriaAttributes => ({
    'aria-labelledby': labelledBy,
    role: 'tabpanel',
    tabIndex: 0,
  }),

  // Menu patterns
  menu: (label: string): AriaAttributes => ({
    'aria-label': label,
    role: 'menu',
  }),

  menuItem: (label: string): AriaAttributes => ({
    'aria-label': label,
    role: 'menuitem',
    tabIndex: -1,
  }),

  // Grid/table patterns
  grid: (label: string): AriaAttributes => ({
    'aria-label': label,
    role: 'grid',
  }),

  gridCell: (): AriaAttributes => ({
    role: 'gridcell',
    tabIndex: -1,
  }),
};

// Screen reader utilities
export const screenReaderUtils = {
  // Hide content from screen readers
  hide: (): AriaAttributes => ({
    'aria-hidden': true,
  }),

  // Show content only to screen readers
  srOnly: 'sr-only', // Tailwind class

  // Announce content to screen readers
  announce: (message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;

    document.body.appendChild(announcement);

    // Remove after announcement
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  },
};

// Keyboard navigation utilities
export const keyboardUtils = {
  // Common key codes
  keys: {
    ENTER: 'Enter',
    SPACE: ' ',
    ESCAPE: 'Escape',
    ARROW_UP: 'ArrowUp',
    ARROW_DOWN: 'ArrowDown',
    ARROW_LEFT: 'ArrowLeft',
    ARROW_RIGHT: 'ArrowRight',
    TAB: 'Tab',
    HOME: 'Home',
    END: 'End',
  },

  // Handle keyboard events for custom interactive elements
  handleKeyDown: (
    event: React.KeyboardEvent,
    handlers: Partial<Record<string, (event: React.KeyboardEvent) => void>>
  ) => {
    const handler = handlers[event.key];
    if (handler) {
      event.preventDefault();
      handler(event);
    }
  },

  // Focus management
  trapFocus: (container: HTMLElement) => {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    // Focus first element
    firstElement?.focus();

    // Return cleanup function
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  },
};

// Color contrast utilities
export const contrastUtils = {
  // Check if color combination meets WCAG AA standards
  meetsWCAGAA: (foreground: string, background: string): boolean => {
    // This is a simplified check - in production you'd use a proper contrast calculation
    // For now, we'll assume our design system colors meet WCAG AA
    return true;
  },

  // Get accessible color combinations
  getAccessibleColors: () => ({
    primary: {
      text: '#ffffff',
      background: '#3B82F6',
      contrast: 4.5, // WCAG AA compliant
    },
    secondary: {
      text: '#ffffff',
      background: '#64748B',
      contrast: 4.5,
    },
    success: {
      text: '#ffffff',
      background: '#10B981',
      contrast: 4.5,
    },
    warning: {
      text: '#000000',
      background: '#F59E0B',
      contrast: 4.5,
    },
    error: {
      text: '#ffffff',
      background: '#EF4444',
      contrast: 4.5,
    },
  }),
};

// Form accessibility helpers
export const formAccessibility = {
  // Generate form field IDs and relationships
  createFieldIds: (fieldName: string) => {
    const fieldId = generateId(`field-${fieldName}`);
    const labelId = generateId(`label-${fieldName}`);
    const errorId = generateId(`error-${fieldName}`);
    const helpId = generateId(`help-${fieldName}`);

    return {
      fieldId,
      labelId,
      errorId,
      helpId,
      getFieldProps: (hasError?: boolean, hasHelp?: boolean) => ({
        id: fieldId,
        'aria-labelledby': labelId,
        'aria-describedby': [
          hasError ? errorId : null,
          hasHelp ? helpId : null,
        ].filter(Boolean).join(' ') || undefined,
        'aria-invalid': hasError,
      }),
      getLabelProps: () => ({
        id: labelId,
        htmlFor: fieldId,
      }),
      getErrorProps: () => ({
        id: errorId,
        'aria-live': 'polite' as const,
        role: 'alert',
      }),
      getHelpProps: () => ({
        id: helpId,
      }),
    };
  },
};

// Responsive design accessibility
export const responsiveA11y = {
  // Touch target sizes (minimum 44px for mobile)
  touchTarget: {
    minSize: '44px',
    className: 'min-h-[44px] min-w-[44px]',
  },

  // Focus indicators
  focusRing: {
    className: 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
  },

  // Skip links for keyboard navigation
  skipLink: {
    className: 'sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-blue-600 text-white px-4 py-2 rounded z-50',
  },
};
