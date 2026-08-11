/**
 * Regression tests for how the API client handles a 401.
 *
 * The case that matters is a token the server rejects while it still looks
 * current locally — revoked, or belonging to a disabled user. `getFreshIdToken()`
 * renews on local expiry, so asking it for a token again just hands back the
 * one that was rejected. Left there, the app stays authenticated on a protected
 * route whose every request 401s: the redirect loop, one layer down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFreshIdToken: vi.fn(async () => 'stored-token' as string | null),
  signOut: vi.fn(async () => {}),
  forceRefreshIdToken: vi.fn(async () => 'renewed-token' as string | null)
}));

vi.mock('@readysetcloud/ui/auth', () => ({
  getFreshIdToken: () => mocks.getFreshIdToken(),
  signOut: () => mocks.signOut()
}));

vi.mock('../session', () => ({
  forceRefreshIdToken: () => mocks.forceRefreshIdToken()
}));

const json = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body
});

const authHeaders = (call: number): Record<string, string> =>
  (vi.mocked(global.fetch).mock.calls[call]![1] as RequestInit).headers as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFreshIdToken.mockResolvedValue('stored-token');
  mocks.forceRefreshIdToken.mockResolvedValue('renewed-token');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApiClient 401 handling', () => {
  it('forces a new token and retries once when the credential is rejected', async () => {
    const { apiClient } = await import('../api');
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    // The stored token still looks current — this is the revoked-token case,
    // where getFreshIdToken keeps handing back the rejected token until
    // something forces a renewal. A real forced refresh writes the new token
    // to storage, so every later read sees it.
    mocks.getFreshIdToken.mockResolvedValue('stored-token');
    mocks.forceRefreshIdToken.mockImplementation(async () => {
      mocks.getFreshIdToken.mockResolvedValue('renewed-token');
      return 'renewed-token';
    });

    const result = await apiClient.get('/me');

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(authHeaders(0).Authorization).toBe('Bearer stored-token');
    expect(authHeaders(1).Authorization).toBe('Bearer renewed-token');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('signs out when the renewed token is rejected too', async () => {
    const { apiClient } = await import('../api');
    global.fetch = vi.fn().mockResolvedValue(json(401, { message: 'Unauthorized' }));

    const result = await apiClient.get('/me');

    expect(result.success).toBe(false);
    // Exactly one retry — never a loop.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.forceRefreshIdToken).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('signs out without retrying when the token cannot be renewed', async () => {
    const { apiClient } = await import('../api');
    global.fetch = vi.fn().mockResolvedValue(json(401, { message: 'Unauthorized' }));
    mocks.forceRefreshIdToken.mockResolvedValue(null);

    const result = await apiClient.get('/me');

    expect(result.success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('leaves the session alone on a non-401 failure', async () => {
    const { apiClient } = await import('../api');
    global.fetch = vi.fn().mockResolvedValue(json(403, { message: 'Nope' }));

    const result = await apiClient.get('/me');

    expect(result.success).toBe(false);
    expect(mocks.forceRefreshIdToken).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
