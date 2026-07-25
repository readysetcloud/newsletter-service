import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IssueStatusBadge } from '../IssueStatusBadge';
import type { IssueStatus } from '../../../types/issues';

const ALL_STATUSES: IssueStatus[] = ['draft', 'scheduled', 'in progress', 'published', 'failed'];

describe('IssueStatusBadge', () => {
  it('labels every status', () => {
    for (const status of ALL_STATUSES) {
      const { unmount } = render(<IssueStatusBadge status={status} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      unmount();
    }
  });

  it('exposes the status to assistive tech', () => {
    render(<IssueStatusBadge status="draft" />);

    expect(screen.getByLabelText('Issue status: Draft')).toBeInTheDocument();
  });

  it('gives draft a distinct treatment from published', () => {
    // The complaint that prompted this: a draft was easy to mistake for a sent
    // issue, because grey reads as "nothing to see here".
    const { container: draft } = render(<IssueStatusBadge status="draft" />);
    const draftClass = draft.querySelector('[role="status"]')!.className;

    const { container: published } = render(<IssueStatusBadge status="published" />);
    const publishedClass = published.querySelector('[role="status"]')!.className;

    expect(draftClass).not.toBe(publishedClass);
    expect(draftClass).toContain('amber');
  });

  it('renders larger and heavier at lg, for page headers', () => {
    const { container: small } = render(<IssueStatusBadge status="draft" />);
    const { container: large } = render(<IssueStatusBadge status="draft" size="lg" />);

    expect(small.querySelector('[role="status"]')!.className).toContain('text-xs');

    const largeClass = large.querySelector('[role="status"]')!.className;
    expect(largeClass).toContain('text-sm');
    expect(largeClass).toContain('font-semibold');
  });

  it('carries an icon so the status reads without parsing the text', () => {
    const { container } = render(<IssueStatusBadge status="draft" />);

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('falls back readably for an unrecognized status', () => {
    render(<IssueStatusBadge status={'nonsense' as IssueStatus} />);

    expect(screen.getByText('nonsense')).toBeInTheDocument();
  });
});
