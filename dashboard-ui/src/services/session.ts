import { AUTH_KEY, getFreshIdToken, readSession } from '@readysetcloud/ui/auth';

/**
 * Renew the id token even when the stored one still looks current.
 *
 * `getFreshIdToken()` short-circuits on `expiresAt` and returns the stored
 * token untouched, which is the right call for ordinary requests but useless
 * for the two cases that need a genuinely new token: claims that changed
 * server-side (a tenant id written during onboarding), and a credential the
 * API rejected while it still looks valid locally. Marking the session expired
 * first is the only lever the package exposes. Drop this the day
 * @readysetcloud/ui grows a first-class `forceRefresh`.
 *
 * Concurrent callers share one refresh — a page that fires several requests at
 * once should not send several REFRESH_TOKEN_AUTH calls.
 */
let inFlight: Promise<string | null> | null = null;

export function forceRefreshIdToken(): Promise<string | null> {
  inFlight ??= runForcedRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runForcedRefresh(): Promise<string | null> {
  const session = readSession();
  // Nothing to refresh with: the caller has to treat this as signed out.
  if (!session?.refreshToken) return null;

  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ...session, expiresAt: 0 }));
  } catch {
    // Storage is blocked, so the expiry can't be forced and getFreshIdToken
    // would just hand back the same token. Say so rather than pretend.
    return null;
  }

  return getFreshIdToken();
}
