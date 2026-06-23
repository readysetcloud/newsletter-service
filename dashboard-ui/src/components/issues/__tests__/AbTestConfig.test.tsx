import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AbTestConfig,
  validateAbTest,
  hasAbTestErrors,
} from '../AbTestConfig';
import type { AbTest } from '@/types/issues';

const futureLocal = (offsetMinutes: number): string => {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const subjectTest = (): AbTest => ({
  dimension: 'subject',
  variants: [
    { variantId: 'a', subject: 'Hello A' },
    { variantId: 'b', subject: 'Hello B' },
  ],
  winMetric: 'openRate',
  confidence: 0.95,
  testFraction: 0.2,
  evaluateAfterMinutes: 240,
  minSamplePerVariant: 500,
});

describe('AbTestConfig', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it('renders the enable toggle off by default and shows no config', () => {
    render(<AbTestConfig value={null} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: /enable a\/b test/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/what to test/i)).not.toBeInTheDocument();
  });

  it('enables a default subject test when toggled on', () => {
    render(<AbTestConfig value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: /enable a\/b test/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as AbTest;
    expect(next.dimension).toBe('subject');
    expect(next.testFraction).toBe(0.2);
    expect(next.confidence).toBe(0.95);
    expect(next.evaluateAfterMinutes).toBe(240);
    expect(next.winMetric).toBe('openRate');
  });

  it('shows subject inputs and a privacy caveat when enabled', () => {
    render(<AbTestConfig value={subjectTest()} onChange={onChange} />);
    expect(screen.getAllByLabelText(/subject/i).length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Apple Mail Privacy Protection/i)
    ).toBeInTheDocument();
  });

  it('switches dimension to send time, resetting variants', () => {
    render(
      <AbTestConfig
        value={subjectTest()}
        onChange={onChange}
        scheduledAtLocal="2026-07-01T09:00"
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: /send time/i }));
    const next = onChange.mock.calls[0][0] as AbTest;
    expect(next.dimension).toBe('sendTime');
    expect(next.variants[0].sendAt).toBe('2026-07-01T09:00');
  });

  it('disables interactive controls when disabled', () => {
    render(<AbTestConfig value={subjectTest()} onChange={onChange} disabled />);
    expect(screen.getByRole('switch', { name: /enable a\/b test/i })).toBeDisabled();
  });

  it('shows the minimum list size hint', () => {
    render(<AbTestConfig value={subjectTest()} onChange={onChange} />);
    // 2 * 500 / 0.2 = 5000
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
  });
});

describe('validateAbTest', () => {
  it('returns no errors for null (disabled)', () => {
    expect(hasAbTestErrors(validateAbTest(null))).toBe(false);
  });

  it('requires both subjects', () => {
    const t = subjectTest();
    t.variants[0].subject = '';
    const errors = validateAbTest(t);
    expect(errors.variantA).toBeTruthy();
  });

  it('flags identical subjects', () => {
    const t = subjectTest();
    t.variants[1].subject = 'Hello A';
    const errors = validateAbTest(t);
    expect(errors.general).toMatch(/different/i);
  });

  it('requires future, differing send times', () => {
    const t: AbTest = {
      dimension: 'sendTime',
      variants: [
        { variantId: 'a', sendAt: futureLocal(-60) },
        { variantId: 'b', sendAt: futureLocal(120) },
      ],
      winMetric: 'openRate',
      confidence: 0.95,
      testFraction: 0.2,
      evaluateAfterMinutes: 240,
    };
    const errors = validateAbTest(t);
    expect(errors.variantA).toMatch(/future/i);
  });

  it('flags identical send times', () => {
    const same = futureLocal(120);
    const t: AbTest = {
      dimension: 'sendTime',
      variants: [
        { variantId: 'a', sendAt: same },
        { variantId: 'b', sendAt: same },
      ],
      winMetric: 'openRate',
      confidence: 0.95,
      testFraction: 0.2,
      evaluateAfterMinutes: 240,
    };
    const errors = validateAbTest(t);
    expect(errors.general).toMatch(/different/i);
  });

  it('rejects out-of-range testFraction and confidence', () => {
    const t = subjectTest();
    t.testFraction = 0.9;
    t.confidence = 0.5;
    const errors = validateAbTest(t);
    expect(errors.testFraction).toBeTruthy();
    expect(errors.confidence).toBeTruthy();
  });

  it('accepts a valid subject test', () => {
    expect(hasAbTestErrors(validateAbTest(subjectTest()))).toBe(false);
  });
});
