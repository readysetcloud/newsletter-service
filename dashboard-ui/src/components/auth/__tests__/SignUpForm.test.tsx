import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { SignUpForm } from '../SignUpForm';
import { AuthProvider } from '../../../contexts/AuthContext';

// Mock AWS Amplify
vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  getCurrentUser: vi.fn().mockResolvedValue(null),
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: null
  })
}));

const renderWithAuth = (component: React.ReactElement) => {
  return render(
    <AuthProvider>
      {component}
    </AuthProvider>
  );
};

describe('SignUpForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnNeedConfirmation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sign up form', () => {
    renderWithAuth(
      <SignUpForm
        onSuccess={mockOnSuccess}
        onNeedConfirmation={mockOnNeedConfirmation}
      />
    );

    expect(screen.getByText('Create Account')).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    renderWithAuth(
      <SignUpForm
        onSuccess={mockOnSuccess}
        onNeedConfirmation={mockOnNeedConfirmation}
      />
    );

    const submitButton = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
      expect(screen.getByText('Last name is required')).toBeInTheDocument();
      expect(screen.getByText('Email is required')).toBeInTheDocument();
      expect(screen.getByText('Password is required')).toBeInTheDocument();
    });
  });

  it('validates password requirements', async () => {
    renderWithAuth(
      <SignUpForm
        onSuccess={mockOnSuccess}
        onNeedConfirmation={mockOnNeedConfirmation}
      />
    );

    const passwordInput = screen.getByLabelText(/^password$/i);
    fireEvent.change(passwordInput, { target: { value: 'weak' } });

    const submitButton = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password must contain at least one uppercase letter/i)).toBeInTheDocument();
    });
  });

  it('validates password confirmation', async () => {
    renderWithAuth(
      <SignUpForm
        onSuccess={mockOnSuccess}
        onNeedConfirmation={mockOnNeedConfirmation}
      />
    );

    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);

    fireEvent.change(passwordInput, { target: { value: 'Password123' } });
    fireEvent.change(confirmPasswordInput, { target: { value: 'Different123' } });

    const submitButton = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
  });

  it('shows password requirements', () => {
    renderWithAuth(
      <SignUpForm
        onSuccess={mockOnSuccess}
        onNeedConfirmation={mockOnNeedConfirmation}
      />
    );

    expect(screen.getByText('Password requirements:')).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters long')).toBeInTheDocument();
    expect(screen.getByText('Contains uppercase and lowercase letters')).toBeInTheDocument();
    expect(screen.getByText('Contains at least one number')).toBeInTheDocument();
  });

  it('toggles password visibility', () => {
    renderWithAuth(
      <SignUpForm
        onSuccess={mockOnSuccess}
        onNeedConfirmation={mockOnNeedConfirmation}
      />
    );

    const passwordInput = screen.getByLabelText(/^password$/i);
    const toggleButton = passwordInput.parentElement?.querySelector('button');

    expect(passwordInput).toHaveAttribute('type', 'password');

    if (toggleButton) {
      fireEvent.click(toggleButton);
      expect(passwordInput).toHaveAttribute('type', 'text');

      fireEvent.click(toggleButton);
      expect(passwordInput).toHaveAttribute('type', 'password');
    }
  });
});
