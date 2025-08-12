import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { UserPreferencesForm } from '../UserPreferencesForm';
import type { UserPreferences } from '@/types/api';

describe('UserPreferencesForm', () => {
  const mockOnSubmit = vi.fn();

  const defaultProps = {
    onSubmit: mockOnSubmit,
    isLoading: false,
  };

  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('renders form fields correctly', () => {
    render(<UserPreferencesForm {...defaultProps} />);

    expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/language & region/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save preferences/i })).toBeInTheDocument();
  });

  it('populates form with initial data', () => {
    const initialData: UserPreferences = {
      timezone: 'America/New_York',
      locale: 'en-US',
    };

    render(<UserPreferencesForm {...defaultProps} initialData={initialData} />);

    const timezoneSelect = screen.getByLabelText(/timezone/i) as HTMLSelectElement;
    const localeSelect = screen.getByLabelText(/language & region/i) as HTMLSelectElement;

    expect(timezoneSelect.value).toBe('America/New_York');
    expect(localeSelect.value).toBe('en-US');
  });

  it('submits form with valid data', async () => {
    mockOnSubmit.mockResolvedValue(undefined);

    render(<UserPreferencesForm {...defaultProps} />);

    const timezoneSelect = screen.getByLabelText(/timezone/i);
    const localeSelect = screen.getByLabelText(/language & region/i);
    const submitButton = screen.getByRole('button', { name: /save preferences/i });

    fireEvent.change(timezoneSelect, { target: { value: 'America/Los_Angeles' } });
    fireEvent.change(localeSelect, { target: { value: 'es-ES' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        timezone: 'America/Los_Angeles',
        locale: 'es-ES',
      });
    });
  });

  it('shows loading state when submitting', async () => {
    let resolveSubmit: () => void;
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    mockOnSubmit.mockReturnValue(submitPromise);

    render(<UserPreferencesForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /save preferences/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/saving\.\.\./i)).toBeInTheDocument();
    });

    resolveSubmit!();
    await waitFor(() => {
      expect(screen.getByText(/save preferences/i)).toBeInTheDocument();
    });
  });

  it('disables form when loading prop is true', () => {
    render(<UserPreferencesForm {...defaultProps} isLoading={true} />);

    const timezoneSelect = screen.getByLabelText(/timezone/i);
    const localeSelect = screen.getByLabelText(/language & region/i);
    const submitButton = screen.getByRole('button', { name: /save preferences/i });

    expect(timezoneSelect).toBeDisabled();
    expect(localeSelect).toBeDisabled();
    expect(submitButton).toBeDisabled();
  });

  it('uses default values when no initial data provided', () => {
    render(<UserPreferencesForm {...defaultProps} />);

    const timezoneSelect = screen.getByLabelText(/timezone/i) as HTMLSelectElement;
    const localeSelect = screen.getByLabelText(/language & region/i) as HTMLSelectElement;

    expect(timezoneSelect.value).toBe('UTC');
    expect(localeSelect.value).toBe('en-US');
  });
});
