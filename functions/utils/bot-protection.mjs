/**
 * Bot Protection Utility
 *
 * Core detection and policy logic for the bot signup protection pipeline.
 * Pure functions where possible for testability.
 */

import domainsList from '../data/disposable-domains.json' with { type: 'json' };

export const disposableDomainSet = new Set(domainsList);

/**
 * Extract request metadata (IP + User-Agent) from the Lambda event.
 * @param {object} event - API Gateway Lambda proxy event
 * @returns {{ sourceIp: string, userAgent: string, unknownIp: boolean }}
 */
export function extractRequestMetadata(event) {
  let sourceIp = event?.requestContext?.identity?.sourceIp || null;

  if (!sourceIp) {
    const headers = event?.headers || {};
    const forwarded = headers['X-Forwarded-For'] || headers['x-forwarded-for'];
    if (forwarded) {
      sourceIp = forwarded.split(',')[0].trim();
    }
  }

  if (!sourceIp) {
    sourceIp = 'unknown';
  }

  const headers = event?.headers || {};
  const userAgent = headers['User-Agent'] || headers['user-agent'] || 'unknown';

  return {
    sourceIp,
    userAgent,
    unknownIp: sourceIp === 'unknown'
  };
}

/**
 * Validate email format against a standard pattern.
 * Requires exactly one @, non-empty local part, domain with at least one dot
 * and non-empty labels.
 * @param {string} email - Raw email string
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;

  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return false;
  if (email.indexOf('@', atIndex + 1) !== -1) return false;

  const localPart = email.substring(0, atIndex);
  const domainPart = email.substring(atIndex + 1);

  if (!localPart || !domainPart) return false;
  if (!domainPart.includes('.')) return false;

  const labels = domainPart.split('.');
  if (labels.some(label => label.length === 0)) return false;

  return true;
}

/**
 * Normalize email: lowercase only.
 * Gmail dot-trick and plus-addressing are out of scope.
 * @param {string} email - Raw email string
 * @returns {string}
 */
export function normalizeEmail(email) {
  return email.toLowerCase();
}

/**
 * Evaluate the honeypot field.
 * @param {string|undefined} websiteField - Value of the `website` body field
 * @returns {boolean} true if honeypot triggered
 */
export function evaluateHoneypot(websiteField) {
  return typeof websiteField === 'string' && websiteField.length > 0;
}

/**
 * Check if the email domain is in the disposable domain list.
 * @param {string} normalizedEmail - Lowercase email
 * @param {Set<string>} disposableDomains - Loaded domain set
 * @returns {boolean}
 */
export function isDisposableDomain(normalizedEmail, disposableDomains) {
  const atIndex = normalizedEmail.indexOf('@');
  if (atIndex === -1) return false;
  const domain = normalizedEmail.substring(atIndex + 1);
  return disposableDomains.has(domain);
}

/**
 * Evaluate User-Agent against suspicious patterns.
 * @param {string} userAgent - UA string
 * @param {string[]} patterns - Suspicious patterns (lowercase)
 * @returns {boolean}
 */
export function isSuspiciousUserAgent(userAgent, patterns) {
  if (userAgent === 'unknown') return true;
  const lowerUa = userAgent.toLowerCase();
  return patterns.some(pattern => lowerUa.includes(pattern));
}

/**
 * Validate and sanitize the elapsedMs field.
 * @param {*} elapsedMs - Raw value from request body
 * @returns {number|null} Sanitized value or null if invalid/absent
 */
export function sanitizeElapsedMs(elapsedMs) {
  if (elapsedMs === null || elapsedMs === undefined) return null;
  if (typeof elapsedMs !== 'number') return null;
  if (!Number.isInteger(elapsedMs)) return null;
  if (elapsedMs < 0 || elapsedMs > 86400000) return null;
  return elapsedMs;
}

/**
 * Derive the fastSubmission flag from sanitized elapsedMs.
 * @param {number|null} elapsedMs - Sanitized value from sanitizeElapsedMs()
 * @returns {boolean} true if elapsedMs is non-null and < 1500
 */
export function isFastSubmission(elapsedMs) {
  return elapsedMs !== null && elapsedMs < 1500;
}

/** Domains where dots in the local part are ignored (aliases). */
const DOT_ALIAS_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Detect suspicious email patterns — currently flags Gmail-style dot-trick
 * abuse where the local part has 3+ dots (e.g. "j.o.h.n@gmail.com").
 * @param {string} normalizedEmail - Lowercase email
 * @returns {boolean}
 */
export function isSuspiciousEmailPattern(normalizedEmail) {
  const atIndex = normalizedEmail.indexOf('@');
  if (atIndex === -1) return false;
  const localPart = normalizedEmail.substring(0, atIndex);
  const domain = normalizedEmail.substring(atIndex + 1);
  if (!DOT_ALIAS_DOMAINS.has(domain)) return false;
  const dotCount = (localPart.match(/\./g) || []).length;
  return dotCount >= 3;
}

/**
 * Build the Detection_Flags object.
 * @param {boolean} honeypot
 * @param {boolean} disposable
 * @param {boolean} suspiciousUa
 * @param {boolean} unknownIp
 * @param {boolean} fastSubmission
 * @param {boolean} [suspiciousEmailPattern=false]
 * @returns {object}
 */
export function buildDetectionFlags(honeypot, disposable, suspiciousUa, unknownIp, fastSubmission, suspiciousEmailPattern = false) {
  return {
    honeypotTriggered: honeypot,
    disposableDomain: disposable,
    suspiciousUserAgent: suspiciousUa,
    unknownIp,
    fastSubmission,
    suspiciousEmailPattern
  };
}


/**
 * Resolve effective tenant policy by merging tenant overrides with global defaults.
 * Validates override values and falls back to defaults for invalid ones.
 * @param {object} tenant - Tenant DynamoDB record
 * @param {object} globalDefaults - Environment-variable-based defaults
 * @param {Function} logInvalidOverride - Callback to log invalid overrides: (fieldName, invalidValue) => void
 * @returns {{ honeypotAction: string, disposableDomainAction: string, rateLimitThreshold: number, rateLimitWindowSeconds: number }}
 */
export function resolvePolicy(tenant, globalDefaults, logInvalidOverride) {
  const validActions = ['block', 'flag'];

  let honeypotAction = globalDefaults.honeypotAction;
  if (tenant.honeypotAction !== undefined && tenant.honeypotAction !== null) {
    if (validActions.includes(tenant.honeypotAction)) {
      honeypotAction = tenant.honeypotAction;
    } else {
      logInvalidOverride('honeypotAction', tenant.honeypotAction);
    }
  }

  let disposableDomainAction = globalDefaults.disposableDomainAction;
  if (tenant.disposableDomainAction !== undefined && tenant.disposableDomainAction !== null) {
    if (validActions.includes(tenant.disposableDomainAction)) {
      disposableDomainAction = tenant.disposableDomainAction;
    } else {
      logInvalidOverride('disposableDomainAction', tenant.disposableDomainAction);
    }
  }

  let rateLimitThreshold = globalDefaults.rateLimitThreshold;
  if (tenant.rateLimitThreshold !== undefined && tenant.rateLimitThreshold !== null) {
    const val = tenant.rateLimitThreshold;
    if (typeof val === 'number' && Number.isInteger(val) && val >= 1 && val <= 1000) {
      rateLimitThreshold = val;
    } else {
      logInvalidOverride('rateLimitThreshold', val);
    }
  }

  let rateLimitWindowSeconds = globalDefaults.rateLimitWindowSeconds;
  if (tenant.rateLimitWindowSeconds !== undefined && tenant.rateLimitWindowSeconds !== null) {
    const val = tenant.rateLimitWindowSeconds;
    if (typeof val === 'number' && Number.isInteger(val) && val >= 60 && val <= 86400) {
      rateLimitWindowSeconds = val;
    } else {
      logInvalidOverride('rateLimitWindowSeconds', val);
    }
  }

  return { honeypotAction, disposableDomainAction, rateLimitThreshold, rateLimitWindowSeconds };
}

/**
 * Given detection flags and resolved policy, decide the action.
 * Only honeypotTriggered and disposableDomain influence blocking.
 * Rejection reason order: honeypot before disposable domain.
 * @param {object} flags - { honeypotTriggered, disposableDomain, suspiciousUserAgent, unknownIp, fastSubmission }
 * @param {object} policy - Resolved policy from resolvePolicy()
 * @returns {{ blocked: boolean, rejectionReason: string|null }}
 */
export function evaluatePolicy(flags, policy) {
  if (flags.honeypotTriggered && policy.honeypotAction === 'block') {
    return { blocked: true, rejectionReason: 'honeypot' };
  }
  if (flags.disposableDomain && policy.disposableDomainAction === 'block') {
    return { blocked: true, rejectionReason: 'disposable_domain' };
  }
  return { blocked: false, rejectionReason: null };
}

/**
 * Emit a Canonical_Log_Entry for bot protection events.
 * @param {import('./structured-logger.mjs').StructuredLogger} logger
 * @param {string} eventType - "signup.blocked" | "signup.flagged" | "signup.duplicate_abuse" | "config.invalid_override"
 * @param {object} data - Fields per the Canonical_Log_Entry schema
 */
export function emitBotProtectionLog(logger, eventType, data) {
  const entry = {
    eventType,
    tenantId: data.tenantId,
    normalizedEmail: data.normalizedEmail,
    sourceIp: data.sourceIp,
    userAgent: data.userAgent,
    detectionFlags: data.detectionFlags,
    timestamp: new Date().toISOString()
  };

  if (eventType === 'signup.blocked' && data.rejectionReason) {
    entry.rejectionReason = data.rejectionReason;
  }

  if (data.requestCountInWindow !== undefined && data.requestCountInWindow !== null) {
    entry.requestCountInWindow = data.requestCountInWindow;
  }

  if (data.elapsedMs !== undefined && data.elapsedMs !== null) {
    entry.elapsedMs = data.elapsedMs;
  }

  logger.info(`Bot protection: ${eventType}`, entry);
}
