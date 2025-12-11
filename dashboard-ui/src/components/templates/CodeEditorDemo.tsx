import React, { useState } from 'react';
import { SimpleCodeEditor } from './SimpleCodeEditor';
import type { Snippet } from '@/types/template';

// Demo component to showcase the enhanced CodeEditor with snippet features
export const CodeEditorDemo: React.FC = () => {
  const [value, setValue] = useState(`<h1>Newsletter Template</h1>
<p>Welcome to our newsletter!</p>

<!-- Try typing "{{>" to see snippet autocomplete -->
<!-- Or right-click on existing snippets for context menu -->

{{> header title="Weekly Update" subtitle="Issue #42"}}

<div class="content">
  {{> article-list count="5"}}
</div>

{{> footer}}`);

  // Mock snippets for demonstration
  const mockSnippets: Snippet[] = [
    {
      id: 'snippet-1',
      tenantId: 'demo',
      name: 'header',
      description: 'Newsletter header with title and subtitle',
      type: 'snippet',
      parameters: [
        { name: 'title', type: 'string', required: true, description: 'Main header title' },
        { name: 'subtitle', type: 'string', required: false, description: 'Optional subtitle' },
        { name: 'showDate', type: 'boolean', required: false, defaultValue: true, description: 'Show publication date' }
      ],
      s3Key: 'snippets/demo/header.hbs',
      s3VersionId: 'v1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      version: 1,
      isActive: true
    },
    {
      id: 'snippet-2',
      tenantId: 'demo',
      name: 'article-list',
      description: 'List of featured articles',
      type: 'snippet',
      parameters: [
        { name: 'count', type: 'number', required: false, defaultValue: 3, description: 'Number of articles to show' },
        { name: 'category', type: 'string', required: false, description: 'Filter by category' }
      ],
      s3Key: 'snippets/demo/article-list.hbs',
      s3VersionId: 'v1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      version: 1,
      isActive: true
    },
    {
      id: 'snippet-3',
      tenantId: 'demo',
      name: 'footer',
      description: 'Newsletter footer with unsubscribe link',
      type: 'snippet',
      parameters: [],
      s3Key: 'snippets/demo/footer.hbs',
      s3VersionId: 'v1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      version: 1,
      isActive: true
    }
  ];

  const handleSnippetEdit = (snippetId: string, parameters: Record<string, any>) => {
    console.log('Edit snippet:', snippetId, parameters);
    // In a real implementation, this would open a parameter configuration dialog
    alert(`Edit snippet ${snippetId} with parameters: ${JSON.stringify(parameters, null, 2)}`);
  };

  const handleSnippetRemove = (startPos: number, endPos: number) => {
    console.log('Remove snippet at position:', startPos, endPos);
    // In a real implementation, this would remove the snippet from the editor
    const newValue = value.substring(0, startPos) + value.substring(endPos);
    setValue(newValue);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Enhanced Code Editor Demo</h2>

      <div className="mb-4 p-4 bg-blue-50 rounded-lg">
        <h3 className="font-semibold mb-2">Features to try:</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Type <code>{'{{>'}</code> to see snippet autocomplete with parameter hints</li>
          <li>Hover over existing snippets to see descriptions and parameter values</li>
          <li>Right-click on snippets for context menu options (edit, remove, info)</li>
          <li>Use handlebars helpers like <code>if</code>, <code>each</code>, <code>unless</code></li>
          <li>Parameter completion when typing inside snippet syntax</li>
        </ul>
      </div>

      <SimpleCodeEditor
        value={value}
        onChange={setValue}
        language="handlebars"
        height="500px"
        onValidationChange={(errors) => {
          console.log('Validation errors:', errors);
        }}
        className="border-2 border-gray-300 rounded-lg"
        theme="light"
      />

      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-semibold mb-2">Available Snippets:</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {mockSnippets.map(snippet => (
            <div key={snippet.id} className="p-3 bg-white rounded border">
              <h4 className="font-medium">{snippet.name}</h4>
              <p className="text-sm text-gray-600 mb-2">{snippet.description}</p>
              {snippet.parameters && snippet.parameters.length > 0 && (
                <div className="text-xs">
                  <strong>Parameters:</strong>
                  <ul className="list-disc list-inside ml-2">
                    {snippet.parameters.map(param => (
                      <li key={param.name}>
                        {param.name} ({param.type}){param.required ? ' *' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
