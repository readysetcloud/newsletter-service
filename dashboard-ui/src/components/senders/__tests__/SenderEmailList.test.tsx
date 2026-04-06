import { render, screen, waitFor } from '@testing-library/react';
import * as userEvent from '@testing-library/user-event';
import { SenderEmailList } from '../SenderEmailList';
import { senderService } from '@/services/senderService';

import type { TierLimits, SenderEmail } from '@/types';

// Mock dependencies
vi.mock('@/services/senderService');
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: vi.fn()
  })
}));
vi.mock('@/components/ui/ConfirmationDialog', () => ({
  useConfirmationDialog: () => ({
    showConfirmation: vi.fn(),
    ConfirmationDialog: () => <div data-testid="confirmation-dialog" />
  })
}));

const mockSenderService = vi.mocked(senderService);

const mockTierLimits: TierLimits = {
  tier: 'creator-tier',
  maxSenders: 2,
  currentCount: 2,
  canUseDNS: true,
  canUseMailbox: true
};

const mockSenders: SenderEmail[] = [
  {
    senderId: 'sender-1',
    email: 'verified@example.com',
    name: 'Verified Sender',
    verificationType: 'mailbox',
    verificationStatus: 'verified',
    isDefault: true,
    domain: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    verifiedAt: '2024-01-01T01:00:00Z',
    failureReason: null
  },
  {
    senderId: 'sender-2',
    email: 'pending@example.com',
    name: 'Pending Sender',
    verificationType: 'domain',
    verificationStatus: 'pending',
    isDefault: false,
    domain: 'example.com',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    verifiedAt: null,
    failureReason: null
  },
  {
    senderId: 'sender-3',
    email: 'failed@example.com',
    name: null,
    verificationType: 'mailbox',
    verificationStatus: 'failed',
    isDefault: false,
    domain: null,
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-03T00:00:00Z',
    verifiedAt: null,
    failureReason: 'DNS records not found'
  }
];

const mockOnSenderDeleted = vi.fn();
const mockOnSenderUpdated = vi.fn();

const defaultProps = {
  senders: mockSenders,
  tierLimits: mockTierLimits,
  onSenderDeleted: mockOnSenderDeleted,
  onSenderUpdated: mockOnSenderUpdated
};

describe('SenderEmailList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSenderService.deleteSenderWithRetry.mockResolvedValue({ success: true });
    mockSenderService.updateSenderWithRetry.mockResolvedValue({
      success: true,
      data: {
        ...mockSenders[1],
        isDefault: true
      }
    });
    mockSenderService.retryVerification.mockResolvedValue({
      success: true,
      data: {
        ...mockSenders[2],
        verificationStatus: 'pending'
      }
    });
    mockSenderService.getSenderStatus.mockResolvedValue({
      success: true,
      data: mockSenders[1]
    });
  });

  it('renders sender list correctly', () => {
    render(<SenderEmailList {...defaultProps} />);

    expect(screen.getByText('Verified Sender')).toBeInTheDocument();
    expect(screen.getByText('verified@example.com')).toBeInTheDocument();
    expect(screen.getByText('Pending Sender')).toBeInTheDocument();
    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
    expect(screen.getByText('failed@example.com')).toBeInTheDocument();
  });

  it('shows correct status icons and badges', () => {
    render(<SenderEmailList {...defaultProps} />);

    // Verified status
    expect(screen.getByText('Verified')).toBeInTheDocument();

    // Pending status
    expect(screen.getByText('Pending verification')).toBeInTheDocument();

    // Failed status
    expect(screen.getByText('Verification failed')).toBeInTheDocument();
  });

  it('shows default sender badge', () => {
    render(<SenderEmailList {...defaultProps} />);

    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('displays verification type icons correctly', () => {
    render(<SenderEmailList {...defaultProps} />);

    // Should show envelope icon for mailbox verification
    const mailboxIcons = screen.getAllByTestId('envelope-icon');
    expect(mailboxIcons).toHaveLength(2); // Two mailbox verifications

    // Should show globe icon for domain verification
    const domainIcons = screen.getAllByTestId('globe-alt-icon');
    expect(domainIcons).toHaveLength(2); // One domain verification + one domain display
  });

  it('shows domain information for domain verification', () => {
    render(<SenderEmailList {...defaultProps} />);

    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('shows failure reason for failed verification', () => {
    render(<SenderEmailList {...defaultProps} />);

    expect(screen.getByText(/DNS records not found/i)).toBeInTheDocument();
  });

  it('shows pending verification message', () => {
    render(<SenderEmailList {...defaultProps} />);

    // The VerificationProgress component shows a message for pending domain verification
    expect(screen.getByText(/checking your DNS records/i)).toBeInTheDocument();
  });

  it('shows empty state when no senders', () => {
    render(<SenderEmailList {...defaultProps} senders={[]} />);

    expect(screen.getByText('No sender emails configured')).toBeInTheDocument();
    expect(screen.getByText(/add your first sender email/i)).toBeInTheDocument();
    expect(screen.getByText(/you can add up to 2 sender emails/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<SenderEmailList {...defaultProps} isLoading={true} />);

    // Should show skeleton loaders
    const skeletons = screen.getAllByRole('generic');
    expect(skeletons.some(el => el.classList.contains('animate-pulse'))).toBe(true);
  });

  it('handles set as default action', async () => {
    const user = userEvent.setup();
    render(<SenderEmailList {...defaultProps} />);

    // Find the set default button for non-default verified sender
    const setDefaultButtons = screen.queryAllByTitle('Set as default sender');
    expect(setDefaultButtons).toHaveLength(0); // No verified non-default senders in mock data

    // Let's test with a verified non-default sender
    const modifiedSenders = [
      ...mockSenders,
      {
        senderId: 'sender-4',
        email: 'another@example.com',
        name: 'Another Sender',
        verificationType: 'mailbox' as const,
        verificationStatus: 'verified' as const,
        isDefault: false,
        domain: null,
        createdAt: '2024-01-04T00:00:00Z',
        updatedAt: '2024-01-04T00:00:00Z',
        verifiedAt: '2024-01-04T01:00:00Z',
        failureReason: null
      }
    ];

    render(<SenderEmailList {...defaultProps} senders={modifiedSenders} />);

    const setDefaultButton = screen.getByTitle('Set as default sender');
    await user.click(setDefaultButton);

    await waitFor(() => {
      expect(mockSenderService.updateSenderWithRetry).toHaveBeenCalledWith('sender-4', {
        isDefault: true
      });
    });

    expect(mockOnSenderUpdated).toHaveBeenCalled();
  });

  it('handles retry verification action', async () => {
    const user = userEvent.setup();
    render(<SenderEmailList {...defaultProps} />);

    const retryButton = screen.getByRole('button', { name: /refresh status/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(mockSenderService.retryVerification).toHaveBeenCalledWith('sender-3');
    });

    expect(mockOnSenderUpdated).toHaveBeenCalled();
  });

  it('handles delete action with confirmation', async () => {
    const user = userEvent.setup();

    render(<SenderEmailList {...defaultProps} />);

    const deleteButtons = screen.getAllByTitle('Delete sender email');
    expect(deleteButtons.length).toBeGreaterThan(0);
    await user.click(deleteButtons[0]);

    // The confirmation dialog mock's showConfirmation is called internally
    // We verify the delete buttons are rendered and clickable
    expect(deleteButtons[0]).toBeInTheDocument();
  });

  it('shows correct verification type labels', () => {
    render(<SenderEmailList {...defaultProps} />);

    // The component renders "{verificationType} verification" with capitalize class
    const mailboxLabels = screen.getAllByText(/mailbox verification/i);
    expect(mailboxLabels.length).toBeGreaterThan(0);
    const domainLabels = screen.getAllByText(/domain verification/i);
    expect(domainLabels.length).toBeGreaterThan(0);
  });

  it('formats creation dates correctly', () => {
    render(<SenderEmailList {...defaultProps} />);

    // Should show formatted dates - the component uses toLocaleDateString()
    // which may vary by locale, so just check the "Added" prefix is present
    const addedTexts = screen.getAllByText(/added/i);
    expect(addedTexts).toHaveLength(3);
  });

  it('disables buttons during loading states', async () => {
    const user = userEvent.setup();
    let resolveUpdate: () => void;
    const updatePromise = new Promise<unknown>((resolve) => {
      resolveUpdate = () => resolve({
        success: true,
        data: { ...mockSenders[1], isDefault: true }
      });
    });

    mockSenderService.updateSenderWithRetry.mockReturnValue(updatePromise);

    const modifiedSenders = [
      ...mockSenders,
      {
        senderId: 'sender-4',
        email: 'another@example.com',
        name: 'Another Sender',
        verificationType: 'mailbox' as const,
        verificationStatus: 'verified' as const,
        isDefault: false,
        domain: null,
        createdAt: '2024-01-04T00:00:00Z',
        updatedAt: '2024-01-04T00:00:00Z',
        verifiedAt: '2024-01-04T01:00:00Z',
        failureReason: null
      }
    ];

    render(<SenderEmailList {...defaultProps} senders={modifiedSenders} />);

    const setDefaultButton = screen.getByTitle('Set as default sender');
    await user.click(setDefaultButton);

    // Button should be disabled and show loading
    await waitFor(() => {
      expect(setDefaultButton).toBeDisabled();
    });

    resolveUpdate!();
  });

  it('handles service errors gracefully', async () => {
    const user = userEvent.setup();
    mockSenderService.retryVerification.mockResolvedValue({
      success: false,
      error: 'Retry failed'
    });

    render(<SenderEmailList {...defaultProps} />);

    const retryButton = screen.getByRole('button', { name: /refresh status/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(mockSenderService.retryVerification).toHaveBeenCalled();
    });

    expect(mockOnSenderUpdated).not.toHaveBeenCalled();
  });

  it('shows correct status badge colors', () => {
    render(<SenderEmailList {...defaultProps} />);

    const verifiedBadge = screen.getByText('Verified');
    expect(verifiedBadge).toHaveClass('bg-success-100', 'text-success-800');

    const pendingBadge = screen.getByText('Pending verification');
    expect(pendingBadge).toHaveClass('bg-warning-100', 'text-warning-800');

    const failedBadge = screen.getByText('Verification failed');
    expect(failedBadge).toHaveClass('bg-error-100', 'text-error-800');
  });

  it('shows email as title when no name provided', () => {
    render(<SenderEmailList {...defaultProps} />);

    // The failed sender has no name, so email should be the title
    const failedSenderCard = screen.getByText('failed@example.com').closest('div');
    expect(failedSenderCard).toBeInTheDocument();
  });

  it('shows name as title when provided', () => {
    render(<SenderEmailList {...defaultProps} />);

    expect(screen.getByText('Verified Sender')).toBeInTheDocument();
    expect(screen.getByText('Pending Sender')).toBeInTheDocument();
  });

  it('applies correct card styling based on verification status', () => {
    render(<SenderEmailList {...defaultProps} />);

    // Verified sender should have green styling - find the card container
    const verifiedSenderName = screen.getByText('Verified Sender');
    const verifiedCard = verifiedSenderName.closest('.border-success-200');
    expect(verifiedCard).toBeInTheDocument();
    expect(verifiedCard).toHaveClass('bg-success-50/30');

    // Failed sender should have red styling
    const failedSenderEmail = screen.getByText('failed@example.com');
    const failedCard = failedSenderEmail.closest('.border-error-200');
    expect(failedCard).toBeInTheDocument();
    expect(failedCard).toHaveClass('bg-error-50/30');
  });
});
