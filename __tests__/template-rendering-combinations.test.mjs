import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  renderTemplate,
  renderSnippet,
  eactUsedSnippets,
  validateTemplate
} from '../functions/templates/utils/template-engine.mjs';

// Mock AWS SDK
const mockS3Send = jest.fn();
const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDdbSend })),
  QueryCommand: jest.fn()
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

describe('Template Rendering with Snippet Combinations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEMPLATES_TABLE_NAME = 'test-templates-table';
    process.env.TEMPLATES_BUCKET_NAME = 'test-templates-bucket';
  });

  describe('Basic Snippet Integration', () => {
    it('should render template with single snippet', async () => {
      // Mock snippet retrieval
      mockDdbSend.mockResolvedValue({
        Items: [{
          id: 'header-snippet',
          name: 'header-snippet',
          s3Key: 'snippets/tenant1/header-snippet.hbs'
        }]
      });

      mockS3Send.mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve('<header class="{{className}}"><h1>{{title}}</h1></header>')
        }
      });

      const templateContent = `
        <html>
          <body>
            {{> header-snippet className="main-header" title=pageTitle}}
            <main>{{content}}</main>
          </body>
        </html>
      `;

      const data = {
        pageTitle: 'Welcome to Our Site',
        content: 'This is the main content area.'
      };

      const result = await renderTemplate(templateContent, data, 'tenant1');

      expect(result).toContain('<header class="main-header">');
      expect(result).toContain('<h1>Welcome to Our Site</h1>');
      expect(result).toContain('<main>This is the main content area.</main>');
    });

    it('should render template with multiple different snippets', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            id: 'header-snippet',
            name: 'header-snippet',
            s3Key: 'snippets/tenant1/header-snippet.hbs'
          },
          {
            id: 'footer-snippet',
            name: 'footer-snippet',
            s3Key: 'snippets/tenant1/footer-snippet.hbs'
          },
          {
            id: 'nav-snippet',
            name: 'nav-snippet',
            s3Key: 'snippets/tenant1/nav-snippet.hbs'
          }
        ]
      });

      mockS3Send
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<header><h1>{{title}}</h1></header>')
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<footer><p>&copy; {{year}} {{company}}</p></footer>')
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<nav><ul>{{#each links}}<li><a href="{{url}}">{{text}}</a></li>{{/each}}</ul></nav>')
          }
        });

      const templateContent = `
        <html>
          <body>
            {{> header-snippet title=siteTitle}}
            {{> nav-snippet links=navigation}}
            <main>{{content}}</main>
            {{> footer-snippet year=currentYear company=companyName}}
          </body>
        </html>
      `;

      const data = {
        siteTitle: 'My Website',
        content: 'Welcome to my website!',
        currentYear: 2024,
        companyName: 'Acme Corp',
        navigation: [
          { url: '/home', text: 'Home' },
          { url: '/about', text: 'About' },
          { url: '/contact', text: 'Contact' }
        ]
      };

      const result = await renderTemplate(templateContent, data, 'tenant1');

      expect(result).toContain('<h1>My Website</h1>');
      expect(result).toContain('<a href="/home">Home</a>');
      expect(result).toContain('<a href="/about">About</a>');
      expect(result).toContain('<a href="/contact">Contact</a>');
      expect(result).toContain('&copy; 2024 Acme Corp');
      expect(result).toContain('Welcome to my website!');
    });

    it('should render template with repeated snippet usage', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [{
          id: 'card-snippet',
          name: 'card-snippet',
          s3Key: 'snippets/tenant1/card-snippet.hbs'
        }]
      });

      mockS3Send.mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve(`
            <div class="card {{className}}">
              <h3>{{title}}</h3>
              <p>{{description}}</p>
              {{#if buttonText}}
                <a href="{{buttonUrl}}" class="btn">{{buttonText}}</a>
              {{/if}}
            </div>
          `)
        }
      });

      const templateContent = `
        <div class="card-grid">
          {{> card-snippet title="Feature 1" description="First amazing feature" className="feature-card"}}
          {{> card-snippet title="Feature 2" description="Second amazing feature" className="feature-card"}}
          {{> card-snippet title="Get Started" description="Ready to begin?" buttonText="Sign Up" buttonUrl="/signup" className="cta-card"}}
        </div>
      `;

      const result = await renderTemplate(templateContent, {}, 'tenant1');

      expect(result).toContain('<h3>Feature 1</h3>');
      expect(result).toContain('<h3>Feature 2</h3>');
      expect(result).toContain('<h3>Get Started</h3>');
      expect(result).toContain('First amazing feature');
      expect(result).toContain('Second amazing feature');
      expect(result).toContain('Ready to begin?');
      expect(result).toContain('<a href="/signup" class="btn">Sign Up</a>');
      expect((result.match(/class="card feature-card"/g) || []).length).toBe(2);
      expect((result.match(/class="card cta-card"/g) || []).length).toBe(1);
    });
  });

  describe('Nested Snippet Combinations', () => {
    it('should render template with nested snippets', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            id: 'button-snippet',
            name: 'button-snippet',
            s3Key: 'snippets/tenant1/button-snippet.hbs'
          },
          {
            id: 'card-snippet',
            name: 'card-snippet',
            s3Key: 'snippets/tenant1/card-snippet.hbs'
          }
        ]
      });

      mockS3Send
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<a href="{{url}}" class="btn {{variant}}">{{text}}</a>')
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve(`
              <div class="card">
                <h3>{{title}}</h3>
                <p>{{content}}</p>
                <div class="card-actions">
                  {{> button-snippet text=buttonText url=buttonUrl variant=buttonVariant}}
                </div>
              </div>
            `)
          }
        });

      const templateContent = `
        <div class="product-showcase">
          {{> card-snippet
            title="Premium Plan"
            content="Get access to all features"
            buttonText="Choose Plan"
            buttonUrl="/premium"
            buttonVariant="primary"}}
        </div>
      `;

      const result = await renderTemplate(templateContent, {}, 'tenant1');

      expect(result).toContain('<h3>Premium Plan</h3>');
      expect(result).toContain('Get access to all features');
      expect(result).toContain('<a href="/premium" class="btn primary">Choose Plan</a>');
    });

    it('should handle deeply nested snippet hierarchies', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            id: 'icon-snippet',
            name: 'icon-snippet',
            s3Key: 'snippets/tenant1/icon-snippet.hbs'
          },
          {
            id: 'button-snippet',
            name: 'button-snippet',
            s3Key: 'snippets/tenant1/button-snippet.hbs'
          },
          {
            id: 'feature-snippet',
            name: 'feature-snippet',
            s3Key: 'snippets/tenant1/feature-snippet.hbs'
          },
          {
            id: 'section-snippet',
            name: 'section-snippet',
            s3Key: 'snippets/tenant1/section-snippet.hbs'
          }
        ]
      });

      mockS3Send
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<i class="icon {{name}}" aria-label="{{label}}"></i>')
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve(`
              <a href="{{url}}" class="btn {{variant}}">
                {{#if icon}}{{> icon-snippet name=icon label=iconLabel}}{{/if}}
                {{text}}
              </a>
            `)
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve(`
              <div class="feature">
                {{> icon-snippet name=iconName label=iconLabel}}
                <h4>{{title}}</h4>
                <p>{{description}}</p>
                {{#if hasButton}}
                  {{> button-snippet text=buttonText url=buttonUrl variant=buttonVariant icon=buttonIcon iconLabel=buttonIconLabel}}
                {{/if}}
              </div>
            `)
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve(`
              <section class="{{className}}">
                <div class="container">
                  <h2>{{title}}</h2>
                  {{#if subtitle}}<p class="subtitle">{{subtitle}}</p>{{/if}}
                  <div class="features-grid">
                    {{#each features}}
                      {{> feature-snippet
                        iconName=this.icon
                        iconLabel=this.iconLabel
                        title=this.title
                        description=this.description
                        hasButton=this.hasButton
                        buttonText=this.buttonText
                        buttonUrl=this.buttonUrl
                        buttonVariant=this.buttonVariant
                        buttonIcon=this.buttonIcon
                        buttonIconLabel=this.buttonIconLabel}}
                    {{/each}}
                  </div>
                </div>
              </section>
            `)
          }
        });

      const templateContent = `
        <html>
          <body>
            {{> section-snippet
              className="features-section"
              title="Our Amazing Features"
              subtitle="Everything you need to succeed"
              features=featureList}}
          </body>
        </html>
      `;

      const data = {
        featureList: [
          {
            icon: 'star',
            iconLabel: 'Star icon',
            title: 'Premium Quality',
            description: 'Top-notch quality guaranteed',
            hasButton: true,
            buttonText: 'Learn More',
            buttonUrl: '/quality',
            buttonVariant: 'secondary',
            buttonIcon: 'arrow-right',
            buttonIconLabel: 'Arrow right'
          },
          {
            icon: 'shield',
            iconLabel: 'Shield icon',
            title: 'Secure & Safe',
            description: 'Your data is protected',
            hasButton: false
          }
        ]
      };

      const result = await renderTemplate(templateContent, data, 'tenant1');

      expect(result).toContain('<h2>Our Amazing Features</h2>');
      expect(result).toContain('Everything you need to succeed');
      expect(result).toContain('<i class="icon star" aria-label="Star icon"></i>');
      expect(result).toContain('<i class="icon shield" aria-label="Shield icon"></i>');
      expect(result).toContain('<h4>Premium Quality</h4>');
      expect(result).toContain('<h4>Secure & Safe</h4>');
      expect(result).toContain('Top-notch quality guaranteed');
      expect(result).toContain('Your data is protected');
      expect(result).toContain('<a href="/quality" class="btn secondary">');
      expect(result).toContain('<i class="icon arrow-right" aria-label="Arrow right"></i>');
      expect(result).toContain('Learn More');
    });
  });

  describe('Conditional Snippet Rendering', () => {
    it('should conditionally render snippets based on data', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            id: 'alert-snippet',
            name: 'alert-snippet',
            s3Key: 'snippets/tenant1/alert-snippet.hbs'
          },
          {
            id: 'success-snippet',
            name: 'success-snippet',
            s3Key: 'snippets/tenant1/success-snippet.hbs'
          }
        ]
      });

      mockS3Send
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<div class="alert alert-{{type}}">{{message}}</div>')
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<div class="success-banner"><h3>{{title}}</h3><p>{{message}}</p></div>')
          }
        });

      const templateContent = `
        <div class="notifications">
          {{#if hasError}}
            {{> alert-snippet type="error" message=errorMessage}}
          {{/if}}
          {{#if hasWarning}}
            {{> alert-snippet type="warning" message=warningMessage}}
          {{/if}}
          {{#if hasSuccess}}
            {{> success-snippet title=successTitle message=successMessage}}
          {{/if}}
        </div>
        <main>{{content}}</main>
      `;

      // Test with error condition
      const errorData = {
        hasError: true,
        errorMessage: 'Something went wrong!',
        content: 'Main content here'
      };

      const errorResult = await renderTemplate(templateContent, errorData, 'tenant1');
      expect(errorResult).toContain('<div class="alert alert-error">Something went wrong!</div>');
      expect(errorResult).not.toContain('success-banner');

      // Test with success condition
      const successData = {
        hasSuccess: true,
        successTitle: 'Great Job!',
        successMessage: 'Operation completed successfully',
        content: 'Main content here'
      };

      const successResult = await renderTemplate(templateContent, successData, 'tenant1');
      expect(successResult).toContain('<div class="success-banner">');
      expect(successResult).toContain('<h3>Great Job!</h3>');
      expect(successResult).toContain('<p>Operation completed successfully</p>');
      expect(successResult).not.toContain('alert alert-');

      // Test with multiple conditions
      const multiData = {
        hasWarning: true,
        warningMessage: 'Please check your settings',
        hasSuccess: true,
        successTitle: 'Saved!',
        successMessage: 'Changes saved successfully',
        content: 'Main content here'
      };

      const multiResult = await renderTemplate(templateContent, multiData, 'tenant1');
      expect(multiResult).toContain('<div class="alert alert-warning">Please check your settings</div>');
      expect(multiResult).toContain('<div class="success-banner">');
      expect(multiResult).toContain('<h3>Saved!</h3>');
    });

    it('should handle snippets within loops', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [{
          id: 'product-card',
          name: 'product-card',
          s3Key: 'snippets/tenant1/product-card.hbs'
        }]
      });

      mockS3Send.mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve(`
            <div class="product-card {{#if featured}}featured{{/if}}">
              <img src="{{image}}" alt="{{name}}">
              <h3>{{name}}</h3>
              <p class="price">\${{price}}</p>
              {{#if onSale}}
                <span class="sale-badge">On Sale!</span>
              {{/if}}
              <p>{{description}}</p>
              {{#if inStock}}
                <button class="btn-primary">Add to Cart</button>
              {{else}}
                <button class="btn-disabled" disabled>Out of Stock</button>
              {{/if}}
            </div>
          `)
        }
      });

      const templateContent = `
        <div class="product-grid">
          {{#each products}}
            {{> product-card
              name=this.name
              price=this.price
              description=this.description
              image=this.image
              featured=this.featured
              onSale=this.onSale
              inStock=this.inStock}}
          {{/each}}
        </div>
      `;

      const data = {
        products: [
          {
            name: 'Premium Widget',
            price: 99.99,
            description: 'The best widget money can buy',
            image: '/images/widget1.jpg',
            featured: true,
            onSale: false,
            inStock: true
          },
          {
            name: 'Basic Widget',
            price: 29.99,
            description: 'A simple, reliable widget',
            image: '/images/widget2.jpg',
            featured: false,
            onSale: true,
            inStock: true
          },
          {
            name: 'Deluxe Widget',
            price: 149.99,
            description: 'The ultimate widget experience',
            image: '/images/widget3.jpg',
            featured: false,
            onSale: false,
            inStock: false
          }
        ]
      };

      const result = await renderTemplate(templateContent, data, 'tenant1');

      expect(result).toContain('<h3>Premium Widget</h3>');
      expect(result).toContain('<h3>Basic Widget</h3>');
      expect(result).toContain('<h3>Deluxe Widget</h3>');
      expect(result).toContain('class="product-card featured"');
      expect(result).toContain('<span class="sale-badge">On Sale!</span>');
      expect(result).toContain('<button class="btn-primary">Add to Cart</button>');
      expect(result).toContain('<button class="btn-disabled" disabled>Out of Stock</button>');
      expect(result).toContain('$99.99');
      expect(result).toContain('$29.99');
      expect(result).toContain('$149.99');
    });
  });

  describe('Complex Data Structures with Snippets', () => {
    it('should handle nested objects and arrays in snippet parameters', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            id: 'user-profile',
            name: 'user-profile',
            s3Key: 'snippets/tenant1/user-profile.hbs'
          },
          {
            id: 'skill-badge',
            name: 'skill-badge',
            s3Key: 'snippets/tenant1/skill-badge.hbs'
          }
        ]
      });

      mockS3Send
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve(`
              <div class="user-profile">
                <div class="profile-header">
                  <img src="{{user.avatar}}" alt="{{user.name}}" class="avatar">
                  <div class="user-info">
                    <h2>{{user.name}}</h2>
                    <p class="title">{{user.title}}</p>
                    <p class="company">{{user.company}}</p>
                  </div>
                </div>
                <div class="profile-details">
                  <p>{{user.bio}}</p>
                  <div class="contact-info">
                    <p>Email: {{user.contact.email}}</p>
                    {{#if user.contact.phone}}
                      <p>Phone: {{user.contact.phone}}</p>
                    {{/if}}
                    {{#if user.contact.website}}
                      <p>Website: <a href="{{user.contact.website}}">{{user.contact.website}}</a></p>
                    {{/if}}
                  </div>
                  <div class="skills">
                    <h3>Skills</h3>
                    <div class="skill-list">
                      {{#each user.skills}}
                        {{> skill-badge name=this.name level=this.level category=this.category}}
                      {{/each}}
                    </div>
                  </div>
                </div>
              </div>
            `)
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve(`
              <span class="skill-badge {{category}} level-{{level}}">
                {{name}}
                {{#if showLevel}}
                  <span class="level-indicator">{{level}}/5</span>
                {{/if}}
              </span>
            `)
          }
        });

      const templateContent = `
        <div class="team-directory">
          <h1>Meet Our Team</h1>
          {{#each teamMembers}}
            {{> user-profile user=this}}
          {{/each}}
        </div>
      `;

      const data = {
        teamMembers: [
          {
            name: 'Alice Johnson',
            title: 'Senior Developer',
            company: 'Tech Corp',
            avatar: '/avatars/alice.jpg',
            bio: 'Passionate full-stack developer with 8 years of experience.',
            contact: {
              email: 'alice@techcorp.com',
              phone: '+1-555-0123',
              website: 'https://alice-dev.com'
            },
            skills: [
              { name: 'JavaScript', level: 5, category: 'frontend' },
              { name: 'React', level: 4, category: 'frontend' },
              { name: 'Node.js', level: 4, category: 'backend' },
              { name: 'AWS', level: 3, category: 'devops' }
            ]
          },
          {
            name: 'Bob Smith',
            title: 'DevOps Engineer',
            company: 'Tech Corp',
            avatar: '/avatars/bob.jpg',
            bio: 'Infrastructure specialist focused on cloud architecture.',
            contact: {
              email: 'bob@techcorp.com'
            },
            skills: [
              { name: 'Docker', level: 5, category: 'devops' },
              { name: 'Kubernetes', level: 4, category: 'devops' },
              { name: 'Python', level: 3, category: 'backend' }
            ]
          }
        ]
      };

      const result = await renderTemplate(templateContent, data, 'tenant1');

      expect(result).toContain('<h1>Meet Our Team</h1>');
      expect(result).toContain('<h2>Alice Johnson</h2>');
      expect(result).toContain('<h2>Bob Smith</h2>');
      expect(result).toContain('Senior Developer');
      expect(result).toContain('DevOps Engineer');
      expect(result).toContain('alice@techcorp.com');
      expect(result).toContain('bob@techcorp.com');
      expect(result).toContain('+1-555-0123');
      expect(result).toContain('https://alice-dev.com');
      expect(result).toContain('<span class="skill-badge frontend level-5">JavaScript</span>');
      expect(result).toContain('<span class="skill-badge devops level-5">Docker</span>');
      expect(result).toContain('<span class="skill-badge backend level-4">Node.js</span>');
    });
  });

  describe('Error Handling in Snippet Combinations', () => {
    it('should handle missing snippets gracefully', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [] // No snippets found
      });

      const templateContent = `
        <div>
          <h1>{{title}}</h1>
          {{> missing-snippet param="value"}}
          <p>{{content}}</p>
        </div>
      `;

      const data = {
        title: 'Test Page',
        content: 'This should still render'
      };

      // Should not throw error, but continue rendering
      const result = await renderTemplate(templateContent, data, 'tenant1');
      expect(result).toContain('<h1>Test Page</h1>');
      expect(result).toContain('<p>This should still render</p>');
    });

    it('should handle S3 errors when loading snippet content', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [{
          id: 'broken-snippet',
          name: 'broken-snippet',
          s3Key: 'snippets/tenant1/broken-snippet.hbs'
        }]
      });

      mockS3Send.mockRejectedValue(new Error('S3 access denied'));

      const templateContent = `
        <div>
          <h1>{{title}}</h1>
          {{> broken-snippet}}
          <p>{{content}}</p>
        </div>
      `;

      const data = {
        title: 'Test Page',
        content: 'This should still render'
      };

      // Should not throw error, but continue rendering without the snippet
      const result = await renderTemplate(templateContent, data, 'tenant1');
      expect(result).toContain('<h1>Test Page</h1>');
      expect(result).toContain('<p>This should still render</p>');
    });

    it('should handle circular snippet references', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            id: 'snippet-a',
            name: 'snippet-a',
            s3Key: 'snippets/tenant1/snippet-a.hbs'
          },
          {
            id: 'snippet-b',
            name: 'snippet-b',
            s3Key: 'snippets/tenant1/snippet-b.hbs'
          }
        ]
      });

      mockS3Send
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<div>A: {{> snippet-b}}</div>')
          }
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve('<div>B: {{> snippet-a}}</div>')
          }
        });

      const templateContent = '{{> snippet-a}}';

      // This should handle the circular reference gracefully
      // Handlebars typically handles this by limiting recursion depth
      await expect(renderTemplate(templateContent, {}, 'tenant1')).resolves.toBeDefined();
    });
  });

  describe('Performance with Many Snippets', () => {
    it('should handle templates with many snippet references efficiently', async () => {
      const snippetCount = 20;
      const snippets = Array.from({ length: snippetCount }, (_, i) => ({
        id: `snippet-${i}`,
        name: `snippet-${i}`,
        s3Key: `snippets/tenant1/snippet-${i}.hbs`
      }));

      mockDdbSend.mockResolvedValue({
        Items: snippets
      });

      // Mock S3 responses for all snippets
      for (let i = 0; i < snippetCount; i++) {
        mockS3Send.mockResolvedValueOnce({
          Body: {
            transformToString: () => Promise.resolve(`<div class="snippet-${i}">Content ${i}: {{param${i}}}</div>`)
          }
        });
      }

      let templateContent = '<div class="snippet-container">';
      const data = {};

      for (let i = 0; i < snippetCount; i++) {
        templateContent += `{{> snippet-${i} param${i}="value${i}"}}`;
        data[`param${i}`] = `value${i}`;
      }
      templateContent += '</div>';

      const startTime = Date.now();
      const result = await renderTemplate(templateContent, data, 'tenant1');
      const endTime = Date.now();

      // Should complete in reasonable time (less than 5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);

      // Verify all snippets were rendered
      for (let i = 0; i < snippetCount; i++) {
        expect(result).toContain(`<div class="snippet-${i}">Content ${i}: value${i}</div>`);
      }
    });
  });

  describe('Snippet Parameter Validation in Context', () => {
    it('should extract all used snippets from complex template', () => {
      const complexTemplate = `
        <html>
          <head>{{> meta-snippet title=pageTitle description=pageDescription}}</head>
          <body>
            {{> header-snippet logo=siteLogo navigation=mainNav}}
            <main>
              {{#if showHero}}
                {{> hero-snippet headline=heroHeadline subheadline=heroSubheadline backgroundImage=heroBg}}
              {{/if}}

              <section class="features">
                {{#each features}}
                  {{> feature-card icon=this.icon title=this.title description=this.description}}
                {{/each}}
              </section>

              {{#if showTestimonials}}
                <section class="testimonials">
                  {{#each testimonials}}
                    {{> testimonial-card quote=this.quote author=this.author company=this.company avatar=this.avatar}}
                  {{/each}}
                </section>
              {{/if}}

              {{> cta-section title=ctaTitle subtitle=ctaSubtitle buttonText=ctaButtonText buttonUrl=ctaButtonUrl}}
            </main>
            {{> footer-snippet copyright=copyrightText socialLinks=socialMedia}}
          </body>
        </html>
      `;

      const usedSnippets = extractUsedSnippets(complexTemplate);

      expect(usedSnippets).toContain('meta-snippet');
      expect(usedSnippets).toContain('header-snippet');
      expect(usedSnippets).toContain('hero-snippet');
      expect(usedSnippets).toContain('feature-card');
      expect(usedSnippets).toContain('testimonial-card');
      expect(usedSnippets).toContain('cta-section');
      expect(usedSnippets).toContain('footer-snippet');
      expect(usedSnippets).toHaveLength(7);
    });

    it('should validate template with snippet dependencies', () => {
      const templateWithSnippets = `
        <div>
          {{> valid-snippet param="value"}}
          {{> another-valid-snippet}}
          {{> invalid-snippet-name! param="value"}}
          {{> reserved-if}}
        </div>
      `;

      const validation = validateTemplate(templateWithSnippets);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.code === 'INVALID_SNIPPET_NAME')).toBe(true);
      expect(validation.errors.some(e => e.code === 'RESERVED_SNIPPET_NAME')).toBe(true);
    });
  });
});
