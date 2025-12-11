import React, { useState } from 'react';
import { SimpleCodeEditor } from '../components/templates/SimpleCodeEditor';
import { Card } from '../components/ui/Card';

/**
 * Demo component showing variable intellise functionality
 *
 * Features demonstrated:
 * 1. Type "{{" to trigger variable autocomplete
 * 2. Predefined variables from the variable definitions
 * 3. Variables extracted from test JSON data
 * 4. Nested object properties with dot notation
 * 5. Control flow helpers (type "{{#" for conditionals)
 * 6. Hover tooltips showing variable information
 */
export const VariableIntellisenseDemo: React.FC = () => {
  const [templateContent, setTemplateContent] = useState(`<h1>{{newsletter.title}}</h1>
<p>Issue #{{newsletter.issue}} - {{newsletter.date}}</p>

<p>Hello {{subscriber.firstName}},</p>

{{#if newsletter.hasSponsors}}
  <div class="sponsors">
    <h3>Our Sponsors</h3>
    {{#each newsletter.sponsors}}
      <div>
        <img src="{{this.logo}}" alt="{{this.name}}">
        <a href="{{this.url}}">{{this.name}}</a>
      </div>
    {{/each}}
  </div>
{{/if}}

<div class="articles">
  <h3>Featured Articles</h3>
  {{#each newsletter.articles}}
    <article>
      <h4>{{this.title}}</h4>
      <p>{{this.summary}}</p>
      <a href="{{this.url}}">Read more</a>
    </article>
  {{/each}}
</div>

<footer>
  <p>Best regards,<br>{{brand.name}}</p>
  <p><a href="{{system.unsubscribeUrl}}">Unsubscribe</a></p>
</footer>`);

  const testData = JSON.stringify({
    newsletter: {
      title: "Serverless Picks of the Week #42",
      issue: 42,
      date: "2024-03-15",
      hasSponsors: true,
      articles: [
        {
          title: "Building Serverless APIs with AWS Lambda",
          summary: "Learn how to create scalable serverless APIs using AWS Lambda and API Gateway.",
          url: "https://example.com/serverless-apis"
        },
        {
          title: "DynamoDB Best Practices",
          summary: "Essential tips for designing efficient DynamoDB tables and queries.",
          url: "https://example.com/dynamodb-tips"
        }
      ],
      sponsors: [
        {
          name: "AWS",
          logo: "https://example.com/aws-logo.png",
          url: "https://aws.amazon.com"
        }
      ]
    },
    subscriber: {
      firstName: "John",
      lastName: "Doe",
      email: "john.doe@example.com",
      isPremium: true
    },
    brand: {
      name: "Ready Set Cloud",
      logo: "https://readysetcloud.s3.us-east-1.amazonaws.com/newsletter.png",
      website: "https://readysetcloud.io"
    },
    system: {
      unsubscribeUrl: "https://example.com/unsubscribe?token=abc123",
      viewOnlineUrl: "https://example.com/newsletter/42"
    }
  }, null, 2);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Variable Intellisense Demo
        </h1>
        <p className="text-gray-600">
          Try typing "&#123;&#123;" in the editor to see variable autocomplete in action
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Template Editor */}
        <Card className="p-0 overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b">
            <h2 className="text-lg font-semibold text-gray-900">
              Handlebars Template Editor
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Features: Variable autocomplete, hover tooltips, syntax highlighting
            </p>
          </div>
          <div className="h-96">
            <SimpleCodeEditor
              value={templateContent}
              onChange={setTemplateContent}
              language="handlebars"
              height="100%"
              testData={testData}
              theme="light"
            />
          </div>
        </Card>

        {/* Test Data */}
        <Card className="p-0 overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b">
            <h2 className="text-lg font-semibold text-gray-900">
              Test Data (JSON)
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Variables from this data will appear in autocomplete
            </p>
          </div>
          <div className="h-96 overflow-auto">
            <pre className="p-4 text-sm text-gray-800 font-mono">
              {testData}
            </pre>
          </div>
        </Card>
      </div>

      {/* Instructions */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          How to Use Variable Intellisense
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Basic Variables</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Type <code className="bg-gray-100 px-1 rounded">&#123;&#123;</code> to trigger autocomplete</li>
              <li>• Use arrow keys to navigate suggestions</li>
              <li>• Press Enter to insert selected variable</li>
              <li>• Hover over variables for detailed information</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Control Flow</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Type <code className="bg-gray-100 px-1 rounded">&#123;&#123;#</code> for conditionals and loops</li>
              <li>• Available helpers: if, unless, each, with</li>
              <li>• Autocomplete includes closing tags</li>
              <li>• Supports nested object properties</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">Try These Examples:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-blue-800 font-medium">Variables:</p>
              <ul className="text-blue-700 space-y-1">
                <li><code>&#123;&#123;newsletter.title&#125;&#125;</code></li>
                <li><code>&#123;&#123;subscriber.firstName&#125;&#125;</code></li>
                <li><code>&#123;&#123;brand.name&#125;&#125;</code></li>
              </ul>
            </div>
            <div>
              <p className="text-blue-800 font-medium">Control Flow:</p>
              <ul className="text-blue-700 space-y-1">
                <li><code>&#123;&#123;#if newsletter.hasSponsors&#125;&#125;</code></li>
                <li><code>&#123;&#123;#each newsletter.articles&#125;&#125;</code></li>
                <li><code>&#123;&#123;#with subscriber&#125;&#125;</code></li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default VariableIntellisenseDemo;
