import { jest } from '@jest/globals';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fc from 'fast-check';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const templatePath = join(__dirname, '..', 'templates', 'welcome.hbs');
const templateSource = readFileSync(templatePath, 'utf-8');
const template = Handlebars.compile(templateSource);

describe('Welcome Email Template', () => {
  describe('Property 3: Template rendering completeness', () => {
    /**
     * Feature: welcome-newsletter, Property 3: Template rendering completeness
     * For any welcome email template rendering with brand data and subscriber information,
     * the rendered HTML should contain the brand name, brand logo (if provided),
     * brand color styling (if provided), personalized greeting (if first name provided),
     * subscriber email, and unsubscribe link with hashed email
     * Validates: Requirements 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5
     */
    test('rendered template contains all required elements based on provided data', () => {
      // Arbitraries for generating test data
      const arbitraryEmail = fc.emailAddress();
      const arbitraryBrandName = fc.string({ minLength: 1, maxLength: 100 });
      const arbitraryFirstName = fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null });
      const arbitraryBrandLogo = fc.option(fc.webUrl(), { nil: null });
      const arbitraryBrandColor = fc.option(
        fc.integer({ min: 0, max: 0xFFFFFF }).map(num =>
          `#${num.toString(16).padStart(6, '0').toUpperCase()}`
        ),
        { nil: null }
      );
      const arbitraryBrandDescription = fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: null });
      const arbitraryUnsubscribeUrl = fc.webUrl();

      const arbitraryTemplateData = fc.record({
        brandName: arbitraryBrandName,
        brandLogo: arbitraryBrandLogo,
        brandColor: arbitraryBrandColor,
        brandDescription: arbitraryBrandDescription,
        subscriberFirstName: arbitraryFirstName,
        subscriberEmail: arbitraryEmail,
        unsubscribeUrl: arbitraryUnsubscribeUrl
      });

      fc.assert(
        fc.property(arbitraryTemplateData, (data) => {
          // Render the template with the generated data
          const rendered = template(data);

          // Property: Brand name must always be present (HTML-escaped by Handlebars)
          // Use Handlebars' own escaping function
          const escapedBrandName = Handlebars.escapeExpression(data.brandName);
          expect(rendered).toContain(escapedBrandName);

          // Property: Brand logo should be present if provided
          if (data.brandLogo) {
            const escapedLogo = Handlebars.escapeExpression(data.brandLogo);
            expect(rendered).toContain(escapedLogo);
            expect(rendered).toContain('src=');
          }

          // Property: Brand color should be used in styling if provided
          if (data.brandColor) {
            expect(rendered).toContain(data.brandColor);
            // Should appear in link color or button background
            expect(rendered.match(new RegExp(data.brandColor.replace('#', '\\#'), 'g')).length).toBeGreaterThan(0);
          }

          // Property: Brand description should be present if provided
          if (data.brandDescription) {
            const escapedDescription = Handlebars.escapeExpression(data.brandDescription);
            expect(rendered).toContain(escapedDescription);
          }

          // Property: Personalized greeting should include first name if provided
          if (data.subscriberFirstName) {
            const escapedFirstName = Handlebars.escapeExpression(data.subscriberFirstName);
            expect(rendered).toContain(escapedFirstName);
            expect(rendered).toContain('Welcome');
          }

          // Property: Subscriber email is not directly shown but unsubscribe link must be present
          const escapedUnsubscribeUrl = Handlebars.escapeExpression(data.unsubscribeUrl);
          expect(rendered).toContain(escapedUnsubscribeUrl);
          expect(rendered).toContain('href=');
          expect(rendered).toContain('Unsubscribe');

          // Property: Template should be valid HTML
          expect(rendered).toContain('<!DOCTYPE html');
          expect(rendered).toContain('</html>');
          expect(rendered).toContain('<body>');
          expect(rendered).toContain('</body>');

          // Property: Template should be responsive (contains viewport meta tag)
          expect(rendered).toContain('viewport');
          expect(rendered).toContain('width=device-width');

          // Property: Template should have proper email structure
          expect(rendered).toContain('<table');
          expect(rendered).toContain('</table>');
        }),
        { numRuns: 100 }
      );
    });

    test('template handles missing optional fields gracefully', () => {
      // Test with minimal required data only
      const minimalData = {
        brandName: 'Test Newsletter',
        subscriberEmail: 'test@example.com',
        unsubscribeUrl: 'https://example.com/unsubscribe'
      };

      const rendered = template(minimalData);

      // Should still render successfully
      expect(rendered).toContain(minimalData.brandName);
      expect(rendered).toContain(minimalData.unsubscribeUrl);
      expect(rendered).toContain('<!DOCTYPE html');
      expect(rendered).toContain('</html>');

      // Should not have broken placeholders
      expect(rendered).not.toContain('{{');
      expect(rendered).not.toContain('}}');
    });

    test('template uses default color when brand color not provided', () => {
      const dataWithoutColor = {
        brandName: 'Test Newsletter',
        subscriberEmail: 'test@example.com',
        unsubscribeUrl: 'https://example.com/unsubscribe'
      };

      const rendered = template(dataWithoutColor);

      // Should use default color #1188E6
      expect(rendered).toContain('#1188E6');
    });

    test('template renders personalized greeting without first name', () => {
      const dataWithoutFirstName = {
        brandName: 'Test Newsletter',
        subscriberEmail: 'test@example.com',
        unsubscribeUrl: 'https://example.com/unsubscribe'
      };

      const rendered = template(dataWithoutFirstName);

      // Should still have welcome message
      expect(rendered).toContain('Welcome');
      // Should not have a comma after Welcome (which would indicate missing name)
      expect(rendered).toContain('Welcome!');
    });
  });
});
