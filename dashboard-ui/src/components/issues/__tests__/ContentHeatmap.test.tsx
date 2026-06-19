import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentHeatmap, computeReadDepth, createHeatColorScale } from '../ContentHeatmap';
import type { LinkPerformance } from '../../../types/issues';

const links: LinkPerformance[] = [
  { url: 'https://a.com', clicks: 100, percentOfTotal: 62.5, position: 1 },
  { url: 'https://b.com', clicks: 60, percentOfTotal: 37.5, position: 2 },
  { url: 'https://c.com', clicks: 0, percentOfTotal: 0, position: 3 },
];

const content =
  'Intro paragraph.\n\nRead [the launch post](https://a.com) and [the changelog](https://b.com).\n\nAlso [a quiet link](https://c.com) at the end.';

describe('computeReadDepth', () => {
  it('summarizes click distribution by link position', () => {
    const stats = computeReadDepth(links);
    expect(stats.totalLinks).toBe(3);
    expect(stats.clickedLinks).toBe(2);
    expect(stats.attributedClicks).toBe(160);
    expect(stats.deepestClickedPosition).toBe(2); // c.com (pos 3) had 0 clicks
    expect(stats.topLinkSharePct).toBeCloseTo(62.5, 1);
    // 100/160 = 62.5% < 80%, +60 = 100% >= 80% at second link
    expect(stats.depthForEightyPercent).toBe(2);
  });

  it('ignores links without a known position and handles no-click issues', () => {
    const stats = computeReadDepth([
      { url: 'https://x.com', clicks: 0, percentOfTotal: 0, position: 0 },
      { url: 'https://y.com', clicks: 0, percentOfTotal: 0, position: 1 },
    ]);
    expect(stats.totalLinks).toBe(1);
    expect(stats.clickedLinks).toBe(0);
    expect(stats.deepestClickedPosition).toBe(0);
    expect(stats.depthForEightyPercent).toBe(0);
    expect(stats.topLinkSharePct).toBe(0);
  });
});

describe('createHeatColorScale', () => {
  it('returns transparent when there are no clicks', () => {
    const scale = createHeatColorScale(0);
    expect(scale(0)).toBe('transparent');
  });

  it('maps higher click counts to hotter colors', () => {
    const scale = createHeatColorScale(100);
    expect(scale(0)).not.toBe(scale(100));
  });
});

describe('ContentHeatmap', () => {
  it('renders the content with per-link click annotations', () => {
    const { container } = render(
      <ContentHeatmap content={content} links={links} totalClicks={160} />
    );

    // Anchor text is preserved
    expect(screen.getByText('the launch post')).toBeInTheDocument();
    expect(screen.getByText('the changelog')).toBeInTheDocument();

    // Click-count badges are rendered as superscripts
    const anchors = container.querySelectorAll('a[title]');
    expect(anchors.length).toBeGreaterThan(0);
    const launchAnchor = Array.from(anchors).find((a) => a.getAttribute('href') === 'https://a.com');
    expect(launchAnchor?.getAttribute('title')).toContain('100 clicks');
    expect(launchAnchor?.getAttribute('title')).toContain('62.5% of total');
    expect(launchAnchor?.querySelector('sup')?.textContent).toBe('100');
  });

  it('shows the reader engagement depth summary', () => {
    render(<ContentHeatmap content={content} links={links} totalClicks={160} />);
    expect(
      screen.getByRole('heading', { name: 'Reader engagement depth' })
    ).toBeInTheDocument();
    expect(screen.getByText('Links clicked')).toBeInTheDocument();
    // 2 of 3 links clicked
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('renders gracefully with no click data', () => {
    render(<ContentHeatmap content={content} links={[]} totalClicks={0} />);
    expect(screen.getByText(/No link clicks were recorded/i)).toBeInTheDocument();
    // Content is still shown
    expect(screen.getByText('the launch post')).toBeInTheDocument();
  });
});
