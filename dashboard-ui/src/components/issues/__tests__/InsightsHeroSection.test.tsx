import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InsightsHeroSection, sortInsightsBySeverity } from '../InsightsHeroSection';
import type { InsightV2 } from '@/types/issues';

describe('InsightsHeroSection', () => {
  const mockInsights: InsightV2[] = [
    {
      type: 'Open Rate',
      severity: 'info',
      confidence: 'high',
      summary: 'Your open rate is performing well',
      recommendation: 'Keep up the good work with your subject lines',
    },
    {
      type: 'Click Rate',
      severity: 'action',
      confidence: 'high',
      summary: 'Click rate is below average',
      recommendation: 'Consider adding more compelling calls-to-action',
    },
    {
      type: 'Deliverability',
      severity: 'watch',
      confidence: 'med',
      summary: 'Bounce rate is slightly elevated',
      recommendation: 'Monitor your list quality',
    },
  ];

  describe('Rendering', () => {
    it('should render insights sorted by severity', () => {
      render(<InsightsHeroSection insights={mockInsights} />);

      const articles = screen.getAllByRole('listitem');
      expect(articles).toHaveLength(3);

      expect(articles[0]).toHaveTextContent('Click Rate');
      expect(articles[0]).toHaveTextContent('Action Required');

      expect(articles[1]).toHaveTextContent('Deliverability');
      expect(articles[1]).toHaveTextContent('Watch');

      expect(articles[2]).toHaveTextContent('Open Rate');
      expect(articles[2]).toHaveTextContent('Good');
    });

    it('should display summary and recommendation for each insight', () => {
      render(<InsightsHeroSection insights={mockInsights} />);

      expect(screen.getByText('Your open rate is performing well')).toBeInTheDocument();
      expect(screen.getByText('Keep up the good work with your subject lines')).toBeInTheDocument();

      expect(screen.getByText('Click rate is below average')).toBeInTheDocument();
      expect(screen.getByText('Consider adding more compelling calls-to-action')).toBeInTheDocument();
    });

    it('should display confidence badges', () => {
      render(<InsightsHeroSection insights={mockInsights} />);

      expect(screen.getAllByText('High Confidence')).toHaveLength(2);
      expect(screen.getByText('Medium Confidence')).toBeInTheDocument();
    });

    it('should show empty state when no insights', () => {
      render(<InsightsHeroSection insights={[]} />);

      expect(screen.getByText('No Insights Yet')).toBeInTheDocument();
      expect(screen.getByText(/Analytics can take a few minutes/i)).toBeInTheDocument();
    });
  });

  describe('Refresh functionality', () => {
    it('should call onRefreshInsights when refresh button is clicked', () => {
      const onRefresh = vi.fn();
      render(<InsightsHeroSection insights={mockInsights} onRefreshInsights={onRefresh} />);

      const refreshButton = screen.getByLabelText('Refresh insights');
      fireEvent.click(refreshButton);

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('should disable refresh button when isRefreshing is true', () => {
      const onRefresh = vi.fn();
      render(
        <InsightsHeroSection
          insights={mockInsights}
          onRefreshInsights={onRefresh}
          isRefreshing={true}
        />
      );

      const refreshButton = screen.getByLabelText('Refresh insights');
      expect(refreshButton).toBeDisabled();
    });

    it('should show refresh button in empty state when onRefreshInsights is provided', () => {
      const onRefresh = vi.fn();
      render(<InsightsHeroSection insights={[]} onRefreshInsights={onRefresh} />);

      const refreshButton = screen.getByLabelText('Refresh insights');
      expect(refreshButton).toBeInTheDocument();
      expect(refreshButton).toHaveTextContent('Refresh Insights');
    });

    it('should not show refresh button when onRefreshInsights is not provided', () => {
      render(<InsightsHeroSection insights={[]} />);
      expect(screen.queryByLabelText('Refresh insights')).not.toBeInTheDocument();
    });
  });

  describe('Severity badges', () => {
    it('should display correct severity badge for action insights', () => {
      const actionInsight: InsightV2[] = [{
        type: 'Test',
        severity: 'action',
        confidence: 'high',
        summary: 'Test summary',
        recommendation: 'Test recommendation',
      }];

      render(<InsightsHeroSection insights={actionInsight} />);
      expect(screen.getByText('Action Required')).toBeInTheDocument();
    });

    it('should display correct severity badge for watch insights', () => {
      const watchInsight: InsightV2[] = [{
        type: 'Test',
        severity: 'watch',
        confidence: 'high',
        summary: 'Test summary',
        recommendation: 'Test recommendation',
      }];

      render(<InsightsHeroSection insights={watchInsight} />);
      expect(screen.getByText('Watch')).toBeInTheDocument();
    });

    it('should display correct severity badge for info insights', () => {
      const infoInsight: InsightV2[] = [{
        type: 'Test',
        severity: 'info',
        confidence: 'high',
        summary: 'Test summary',
        recommendation: 'Test recommendation',
      }];

      render(<InsightsHeroSection insights={infoInsight} />);
      expect(screen.getByText('Good')).toBeInTheDocument();
    });
  });

  describe('Evidence display', () => {
    it('should display evidence when available', () => {
      const insightWithEvidence: InsightV2[] = [{
        type: 'Test',
        severity: 'action',
        confidence: 'high',
        summary: 'Test summary',
        recommendation: 'Test recommendation',
        evidence: [
          { metric: 'Open Rate', value: '25%' },
          { metric: 'Average', value: '35%' },
        ],
      }];

      render(<InsightsHeroSection insights={insightWithEvidence} />);

      expect(screen.getByText('Open Rate:')).toBeInTheDocument();
      expect(screen.getByText('25%')).toBeInTheDocument();
      expect(screen.getByText('Average:')).toBeInTheDocument();
      expect(screen.getByText('35%')).toBeInTheDocument();
    });

    it('should not display evidence section when evidence is empty', () => {
      const insightWithoutEvidence: InsightV2[] = [{
        type: 'Test',
        severity: 'action',
        confidence: 'high',
        summary: 'Test summary',
        recommendation: 'Test recommendation',
        evidence: [],
      }];

      render(<InsightsHeroSection insights={insightWithoutEvidence} />);

      const article = screen.getByRole('listitem');
      expect(article.querySelectorAll('ul').length).toBe(0);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(<InsightsHeroSection insights={mockInsights} />);

      expect(screen.getByLabelText('Insights section')).toBeInTheDocument();
      expect(screen.getByLabelText('Insight cards')).toBeInTheDocument();
    });

    it('should have proper role attributes', () => {
      render(<InsightsHeroSection insights={mockInsights} />);

      const section = screen.getByRole('region', { name: 'Insights section' });
      expect(section).toBeInTheDocument();

      const list = screen.getByRole('list', { name: 'Insight cards' });
      expect(list).toBeInTheDocument();

      const articles = screen.getAllByRole('listitem');
      expect(articles).toHaveLength(3);
    });
  });

  describe('sortInsightsBySeverity utility', () => {
    it('should sort insights by severity priority', () => {
      const unsortedInsights: InsightV2[] = [
        { type: 'A', severity: 'info', confidence: 'high', summary: 'A', recommendation: 'A' },
        { type: 'B', severity: 'action', confidence: 'high', summary: 'B', recommendation: 'B' },
        { type: 'C', severity: 'watch', confidence: 'high', summary: 'C', recommendation: 'C' },
      ];

      const sorted = sortInsightsBySeverity(unsortedInsights);

      expect(sorted[0].severity).toBe('action');
      expect(sorted[1].severity).toBe('watch');
      expect(sorted[2].severity).toBe('info');
    });

    it('should maintain order for insights with same severity', () => {
      const sameSevirtyInsights: InsightV2[] = [
        { type: 'A', severity: 'action', confidence: 'high', summary: 'A', recommendation: 'A' },
        { type: 'B', severity: 'action', confidence: 'high', summary: 'B', recommendation: 'B' },
        { type: 'C', severity: 'action', confidence: 'high', summary: 'C', recommendation: 'C' },
      ];

      const sorted = sortInsightsBySeverity(sameSevirtyInsights);

      expect(sorted[0].type).toBe('A');
      expect(sorted[1].type).toBe('B');
      expect(sorted[2].type).toBe('C');
    });

    it('should not mutate original array', () => {
      const original: InsightV2[] = [
        { type: 'A', severity: 'info', confidence: 'high', summary: 'A', recommendation: 'A' },
        { type: 'B', severity: 'action', confidence: 'high', summary: 'B', recommendation: 'B' },
      ];

      const originalCopy = [...original];
      sortInsightsBySeverity(original);

      expect(original).toEqual(originalCopy);
    });
  });

  describe('Responsive layout', () => {
    it('should render grid layout', () => {
      render(<InsightsHeroSection insights={mockInsights} />);

      const grid = screen.getByRole('list', { name: 'Insight cards' });
      expect(grid).toHaveClass('grid');
      expect(grid).toHaveClass('grid-cols-1');
      expect(grid).toHaveClass('md:grid-cols-2');
      expect(grid).toHaveClass('lg:grid-cols-3');
    });
  });
});
