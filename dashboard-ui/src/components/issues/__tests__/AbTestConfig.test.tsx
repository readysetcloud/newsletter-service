import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  AbTestConfig,
  validateAbTest,
  hasAbTestErrors,
  nextOccurrenceOfUtcHour,
} from '../AbTestConfig';
import { issuesService } from '@/services/issuesService';
import type { AbTest, AbSuggestionResponse } from '@/types/issues';

vi.mock('@/services/issuesService', () => ({
  issuesService: {
    getAbSuggestions: vi.fn(),
  },
}));

const mockedGetAbSuggestions = vi.mocked(issuesService.getAbSuggestions);

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
    mockedGetAbSuggestions.mockReset();
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

  it('requests subject suggestions and renders them with rationale + history note', async () => {
    const response: AbSuggestionResponse = {
      dimension: 'subject',
      rationale: 'Shorter, curiosity-driven subjects tend to perform better.',
      subjects: ['Subject idea one', 'Subject idea two'],
      usedHistory: true,
    };
    mockedGetAbSuggestions.mockResolvedValue({ success: true, data: response });

    render(<AbTestConfig value={subjectTest()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /suggest subjects with ai/i }));

    await waitFor(() =>
      expect(screen.getByText('Subject idea one')).toBeInTheDocument()
    );
    expect(mockedGetAbSuggestions).toHaveBeenCalledWith({
      dimension: 'subject',
      subject: 'Hello A',
    });
    expect(screen.getByText(/curiosity-driven/i)).toBeInTheDocument();
    expect(screen.getByText(/based on your past a\/b tests/i)).toBeInTheDocument();
  });

  it('accepts a subject suggestion into variant B via the Use action', async () => {
    const response: AbSuggestionResponse = {
      dimension: 'subject',
      rationale: 'Try these.',
      subjects: ['Accepted subject'],
      usedHistory: false,
    };
    mockedGetAbSuggestions.mockResolvedValue({ success: true, data: response });

    render(<AbTestConfig value={subjectTest()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /suggest subjects with ai/i }));

    await waitFor(() =>
      expect(screen.getByText('Accepted subject')).toBeInTheDocument()
    );
    // Sparse-history note shows best-practices phrasing.
    expect(screen.getByText(/general best practices/i)).toBeInTheDocument();

    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^use$/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as AbTest;
    const variantB = next.variants.find((v) => v.variantId === 'b');
    expect(variantB?.subject).toBe('Accepted subject');
    // Variant A is never overwritten.
    const variantA = next.variants.find((v) => v.variantId === 'a');
    expect(variantA?.subject).toBe('Hello A');
  });

  it('shows an inline error when the suggestions request fails', async () => {
    mockedGetAbSuggestions.mockResolvedValue({
      success: false,
      error: 'Service unavailable',
    });

    render(<AbTestConfig value={subjectTest()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /suggest subjects with ai/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/service unavailable/i)
    );
    expect(screen.queryByLabelText(/ai suggestions/i)).not.toBeInTheDocument();
  });

  it('prefills variant B send time from a send-time suggestion', async () => {
    const response: AbSuggestionResponse = {
      dimension: 'sendTime',
      rationale: 'Mornings perform well.',
      sendTimes: [{ label: '9:00 AM ET', hourUtc: 13 }],
      usedHistory: false,
    };
    mockedGetAbSuggestions.mockResolvedValue({ success: true, data: response });

    const sendTimeTest: AbTest = {
      dimension: 'sendTime',
      variants: [
        { variantId: 'a', sendAt: '' },
        { variantId: 'b', sendAt: '' },
      ],
      winMetric: 'openRate',
      confidence: 0.95,
      testFraction: 0.2,
      evaluateAfterMinutes: 240,
      minSamplePerVariant: 500,
    };

    render(<AbTestConfig value={sendTimeTest} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole('button', { name: /suggest send times with ai/i })
    );

    await waitFor(() =>
      expect(screen.getByText('9:00 AM ET')).toBeInTheDocument()
    );
    expect(mockedGetAbSuggestions).toHaveBeenCalledWith({ dimension: 'sendTime' });

    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^use$/i }));

    const next = onChange.mock.calls[0][0] as AbTest;
    const variantB = next.variants.find((v) => v.variantId === 'b');
    expect(variantB?.sendAt).toBe(nextOccurrenceOfUtcHour(13));
    // The prefilled value is a valid datetime-local string in the future.
    expect(variantB?.sendAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(variantB!.sendAt!).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('nextOccurrenceOfUtcHour', () => {
  it('picks today when the UTC hour is still ahead', () => {
    const now = new Date('2026-06-23T05:00:00Z');
    const result = nextOccurrenceOfUtcHour(13, now);
    expect(new Date(result).getUTCHours()).toBe(13);
    expect(new Date(result).getTime()).toBeGreaterThan(now.getTime());
    // Same UTC day.
    expect(new Date(result).getUTCDate()).toBe(23);
  });

  it('rolls to tomorrow when the UTC hour has already passed', () => {
    const now = new Date('2026-06-23T18:00:00Z');
    const result = nextOccurrenceOfUtcHour(13, now);
    expect(new Date(result).getUTCHours()).toBe(13);
    expect(new Date(result).getUTCDate()).toBe(24);
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
