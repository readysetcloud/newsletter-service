import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GenerateReportForm } from '../GenerateReportForm';

const isoDay = (offsetDays: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const openForm = () => fireEvent.click(screen.getByRole('button', { name: /new report/i }));

const setRange = (from: string, to: string) => {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: to } });
};

describe('GenerateReportForm', () => {
  let onGenerate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onGenerate = vi.fn().mockResolvedValue(undefined);
  });

  const setup = (props = {}) =>
    render(<GenerateReportForm onGenerate={onGenerate} {...props} />);

  it('stays out of the way until asked for', () => {
    setup();

    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  });

  describe('the end date', () => {
    it('sends the day after the one picked, because the API end is exclusive', async () => {
      // Someone picking 1–14 June means the 14th is included. The API takes an
      // exclusive end, so this is the conversion nobody should have to think
      // about — and the easiest place in the feature to be off by one.
      setup();
      openForm();
      setRange('2026-06-01', '2026-06-14');
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

      await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
      expect(onGenerate).toHaveBeenCalledWith({
        periodStart: '2026-06-01',
        periodEnd: '2026-06-15'
      });
    });

    it('rolls over a month boundary correctly', async () => {
      setup();
      openForm();
      setRange('2026-06-01', '2026-06-30');
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

      await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
      expect(onGenerate.mock.calls[0][0].periodEnd).toBe('2026-07-01');
    });

    it('rolls over a year boundary correctly', async () => {
      setup();
      openForm();
      setRange('2025-12-01', '2025-12-31');
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

      await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
      expect(onGenerate.mock.calls[0][0].periodEnd).toBe('2026-01-01');
    });

    it('sends a single day as a one-day range', async () => {
      setup();
      openForm();
      setRange('2026-06-03', '2026-06-03');
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

      await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
      expect(onGenerate).toHaveBeenCalledWith({
        periodStart: '2026-06-03',
        periodEnd: '2026-06-04'
      });
    });
  });

  describe('what it refuses to send', () => {
    it('an inverted range', () => {
      setup();
      openForm();
      setRange('2026-06-14', '2026-06-01');

      expect(screen.getByText(/end date comes before/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    });

    it('a range that has not happened', () => {
      setup();
      openForm();
      setRange(isoDay(-3), isoDay(7));

      expect(screen.getByText(/in the future/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    });

    it('a range longer than the server accepts', () => {
      setup();
      openForm();
      setRange('2024-01-01', '2025-06-01');

      expect(screen.getByText(/at most 366/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    });

    it('anything at all when the tenant is at their limit', () => {
      setup({ disabled: true, disabledReason: 'Three reports are already being generated.' });

      expect(screen.getByRole('button', { name: /new report/i })).toBeDisabled();
    });
  });

  it('closes once the report has been accepted', async () => {
    setup();
    openForm();
    setRange('2026-06-01', '2026-06-14');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(screen.queryByLabelText('From')).not.toBeInTheDocument());
  });

  it('stays open when starting the report fails, so the range is not lost', async () => {
    onGenerate.mockRejectedValue(new Error('nope'));
    setup();
    openForm();
    setRange('2026-06-01', '2026-06-14');

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(screen.getByLabelText('From')).toBeInTheDocument();
  });
});
