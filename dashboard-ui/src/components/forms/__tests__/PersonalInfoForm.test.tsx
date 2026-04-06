import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PersonalInfoForm } from '../PersonalInfoForm';
import type { PersonalInfo } from '@/types/api';
import { ToastProvider } from '@/components/ui/Toast';

const mockOnSubmit = vi.fn();

const defaultProps = {
  onSubmit: mockOnSubmit,
  isLoading: false
};

const mockInitialData: PersonalInfo = {
  firstName: 'John',
  lastName: 'Doe',
  links: [
    { platform: 'twitter', url: 'https://twitter.com/johndoe', name: 'John Doe' }
  ]
};

// Suppress unhandled ZodError rejections from zod v4 + @hookform/resolvers onChange validation
const originalListeners = process.rawListeners('unhandledRejection');

beforeAll(() => {
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason: unknown) => {
    if (reason && typeof reason === 'object' && ('_zod' in reason || (reason as Error)?.constructor?.name === 'ZodError')) {
      // Suppress ZodError rejections from onChange validation
      return;
    }
    // Re-throw non-ZodError rejections
    throw reason;
  });
});

afterAll(() => {
  process.removeAllListeners('unhandledRejection');
  originalListeners.forEach((listener) => {
    process.on('unhandledRejection', listener as NodeJS.UnhandledRejectionListener);
  });
});

describe('PersonalInfoForm', () => {

  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('renders form fields correctly', () => {
    render(<ToastProvider><PersonalInfoForm {...defaultProps} /></ToastProvider>);

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('populates form with initial data', () => {
    render(<ToastProvider><PersonalInfoForm {...defaultProps} initialData={mockInitialData} /></ToastProvider>);

    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Doe')).toBeInTheDocument();
  });

  it('shows validation errors for empty required fields', async () => {
    render(
      <ToastProvider>
        <PersonalInfoForm
          {...defaultProps}
          initialData={{ firstName: 'John', lastName: 'Doe', links: [] }}
        />
      </ToastProvider>
    );

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);

    // Clear fields to trigger onChange validation errors
    await act(async () => {
      fireEvent.change(firstNameInput, { target: { value: '' } });
    });
    await act(async () => {
      fireEvent.change(lastNameInput, { target: { value: '' } });
    });

    // Submit button should be disabled when fields are invalid
    const submitButton = screen.getByRole('button', { name: /save changes/i });
    expect(submitButton).toBeDisabled();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    mockOnSubmit.mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <PersonalInfoForm
          {...defaultProps}
          initialData={{ firstName: 'John', lastName: 'Doe', links: [] }}
        />
      </ToastProvider>
    );

    const firstNameInput = screen.getByLabelText(/first name/i);

    await act(async () => {
      fireEvent.change(firstNameInput, { target: { value: 'Jane' } });
    });

    // Wait for validation to pass and button to become enabled
    const submitButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        firstName: 'Jane',
        lastName: 'Doe',
        links: []
      });
    });
  });

  it('shows loading state when submitting', async () => {
    let resolveSubmit: () => void;
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    mockOnSubmit.mockReturnValue(submitPromise);

    render(
      <ToastProvider>
        <PersonalInfoForm
          {...defaultProps}
          initialData={{ firstName: 'John', lastName: 'Doe', links: [] }}
        />
      </ToastProvider>
    );

    const firstNameInput = screen.getByLabelText(/first name/i);

    await act(async () => {
      fireEvent.change(firstNameInput, { target: { value: 'Jane' } });
    });

    // Wait for validation to pass and button to become enabled
    const submitButton = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/saving.../i)).toBeInTheDocument();
    });

    await act(async () => {
      resolveSubmit!();
    });
    await waitFor(() => {
      // After successful submission, EnhancedForm shows "Submitted!" briefly
      expect(screen.queryByText(/saving.../i)).not.toBeInTheDocument();
    });
  });

  it('disables form when loading prop is true', () => {
    render(<ToastProvider><PersonalInfoForm {...defaultProps} isLoading={true} /></ToastProvider>);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const submitButton = screen.getByRole('button', { name: /save changes/i });

    expect(firstNameInput).toBeDisabled();
    expect(lastNameInput).toBeDisabled();
    expect(submitButton).toBeDisabled();
  });
});
