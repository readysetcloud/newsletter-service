import React, { useState } from 'react';
import { TemplatePreview } from '@/components/templates/TemplatePreview';
import type { Template, Snippet } from '@/types/template';

/**
 * Example usage of the TemplatePreview component
 * This demonstrates how to integrate the preview functionality
 * into your template management workflow.
 */
export const TemplatePreviewUsage: React.FC = () => {
  const [testData, setTestData] = useState({
    title: 'Welcome to Our Newsletter',
    subtitle: 'Your weekly dose of awesome content',
    date: new Date().toLocaleDateString(),
    author: 'John Doe',
    content: 'This is sample content for your newsletter template.',
    unsubscribeUrl: '#unsubscribe',
    companyName: 'Your Company',
    companyAddress: '123 Main St, City, State 12345',
  });

  // Example template with handlebars syntax
  const exampleTemplate: Template = {
    id: 'example-template',
    tenantId: 'tenant-1',
    name: 'Newsletter Template',
    description: 'A sample newsletter template',
    type: 'template',
    content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 20px; border-radius: 8px; }
    .header { text-ali: center; border-bottom: 2px solid #e5e5e5; padding-bottom: 20px; margin-bottom: 20px; }
    .content { line-height: 1.6; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{title}}</h1>
      {{#if subtitle}}<p style="color: #666; margin: 10px 0 0 0;">{{subtitle}}</p>{{/if}}
      <p style="color: #999; font-size: 14px;">{{date}}</p>
    </div>

    <div class="content">
      {{> welcome-message name=author}}

      <div style="margin: 20px 0;">
        {{content}}
      </div>

      {{> call-to-action buttonText="Read More" buttonUrl="#"}}
    </div>

    <div class="footer">
      <p>Best regards,<br>{{companyName}}</p>
      <p>{{companyAddress}}</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
    `.trim(),
    s3Key: 'templates/tenant-1/example-template.hbs',
    s3VersionId: 'version-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true,
  };

  // Example snippets that can be used in templates
  const exampleSnippets: Snippet[] = [
    {
      id: 'welcome-message',
      tenantId: 'tenant-1',
      name: 'welcome-message',
      description: 'A personalized welcome message',
      type: 'snippet',
      content: `
<div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
  <h3 style="margin: 0 0 10px 0; color: #333;">Hello {{name}}!</h3>
  <p style="margin: 0; color: #666;">Welcome to our newsletter. We're excited to share the latest updates with you.</p>
</div>
      `.trim(),
      parameters: [
        {
          name: 'name',
          type: 'string',
          required: true,
          defaultValue: 'Reader',
          description: 'The name of the person to greet',
        },
      ],
      s3Key: 'snippets/tenant-1/welcome-message.hbs',
      s3VersionId: 'version-1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      version: 1,
      isActive: true,
    },
    {
      id: 'call-to-action',
      tenantId: 'tenant-1',
      name: 'call-to-action',
      description: 'A call-to-action button',
      type: 'snippet',
      content: `
<div style="text-align: center; margin: 25px 0;">
  <a href="{{buttonUrl}}" style="display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
    {{buttonText}}
  </a>
</div>
      `.trim(),
      parameters: [
        {
          name: 'buttonText',
          type: 'string',
          required: true,
          defaultValue: 'Click Here',
          description: 'The text to display on the button',
        },
        {
          name: 'buttonUrl',
          type: 'string',
          required: true,
          defaultValue: '#',
          description: 'The URL the button should link to',
        },
      ],
      s3Key: 'snippets/tenant-1/call-to-action.hbs',
      s3VersionId: 'version-1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      version: 1,
      isActive: true,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Template Preview Demo</h1>
        <p className="text-gray-600">
          This example demonstrates the TemplatePreview component with live preview,
          responsive modes, and test email functionality.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template Info */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Template Details</h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-medium text-gray-700">Name:</dt>
                <dd className="text-gray-600">{exampleTemplate.name}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">Description:</dt>
                <dd className="text-gray-600">{exampleTemplate.description}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">Snippets Used:</dt>
                <dd className="text-gray-600">
                  {exampleSnippets.map(snippet => snippet.name).join(', ')}
                </dd>
              </div>
            </dl>

            <div className="mt-6">
              <h3 className="text-md font-semibold mb-3">Available Features:</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Live handlebars rendering</li>
                <li>• Responsive preview modes</li>
                <li>• Test email sending</li>
                <li>• Snippet integration</li>
                <li>• Custom test data</li>
                <li>• Error handling</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Template Preview */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Live Preview</h2>
            <TemplatePreview
              template={exampleTemplate}
              snippets={exampleSnippets}
              testData={testData}
              onTestDataChange={(data) => setTestData(data as any)}
            />
          </div>
        </div>
      </div>

      {/* Usage Instructions */}
      <div className="mt-8 bg-blue-50 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-blue-900 mb-4">How to Use TemplatePreview</h2>
        <div className="text-blue-800 space-y-2">
          <p><strong>1. Basic Usage:</strong> Pass a template object with handlebars content</p>
          <p><strong>2. Snippets:</strong> Include snippet objects to enable snippet rendering</p>
          <p><strong>3. Test Data:</strong> Provide test data to populate template variables</p>
          <p><strong>4. Preview Modes:</strong> Switch between desktop, tablet, and mobile views</p>
          <p><strong>5. Test Email:</strong> Enter an email address to send a test email</p>
          <p><strong>6. Custom Data:</strong> Use onTestDataChange to allow test data editing</p>
        </div>
      </div>
    </div>
  );
};

export default TemplatePreviewUsage;
