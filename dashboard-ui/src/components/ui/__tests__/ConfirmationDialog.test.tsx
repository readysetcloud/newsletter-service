import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmationDialog, confirmationPresets } from '../ConfirmationDialog';

describe('ConfirmationDialog', () => {
  const mockOnConfirm = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with basic props', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Confirm Action"
        description="Are you sure you want to proceed?"
      />
    );

    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getAllByText('Are you sure you want to proceed?')[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('handles confirmation without text requirement', async () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Confirm Action"
        description="Are you sure?"
        requireTextConfirmation={false}
      />
    );

    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockOnConfirm).toHaveBeenCalled();
    });
  });

  it('requires text confirmation when enabled', async () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Delete Item"
        description="This will permanently delete the item."
        requireTextConfirmation={true}
        confirmationText="DELETE"
      />
    );

    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    const textInput = screen.getByPlaceholderText('Type "DELETE" here');

    // Should be disabled initially
    expect(confirmButton).toBeDisabled();

    // Type incorrect text
    fireEvent.change(textInput, { target: { value: 'delete' } });
    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    // Type correct text
    fireEvent.change(textInput, { target: { value: 'DELETE' } });
    expect(confirmButton).not.toBeDisabled();

    // Click confirm
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockOnConfirm).toHaveBeenCalled();
    });
  });

  it('shows details when provided', () => {
    const details = [
      { label: 'Name', value: 'Test Item' },
      { label: 'Created', value: '2024-01-01' }
    ];

    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Confirm Action"
        description="Are you sure?"
        details={details}
      />
    );

    expect(screen.getByText('Details')).toBeInTheDocument();

    // Click show details
    fireEvent.click(screen.getByText('Show details'));

    expect(screen.getByText('Name:')).toBeInTheDocument();
    expect(screen.getByText('Test Item')).toBeInTheDocument();
    expect(screen.getByText('Created:')).toBeInTheDocument();
    expect(screen.getByText('2024-01-01')).toBeInTheDocument();
  });

  it('shows consequences when provided', () => {
    const consequences = [
      'This action cannot be undone',
      'All data will be lost'
    ];

    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Dangerous Action"
        description="This is dangerous."
        consequences={consequences}
        type="danger"
      />
    );

    expect(screen.getByText('This action cannot be undone')).toBeInTheDocument();
    expect(screen.getByText('• This action cannot be undone')).toBeInTheDocument();
    expect(screen.getByText('• All data will be lost')).toBeInTheDocument();
  });

  it('applies correct styling for different types', () => {
    const { rerender } = render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Danger"
        description="Dangerous action"
        type="danger"
      />
    );

    let confirmButton = screen.getByRole('button', { name: /confirm/i });
    expect(confirmButton).toHaveClass('bg-error-600');

    rerender(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Warning"
        description="Warning action"
        type="warning"
      />
    );

    confirmButton = screen.getByRole('button', { name: /confirm/i });
    expect(confirmButton).toHaveClass('bg-primary-600');
  });

  it('uses preset configurations correctly', () => {
    const preset = confirmationPresets.deleteApiKey('Test API Key');

    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        {...preset}
      />
    );

    expect(screen.getAllByText('Delete API Key')[0]).toBeInTheDocument();
    expect(screen.getAllByText(/permanently removed from the system/)[0]).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type "DELETE" here')).toBeInTheDocument();
  });

  it('handles loading state during confirmation', async () => {
    const slowConfirm = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)));

    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={slowConfirm}
        title="Confirm"
        description="Are you sure?"
        loadingText="Processing..."
      />
    );

    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });

    // Should be disabled during loading
    expect(confirmButton).toBeDisabled();
  });

  it('prevents closing during confirmation', async () => {
    const slowConfirm = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)));

    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={slowConfirm}
        title="Confirm"
        description="Are you sure?"
      />
    );

    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    const cancelButton = screen.getByRole('button', { name: /cancel/i });

    fireEvent.click(confirmButton);

    // Try to cancel during loading
    fireEvent.click(cancelButton);

    // Should not call onClose during loading
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
