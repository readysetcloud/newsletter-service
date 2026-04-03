// Feature: dashboard-ux-overhaul, Property 9: EmptyState renders all provided props
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { EmptyState } from '../EmptyState';

/**
 * **Validates: Requirements 10.5, 11.9**
 *
 * Property 9: EmptyState renders all provided props
 *
 * For any EmptyState component instance, if an icon, heading, and description
 * are provided, all three must be present in the rendered output. If an action
 * prop is provided, a call-to-action button with the action's label must also
 * be rendered. When no action is provided, no button should appear.
 */

const MockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg data-testid="empty-state-icon" className={className} />
);

// Generator: alphanumeric strings to avoid whitespace-only edge cases
const alphanumGen = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/);

const emptyStatePropsGen = fc.record({
  heading: alphanumGen,
  description: alphanumGen,
  hasAction: fc.boolean(),
  actionLabel: alphanumGen,
});

describe('EmptyState - Property-Based Tests', () => {
  describe('Property 9: EmptyState renders all provided props', () => {
    it('heading text always appears in rendered output', () => {
      fc.assert(
        fc.property(emptyStatePropsGen, ({ heading, description }) => {
          const { container, unmount } = render(
            <EmptyState
              icon={MockIcon}
              heading={heading}
              description={description}
            />,
          );
          const text = container.textContent || '';

          expect(text).toContain(heading);

          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('description text always appears in rendered output', () => {
      fc.assert(
        fc.property(emptyStatePropsGen, ({ heading, description }) => {
          const { container, unmount } = render(
            <EmptyState
              icon={MockIcon}
              heading={heading}
              description={description}
            />,
          );
          const text = container.textContent || '';

          expect(text).toContain(description);

          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('icon is always rendered in the output', () => {
      fc.assert(
        fc.property(emptyStatePropsGen, ({ heading, description }) => {
          const { container, unmount } = render(
            <EmptyState
              icon={MockIcon}
              heading={heading}
              description={description}
            />,
          );

          const icon = container.querySelector('[data-testid="empty-state-icon"]');
          expect(icon).not.toBeNull();

          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('when action is provided, a button with the action label appears', () => {
      fc.assert(
        fc.property(
          emptyStatePropsGen.filter(({ hasAction }) => hasAction),
          ({ heading, description, actionLabel }) => {
            const onClick = vi.fn();
            const { container, unmount } = render(
              <EmptyState
                icon={MockIcon}
                heading={heading}
                description={description}
                action={{ label: actionLabel, onClick }}
              />,
            );

            const button = container.querySelector('button');
            expect(button).not.toBeNull();
            expect(button!.textContent).toContain(actionLabel);

            unmount();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('when action is not provided, no button is rendered', () => {
      fc.assert(
        fc.property(
          emptyStatePropsGen.filter(({ hasAction }) => !hasAction),
          ({ heading, description }) => {
            const { container, unmount } = render(
              <EmptyState
                icon={MockIcon}
                heading={heading}
                description={description}
              />,
            );

            const button = container.querySelector('button');
            expect(button).toBeNull();

            unmount();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
