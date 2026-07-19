import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriberService } from '../subscriberService';
import type { SubscriberDetail } from '@/types';

vi.mock('../api', () => ({
  apiClient: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

const detail: SubscriberDetail = {
  email: 'reader@example.com',
  addedAt: '2025-01-01T00:00:00Z',
  lastEngagedIssue: 19,
  recentActivity: [{ type: 'open', issue: 41, ts: '2026-01-01T00:00:00Z' }],
  openHourTotal: 3,
};

describe('SubscriberService detail caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches subscriber detail from the API on a cold cache', async () => {
    const { apiClient } = await import('../api');
    vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: detail });

    const service = new SubscriberService();
    const res = await service.getSubscriber('reader@example.com');

    expect(res).toEqual({ success: true, data: detail });
    expect(apiClient.get).toHaveBeenCalledWith('/subscribers/reader%40example.com');
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('serves a second read from cache without hitting the API again', async () => {
    const { apiClient } = await import('../api');
    vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: detail });

    const service = new SubscriberService();
    await service.getSubscriber('reader@example.com');
    const second = await service.getSubscriber('reader@example.com');

    expect(second).toEqual({ success: true, data: detail });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('coalesces a prefetch and an immediate open into a single request', async () => {
    const { apiClient } = await import('../api');
    let resolveGet: (v: { success: true; data: SubscriberDetail }) => void = () => {};
    vi.mocked(apiClient.get).mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      })
    );

    const service = new SubscriberService();
    service.prefetchSubscriber('reader@example.com'); // warms the cache, in flight
    const openPromise = service.getSubscriber('reader@example.com'); // should reuse it

    resolveGet({ success: true, data: detail });
    await openPromise;

    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed response, so a later open retries', async () => {
    const { apiClient } = await import('../api');
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ success: false, error: 'boom' })
      .mockResolvedValueOnce({ success: true, data: detail });

    const service = new SubscriberService();
    const first = await service.getSubscriber('reader@example.com');
    const second = await service.getSubscriber('reader@example.com');

    expect(first.success).toBe(false);
    expect(second).toEqual({ success: true, data: detail });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('evicts cached detail on unsubscribe', async () => {
    const { apiClient } = await import('../api');
    vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: detail });
    vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

    const service = new SubscriberService();
    await service.getSubscriber('reader@example.com'); // cache it
    await service.unsubscribe('reader@example.com'); // should evict
    await service.getSubscriber('reader@example.com'); // cold again

    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});
