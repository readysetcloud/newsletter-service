import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { SocialLinksManager } from '../SocialLinksManager';

describe('SocialLinksManager', () => {
  const mockOnUpdate = vi.fn();

  const defaultProps = {
    onUpdate: mockOnUpdate,
    isLoading: false,
  };

  beforeEach(() => {
    mockOnUpdate.mockClear();
  });

  it('renders form with initial empty link', () => {
    render(<SocialLinksManager {...defaultProps} />);

    expect(screen.getByText(/social links/i)).toBeInTheDocument();
    expect(screen.getByText(/link 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save links/i })).toBeInTheDocument();
  });

  it('submits form with valid links', async () => {
    mockOnUpdate.mockResolvedValue(undefined);

    render(<SocialLinksManager {...defaultProps} />);

    const urlInput = screen.getByLabelText(/url/i);
    const nameInput = screen.getByLabelText(/display name/i);
    const submitButton = screen.getByRole('button', { name: /save links/i });

    fireEvent.change(urlInput, { target: { value: 'https://twitter.com/user' } });
    fireEvent.change(nameInput, { target: { value: 'Twitter' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith([
        {
          url: 'https://twitter.com/user',
          name: 'Twitter',
        },
      ]);
    });
  });

  it('shows loading state when submitting', async () => {
    let resolveUpdate: () => void;
    const updatePromise = new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    });
    mockOnUpdate.mockReturnValue(updatePromise);

    render(<SocialLinksManager {...defaultProps} />);

    // Fill in valid data first
    const urlInput = screen.getByLabelText(/url/i);
    const nameInput = screen.getByLabelText(/display name/i);
    const submitButton = screen.getByRole('button', { name: /save links/i });

    fireEvent.change(urlInput, { target: { value: 'https://twitter.com/user' } });
    fireEvent.change(nameInput, { target: { value: 'Twitter' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/saving\.\.\./i)).toBeInTheDocument();
    });

    resolveUpdate!();
    await waitFor(() => {
      expect(screen.getByText(/save links/i)).toBeInTheDocument();
    });
  });
});
