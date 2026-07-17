import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InterestChips } from '../InterestChips';

const recent = new Date().toISOString();

describe('InterestChips', () => {
  it('renders an em dash when there are no interest scores', () => {
    render(<InterestChips interestScores={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a custom empty label', () => {
    render(<InterestChips interestScores={{}} emptyLabel="No interests" />);
    expect(screen.getByText('No interests')).toBeInTheDocument();
  });

  it('renders topics sorted by score descending with display names', () => {
    render(
      <InterestChips
        interestScores={{
          serverless: { score: 1.5, lastScoredAt: recent },
          ai: { score: 4, lastScoredAt: recent },
        }}
        max={5}
      />
    );
    // Display names resolved from the taxonomy
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Serverless')).toBeInTheDocument();
    // Scores shown
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1.5')).toBeInTheDocument();
  });

  it('collapses topics beyond max into a +N chip', () => {
    render(
      <InterestChips
        interestScores={{
          ai: { score: 4, lastScoredAt: recent },
          serverless: { score: 3, lastScoredAt: recent },
          devops: { score: 2, lastScoredAt: recent },
          security: { score: 1, lastScoredAt: recent },
        }}
        max={2}
      />
    );
    // Top 2 shown
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Serverless')).toBeInTheDocument();
    // Remaining 2 collapsed
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText('DevOps')).not.toBeInTheDocument();
  });

  it('omits topics with a zero score', () => {
    render(
      <InterestChips
        interestScores={{
          ai: { score: 0, lastScoredAt: recent },
          devops: { score: 2, lastScoredAt: recent },
        }}
      />
    );
    expect(screen.getByText('DevOps')).toBeInTheDocument();
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
  });
});
