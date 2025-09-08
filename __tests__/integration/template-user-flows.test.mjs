import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock AWS SDK instances
const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();
const mockEventBridgeSt.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDdbSend })),
  GetItemCommand: jest.fn((params) => params),
  PutItemCommand: jest.fn((params) => params),
  QueryCommand: jest.fn((params) => params),
  UpdateItemCommand: jest.fn((params) => params),
  DeleteItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => params),
  PutObjectCommand: jest.fn((params) => params),
  DeleteObjectCommand: jest.fn((params) => params),
  ListObjectVersionsCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn(() => ({ send: jest.fn() })),
  SendEmailCommand: jest.fn((params) => params)
}));

// Mock auth functions
jest.unstable_mockModule('../functions/auth/jwt-verifier.mjs', () => ({
  verifyJWT: jest.fn()
}));

// Import handlers after mocks
const { handler: createTemplateHandler } = await import('../functions/templates/create-template.mjs');
const { handler: getTemplateHandler } = await import('../functions/templates/get-template.mjs');
const { handler: updateTemplateHandler } = await import('../functions/templates/update-template.mjs');
const { handler: deleteTemplateHandler } = await import('../functions/templates/delete-template.mjs');
const { handler: previewTemplateHandler } = await import('../functions/templates/preview-template.mjs');

const { handler: createSnippetHandler } = await import('../functions/templates/create-snippet.mjs');
const { handler: getSnippetHandler } = await import('../functions/templates/get-snippet.mjs');
const { handler: updateSnippetHandler } = await import('../functions/templates/update-snippet.mjs');
const { handler: deleteSnippetHandler } = await import('../functions/templates/delete-snippet.mjs');
const { handler: previewSnippetHandler } = await import('../functions/templates/preview-snippet.mjs');

describe('Template System End-to-End User Flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEMPLATES_TABLE_NAME = 'test-templates-table';
    process.env.TEMPLATES_BUCKET_NAME = 'test-templates-bucket';
    process.env.EVENT_BUS_NAME = 'test-event-bus';

    // Mock JWT verification
    const { verifyJWT } = jest.requireMock('../functions/auth/jwt-verifier.mjs');
    verifyJWT.mockResolvedValue({
      'custom:tenantId': 'tenant-123',
      sub: 'user-456',
      email: 'test@example.com'
    });
  });

  afterEach(() => {
    delete process.env.TEMPLATES_TABLE_NAME;
    delete process.env.TEMPLATES_BUCKET_NAME;
    delete process.env.EVENT_BUS_NAME;
  });

  describe('Complete Template Creation and Usage Flow', () => {
    it('should create snippet, create template using snippet, preview, and delete', async () => {
      // Step 1: Create a reusable snippet
      mockDdbSend.mockResolvedValueOnce({}); // Create snippet in DDB
      mockS3Send.mockResolvedValueOnce({ // Upload snippet to S3
        VersionId: 'snippet-version-1',
        ETag: 'snippet-etag-1'
      });
      mockEventBridgeSend.mockResolvedValueOnce({}); // Event notification

      const snippetData = {
        name: 'article-card',
        description: 'Reusable article card component',
        content: `
          <div class="article-card {{className}}">
            <h3 class="article-title">{{title}}</h3>
            <p class="article-excerpt">{{excerpt}}</p>
            {{#if showDate}}
              <time class="article-date">{{date}}</time>
            {{/if}}
            {{#if showAuthor}}
              <span class="article-author">By {{author}}</span>
            {{/if}}
          </div>
        `,
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Article title' },
          { name: 'excerpt', type: 'string', required: true, description: 'Article excerpt' },
          { name: 'date', type: 'string', required: false, description: 'Publication date' },
          { name: 'author', type: 'string', required: false, description: 'Article author' },
          { name: 'showDate', type: 'boolean', required: false, defaultValue: true, description: 'Show publication date' },
          { name: 'showAuthor', type: 'boolean', required: false, defaultValue: true, description: 'Show author name' },
          { name: 'className', type: 'string', required: false, description: 'Additional CSS classes' }
        ]
      };

      const createSnippetEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(snippetData)
      };

      const snippetResult = await createSnippetHandler(createSnippetEvent);
      expect(snippetResult.statusCode).toBe(201);

      const createdSnippet = JSON.parse(snippetResult.body).snippet;
      expect(createdSnippet.name).toBe('article-card');
      expect(createdSnippet.parameters).toHaveLength(7);

      // Step 2: Create a template that uses the snippet
      mockDdbSend.mockResolvedValueOnce({}); // Create template in DDB
      mockS3Send.mockResolvedValueOnce({ // Upload template to S3
        VersionId: 'template-version-1',
        ETag: 'template-etag-1'
      });
      mockEventBridgeSend.mockResolvedValueOnce({}); // Event notification

      const templateData = {
        name: 'Newsletter Template',
        description: 'Monthly newsletter with article cards',
        content: `
          <html>
            <head>
              <title>{{newsletter.title}}</title>
              <style>
                .newsletter { max-width: 600px; margin: 0 auto; }
                .article-card { border: 1px solid #ddd; margin: 20px 0; padding: 15px; }
                .featured { border-color: #007cba; background: #f0f8ff; }
              </style>
            </head>
            <body>
              <div class="newsletter">
                <h1>{{newsletter.title}}</h1>
                <p>{{newsletter.intro}}</p>

                {{#if newsletter.featured}}
                  <h2>Featured Article</h2>
                  {{> article-card
                    title=newsletter.featured.title
                    excerpt=newsletter.featured.excerpt
                    date=newsletter.featured.date
                    author=newsletter.featured.author
                    className="featured"
                    showDate=true
                    showAuthor=true}}
                {{/if}}

                <h2>Latest Articles</h2>
                {{#each newsletter.articles}}
                  {{> article-card
                    title=this.title
                    excerpt=this.excerpt
                    date=this.date
                    author=this.author
                    showDate=true
                    showAuthor=false}}
                {{/each}}

                <footer>
                  <p>{{newsletter.footer}}</p>
                </footer>
              </div>
            </body>
          </html>
        `,
        category: 'newsletter',
        tags: ['monthly', 'articles', 'newsletter']
      };

      const createTemplateEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(templateData)
      };

      const templateResult = await createTemplateHandler(createTemplateEvent);
      expect(templateResult.statusCode).toBe(201);

      const createdTemplate = JSON.parse(templateResult.body).template;
      expect(createdTemplate.name).toBe('Newsletter Template');
      expect(createdTemplate.snippets).toContain('article-card');

      // Step 3: Preview the template with test data
      mockDdbSend
        .mockResolvedValueOnce({ Item: createdTemplate }) // Get template
        .mockResolvedValueOnce({ // Get snippets for tenant
          Items: [{
            id: createdSnippet.id,
            name: 'article-card',
            s3Key: createdSnippet.s3Key
          }]
        });

      mockS3Send
        .mockResolvedValueOnce({ // Get template content
          Body: {
            transformToString: () => Promise.resolve(templateData.content)
          }
        })
        .mockResolvedValueOnce({ // Get snippet content
          Body: {
            transformToString: () => Promise.resolve(snippetData.content)
          }
        });

      const testData = {
        newsletter: {
          title: 'Tech Weekly #42',
          intro: 'Welcome to this week\'s edition of Tech Weekly!',
          featured: {
            title: 'The Future of Serverless Computing',
            excerpt: 'Exploring the latest trends and innovations in serverless architecture.',
            date: '2024-01-15',
            author: 'Jane Smith'
          },
          articles: [
            {
              title: 'JavaScript Performance Tips',
              excerpt: 'Learn how to optimize your JavaScript code for better performance.',
              date: '2024-01-14',
              author: 'John Doe'
            },
            {
              title: 'CSS Grid vs Flexbox',
              excerpt: 'Understanding when to use CSS Grid and when to use Flexbox.',
              date: '2024-01-13',
              author: 'Alice Johnson'
            }
          ],
          footer: 'Thanks for reading! Unsubscribe at any time.'
        }
      };

      const previewEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: createdTemplate.id },
        body: JSON.stringify({ testData })
      };

      const previewResult = await previewTemplateHandler(previewEvent);
      expect(previewResult.statusCode).toBe(200);

      const previewBody = JSON.parse(previewResult.body);
      expect(previewBody.templateId).toBe(createdTemplate.id);
      expect(previewBody.renderedHtml).toContain('Tech Weekly #42');
      expect(previewBody.renderedHtml).toContain('The Future of Serverless Computing');
      expect(previewBody.renderedHtml).toContain('JavaScript Performance Tips');
      expect(previewBody.renderedHtml).toContain('CSS Grid vs Flexbox');
      expect(previewBody.renderedHtml).toContain('class="featured"');
      expect(previewBody.validation.isValid).toBe(true);
      expect(previewBody.validation.snippetsUsed).toContain('article-card');

      // Step 4: Update the template
      mockDdbSend
        .mockResolvedValueOnce({ Item: createdTemplate }) // Get existing template
        .mockResolvedValueOnce({}); // Update template

      mockS3Send.mockResolvedValueOnce({ // Upload updated content
        VersionId: 'template-version-2',
        ETag: 'template-etag-2'
      });

      mockEventBridgeSend.mockResolvedValueOnce({}); // Event notification

      const updateData = {
        description: 'Updated monthly newsletter with improved article cards',
        content: templateData.content.replace('margin: 20px 0', 'margin: 25px 0'), // Minor content change
        tags: ['monthly', 'articles', 'newsletter', 'updated']
      };

      const updateEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: createdTemplate.id },
        body: JSON.stringify(updateData)
      };

      const updateResult = await updateTemplateHandler(updateEvent);
      expect(updateResult.statusCode).toBe(200);

      const updatedTemplate = JSON.parse(updateResult.body).template;
      expect(updatedTemplate.description).toBe('Updated monthly newsletter with improved article cards');
      expect(updatedTemplate.version).toBe(2);
      expect(updatedTemplate.tags).toContain('updated');

      // Step 5: Try to delete the snippet (should fail because it's used in template)
      mockDdbSend
        .mockResolvedValueOnce({ Item: createdSnippet }) // Get snippet
        .mockResolvedValueOnce({ // Check dependencies
          Items: [{ id: createdTemplate.id, name: 'Newsletter Template' }]
        });

      const deleteSnippetEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { snippetId: createdSnippet.id }
      };

      const deleteSnippetResult = await deleteSnippetHandler(deleteSnippetEvent);
      expect(deleteSnippetResult.statusCode).toBe(409);

      const deleteSnippetBody = JSON.parse(deleteSnippetResult.body);
      expect(deleteSnippetBody.code).toBe('SNIPPET_IN_USE');
      expect(deleteSnippetBody.dependentTemplates).toHaveLength(1);
      expect(deleteSnippetBody.dependentTemplates[0].name).toBe('Newsletter Template');

      // Step 6: Delete the template first
      mockDdbSend
        .mockResolvedValueOnce({ Item: updatedTemplate }) // Get template
        .mockResolvedValueOnce({}); // Delete template

      mockS3Send.mockResolvedValueOnce({ // Mark S3 object for deletion
        VersionId: 'delete-marker-1'
      });

      mockEventBridgeSend.mockResolvedValueOnce({}); // Event notification

      const deleteTemplateEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: createdTemplate.id }
      };

      const deleteTemplateResult = await deleteTemplateHandler(deleteTemplateEvent);
      expect(deleteTemplateResult.statusCode).toBe(200);

      const deleteTemplateBody = JSON.parse(deleteTemplateResult.body);
      expect(deleteTemplateBody.message).toBe('Template deleted successfully');
      expect(deleteTemplateBody.templateId).toBe(createdTemplate.id);

      // Step 7: Now delete the snippet (should succeed)
      mockDdbSend
        .mockResolvedValueOnce({ Item: createdSnippet }) // Get snippet
        .mockResolvedValueOnce({ Items: [] }) // No dependencies
        .mockResolvedValueOnce({}); // Delete snippet

      mockS3Send.mockResolvedValueOnce({ // Mark S3 object for deletion
        VersionId: 'delete-marker-2'
      });

      mockEventBridgeSend.mockResolvedValueOnce({}); // Event notification

      const deleteSnippetEvent2 = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { snippetId: createdSnippet.id }
      };

      const deleteSnippetResult2 = await deleteSnippetHandler(deleteSnippetEvent2);
      expect(deleteSnippetResult2.statusCode).toBe(200);

      const deleteSnippetBody2 = JSON.parse(deleteSnippetResult2.body);
      expect(deleteSnippetBody2.message).toBe('Snippet deleted successfully');
      expect(deleteSnippetBody2.snippetId).toBe(createdSnippet.id);
    });
  });

  describe('Template Editing and Version Management Flow', () => {
    it('should create template, make multiple edits, and handle version history', async () => {
      // Step 1: Create initial template
      mockDdbSend.mockResolvedValueOnce({});
      mockS3Send.mockResolvedValueOnce({
        VersionId: 'version-1',
        ETag: 'etag-1'
      });
      mockEventBridgeSend.mockResolvedValueOnce({});

      const initialTemplate = {
        name: 'Welcome Email',
        description: 'Welcome email for new users',
        content: '<h1>Welcome {{userName}}!</h1><p>Thanks for joining us.</p>',
        category: 'onboarding',
        tags: ['welcome', 'email']
      };

      const createEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(initialTemplate)
      };

      const createResult = await createTemplateHandler(createEvent);
      expect(createResult.statusCode).toBe(201);

      const template = JSON.parse(createResult.body).template;
      expect(template.version).toBe(1);

      // Step 2: First edit - add more content
      mockDdbSend
        .mockResolvedValueOnce({ Item: template })
        .mockResolvedValueOnce({});

      mockS3Send.mockResolvedValueOnce({
        VersionId: 'version-2',
        ETag: 'etag-2'
      });

      mockEventBridgeSend.mockResolvedValueOnce({});

      const firstEdit = {
        content: `
          <h1>Welcome {{userName}}!</h1>
          <p>Thanks for joining us at {{companyName}}.</p>
          <p>Here's what you can do next:</p>
          <ul>
            <li>Complete your profile</li>
            <li>Explore our features</li>
            <li>Join our community</li>
          </ul>
        `,
        description: 'Enhanced welcome email with next steps'
      };

      const firstEditEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: template.id },
        body: JSON.stringify(firstEdit)
      };

      const firstEditResult = await updateTemplateHandler(firstEditEvent);
      expect(firstEditResult.statusCode).toBe(200);

      const updatedTemplate1 = JSON.parse(firstEditResult.body).template;
      expect(updatedTemplate1.version).toBe(2);
      expect(updatedTemplate1.s3VersionId).toBe('version-2');

      // Step 3: Second edit - add styling
      mockDdbSend
        .mockResolvedValueOnce({ Item: updatedTemplate1 })
        .mockResolvedValueOnce({});

      mockS3Send.mockResolvedValueOnce({
        VersionId: 'version-3',
        ETag: 'etag-3'
      });

      mockEventBridgeSend.mockResolvedValueOnce({});

      const secondEdit = {
        content: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; }
                h1 { color: #333; }
                ul { padding-left: 20px; }
                li { margin: 5px 0; }
              </style>
            </head>
            <body>
              <h1>Welcome {{userName}}!</h1>
              <p>Thanks for joining us at {{companyName}}.</p>
              <p>Here's what you can do next:</p>
              <ul>
                <li>Complete your profile</li>
                <li>Explore our features</li>
                <li>Join our community</li>
              </ul>
              <p>Best regards,<br>The {{companyName}} Team</p>
            </body>
          </html>
        `,
        tags: ['welcome', 'email', 'styled']
      };

      const secondEditEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: template.id },
        body: JSON.stringify(secondEdit)
      };

      const secondEditResult = await updateTemplateHandler(secondEditEvent);
      expect(secondEditResult.statusCode).toBe(200);

      const updatedTemplate2 = JSON.parse(secondEditResult.body).template;
      expect(updatedTemplate2.version).toBe(3);
      expect(updatedTemplate2.s3VersionId).toBe('version-3');
      expect(updatedTemplate2.tags).toContain('styled');

      // Step 4: Preview the final version
      mockDdbSend.mockResolvedValueOnce({ Item: updatedTemplate2 });
      mockS3Send.mockResolvedValueOnce({
        Body: {
          transformToString: () => Promise.resolve(secondEdit.content)
        }
      });

      const previewData = {
        userName: 'John Doe',
        companyName: 'Acme Corp'
      };

      const previewEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: template.id },
        body: JSON.stringify({ testData: previewData })
      };

      const previewResult = await previewTemplateHandler(previewEvent);
      expect(previewResult.statusCode).toBe(200);

      const previewBody = JSON.parse(previewResult.body);
      expect(previewBody.renderedHtml).toContain('Welcome John Doe!');
      expect(previewBody.renderedHtml).toContain('Acme Corp');
      expect(previewBody.renderedHtml).toContain('<style>');
      expect(previewBody.validation.isValid).toBe(true);
    });
  });

  describe('Complex Snippet Composition Flow', () => {
    it('should create multiple nested snippets and compose them in a template', async () => {
      // Step 1: Create base button snippet
      mockDdbSend.mockResolvedValueOnce({});
      mockS3Send.mockResolvedValueOnce({
        VersionId: 'button-version-1',
        ETag: 'button-etag-1'
      });
      mockEventBridgeSend.mockResolvedValueOnce({});

      const buttonSnippet = {
        name: 'button',
        description: 'Reusable button component',
        content: '<a href="{{url}}" class="btn {{variant}} {{size}}" {{#if target}}target="{{target}}"{{/if}}>{{text}}</a>',
        parameters: [
          { name: 'text', type: 'string', required: true, description: 'Button text' },
          { name: 'url', type: 'string', required: true, description: 'Button URL' },
          { name: 'variant', type: 'string', required: false, defaultValue: 'primary', description: 'Button style variant' },
          { name: 'size', type: 'string', required: false, defaultValue: 'medium', description: 'Button size' },
          { name: 'target', type: 'string', required: false, description: 'Link target' }
        ]
      };

      const createButtonEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(buttonSnippet)
      };

      const buttonResult = await createSnippetHandler(createButtonEvent);
      expect(buttonResult.statusCode).toBe(201);
      const createdButton = JSON.parse(buttonResult.body).snippet;

      // Step 2: Create call-to-action snippet that uses button
      mockDdbSend.mockResolvedValueOnce({});
      mockS3Send.mockResolvedValueOnce({
        VersionId: 'cta-version-1',
        ETag: 'cta-etag-1'
      });
      mockEventBridgeSend.mockResolvedValueOnce({});

      const ctaSnippet = {
        name: 'call-to-action',
        description: 'Call-to-action section with button',
        content: `
          <div class="cta-section {{alignment}}">
            <h2 class="cta-title">{{title}}</h2>
            {{#if subtitle}}
              <p class="cta-subtitle">{{subtitle}}</p>
            {{/if}}
            <div class="cta-buttons">
              {{> button text=primaryButtonText url=primaryButtonUrl variant="primary" size="large"}}
              {{#if secondaryButtonText}}
                {{> button text=secondaryButtonText url=secondaryButtonUrl variant="secondary" size="large"}}
              {{/if}}
            </div>
          </div>
        `,
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'CTA title' },
          { name: 'subtitle', type: 'string', required: false, description: 'CTA subtitle' },
          { name: 'primaryButtonText', type: 'string', required: true, description: 'Primary button text' },
          { name: 'primaryButtonUrl', type: 'string', required: true, description: 'Primary button URL' },
          { name: 'secondaryButtonText', type: 'string', required: false, description: 'Secondary button text' },
          { name: 'secondaryButtonUrl', type: 'string', required: false, description: 'Secondary button URL' },
          { name: 'alignment', type: 'string', required: false, defaultValue: 'center', description: 'Text alignment' }
        ]
      };

      const createCtaEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(ctaSnippet)
      };

      const ctaResult = await createSnippetHandler(createCtaEvent);
      expect(ctaResult.statusCode).toBe(201);
      const createdCta = JSON.parse(ctaResult.body).snippet;

      // Step 3: Create hero section snippet that uses CTA
      mockDdbSend.mockResolvedValueOnce({});
      mockS3Send.mockResolvedValueOnce({
        VersionId: 'hero-version-1',
        ETag: 'hero-etag-1'
      });
      mockEventBridgeSend.mockResolvedValueOnce({});

      const heroSnippet = {
        name: 'hero-section',
        description: 'Hero section with background and CTA',
        content: `
          <section class="hero" style="{{#if backgroundImage}}background-image: url({{backgroundImage}});{{/if}} {{#if backgroundColor}}background-color: {{backgroundColor}};{{/if}}">
            <div class="hero-content">
              <h1 class="hero-headline">{{headline}}</h1>
              {{#if subheadline}}
                <p class="hero-subheadline">{{subheadline}}</p>
              {{/if}}
              {{#if showCta}}
                {{> call-to-action
                  title=ctaTitle
                  subtitle=ctaSubtitle
                  primaryButtonText=ctaPrimaryText
                  primaryButtonUrl=ctaPrimaryUrl
                  secondaryButtonText=ctaSecondaryText
                  secondaryButtonUrl=ctaSecondaryUrl}}
              {{/if}}
            </div>
          </section>
        `,
        parameters: [
          { name: 'headline', type: 'string', required: true, description: 'Hero headline' },
          { name: 'subheadline', type: 'string', required: false, description: 'Hero subheadline' },
          { name: 'backgroundImage', type: 'string', required: false, description: 'Background image URL' },
          { name: 'backgroundColor', type: 'string', required: false, description: 'Background color' },
          { name: 'showCta', type: 'boolean', required: false, defaultValue: true, description: 'Show CTA section' },
          { name: 'ctaTitle', type: 'string', required: false, description: 'CTA title' },
          { name: 'ctaSubtitle', type: 'string', required: false, description: 'CTA subtitle' },
          { name: 'ctaPrimaryText', type: 'string', required: false, description: 'CTA primary button text' },
          { name: 'ctaPrimaryUrl', type: 'string', required: false, description: 'CTA primary button URL' },
          { name: 'ctaSecondaryText', type: 'string', required: false, description: 'CTA secondary button text' },
          { name: 'ctaSecondaryUrl', type: 'string', required: false, description: 'CTA secondary button URL' }
        ]
      };

      const createHeroEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(heroSnippet)
      };

      const heroResult = await createSnippetHandler(createHeroEvent);
      expect(heroResult.statusCode).toBe(201);
      const createdHero = JSON.parse(heroResult.body).snippet;

      // Step 4: Create landing page template using hero section
      mockDdbSend.mockResolvedValueOnce({});
      mockS3Send.mockResolvedValueOnce({
        VersionId: 'landing-version-1',
        ETag: 'landing-etag-1'
      });
      mockEventBridgeSend.mockResolvedValueOnce({});

      const landingTemplate = {
        name: 'Product Landing Page',
        description: 'Landing page template with hero section and nested components',
        content: `
          <!DOCTYPE html>
          <html>
            <head>
              <title>{{page.title}}</title>
              <meta name="description" content="{{page.description}}">
              <style>
                .hero { padding: 80px 20px; text-align: center; min-height: 500px; display: flex; align-items: center; justify-content: center; }
                .hero-content { max-width: 800px; }
                .hero-headline { font-size: 3rem; margin-bottom: 1rem; color: white; }
                .hero-subheadline { font-size: 1.5rem; margin-bottom: 2rem; color: rgba(255,255,255,0.9); }
                .cta-section { margin-top: 2rem; }
                .cta-title { font-size: 2rem; margin-bottom: 1rem; color: white; }
                .cta-subtitle { font-size: 1.2rem; margin-bottom: 1.5rem; color: rgba(255,255,255,0.8); }
                .cta-buttons { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
                .btn { padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; }
                .btn.primary { background: #007cba; color: white; }
                .btn.secondary { background: transparent; color: white; border: 2px solid white; }
                .btn.large { padding: 15px 30px; font-size: 1.1rem; }
              </style>
            </head>
            <body>
              {{> hero-section
                headline=hero.headline
                subheadline=hero.subheadline
                backgroundImage=hero.backgroundImage
                backgroundColor=hero.backgroundColor
                showCta=hero.showCta
                ctaTitle=hero.cta.title
                ctaSubtitle=hero.cta.subtitle
                ctaPrimaryText=hero.cta.primaryText
                ctaPrimaryUrl=hero.cta.primaryUrl
                ctaSecondaryText=hero.cta.secondaryText
                ctaSecondaryUrl=hero.cta.secondaryUrl}}
            </body>
          </html>
        `,
        category: 'landing-page',
        tags: ['landing', 'hero', 'cta', 'product']
      };

      const createLandingEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(landingTemplate)
      };

      const landingResult = await createTemplateHandler(createLandingEvent);
      expect(landingResult.statusCode).toBe(201);
      const createdLanding = JSON.parse(landingResult.body).template;

      // Verify all snippets are detected
      expect(createdLanding.snippets).toContain('hero-section');

      // Step 5: Preview the complete composition
      mockDdbSend
        .mockResolvedValueOnce({ Item: createdLanding }) // Get template
        .mockResolvedValueOnce({ // Get all snippets
          Items: [
            { id: createdButton.id, name: 'button', s3Key: createdButton.s3Key },
            { id: createdCta.id, name: 'call-to-action', s3Key: createdCta.s3Key },
            { id: createdHero.id, name: 'hero-section', s3Key: createdHero.s3Key }
          ]
        });

      mockS3Send
        .mockResolvedValueOnce({ // Get template content
          Body: { transformToString: () => Promise.resolve(landingTemplate.content) }
        })
        .mockResolvedValueOnce({ // Get button snippet
          Body: { transformToString: () => Promise.resolve(buttonSnippet.content) }
        })
        .mockResolvedValueOnce({ // Get CTA snippet
          Body: { transformToString: () => Promise.resolve(ctaSnippet.content) }
        })
        .mockResolvedValueOnce({ // Get hero snippet
          Body: { transformToString: () => Promise.resolve(heroSnippet.content) }
        });

      const complexTestData = {
        page: {
          title: 'Amazing Product - Get Started Today',
          description: 'The best product for your needs'
        },
        hero: {
          headline: 'Transform Your Business Today',
          subheadline: 'Join thousands of satisfied customers who have revolutionized their workflow',
          backgroundColor: '#1a365d',
          showCta: true,
          cta: {
            title: 'Ready to Get Started?',
            subtitle: 'Choose the plan that works for you',
            primaryText: 'Start Free Trial',
            primaryUrl: '/signup',
            secondaryText: 'View Pricing',
            secondaryUrl: '/pricing'
          }
        }
      };

      const complexPreviewEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: createdLanding.id },
        body: JSON.stringify({ testData: complexTestData })
      };

      const complexPreviewResult = await previewTemplateHandler(complexPreviewEvent);
      expect(complexPreviewResult.statusCode).toBe(200);

      const complexPreviewBody = JSON.parse(complexPreviewResult.body);
      expect(complexPreviewBody.renderedHtml).toContain('Transform Your Business Today');
      expect(complexPreviewBody.renderedHtml).toContain('Ready to Get Started?');
      expect(complexPreviewBody.renderedHtml).toContain('Start Free Trial');
      expect(complexPreviewBody.renderedHtml).toContain('View Pricing');
      expect(complexPreviewBody.renderedHtml).toContain('background-color: #1a365d');
      expect(complexPreviewBody.renderedHtml).toContain('class="btn primary large"');
      expect(complexPreviewBody.renderedHtml).toContain('class="btn secondary large"');
      expect(complexPreviewBody.validation.isValid).toBe(true);
      expect(complexPreviewBody.validation.snippetsUsed).toContain('hero-section');
    });
  });

  describe('Error Recovery and Validation Flow', () => {
    it('should handle validation errors and allow correction', async () => {
      // Step 1: Try to create template with invalid content
      const invalidTemplate = {
        name: 'Invalid Template',
        content: '<h1>{{title</h1>' // Missing closing brace
      };

      const invalidEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(invalidTemplate)
      };

      const invalidResult = await createTemplateHandler(invalidEvent);
      expect(invalidResult.statusCode).toBe(400);

      const invalidBody = JSON.parse(invalidResult.body);
      expect(invalidBody.code).toBe('TEMPLATE_VALIDATION_FAILED');
      expect(invalidBody.errors).toBeDefined();
      expect(invalidBody.errors.length).toBeGreaterThan(0);

      // Step 2: Create template with corrected content
      mockDdbSend.mockResolvedValueOnce({});
      mockS3Send.mockResolvedValueOnce({
        VersionId: 'version-1',
        ETag: 'etag-1'
      });
      mockEventBridgeSend.mockResolvedValueOnce({});

      const correctedTemplate = {
        name: 'Corrected Template',
        content: '<h1>{{title}}</h1><p>{{content}}</p>' // Fixed syntax
      };

      const correctedEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        body: JSON.stringify(correctedTemplate)
      };

      const correctedResult = await createTemplateHandler(correctedEvent);
      expect(correctedResult.statusCode).toBe(201);

      const template = JSON.parse(correctedResult.body).template;
      expect(template.name).toBe('Corrected Template');

      // Step 3: Try to update with invalid content
      mockDdbSend.mockResolvedValueOnce({ Item: template });

      const invalidUpdate = {
        content: '<div>{{#if condition}}<p>{{text}}</div>' // Missing closing if
      };

      const invalidUpdateEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: template.id },
        body: JSON.stringify(invalidUpdate)
      };

      const invalidUpdateResult = await updateTemplateHandler(invalidUpdateEvent);
      expect(invalidUpdateResult.statusCode).toBe(400);

      const invalidUpdateBody = JSON.parse(invalidUpdateResult.body);
      expect(invalidUpdateBody.code).toBe('TEMPLATE_VALIDATION_FAILED');

      // Step 4: Update with corrected content
      mockDdbSend
        .mockResolvedValueOnce({ Item: template })
        .mockResolvedValueOnce({});

      mockS3Send.mockResolvedValueOnce({
        VersionId: 'version-2',
        ETag: 'etag-2'
      });

      mockEventBridgeSend.mockResolvedValueOnce({});

      const correctedUpdate = {
        content: '<div>{{#if condition}}<p>{{text}}</p>{{/if}}</div>' // Fixed syntax
      };

      const correctedUpdateEvent = {
        headers: { Authorization: 'Bearer valid-jwt-token' },
        pathParameters: { templateId: template.id },
        body: JSON.stringify(correctedUpdate)
      };

      const correctedUpdateResult = await updateTemplateHandler(correctedUpdateEvent);
      expect(correctedUpdateResult.statusCode).toBe(200);

      const updatedTemplate = JSON.parse(correctedUpdateResult.body).template;
      expect(updatedTemplate.version).toBe(2);
    });
  });
});
