import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { unsubscribeUser } from "../utils/subscriber.mjs";
import { getTenant } from "../utils/helpers.mjs";
import { readSubscriberToken } from "../utils/subscriber-token.mjs";
import { getMostRecentPublishedIssue, incrementIssueCounter } from "../utils/issue-attribution.mjs";
import { htmlResponse, getUnsubscribePage } from "./unsubscribe-pages.mjs";

const eventBridge = new EventBridgeClient();

/**
 * POST /{tenant}/unsubscribe — the one place a subscriber is actually removed.
 *
 * Three callers land here, distinguished by what they carry:
 *
 *  1. RFC 8058 one-click: the mail provider POSTs `List-Unsubscribe=One-Click`
 *     to the URL from the List-Unsubscribe header, encrypted token in the
 *     query string. No human confirmation is allowed by the RFC — and none is
 *     needed, because link scanners GET and never POST.
 *  2. The confirmation form the GET handler renders for the footer link: same
 *     token in the query string, `confirmed=true` in the body, and the person
 *     expects an HTML page back, not JSON.
 *  3. The legacy manual form (typed email address, JSON body). Kept as-is: it
 *     is the escape hatch when a link is dead, and old error pages in the wild
 *     still post it.
 *
 * The token paths count toward `unsubscribes` — they are the subscriber acting
 * on their own mail. The typed-address form stays under `manualRemovals`, as
 * before, since anyone can type any address into it.
 */
export const handler = async (event) => {
  const tenantId = event.pathParameters?.tenant;

  if (!tenantId) {
    return jsonResponse(400, 'Missing tenant parameter');
  }

  // A token in the query string marks the request as coming from an email we
  // sent — the one-click header or the footer link's confirmation form. Its
  // absence marks the legacy typed-address form.
  const token = event.queryStringParameters?.email;
  if (token) {
    return await handleTokenUnsubscribe(event, tenantId, token);
  }

  return await handleManualFormUnsubscribe(event, tenantId);
};

const handleTokenUnsubscribe = async (event, tenantId, token) => {
  const params = parseFormBody(event);
  const isOneClick = params.get('List-Unsubscribe') === 'One-Click';
  const isConfirmation = params.get('confirmed') === 'true';
  // A browser gets HTML, a mail provider gets JSON.
  const wantsHtml = !isOneClick;

  // Only the two documented intents remove anyone. Treating every
  // token-bearing POST as an unsubscribe made the boundary wider than the
  // flow: an empty or arbitrary body would have fallen through as a real
  // removal.
  if (!isOneClick && !isConfirmation) {
    // No legitimate caller reaches here: our own confirmation page always sends
    // `confirmed=true`, and a provider always sends the RFC's key/value.
    console.warn('Rejecting token POST with no recognized unsubscribe intent', { tenantId });
    return jsonResponse(400, 'Missing unsubscribe confirmation');
  }

  let emailAddress;
  try {
    // Verifies the token was minted for this tenant. Without that check a
    // token for tenant A could be replayed at tenant B's endpoint and both
    // unsubscribe and suppress the address there.
    const { email, legacy } = readSubscriberToken(token, tenantId);
    emailAddress = email;
    if (legacy) {
      console.log('Unsubscribe used a legacy (pre-tenant-binding) token', { tenantId, isOneClick });
    }
  } catch (decryptErr) {
    console.error('Unsubscribe token rejected:', {
      tenantId,
      isOneClick,
      error: decryptErr.message
    });
    await notifyAdminSafely(tenantId, null, isOneClick ? 'one-click' : 'encrypted-link', { error: decryptErr.message });

    return wantsHtml
      ? htmlResponse(await getUnsubscribePage(tenantId, false, ''))
      : jsonResponse(400, 'Invalid or expired unsubscribe link');
  }

  const metadata = extractRequestMetadata(event);
  const method = isOneClick ? 'one-click' : 'encrypted-link';
  const result = await unsubscribeUser(tenantId, emailAddress, method, metadata);

  if (result.actuallyRemoved) {
    await attributeUnsubscribe(tenantId, 'unsubscribes');
  } else if (!result.success) {
    await notifyAdminSafely(tenantId, emailAddress, method, metadata);
  }

  // `success: false` still renders the failure page (which carries the manual
  // form) for humans; one-click gets the honest status code so the provider
  // can retry.
  if (wantsHtml) {
    return htmlResponse(await getUnsubscribePage(tenantId, result.success, emailAddress));
  }

  return result.success
    ? jsonResponse(200, 'Successfully unsubscribed')
    : jsonResponse(500, 'Unsubscribe failed');
};

const handleManualFormUnsubscribe = async (event, tenantId) => {
  let tenant;
  let emailAddress;

  try {
    try {
      tenant = await getTenant(tenantId);
    } catch (err) {
      console.error('Tenant not found:', { tenantId, error: err.message });
      return jsonResponse(404, 'Tenant not found');
    }

    const body = JSON.parse(decodeBody(event) || '{}');
    emailAddress = body.email;

    if (!emailAddress) {
      return jsonResponse(400, 'Missing email parameter');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailAddress)) {
      return jsonResponse(400, 'Invalid email format');
    }

    const metadata = extractRequestMetadata(event);
    const result = await unsubscribeUser(tenantId, emailAddress, 'manual-form', metadata);

    if (result.actuallyRemoved) {
      await attributeUnsubscribe(tenantId, 'manualRemovals');
    } else if (!result.success) {
      await notifyAdminOfFailure(tenant, emailAddress, 'manual-form', metadata);
    }

    return jsonResponse(200, 'Successfully unsubscribed');
  } catch (err) {
    console.error('Manual unsubscribe error:', err);

    if (tenant && emailAddress) {
      try {
        await notifyAdminOfFailure(tenant, emailAddress, 'manual-form', { error: err.message });
      } catch (notifyErr) {
        console.error('Failed to notify admin of unsubscribe failure:', notifyErr);
      }
    }

    // Privacy-preserving: the form must not reveal whether an address exists.
    return jsonResponse(200, 'Successfully unsubscribed');
  }
};

const decodeBody = (event) => {
  if (!event.body) {
    return '';
  }
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
};

/**
 * Read the POST body as form fields.
 *
 * RFC 8058 says the one-click POST SHOULD be `multipart/form-data` and MAY be
 * `application/x-www-form-urlencoded`, so multipart is the form to expect from
 * a conforming provider — a urlencoded-only parser would miss the common case
 * and silently reject real unsubscribes. Browsers posting the confirmation
 * form send urlencoded. Both are handled; the body is small and fixed-shape
 * (one key/value), so multipart is picked apart directly rather than pulling
 * in a parser.
 */
const parseFormBody = (event) => {
  const body = decodeBody(event);
  if (!body) {
    return new URLSearchParams();
  }

  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const params = new URLSearchParams();
    // Each part is `...name="field"\r\n\r\n<value>` up to the next boundary.
    const partPattern = /name="([^"]+)"[^]*?\r?\n\r?\n([^]*?)(?=\r?\n--)/g;
    let match;
    while ((match = partPattern.exec(body)) !== null) {
      params.append(match[1], match[2].trim());
    }
    return params;
  }

  try {
    return new URLSearchParams(body);
  } catch {
    return new URLSearchParams();
  }
};

const extractRequestMetadata = (event) => ({
  ipAddress: event.requestContext?.identity?.sourceIp ||
    event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
    'unknown',
  userAgent: event.headers?.['User-Agent'] || event.headers?.['user-agent'] || 'unknown'
});

const attributeUnsubscribe = async (tenantId, counterName) => {
  try {
    const recentIssue = await getMostRecentPublishedIssue(tenantId);
    if (recentIssue) {
      await incrementIssueCounter(recentIssue.pk, counterName);
    } else {
      console.warn('No published issue found for unsubscribe attribution:', { tenantId });
    }
  } catch (attrErr) {
    console.warn('Failed to increment unsubscribe counter:', { tenantId, error: attrErr.message });
  }
};

const jsonResponse = (statusCode, message) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message })
});

const notifyAdminSafely = async (tenantId, emailAddress, method, metadata) => {
  try {
    const tenant = await getTenant(tenantId);
    await notifyAdminOfFailure(tenant, emailAddress, method, metadata);
  } catch (err) {
    console.error('Failed to notify admin of unsubscribe failure:', err);
  }
};

const notifyAdminOfFailure = async (tenant, emailAddress, method, metadata = {}) => {
  try {
    if (!tenant?.createdBy) {
      console.error('No admin email found for tenant:', { tenantId: tenant?.pk });
      return;
    }

    const subject = `[Alert] Unsubscribe Request Failed - ${tenant.name || tenant.brandName || tenant.pk}`;
    const html = `
      <h2>Unsubscribe Request Failed</h2>
      <p>An unsubscribe request could not be processed for your newsletter.</p>

      <h3>Details:</h3>
      <ul>
        <li><strong>Email:</strong> ${emailAddress || 'could not be determined'}</li>
        <li><strong>Method:</strong> ${method}</li>
        <li><strong>Time:</strong> ${new Date().toISOString()}</li>
        ${metadata.error ? `<li><strong>Error:</strong> ${metadata.error}</li>` : ''}
        ${metadata.ipAddress ? `<li><strong>IP Address:</strong> ${metadata.ipAddress}</li>` : ''}
        ${metadata.userAgent ? `<li><strong>User Agent:</strong> ${metadata.userAgent}</li>` : ''}
      </ul>

      <p>The user was shown a success message for privacy and UX reasons, but the unsubscribe did not complete successfully.</p>
      <p>Please manually verify and remove this email address from your contact list if needed.</p>
    `;

    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'newsletter-service',
        DetailType: 'Send Email v2',
        Detail: JSON.stringify({
          tenantId: tenant.pk,
          to: { email: tenant.createdBy },
          subject,
          html
        })
      }]
    }));

    console.log('Admin notified of unsubscribe failure:', { tenantId: tenant.pk, adminEmail: tenant.createdBy });
  } catch (err) {
    console.error('Failed to notify admin:', err);
    throw err;
  }
};
