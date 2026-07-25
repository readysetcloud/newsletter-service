import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LinkPerformanceTable } from '../LinkPerformanceTable';
import type { LinkPerformance } from '../../../types/issues';

const makeLinks = (count: number): LinkPerformance[] => {
  const totalClicks = (count * (count + 1)) / 2;
  return Array.from({ length: count }, (_, index) => {
    const clicks = count - index;
    return {
      url: `https://example.com/article-${index + 1}`,
      clicks,
      percentOfTotal: (clicks / totalClicks) * 100,
      position: index + 1,
    };
  });
};

/** Rows in the desktop table body (the mobile card list renders separately). */
const tableRowUrls = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1) // header
    .map(row => row.textContent ?? '')
    .filter(text => text.includes('https://'));

describe('LinkPerformanceTable paging', () => {
  it('renders only one page of links at a time', () => {
    render(<LinkPerformanceTable links={makeLinks(25)} totalClicks={325} pageSize={10} />);

    expect(tableRowUrls()).toHaveLength(10);
    expect(screen.getByText(/1–10/)).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('advances to the next page and back', () => {
    render(<LinkPerformanceTable links={makeLinks(25)} totalClicks={325} pageSize={10} />);

    // Highest click count sorts first, so page one starts with article-1.
    expect(tableRowUrls()[0]).toContain('article-1');

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(tableRowUrls()[0]).toContain('article-11');
    expect(screen.getByText(/11–20/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /previous page/i }));

    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(tableRowUrls()[0]).toContain('article-1');
  });

  it('shows a short final page and disables next at the end', () => {
    render(<LinkPerformanceTable links={makeLinks(25)} totalClicks={325} pageSize={10} />);

    const next = screen.getByRole('button', { name: /next page/i });
    fireEvent.click(next);
    fireEvent.click(next);

    expect(tableRowUrls()).toHaveLength(5);
    expect(screen.getByText(/21–25/)).toBeInTheDocument();
    expect(next).toBeDisabled();
  });

  it('disables previous on the first page', () => {
    render(<LinkPerformanceTable links={makeLinks(25)} totalClicks={325} pageSize={10} />);

    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
  });

  it('does not render the pager when everything fits on one page', () => {
    render(<LinkPerformanceTable links={makeLinks(4)} totalClicks={10} pageSize={10} />);

    expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument();
    expect(tableRowUrls()).toHaveLength(4);
  });

  it('keeps the running total across all links, not just the visible page', () => {
    render(<LinkPerformanceTable links={makeLinks(25)} totalClicks={325} pageSize={10} />);

    expect(screen.getByText(/Total \(all 25 links\)/)).toBeInTheDocument();
    expect(screen.getByText('325')).toBeInTheDocument();
  });

  it('clamps the current page when the link list shrinks', () => {
    const { rerender } = render(
      <LinkPerformanceTable links={makeLinks(25)} totalClicks={325} pageSize={10} />
    );

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    rerender(<LinkPerformanceTable links={makeLinks(12)} totalClicks={78} pageSize={10} />);

    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(tableRowUrls()).toHaveLength(2);
  });

  it('renders a stacked card per link for narrow screens', () => {
    render(<LinkPerformanceTable links={makeLinks(25)} totalClicks={325} pageSize={10} />);

    const cards = within(screen.getByRole('list', { name: /link performance/i })).getAllByRole('listitem');
    expect(cards).toHaveLength(10);
    expect(cards[0]).toHaveTextContent('article-1');
  });

  it('renders an empty state without a pager', () => {
    render(<LinkPerformanceTable links={[]} totalClicks={0} />);

    expect(screen.getByText('No link performance data available')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
