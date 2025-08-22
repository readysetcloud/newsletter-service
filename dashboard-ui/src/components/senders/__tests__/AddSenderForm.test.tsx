import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddSenderForm } from '../AddSenderForm';
import { senderService } from '@/services/senderService';
import type { TierLimits, SenderEmail } from '@/types';

// Mock dependencies
vi.mock('@/services/senderService');
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: vi.fn()
  })
}));

const mockSenderService = vi.mocked(senderService);

const mockTierLimits: TierLimits = {
  tier: 'free-tier',
  maxSenders: 1,
  currentCount: 0,
  canUseDNS: false,
  canUseMailbox: true
};

const mockCreatorTierLimits: TierLimits = {
  tier: 'creator-tier',
  maxSenders: 2,
  currentCount: 0,
  canUseDNS: true,
  canUseMailbox: true
};

const mockExistingSenders: SenderEmail[] = [];

const mockOnSenderCreated = vi.fn();
const mockOnCancel = vi.fn();

const defaultProps = {
  tierLimits: mockTierLimits,
  existingSenders: mockExistingSenders,
  onSenderCreated: mockOnSenderCreated,
  onCancel: mockOnCancel
};

describe('AddSenderForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSenderService.canAddSender.mockReturnValue(true);
    mockSenderService.getAvailableSlots.mockReturnValue(1);
    mockSenderService.createSenderWithRetry.mockResolvedValue({
      success: true,
      data: {
        senderId: 'test-id',
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'mailbox',
        verificationStatus: 'pending',
        isDefault: true,
        domain: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        verifiedAt: null,
        failureReason: null
      }
    });
  });

  it('renders form fields correctly', () => {
    render(<AddSenderForm {...defaultProps} />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sender name/i)).toBeInTheDocument();
    expect(screen.getByText(/verification method/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add sender email/i })).toBeInTheDocument();
  });

  it('shows tier limit reached message when cannot add sender', () => {
    mockSenderService.canAddSender.mockReturnValue(false);

    render(<AddSenderForm {...defaultProps} />);

    expect(screen.getByText(/sender limit reached/i)).toBeInTheDocument();
    expect(screen.getByText(/you've reached the maximum of 1 sender email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upgrade plan/i })).toBeInTheDocument();
  });

  it('displays available slots correctly', () => {
    mockSenderService.getAvailableSlots.mockReturnValue(2);

    render(<AddSenderForm {...defaultProps} tierLimits={mockCreatorTierLimits} />);

    expect(screen.getByText(/you have 2 of 2 slots available/i)).toBeInTheDocument();
  });

  it('shows verification type options based on tier', () => {
    render(<AddSenderForm {...defaultProps} />);

    expect(screen.getByText(/email verification/i)).toBeInTheDocument();
    expect(screen.getByText(/domain verification/i)).toBeInTheDocument();

    // DNS verification should be disabled for free tier
    const domainOption = screen.getByText(/domain verification/i).closest('div');
    expect(domainOption).toHaveClass('cursor-not-allowed', 'opacity-60');
  });

  it('enables both verification types for creator tier', () => {
    render(<AddSenderForm {...defaultProps} tierLimits={mockCreatorTierLimits} />);

    const emailOption = screen.getByText(/email verification/i).closest('div');
    const domainOption = screen.getByText(/domain verification/i).closest('div');

    expect(emailOption).not.toHaveClass('cursor-not-allowed', 'opacity-60');
    expect(domainOption).not.toHaveClass('cursor-not-allowed', 'opacity-60');
  });

  it('validates required fields', async () => {
    const user = userEvent.setup();
    render(<AddSenderForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /add sender email/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      expect(screen.getByText(/verification type is required/i)).toBeInTheDocument();
    });

    expect(mockSenderService.createSenderWithRetry).not.toHaveBeenCalled();
  });

  it('validates email format', async () => {
    const user = userEvent.setup();
    render(<AddSenderForm {...defaultProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'invalid-email');

    const submitButton = screen.getByRole('button', { name: /add sender email/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    });
  });

  it('shows error for duplicate email', async () => {
    const user = userEvent.setup();
    const existingSenders = [
      {
        senderId: 'existing-id',
        email: 'existing@example.com',
        name: 'Existing Sender',
        verificationType: 'mailbox' as const,
        verificationStatus: 'verified' as const,
        isDefault: true,
        domain: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        verifiedAt: '2024-01-01T01:00:00Z',
        failureReason: null
      }
    ];

    render(<AddSenderForm {...defaultProps} existingSenders={existingSenders} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'existing@example.com');

    await waitFor(() => {
      expect(screen.getByText(/this email address is already configured/i)).toBeInTheDocument();
    });
  });

  it('selects verification type when clicked', async () => {
    const user = userEvent.setup();
    render(<AddSenderForm {...defaultProps} />);

    const emailOption = screen.getByText(/email verification/i).closest('div');
    await user.click(emailOption!);

    expect(screen.getByTestId('check-circle-icon')).toBeInTheDocument();
  });

  it('submits form with valid data', async () => {
    const user = userEvent.setup();
    render(<AddSenderForm {...defaultProps} />);

    // Fill form
    const emailInput = screen.getByLabelText(/email address/i);
    const nameInput = screen.getByLabelText(/sender name/i);

    await user.type(emailInput, 'test@example.com');
    await user.type(nameInput, 'Test Sender');

    // Select verification type
    const emailOption = screen.getByText(/email verification/i).closest('div');
    await user.click(emailOption!);

    // Submit form
    const submitButton = screen.getByRole('button', { name: /add sender email/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockSenderService.createSenderWithRetry).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'mailbox'
      });
    });

    expect(mockOnSenderCreated).toHaveBeenCalled();
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup();
    let resolveCreate: () => void;
    const createPromise = new Promise<any>((resolve) => {
      resolveCreate = () => resolve({
        success: true,
        data: {
          senderId: 'test-id',
          email: 'test@example.com',
          name: 'Test Sender',
          verificationType: 'mailbox',
          verificationStatus: 'pending',
          isDefault: true,
          domain: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          verifiedAt: null,
          failureReason: null
        }
      });
    });

    mockSenderService.createSenderWithRetry.mockReturnValue(createPromise);

    render(<AddSenderForm {...defaultProps} />);

    // Fill and submit form
    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'test@example.com');

    const emailOption = screen.getByText(/email verification/i).closest('div');
    await user.click(emailOption!);

    const submitButton = screen.getByRole('button', { name: /add sender email/i });
    await user.click(submitButton);

    // Check loading state
    await waitFor(() => {
      expect(screen.getByText(/adding sender.../i)).toBeInTheDocument();
      expect(submitButton).toBeDisabled();
    });

    // Resolve promise
    resolveCreate!();

    await waitFor(() => {
      expect(screen.getByText(/add sender email/i)).toBeInTheDocument();
    });
  });

  it('handles submission error', async () => {
    const user = userEvent.setup();
    mockSenderService.createSenderWithRetry.mockResolvedValue({
      success: false,
      error: 'Failed to create sender'
    });

    render(<AddSenderForm {...defaultProps} />);

    // Fill and submit form
    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'test@example.com');

    const emailOption = screen.getByText(/email verification/i).closest('div');
    await user.click(emailOption!);

    const submitButton = screen.getByRole('button', { name: /add sender email/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockSenderService.createSenderWithRetry).toHaveBeenCalled();
    });

    expect(mockOnSenderCreated).not.toHaveBeenCalled();
  });

  it('auto-suggests domain verification for existing verified domain', async () => {
    const user = userEvent.setup();
    const existingSenders = [
      {
        senderId: 'existing-id',
        email: 'existing@example.com',
        name: 'Existing Sender',
        verificationType: 'domain' as const,
        verificationStatus: 'verified' as const,
        isDefault: true,
        domain: 'example.com',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        verifiedAt: '2024-01-01T01:00:00Z',
        failureReason: null
      }
    ];

    render(<AddSenderForm {...defaultProps} tierLimits={mockCreatorTierLimits} existingSenders={existingSenders} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'new@example.com');

    await waitFor(() => {
      expect(screen.getByTestId('check-circle-icon')).toBeInTheDocument();
    });
  });

  it('shows domain verification info when domain type selected', async () => {
    const user = userEvent.setup();
    render(<AddSenderForm {...defaultProps} tierLimits={mockCreatorTierLimits} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'test@example.com');

    const domainOption = screen.getByText(/domain verification/i).closest('div');
    await user.click(domainOption!);

    await waitFor(() => {
      expect(screen.getByText(/you'll verify the domain "example.com"/i)).toBeInTheDocument();
    });
  });

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup();
    render(<AddSenderForm {...defaultProps} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('resets form after successful submission', async () => {
    const user = userEvent.setup();
    render(<AddSenderForm {...defaultProps} />);

    // Fill form
    const emailInput = screen.getByLabelText(/email address/i);
    const nameInput = screen.getByLabelText(/sender name/i);

    await user.type(emailInput, 'test@example.com');
    await user.type(nameInput, 'Test Sender');

    const emailOption = screen.getByText(/email verification/i).closest('div');
    await user.click(emailOption!);

    // Submit form
    const submitButton = screen.getByRole('button', { name: /add sender email/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockOnSenderCreated).toHaveBeenCalled();
    });

    // Check form is reset
    expect(emailInput).toHaveValue('');
    expect(nameInput).toHaveValue('');
  });

  it('disables form fields when submitting', async () => {
    const user = userEvent.setup();
    let resolveCreate: () => void;
    const createPromise = new Promise<any>((resolve) => {
      resolveCreate = () => resolve({
        success: true,
        data: {
          senderId: 'test-id',
          email: 'test@example.com',
          verificationType: 'mailbox',
          verificationStatus: 'pending',
          isDefault: true,
          domain: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          verifiedAt: null,
          failureReason: null
        }
      });
    });

    mockSenderService.createSenderWithRetry.mockReturnValue(createPromise);

    render(<AddSenderForm {...defaultProps} />);

    // Fill and submit form
    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'test@example.com');

    const emailOption = screen.getByText(/email verification/i).closest('div');
    await user.click(emailOption!);

    const submitButton = screen.getByRole('button', { name: /add sender email/i });
    await user.click(submitButton);

    // Check fields are disabled
    await waitFor(() => {
      expect(emailInput).toBeDisabled();
    });

    resolveCreate!();
  });
});
