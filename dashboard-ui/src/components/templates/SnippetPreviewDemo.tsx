import React, { useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { TemplateBuilder, TemplateBuilderRef } from './TemplateBuilder';
import type { Snippet } from '@/types/template';

// Demo snippet for testing
const demoSnippet: Snippet = {
  id: 'demo-snippet-1',
  tenantId: 'demo-tenant',
  name: 'Article Card',
  description: 'A reusable article card component',
  type: 'snippet',
  content: `<div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; background: white;">
  <h3 style="margin: 0 0 8px 0; color: #1a202c; font-size: 18px;">{{title}}</h3>
  {{#if author}}
  <p style="margin: 0 0 12px 0; color: #718096; font-size: 14px;">By {{author}}</p>
  {{/if}}
  <p style="margin: 0 0 12px 0; color: #4a5568; line-height: 1.5;">{{content}}</p>
  {{#if url}}
  <a href="{{url}}" style="color: #3182ce; text-decoration: none; font-weight: 500;">Read more →</a>
  {{/if}}
</div>`,
  parameters: [
    {
      name: 'title',
      type: 'string',
      required: true,
      defaultValue: 'Sample Article Title',
      description: 'The title of the article'
    },
    {
      name: 'author',
      type: 'string',
      required: false,
      defaultValue: 'John Doe',
      description: 'The author of the article'
    },
    {
      name: 'content',
      type: 'string',
      required: true,
      defaultValue: 'This is a sample article content that demonstrates how the snippet preview works.',
      description: 'The main content of the article'
    },
    {
      name: 'url',
      type: 'string',
      required: false,
      defaultValue: 'https://example.com',
      description: 'Link to the full article'
    }
  ],
  s3Key: 'demo/article-card.hbs',
  s3VersionId: 'v1',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: 'demo-user',
  isActive: true
};

export const SnippetPreviewDemo: React.FC = () => {
  const templateBuilderRef = useRef<TemplateBuilderRef>(null);

  const handlePreviewSnippet = () => {
    if (templateBuilderRef.current) {
      templateBuilderRef.current.previewSnippet(demoSnippet, {
        title: 'Advanced React Patterns',
        author: 'Jane Smith',
        content: 'Learn about advanced React patterns including render props, higher-order components, and custom hooks.',
        url: 'https://example.com/react-patterns'
      });
    }
  };

  const handleExitPreview = () => {
    if (templateBuilderRef.current) {
      templateBuilderRef.current.exitSnippetPreview();
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b p-4">
        <h1 className="text-xl font-bold mb-4">Snippet Preview Demo</h1>
        <div className="flex space-x-4">
          <Button onClick={handlePreviewSnippet}>
            Preview Article Card Snippet
          </Button>
          <Button onClick={handleExitPreview} variant="outline">
            Exit Preview
          </Button>
        </div>
      </div>

      <div className="flex-1">
        <TemplateBuilder
          ref={templateBuilderRef}
        />
      </div>
    </div>
  );
};

export default SnippetPreviewDemo;
