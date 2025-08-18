import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ConfirmSignUpForm } from '../ConfirmSignUpForm';
import { AuthProvider } from '../../../contexts/AuthContext';

// Mock AWS Amplify
vi.mock('aws-amplify/auth', () => ({
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
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

describe('ConfirmSignUpForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnBackToSignUp = vi.fn();
  const testEmail = 'test@example.com';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders confirmation form with email', () => {
    renderWithAuth(
      <ConfirmSignUpForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onBackToSignUp={mockOnBackToSignUp}
      />
    );

    expect(screen.getByText('Verify Your Email')).toBeInTheDocument();
    expect(screen.getByText(testEmail)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmation code/i)).toBeInTheDocument();
  });

  it('validates confirmation code format', async () => {
    renderWithAuth(
      <ConfirmSignUpForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onBackToSignUp={mockOnBackToSignUp}
      />
    );

    const codeInput = screen.getByLabelText(/confirmation code/i);
    const submitButton = screen.getByRole('button', { name: /verify email/i });

    // Test empty code
    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(screen.getByText('Confirmation code is required')).toBeInTheDocument();
    });

    // Test invalid format
    fireEvent.change(codeInput, { target: { value: '12345' } });
    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(screen.getByText('Confirmation code must be 6 digits')).toBeInTheDocument();
    });
  });

  it('only allows numeric input and limits to 6 digits', () => {
    renderWithAuth(
      <ConfirmSignUpForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onBackToSignUp={mockOnBackToSignUp}
      />
    );

    const codeInput = screen.getByLabelText(/confirmation code/i) as HTMLInputElement;

    // Test non-numeric input is filtered out
    fireEvent.change(codeInput, { target: { value: 'abc123def' } });
    expect(codeInput.value).toBe('123');

    // Test length limit
    fireEvent.change(codeInput, { target: { value: '1234567890' } });
    expect(codeInput.value).toBe('123456');
  });

  it('shows resend code button with cooldown', async () => {
    renderWithAuth(
      <ConfirmSignUpForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onBackToSignUp={mockOnBackToSignUp}
      />
    );

    const resendButton = screen.getByText(/resend confirmation code/i);
    expect(resendButton).toBeInTheDocument();
    expect(resendButton).not.toBeDisabled();
  });

  it('shows back to sign up button when provided', () => {
    renderWithAuth(
      <ConfirmSignUpForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onBackToSignUp={mockOnBackToSignUp}
      />
    );

    const backButton = screen.getByText(/back to sign up/i);
    expect(backButton).toBeInTheDocument();

    fireEvent.click(backButton);
    expect(mockOnBackToSignUp).toHaveBeenCalled();
  });

  it('does not show back button when not provided', () => {
    renderWithAuth(
      <ConfirmSignUpForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.queryByText(/back to sign up/i)).not.toBeInTheDocument();
  });
});
