import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SegmentListPage } from '../SegmentListPage';
import { segmentService } from '@/services/segmentService';
import type { Segment } from '@/services/segmentService';

// Mock segmentService
vi.mock('@/services/segmentService', () => ({
  segmentService: {
    listSegments: vi.fn(),
    createSegment: vi.fn(),
    deleteSegment: vi.fn(),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/segments' }),
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

// Mock Toast context
const mockAddToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

// Mock AppHeader
vi.mock('@/components/layout/AppHeader', () => ({
  AppHeader: () => <div data-testid="app-header">AppHeader</div>,
}));

const mockSegments: Segment[] = [
  {
    segmentId: 'seg-1',
    name: 'VIP Subscribers',
    description: 'Top engaged readers',
    memberCount: 42,
    createdAt: '2025-01-15T10:00:00Z',
  },
  {
    segmentId: 'seg-2',
    name: 'Dormant Users',
    memberCount: 0,
    createdAt: '2025-01-10T10:00:00Z',
  },
];

describe('SegmentListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    vi.mocked(segmentService.listSegments).mockReturnValue(
      new Promise(() => {})
    );
    render(<SegmentListPage />);
    expect(screen.getByText('Loading segments...')).toBeInTheDocument();
  });

  it('renders segments with name, description, member count', async () => {
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
    expect(screen.getByText('Top engaged readers')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Dormant Users')).toBeInTheDocument();
  });

  it('renders empty state when no segments exist', async () => {
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: [] },
    });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('No segments yet')).toBeInTheDocument();
    });
  });

  it('renders error state with retry button', async () => {
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: false,
      error: 'Network error',
    });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load segments')).toBeInTheDocument();
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('retries loading on Try Again click', async () => {
    vi.mocked(segmentService.listSegments)
      .mockResolvedValueOnce({ success: false, error: 'Network error' })
      .mockResolvedValueOnce({
        success: true,
        data: { segments: mockSegments },
      });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Try Again'));
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
  });

  it('opens create modal and submits successfully', async () => {
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: [] },
    });
    const newSegment: Segment = {
      segmentId: 'seg-new',
      name: 'New Segment',
      description: 'A description',
      memberCount: 0,
      createdAt: '2025-01-20T10:00:00Z',
    };
    vi.mocked(segmentService.createSegment).mockResolvedValue({
      success: true,
      data: newSegment,
    });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('No segments yet')).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText('Create Segment')[0]);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'New Segment' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'A description' },
    });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => {
      expect(segmentService.createSegment).toHaveBeenCalledWith({
        name: 'New Segment',
        description: 'A description',
      });
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success' })
      );
    });
  });

  it('shows conflict error inline on 409', async () => {
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });
    vi.mocked(segmentService.createSegment).mockResolvedValue({
      success: false,
      error: '409 Conflict',
    });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Create Segment'));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'VIP Subscribers' },
    });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => {
      expect(
        screen.getByText('A segment with this name already exists')
      ).toBeInTheDocument();
    });
  });

  it('shows delete confirmation and deletes on confirm', async () => {
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });
    vi.mocked(segmentService.deleteSegment).mockResolvedValue({
      success: true,
      data: undefined,
    });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
    const deleteButtons = screen.getAllByLabelText(/Delete segment/);
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Delete Segment')).toBeInTheDocument();
      expect(
        screen.getByText(/Are you sure you want to delete/)
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(segmentService.deleteSegment).toHaveBeenCalledWith('seg-1');
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', title: 'Segment Deleted' })
      );
    });
  });

  it('cancels delete confirmation dialog', async () => {
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
    const deleteButtons = screen.getAllByLabelText(/Delete segment/);
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Delete Segment')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(
        screen.queryByText(/Are you sure you want to delete/)
      ).not.toBeInTheDocument();
    });
  });

  it('navigates to segment detail on name click', async () => {
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });
    render(<SegmentListPage />);
    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });
    const viewButtons = screen.getAllByLabelText(
      'View segment: VIP Subscribers'
    );
    fireEvent.click(viewButtons[0]);
    expect(mockNavigate).toHaveBeenCalledWith('/segments/seg-1');
  });
});
