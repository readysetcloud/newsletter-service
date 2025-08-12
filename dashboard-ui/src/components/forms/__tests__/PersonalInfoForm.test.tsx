import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PersonalInfoForm } from '../PersonalInfoForm';
import type { PersonalInfo } from '@/types/api';

const mockOnSubmit = vi.fn();

const defaultProps = {
  onSubmit: mockOnSubmit,
  isLoading: false
};

const mockInitialData: PersonalInfo = {
  firstName: 'John',
  lastName: 'Doe',
  links: [
    { platform: 'twitter', url: 'https://twitter.com/johndoe', displayName: 'John Doe' }
  ]
};

describe('PersonalInfoForm', () => {
  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('renders form fields correctly', () => {
    render(<PersonalInfoForm {...defaultProps} />);

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('populates form with initial data', () => {
    render(<PersonalInfoForm {...defaultProps} initialData={mockInitialData} />);

    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Doe')).toBeInTheDocument();
  });

  it('shows validation errors for empty required fields', async () => {
    render(<PersonalInfoForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/first name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/last name is required/i)).toBeInTheDocument();
    });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    mockOnSubmit.mockResolvedValue(undefined);
    render(<PersonalInfoForm {...defaultProps} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const submitButton = screen.getByRole('button', { name: /save changes/i });

    fireEvent.change(firstNameInput, { target: { value: 'Jane' } });
    fireEvent.change(lastNameInput, { target: { value: 'Smith' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        firstName: 'Jane',
        lastName: 'Smith',
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

    render(<PersonalInfoForm {...defaultProps} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const submitButton = screen.getByRole('button', { name: /save changes/i });

    fireEvent.change(firstNameInput, { target: { value: 'Jane' } });
    fireEvent.change(lastNameInput, { target: { value: 'Smith' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/saving.../i)).toBeInTheDocument();
      expect(submitButton).toBeDisabled();
    });

    resolveSubmit!();
    await waitFor(() => {
      expect(screen.getByText(/save changes/i)).toBeInTheDocument();
    });
  });

  it('disables form when loading prop is true', () => {
    render(<PersonalInfoForm {...defaultProps} isLoading={true} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const submitButton = screen.getByRole('button', { name: /save changes/i });

    expect(firstNameInput).toBeDisabled();
    expect(lastNameInput).toBeDisabled();
    expect(submitButton).toBeDisabled();
  });
});
