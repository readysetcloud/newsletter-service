// Feature: dashboard-ux-overhaul, Property 10: EmptyState text excludes forbidden phrases
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { EmptyState } from '../EmptyState';

/**
 * **Validates: Requirements 11.10**
 *
 * Property 10: EmptyState text excludes forbidden phrases
 *
 * For any heading and description strings that do NOT contain forbidden phrases,
 * the rendered EmptyState output also does NOT contain those phrases.
 * The forbidden phrases are: "No data", "Nothing here", "Empty",
 * "No segments found", "Not found" (case-insensitive).
 *
 * This verifies the component itself does not inject forbidden language —
 * if clean inputs go in, the output stays clean.
 */

const FORBIDDEN_PHRASES = [
  'no data',
  'nothing here',
  'empty',
  'no segments found',
  'not found',
];

const MockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg data-testid="empty-state-icon" className={className} />
);

function containsForbiddenPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.some((phrase) => lower.includes(phrase));
}

// Generator: random alphanumeric strings that exclude forbidden phrases
const cleanStringGen = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,49}$/)
  .filter((s) => !containsForbiddenPhrase(s));

describe('EmptyState - Property-Based Tests', () => {
  describe('Property 10: EmptyState text excludes forbidden phrases', () => {
    it('rendered text never contains forbidden phrases when inputs are clean', () => {
      fc.assert(
        fc.property(
          cleanStringGen,
          cleanStringGen,
          (heading, description) => {
            const { container, unmount } = render(
              <EmptyState
                icon={MockIcon}
                heading={heading}
                description={description}
              />,
            );

            const renderedText = (container.textContent || '').toLowerCase();

            for (const phrase of FORBIDDEN_PHRASES) {
              expect(renderedText).not.toContain(phrase);
            }

            unmount();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rendered text with action button never contains forbidden phrases when inputs are clean', () => {
      fc.assert(
        fc.property(
          cleanStringGen,
          cleanStringGen,
          cleanStringGen,
          (heading, description, actionLabel) => {
            const { container, unmount } = render(
              <EmptyState
                icon={MockIcon}
                heading={heading}
                description={description}
                action={{ label: actionLabel, onClick: () => {} }}
              />,
            );

            const renderedText = (container.textContent || '').toLowerCase();

            for (const phrase of FORBIDDEN_PHRASES) {
              expect(renderedText).not.toContain(phrase);
            }

            unmount();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
