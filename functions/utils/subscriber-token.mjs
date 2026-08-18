import { encrypt, decrypt } from './helpers.mjs';

/**
 * Tokens that identify a subscriber to the self-service endpoints they reach
 * from an email: the unsubscribe link, the RFC 8058 one-click header, and the
 * preference centre.
 *
 * These tokens used to be `encrypt(email)` — the address and nothing else —
 * while the tenant came independently from the URL path. Nothing tied the two
 * together, so a token minted for `person@example.com` under tenant A could be
 * replayed as `/{tenantB}/unsubscribe?email=<tokenA>` and applied to tenant B.
 * Because an unsubscribe records a suppression even when no subscriber exists,
 * that replay could also plant a suppression under a tenant the holder was
 * never on. A v2 token carries the tenant inside the encrypted payload, so the
 * path can be checked against it.
 *
 * One purpose value covers every link rather than separating unsubscribe from
 * preferences: both hrefs in the newsletter template are filled from the single
 * `__EMAIL_HASH__` marker, and tenants may have custom templates embedding that
 * same marker, so splitting it into two markers would quietly break their
 * footers. The field is kept so the token is self-describing and a later split
 * is a decode-side change only. The security property the tenant binding
 * provides is unaffected either way.
 */

const TOKEN_VERSION = 2;
const TOKEN_PURPOSE = 'subscriber-link';

/**
 * Mint a tenant-bound token for one subscriber.
 * @param {string} tenantId
 * @param {string} email
 * @returns {string} Encrypted token; percent-encode before putting it in a URL.
 */
export const mintSubscriberToken = (tenantId, email) =>
  encrypt(JSON.stringify({
    v: TOKEN_VERSION,
    purpose: TOKEN_PURPOSE,
    tenantId,
    email
  }));

/**
 * Decode a token and check it was minted for this tenant.
 *
 * Legacy tokens (a bare encrypted address) are accepted, because they are
 * sitting in every email already delivered and those unsubscribe links have to
 * keep working — an unhonoured unsubscribe is a worse outcome than an
 * unverifiable one. They cannot be tenant-checked by construction, so they are
 * flagged `legacy: true` for the caller to log; once the mail carrying them has
 * aged out, refusing them becomes a one-line change here.
 *
 * @param {string} token - Encrypted token from the query string
 * @param {string} tenantId - Tenant from the request path
 * @returns {{email: string, legacy: boolean}}
 * @throws {Error} When the token cannot be decrypted, is malformed, or was
 *   minted for a different tenant.
 */
export const readSubscriberToken = (token, tenantId) => {
  const decrypted = decrypt(token);

  let payload;
  try {
    payload = JSON.parse(decrypted);
  } catch {
    // Not JSON: a v1 token, which is a bare email address.
    return { email: decrypted, legacy: true };
  }

  if (!payload || typeof payload !== 'object' || payload.v !== TOKEN_VERSION) {
    throw new Error('Unrecognized subscriber token payload');
  }

  if (payload.purpose !== TOKEN_PURPOSE) {
    throw new Error(`Subscriber token has the wrong purpose: ${payload.purpose}`);
  }

  if (!payload.email || typeof payload.email !== 'string') {
    throw new Error('Subscriber token carries no email address');
  }

  if (payload.tenantId !== tenantId) {
    // The replay this version exists to stop.
    throw new Error('Subscriber token was minted for a different tenant');
  }

  return { email: payload.email, legacy: false };
};
