import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmptyState } from '../EmptyState';

const MockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg data-testid="empty-state-icon" className={className} />
);

describe('EmptyState', () => {
  it('renders icon, heading, and description', () => {
    render(
      <EmptyState
        icon={MockIcon}
        heading="Get started with segments"
        description="Create your first segment to start organizing your audience"
      />
    );

    expect(screen.getByTestId('empty-state-icon')).toBeInTheDocument();
    expect(screen.getByText('Get started with segments')).toBeInTheDocument();
    expect(screen.getByText('Create your first segment to start organizing your audience')).toBeInTheDocument();
  });

  it('applies correct classes to the icon', () => {
    render(
      <EmptyState
        icon={MockIcon}
        heading="Heading"
        description="Description"
      />
    );

    const icon = screen.getByTestId('empty-state-icon');
    expect(icon).toHaveClass('mx-auto', 'h-12', 'w-12', 'text-muted-foreground/50', 'mb-4');
  });

  it('renders CTA button when action is provided', () => {
    const handleClick = vi.fn();

    render(
      <EmptyState
        icon={MockIcon}
        heading="Get started"
        description="Create your first segment"
        action={{ label: 'Create Segment', onClick: handleClick }}
      />
    );

    const button = screen.getByRole('button', { name: 'Create Segment' });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not render a button when no action is provided', () => {
    render(
      <EmptyState
        icon={MockIcon}
        heading="All caught up"
        description="There are no pending items"
      />
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
