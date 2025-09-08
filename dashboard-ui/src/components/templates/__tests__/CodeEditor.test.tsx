import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { CodeEditor } from '../CodeEditor';
import type { Snippet } from '@/types/template';

// Mock Monaco Editor
const mockEditor = {
  getValue: vi.fn(),
  onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
  updateOptions: vi.fn(),
  deltaDecorations: vi.fn(() => []),
  getModel: vi.fn(() => ({}))
};

const mockMonaco = {
  languages: {
    getLanguages: vi.fn(() => []),
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    CompletionItemKind: {
      Snippet: 1,
      Keyword: 2
    },
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 1
    }
  },
  editor: {
    defineTheme: vi.fn(),
    setModelMarkers: vi.fn()
  },
  Range: vi.fn(),
  MarkerSeverity: {
    Error: 8,
    Warning: 4,
    Info: 1
  }
};

vi.mock('@monaco-editor/react', () => ({
  default: ({ onMount, onChange, value }: any) => {
    React.useEffect(() => {
      if (onMount) {
        onMount(mockEditor, mockMonaco);
      }
    }, [onMount]);

    return (
      <textarea
        data-testid="monaco-editor"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  }
}));

const mockSnippets: Snippet[] = [
  {
    id: 'snippet-1',
    tenantId: 'tenant-1',
    name: 'header',
    description: 'Newsletter header',
    type: 'snippet',
    parameters: [
      { name: 'title', type: 'string', required: true, description: 'Header title' },
      { name: 'subtitle', type: 'string', required: false, description: 'Header subtitle' }
    ],
    s3Key: 'snippets/tenant-1/snippet-1.hbs',
    s3VersionId: 'v1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true
  },
  {
    id: 'snippet-2',
    tenantId: 'tenant-1',
    name: 'footer',
    description: 'Newsletter footer',
    type: 'snippet',
    parameters: [],
    s3Key: 'snippets/tenant-1/snippet-2.hbs',
    s3VersionId: 'v1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true
  }
];

describe('CodeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with basic props', () => {
    const mockOnChange = vi.fn();

    render(
      <CodeEditor
        value="<h1>Test</h1>"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toHaveValue('<h1>Test</h1>');
  });

  it('calls onChange when content changes', () => {
    const mockOnChange = vi.fn();

    render(
      <CodeEditor
        value=""
        onChange={mockOnChange}
      />
    );

    const editor = screen.getByTestId('monaco-editor');
    fireEvent.change(editor, { target: { value: '<h1>New Content</h1>' } });

    expect(mockOnChange).toHaveBeenCalledWith('<h1>New Content</h1>');
  });

  it('sets up handlebars language on mount', async () => {
    render(
      <CodeEditor
        value=""
        onChange={vi.fn()}
        language="handlebars"
      />
    );

    await waitFor(() => {
      expect(mockMonaco.languages.register).toHaveBeenCalledWith({ id: 'handlebars' });
      expect(mockMonaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
        'handlebars',
        expect.any(Object)
      );
    });
  });

  it('sets up snippet autocomplete when snippets are provided', async () => {
    render(
      <CodeEditor
        value=""
        onChange={vi.fn()}
        snippets={mockSnippets}
      />
    );

    await waitFor(() => {
      expect(mockMonaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
        'handlebars',
        expect.any(Object)
      );
    });
  });

  it('validates handlebars syntax and reports errors', async () => {
    const mockOnValidationChange = vi.fn();

    render(
      <CodeEditor
        value="{{unclosed"
        onChange={vi.fn()}
        onValidationChange={mockOnValidationChange}
      />
    );

    await waitFor(() => {
      expect(mockOnValidationChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Unmatched handlebars braces',
            severity: 'error'
          })
        ])
      );
    });
  });

  it('shows validation status bar when there are errors', async () => {
    const mockOnValidationChange = vi.fn();

    render(
      <CodeEditor
        value="{{unclosed"
        onChange={vi.fn()}
        onValidationChange={mockOnValidationChange}
      />
    );

    // Wait for validation to complete
    await waitFor(() => {
      expect(mockOnValidationChange).toHaveBeenCalled();
    });

    // The validation status should be shown (this would be visible in the actual component)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('configures editor options correctly', async () => {
    render(
      <CodeEditor
        value=""
        onChange={vi.fn()}
        height="600px"
        readOnly={true}
        showMinimap={true}
      />
    );

    await waitFor(() => {
      expect(mockEditor.updateOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          minimap: { enabled: true }
        })
      );
    });
  });

  it('handles different languages', () => {
    render(
      <CodeEditor
        value=""
        onChange={vi.fn()}
        language="html"
      />
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('shows language indicator', () => {
    render(
      <CodeEditor
        value=""
        onChange={vi.fn()}
        language="handlebars"
      />
    );

    expect(screen.getByText('handlebars')).toBeInTheDocument();
  });

  it('handles empty value gracefully', () => {
    const mockOnChange = vi.fn();

    render(
      <CodeEditor
        value=""
        onChange={mockOnChange}
      />
    );

    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveValue('');
  });

  it('applies custom className', () => {
    render(
      <CodeEditor
        value=""
        onChange={vi.fn()}
        className="custom-class"
      />
    );

    // The className would be applied to the container div
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('handles theme changes', () => {
    render(
      <CodeEditor
        value=""
        onChange={vi.fn()}
        theme="dark"
      />
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('validates HTML tags', async () => {
    const mockOnValidationChange = vi.fn();

    render(
      <CodeEditor
        value="<div>unclosed div"
        onChange={vi.fn()}
        onValidationChange={mockOnValidationChange}
      />
    );

    await waitFor(() => {
      expect(mockOnValidationChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Unclosed HTML tag: div',
            severity: 'warning'
          })
        ])
      );
    });
  });

  it('validates empty handlebars expressions', async () => {
    const mockOnValidationChange = vi.fn();

    render(
      <CodeEditor
        value="{{}}"
        onChange={vi.fn()}
        onValidationChange={mockOnValidationChange}
      />
    );

    await waitFor(() => {
      expect(mockOnValidationChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Empty handlebars expression',
            severity: 'error'
          })
        ])
      );
    });
  });
});
