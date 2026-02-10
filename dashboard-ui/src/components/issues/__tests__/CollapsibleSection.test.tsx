import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '../CollapsibleSection';
import { TrendingUp } from 'lucide-react';

describe('CollapsibleSection', () => {
  const mockOnToggle = vi.fn();
  const defaultProps = {
    id: 'test-section',
    title: 'Test Section',
    isExpanded: false,
    onToggle: mockOnToggle,
    children: <div>Test Content</div>,
  };

  beforeEach(() => {
    mockOnToggle.mockClear();
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('Rendering', () => {
    it('should render section with title', () => {
      render(<CollapsibleSection {...defaultProps} />);

      expect(screen.getByText('Test Section')).toBeInTheDocument();
    });

    it('should render section with description when provided', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          description="This is a test description"
        />
      );

      expect(screen.getByText('This is a test description')).toBeInTheDocument();
    });

    it('should render icon when provided', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          icon={<TrendingUp data-testid="test-icon" />}
        />
      );

      expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    });

    it('should render children when expanded', () => {
      render(<CollapsibleSection {...defaultProps} isExpanded={true} />);

      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should hide children when collapsed', () => {
      render(<CollapsibleSection {...defaultProps} isExpanded={false} />);

      const content = screen.getByText('Test Content');
      const contentContainer = content.closest('[id$="-content"]');
      expect(contentContainer).toHaveClass('max-h-0');
      expect(contentContainer).toHaveClass('opacity-0');
    });

    it('should render badge when collapsed and badge is provided', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          isExpanded={false}
          badge="5 items"
        />
      );

      expect(screen.getByText('5 items')).toBeInTheDocument();
    });

    it('should not render badge when expanded', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          isExpanded={true}
          badge="5 items"
        />
      );

      expect(screen.queryByText('5 items')).not.toBeInTheDocument();
    });

    it('should render badge with number', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          isExpanded={false}
          badge={42}
        />
      );

      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('should render empty state when isEmpty is true', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          isEmpty={true}
        />
      );

      expect(screen.getByText('No data available for this section')).toBeInTheDocument();
    });

    it('should render custom empty message', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          isEmpty={true}
          emptyMessage="Custom empty message"
        />
      );

      expect(screen.getByText('Custom empty message')).toBeInTheDocument();
    });

    it('should not render toggle button in empty state', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          isEmpty={true}
        />
      );

      const header = screen.getByText('Test Section').closest('div');
      expect(header).not.toHaveAttribute('role', 'button');
    });

    it('should not render children in empty state', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          isEmpty={true}
        />
      );

      expect(screen.queryByText('Test Content')).not.toBeInTheDocument();
    });
  });

  describe('Expand/Collapse interaction', () => {
    it('should call onToggle when header is clicked', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const header = screen.getByRole('button');
      fireEvent.click(header);

      expect(mockOnToggle).toHaveBeenCalledWith('test-section');
      expect(mockOnToggle).toHaveBeenCalledTimes(1);
    });

    it('should call onToggle when Enter key is pressed', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const header = screen.getByRole('button');
      fireEvent.keyDown(header, { key: 'Enter' });

      expect(mockOnToggle).toHaveBeenCalledWith('test-section');
    });

    it('should call onToggle when Space key is pressed', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const header = screen.getByRole('button');
      fireEvent.keyDown(header, { key: ' ' });

      expect(mockOnToggle).toHaveBeenCalledWith('test-section');
    });

    it('should not call onToggle for other keys', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const header = screen.getByRole('button');
      fireEvent.keyDown(header, { key: 'a' });

      expect(mockOnToggle).not.toHaveBeenCalled();
    });

    it('should rotate chevron icon when expanded', () => {
      const { rerender } = render(<CollapsibleSection {...defaultProps} isExpanded={false} />);

      const chevron = screen.getByRole('button').querySelector('svg');
      expect(chevron).not.toHaveClass('rotate-180');

      rerender(<CollapsibleSection {...defaultProps} isExpanded={true} />);

      expect(chevron).toHaveClass('rotate-180');
    });
  });

  describe('Session state persistence', () => {
    it('should save expanded state to sessionStorage', () => {
      render(<CollapsibleSection {...defaultProps} isExpanded={true} />);

      const stored = sessionStorage.getItem('issue-detail-expanded-sections');
      expect(stored).toBeTruthy();

      const expandedSections = JSON.parse(stored!);
      expect(expandedSections).toContain('test-section');
    });

    it('should remove from sessionStorage when collapsed', () => {
      // First expand
      const { rerender } = render(<CollapsibleSection {...defaultProps} isExpanded={true} />);

      let stored = sessionStorage.getItem('issue-detail-expanded-sections');
      let expandedSections = JSON.parse(stored!);
      expect(expandedSections).toContain('test-section');

      // Then collapse
      rerender(<CollapsibleSection {...defaultProps} isExpanded={false} />);

      stored = sessionStorage.getItem('issue-detail-expanded-sections');
      expandedSections = JSON.parse(stored!);
      expect(expandedSections).not.toContain('test-section');
    });

    it('should handle multiple sections in sessionStorage', () => {
      // Render first section expanded
      const { rerender } = render(<CollapsibleSection {...defaultProps} id="section-1" isExpanded={true} />);

      // Render second section expanded
      rerender(<CollapsibleSection {...defaultProps} id="section-2" isExpanded={true} />);

      const stored = sessionStorage.getItem('issue-detail-expanded-sections');
      const expandedSections = JSON.parse(stored!);

      expect(expandedSections).toContain('section-1');
      expect(expandedSections).toContain('section-2');
    });

    it('should handle sessionStorage errors gracefully', () => {
      // Mock sessionStorage to throw error
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = vi.fn(() => {
        throw new Error('Storage quota exceeded');
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<CollapsibleSection {...defaultProps} isExpanded={true} />);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to save section state to sessionStorage:',
        expect.any(Error)
      );

      // Restore
      Storage.prototype.setItem = originalSetItem;
      consoleSpy.mockRestore();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const header = screen.getByRole('button');
      expect(header).toHaveAttribute('aria-expanded', 'false');
      expect(header).toHaveAttribute('aria-controls', 'test-section-content');

      const content = screen.getByText('Test Content').closest('[id$="-content"]');
      expect(content).toHaveAttribute('id', 'test-section-content');
      expect(content).toHaveAttribute('aria-hidden', 'true');
    });

    it('should update aria-expanded when state changes', () => {
      const { rerender } = render(<CollapsibleSection {...defaultProps} isExpanded={false} />);

      let header = screen.getByRole('button');
      expect(header).toHaveAttribute('aria-expanded', 'false');

      rerender(<CollapsibleSection {...defaultProps} isExpanded={true} />);

      header = screen.getByRole('button');
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });

    it('should update aria-hidden on content when state changes', () => {
      const { rerender } = render(<CollapsibleSection {...defaultProps} isExpanded={false} />);

      let content = screen.getByText('Test Content').closest('[id$="-content"]');
      expect(content).toHaveAttribute('aria-hidden', 'true');

      rerender(<CollapsibleSection {...defaultProps} isExpanded={true} />);

      content = screen.getByText('Test Content').closest('[id$="-content"]');
      expect(content).toHaveAttribute('aria-hidden', 'false');
    });

    it('should have proper section labeling', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const section = screen.getByRole('region');
      expect(section).toHaveAttribute('aria-labelledby', 'test-section-title');

      const title = screen.getByText('Test Section');
      expect(title).toHaveAttribute('id', 'test-section-title');
    });

    it('should be keyboard accessible', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const header = screen.getByRole('button');
      expect(header).toHaveAttribute('tabIndex', '0');
    });

    it('should have aria-label for badge', () => {
      render(
        <CollapsibleSection
          {...defaultProps}
          isExpanded={false}
          badge={5}
        />
      );

      const badge = screen.getByText('5');
      expect(badge).toHaveAttribute('aria-label', '5 items');
    });
  });

  describe('Animation classes', () => {
    it('should apply correct classes when collapsed', () => {
      render(<CollapsibleSection {...defaultProps} isExpanded={false} />);

      const content = screen.getByText('Test Content').closest('[id$="-content"]');
      expect(content).toHaveClass('max-h-0');
      expect(content).toHaveClass('opacity-0');
      expect(content).toHaveClass('transition-all');
      expect(content).toHaveClass('duration-300');
    });

    it('should apply correct classes when expanded', () => {
      render(<CollapsibleSection {...defaultProps} isExpanded={true} />);

      const content = screen.getByText('Test Content').closest('[id$="-content"]');
      expect(content).toHaveClass('max-h-[5000px]');
      expect(content).toHaveClass('opacity-100');
      expect(content).toHaveClass('transition-all');
      expect(content).toHaveClass('duration-300');
    });

    it('should apply hover styles to header', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const header = screen.getByRole('button');
      expect(header).toHaveClass('hover:bg-muted/50');
      expect(header).toHaveClass('transition-colors');
    });
  });

  describe('Responsive behavior', () => {
    it('should render with proper responsive classes', () => {
      render(<CollapsibleSection {...defaultProps} />);

      const section = screen.getByRole('region');
      expect(section).toHaveClass('rounded-lg');
      expect(section).toHaveClass('border');
      expect(section).toHaveClass('shadow-sm');
    });
  });
});
