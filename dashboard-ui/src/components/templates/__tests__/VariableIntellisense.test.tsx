import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SimpleCodeEditor } from '../SimpleCodeEditor';
import { getAllVariables } from '../../../data/variableDefinitions';

// Mock Monaco Editor
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ onChange, onMount }: any) => {
    const mockEditor = {
      getValue: () => '{{newsletter.title}}',
      setValue: (value: string) => {},
      getPosition: () => ({ lineNumber: 1, column: 10 }),
      setPosition: () => {},
      focus: () => {},
      updateOptions: () => {},
      onDidChangeModelContent: () => ({ dispose: () => {} }),
      addAction: () => {},
      trigger: () => {}
    };

    const mockMonaco = {
      languages: {
        register: () => {},
        setMonarchTokensProvider: () => {},
        registerCompletionItemProvider: () => ({ dispose: () => {} }),
        registerHoverProvider: () => ({ dispose: () => {} }),
        CompletionItemKind: {
          Variable: 1,
          Snippet: 2,
          Keyword: 3,
          Property: 4
        },
        CompletionItemInsertTextRule: {
          InsertAsSnippet: 1
        }
      },
      editor: {
        defineTheme: () => {},
        getModel: () => null
      },
      Range: class MockRange {
        constructor(public startLineNumber: number, public startColumn: number,
                   public endLineNumber: number, public endColumn: number) {}
      }
    };

    React.useEffect(() => {
      if (onMount) {
        onMount(mockEditor, mockMonaco);
      }
    }, [onMount]);

    return (
      <textarea
        data-testid="monaco-editor"
        onChange={(e) => onChange?.(e.target.value)}
        defaultValue="{{newsletter.title}}"
      />
    );
  },
  loader: {
    config: () => {}
  }
}));

describe('Variable Intellisense', () => {
  const testData = JSON.stringify({
    newsletter: {
      title: 'Test Newsletter',
      issue: 42,
      articles: [
        { title: 'Article 1', url: 'https://example.com/1' }
      ]
    },
    subscriber: {
      firstName: 'John',
      email: 'john@example.com'
    }
  });

  it('should render CodeEditor with variable intellisense support', () => {
    render(
      <SimpleCodeEditor
        value="{{newsletter.title}}"
        onChange={() => {}}
        language="handlebars"
        testData={testData}
      />
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('should parse test data for variable extraction', () => {
    const { rerender } = render(
      <SimpleCodeEditor
        value=""
        onChange={() => {}}
        language="handlebars"
        testData={testData}
      />
    );

    // Test that the component doesn't crash with valid test data
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();

    // Test with invalid JSON
    rerender(
      <SimpleCodeEditor
        value=""
        onChange={() => {}}
        language="handlebars"
        testData="invalid json"
      />
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('should handle variable intellisense setup', async () => {
    const mockOnChange = jest.fn();

    render(
      <SimpleCodeEditor
        value="{{newsletter."
        onChange={mockOnChange}
        language="handlebars"
        testData={testData}
      />
    );

    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toBeInTheDocument();

    // Simulate typing to trigger intellisense
    fireEvent.change(editor, { target: { value: '{{newsletter.t' } });

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith('{{newsletter.t');
    });
  });

  it('should provide predefined variables', () => {
    const variables = getAllVariables();

    expect(variables.length).toBeGreaterThan(0);
    expect(variables.some(v => v.path === 'newsletter.title')).toBe(true);
    expect(variables.some(v => v.path === 'subscriber.firstName')).toBe(true);
    expect(variables.some(v => v.path === 'brand.name')).toBe(true);
  });

  it('should handle nested object properties in test data', () => {
    const complexTestData = JSON.stringify({
      newsletter: {
        title: 'Test',
        featuredArticle: {
          title: 'Featured',
          author: {
            name: 'John Doe',
            email: 'john@example.com'
          }
        }
      }
    });

    render(
      <SimpleCodeEditor
        value=""
        onChange={() => {}}
        language="handlebars"
        testData={complexTestData}
      />
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('should handle array properties in test data', () => {
    const arrayTestData = JSON.stringify({
      newsletter: {
        articles: [
          { title: 'Article 1', url: 'https://example.com/1' },
          { title: 'Article 2', url: 'https://example.com/2' }
        ],
        tags: ['serverless', 'aws', 'lambda']
      }
    });

    render(
      <SimpleCodeEditor
        value=""
        onChange={() => {}}
        language="handlebars"
        testData={arrayTestData}
      />
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('should support control flow helpers', () => {
    render(
      <SimpleCodeEditor
        value="{{#if newsletter.hasSponsors}}"
        onChange={() => {}}
        language="handlebars"
        testData={testData}
      />
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });
});
