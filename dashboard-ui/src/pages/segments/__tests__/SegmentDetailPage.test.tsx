import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SegmentDetailPage } from '../SegmentDetailPage';
import { segmentService } from '@/services/segmentService';
import type { Segment, SegmentMember } from '@/services/segmentService';

vi.mock('@/services/segmentService', () => ({
  segmentService: {
    getSegment: vi.fn(),
    listMembers: vi.fn(),
    addMembers: vi.fn(),
    removeMembers: vi.fn(),
    exportSegment: vi.fn(),
    getJobStatus: vi.fn(),
    updateSegment: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ segmentId: 'seg-1' }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/segments/seg-1' }),
  Link: ({ children, to, ...props }: Record<string, unknown>) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

const mockAddToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

const mockSegment: Segment = {
  segmentId: 'seg-1',
  name: 'VIP Subscribers',
  description: 'Top engaged readers',
  memberCount: 2,
  createdAt: '2025-01-15T10:00:00Z',
};

const mockMembers: SegmentMember[] = [
  {
    email: 'alice@example.com',
    lastEngagedIssue: 25,
    engagementCount: 12,
    addedAt: '2025-01-16T10:00:00Z',
  },
  {
    email: 'bob@example.com',
    lastEngagedIssue: null,
    engagementCount: null,
    addedAt: '2025-01-17T10:00:00Z',
  },
];

function setupMocks(opts?: {
  segment?: Partial<Segment> | null;
  segmentError?: string;
  members?: SegmentMember[];
  nextToken?: string;
}) {
  const seg = opts?.segment === null
    ? null
    : { ...mockSegment, ...(opts?.segment || {}) };

  if (opts?.segmentError) {
    vi.mocked(segmentService.getSegment).mockResolvedValue({
      success: false,
      error: opts.segmentError,
    });
  } else if (seg === null) {
    vi.mocked(segmentService.getSegment).mockResolvedValue({
      success: false,
      error: '404 Not Found',
    });
  } else {
    vi.mocked(segmentService.getSegment).mockResolvedValue({
      success: true,
      data: seg as Segment,
    });
  }

  const members = opts?.members ?? mockMembers;
  const count = seg ? seg.memberCount ?? members.length : members.length;

  vi.mocked(segmentService.listMembers).mockResolvedValue({
    success: true,
    data: {
      members,
      nextToken: opts?.nextToken,
      totalCount: count,
    },
  });
}

describe('SegmentDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders segment detail with member table', async () => {
    setupMocks();
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
    expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    expect(screen.getByText('Top engaged readers')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows Load More when nextToken exists', async () => {
    setupMocks({ nextToken: 'abc123' });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Load More')).toBeInTheDocument();
    });
  });

  it('loads more members on Load More click', async () => {
    setupMocks({ nextToken: 'page2' });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Load More')).toBeInTheDocument();
    });
    vi.mocked(segmentService.listMembers).mockResolvedValueOnce({
      success: true,
      data: {
        members: [{
          email: 'charlie@example.com',
          lastEngagedIssue: 5,
          engagementCount: 3,
          addedAt: '2025-01-18T10:00:00Z',
        }],
        nextToken: undefined,
        totalCount: 3,
      },
    });
    fireEvent.click(screen.getByText('Load More'));
    await waitFor(() => {
      expect(screen.getByText('charlie@example.com')).toBeInTheDocument();
    });
  });

  it('shows empty state when no members', async () => {
    setupMocks({ members: [], segment: { memberCount: 0 } });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByText(
          'No subscribers have been added to this segment yet.'
        )
      ).toBeInTheDocument();
    });
  });

  it('adds members and shows result counts', async () => {
    setupMocks();
    vi.mocked(segmentService.addMembers).mockResolvedValue({
      success: true,
      data: { added: 2, skipped: 1, skippedEmails: ['bad@example.com'] },
    });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Add'));
    const textarea = screen.getByPlaceholderText(/Paste emails/);
    fireEvent.change(textarea, {
      target: { value: 'a@example.com, b@example.com, bad@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Members' }));
    await waitFor(() => {
      expect(segmentService.addMembers).toHaveBeenCalledWith('seg-1', [
        'a@example.com',
        'b@example.com',
        'bad@example.com',
      ]);
    });
    await waitFor(() => {
      expect(screen.getByText('2 added, 1 skipped')).toBeInTheDocument();
    });
  });

  it('selects and removes members', async () => {
    setupMocks();
    vi.mocked(segmentService.removeMembers).mockResolvedValue({
      success: true,
      data: { removed: 1 },
    });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Select alice@example.com'));
    await waitFor(() => {
      expect(screen.getByText(/Remove Selected/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Remove Selected/));
    await waitFor(() => {
      expect(segmentService.removeMembers).toHaveBeenCalledWith(
        'seg-1',
        ['alice@example.com']
      );
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          title: 'Members Removed',
        })
      );
    });
  });

  it('handles synchronous export with s3Key', async () => {
    setupMocks();
    vi.mocked(segmentService.exportSegment).mockResolvedValue({
      success: true,
      data: { s3Key: 'reports/segment-export-123.json' },
    });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Export'));
    await waitFor(() => {
      expect(
        screen.getByText('reports/segment-export-123.json')
      ).toBeInTheDocument();
    });
  });

  it('handles async export with job polling', async () => {
    setupMocks();
    vi.mocked(segmentService.exportSegment).mockResolvedValue({
      success: true,
      data: { jobId: 'job-1' },
    });
    vi.mocked(segmentService.getJobStatus).mockResolvedValue({
      success: true,
      data: {
        jobId: 'job-1',
        status: 'completed',
        s3Key: 'reports/async-export.json',
      },
    });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Export'));
    await waitFor(
      () => {
        expect(
          screen.getByText('reports/async-export.json')
        ).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('shows not found when segment does not exist', async () => {
    setupMocks({ segmentError: '404 Not Found' });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Segment not found')).toBeInTheDocument();
    });
  });

  it('shows error state with retry on generic error', async () => {
    vi.mocked(segmentService.getSegment).mockResolvedValue({
      success: false,
      error: 'Internal server error',
    });
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('toggles select all checkbox', async () => {
    setupMocks();
    render(<SegmentDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Select all members'));
    await waitFor(() => {
      expect(
        screen.getByText(/Remove Selected \(2\)/)
      ).toBeInTheDocument();
    });
  });
});
