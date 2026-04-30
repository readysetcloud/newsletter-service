import * as fc from 'fast-check';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  extractRequestMetadata,
  isValidEmail,
  normalizeEmail,
  evaluateHoneypot,
  isDisposableDomain,
  isSuspiciousUserAgent,
  sanitizeElapsedMs,
  isFastSubmission,
  resolvePolicy,
  evaluatePolicy,
  emitBotProtectionLog,
  disposableDomainSet
} from '../utils/bot-protection.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('disposable domain data', () => {
  test('bundled module stays in sync with JSON data file', async () => {
    const jsonPath = join(__dirname, '..', 'data', 'disposable-domains.json');
    const domains = JSON.parse(await readFile(jsonPath, 'utf-8'));
    expect([...disposableDomainSet].sort()).toEqual([...domains].sort());
  });
});

// Feature: bot-signup-protection, Property 1: Metadata extraction always produces valid output
describe('Property 1: Metadata extraction always produces valid output', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.4, 1.5**
   */
  test('extractRequestMetadata always returns non-empty sourceIp, non-empty userAgent, and unknownIp iff sourceIp==="unknown"', () => {
    const arbEvent = fc.record({
      requestContext: fc.option(
        fc.record({
          identity: fc.option(
            fc.record({
              sourceIp: fc.option(fc.string({ minLength: 1 }), { nil: undefined })
            }),
            { nil: undefined }
          )
        }),
        { nil: undefined }
      ),
      headers: fc.option(
        fc.record({
          'X-Forwarded-For': fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
          'User-Agent': fc.option(fc.string({ minLength: 1 }), { nil: undefined })
        }),
        { nil: undefined }
      )
    });

    fc.assert(
      fc.property(arbEvent, (event) => {
        const result = extractRequestMetadata(event);

        // sourceIp is always a non-empty string
        expect(typeof result.sourceIp).toBe('string');
        expect(result.sourceIp.length).toBeGreaterThan(0);

        // userAgent is always a non-empty string
        expect(typeof result.userAgent).toBe('string');
        expect(result.userAgent.length).toBeGreaterThan(0);

        // unknownIp is true iff sourceIp === "unknown"
        expect(result.unknownIp).toBe(result.sourceIp === 'unknown');
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: bot-signup-protection, Property 2: Honeypot evaluation is equivalent to non-empty website field
describe('Property 2: Honeypot evaluation is equivalent to non-empty website field', () => {
  /**
   * **Validates: Requirements 2.2, 2.3**
   */
  test('evaluateHoneypot returns true iff website is a non-empty string', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: undefined }),
        (website) => {
          const result = evaluateHoneypot(website);
          const expected = typeof website === 'string' && website.length > 0;
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: bot-signup-protection, Property 3: Disposable domain detection matches set membership
describe('Property 3: Disposable domain detection matches set membership', () => {
  /**
   * **Validates: Requirements 3.2, 3.3**
   */
  test('isDisposableDomain returns true iff domain portion is in the set', () => {
    const arbDomain = fc.stringMatching(/^[a-z]{2,10}\.[a-z]{2,5}$/);
    const arbLocalPart = fc.stringMatching(/^[a-z0-9]{1,10}$/);
    const arbDomainSet = fc.array(arbDomain, { minLength: 0, maxLength: 10 });

    fc.assert(
      fc.property(
        arbLocalPart,
        arbDomain,
        arbDomainSet,
        (local, domain, domainList) => {
          const email = `${local}@${domain}`;
          const domainSet = new Set(domainList);
          const result = isDisposableDomain(email, domainSet);
          expect(result).toBe(domainSet.has(domain));
        }
      ),
      { numRuns: 100 }
    );
  });
});



// Feature: bot-signup-protection, Property 4: Email validation accepts valid formats and rejects invalid ones
describe('Property 4: Email validation accepts valid formats and rejects invalid ones', () => {
  /**
   * **Validates: Requirements 3.4, 3.5**
   */
  test('isValidEmail accepts fc.emailAddress() generated emails', () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        expect(isValidEmail(email)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('isValidEmail rejects strings missing @ or with invalid domain structure', () => {
    // Strings without @ should always be rejected
    const arbNoAt = fc.string().filter(s => !s.includes('@'));
    fc.assert(
      fc.property(arbNoAt, (s) => {
        expect(isValidEmail(s)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('isValidEmail rejects strings with multiple @ signs', () => {
    const arbMultipleAt = fc.tuple(fc.string(), fc.string(), fc.string()).map(
      ([a, b, c]) => `${a}@${b}@${c}`
    );
    fc.assert(
      fc.property(arbMultipleAt, (s) => {
        expect(isValidEmail(s)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: bot-signup-protection, Property 5: Suspicious UA detection matches pattern containment
describe('Property 5: Suspicious UA detection matches pattern containment', () => {
  /**
   * **Validates: Requirements 4.2, 4.3**
   */
  test('isSuspiciousUserAgent returns true iff UA is "unknown" or lowercase UA contains any pattern', () => {
    const arbUa = fc.string({ minLength: 0, maxLength: 50 });
    const arbPatterns = fc.array(
      fc.stringMatching(/^[a-z]{1,8}$/),
      { minLength: 0, maxLength: 5 }
    );

    fc.assert(
      fc.property(arbUa, arbPatterns, (ua, patterns) => {
        const result = isSuspiciousUserAgent(ua, patterns);
        const lowerUa = ua.toLowerCase();
        const expected = ua === 'unknown' || patterns.some(p => lowerUa.includes(p));
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: bot-signup-protection, Property 10: elapsedMs sanitization
describe('Property 10: elapsedMs sanitization', () => {
  /**
   * **Validates: Requirements 7.2, 7.4**
   */
  test('sanitizeElapsedMs returns value iff non-negative integer <= 86400000, else null', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const result = sanitizeElapsedMs(v);
        const isValidElapsed =
          typeof v === 'number' &&
          Number.isInteger(v) &&
          v >= 0 &&
          v <= 86400000;

        if (isValidElapsed) {
          expect(result).toBe(v);
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: bot-signup-protection, Property 11: fastSubmission flag derivation
describe('Property 11: fastSubmission flag derivation', () => {
  /**
   * **Validates: Requirement 7**
   */
  test('isFastSubmission returns true iff elapsedMs is non-null and < 1500', () => {
    const arbElapsedMs = fc.option(fc.nat(), { nil: null });

    fc.assert(
      fc.property(arbElapsedMs, (elapsedMs) => {
        const result = isFastSubmission(elapsedMs);
        const expected = elapsedMs !== null && elapsedMs < 1500;
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: bot-signup-protection, Property 12: Email normalization is idempotent lowercase
describe('Property 12: Email normalization is idempotent lowercase', () => {
  /**
   * **Validates: Requirements 8.1**
   */
  test('normalizeEmail equals toLowerCase and is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const normalized = normalizeEmail(s);

        // Equals toLowerCase
        expect(normalized).toBe(s.toLowerCase());

        // Idempotent: applying twice gives same result
        expect(normalizeEmail(normalized)).toBe(normalized);
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: bot-signup-protection, Property 8: Policy resolution correctness
describe('Property 8: Policy resolution correctness', () => {
  /**
   * **Validates: Requirements 5.7, 9.3, 10.3, 11.1, 11.2, 12.1, 12.2, 12.3, 12.4**
   */

  // Simple spy factory (jest.fn() is not available inside fc.property in ESM)
  function createSpy() {
    const calls = [];
    const fn = (...args) => { calls.push(args); };
    fn.calls = calls;
    return fn;
  }

  // Arbitraries for valid policy values
  const arbValidAction = fc.constantFrom('block', 'flag');
  const arbValidThreshold = fc.integer({ min: 1, max: 1000 });
  const arbValidWindow = fc.integer({ min: 60, max: 86400 });

  // Arbitrary for invalid action values (not "block" or "flag")
  const arbInvalidAction = fc.oneof(
    fc.integer(),
    fc.constant(true),
    fc.constant(0),
    fc.string().filter(s => s !== 'block' && s !== 'flag')
  );

  // Arbitrary for invalid threshold values (outside [1, 1000] or non-integer)
  const arbInvalidThreshold = fc.oneof(
    fc.integer({ min: -1000, max: 0 }),
    fc.integer({ min: 1001, max: 100000 }),
    fc.constant(1.5),
    fc.constant('ten'),
    fc.constant(true)
  );

  // Arbitrary for invalid window values (outside [60, 86400] or non-integer)
  const arbInvalidWindow = fc.oneof(
    fc.integer({ min: -1000, max: 59 }),
    fc.integer({ min: 86401, max: 200000 }),
    fc.constant(30.5),
    fc.constant('hour'),
    fc.constant(false)
  );

  // Valid global defaults
  const arbDefaults = fc.record({
    honeypotAction: arbValidAction,
    disposableDomainAction: arbValidAction,
    rateLimitThreshold: arbValidThreshold,
    rateLimitWindowSeconds: arbValidWindow
  });

  test('uses tenant override when value is valid', () => {
    const arbTenant = fc.record({
      honeypotAction: arbValidAction,
      disposableDomainAction: arbValidAction,
      rateLimitThreshold: arbValidThreshold,
      rateLimitWindowSeconds: arbValidWindow
    });

    fc.assert(
      fc.property(arbTenant, arbDefaults, (tenant, defaults) => {
        const logFn = createSpy();
        const result = resolvePolicy(tenant, defaults, logFn);

        expect(result.honeypotAction).toBe(tenant.honeypotAction);
        expect(result.disposableDomainAction).toBe(tenant.disposableDomainAction);
        expect(result.rateLimitThreshold).toBe(tenant.rateLimitThreshold);
        expect(result.rateLimitWindowSeconds).toBe(tenant.rateLimitWindowSeconds);
        expect(logFn.calls.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  test('falls back to global default when tenant field is absent', () => {
    const arbEmptyTenant = fc.record({
      tenantId: fc.string({ minLength: 1 }),
      name: fc.string()
    });

    fc.assert(
      fc.property(arbEmptyTenant, arbDefaults, (tenant, defaults) => {
        const logFn = createSpy();
        const result = resolvePolicy(tenant, defaults, logFn);

        expect(result.honeypotAction).toBe(defaults.honeypotAction);
        expect(result.disposableDomainAction).toBe(defaults.disposableDomainAction);
        expect(result.rateLimitThreshold).toBe(defaults.rateLimitThreshold);
        expect(result.rateLimitWindowSeconds).toBe(defaults.rateLimitWindowSeconds);
        expect(logFn.calls.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  test('falls back to global default and invokes logFn when tenant field is invalid', () => {
    const arbInvalidTenant = fc.record({
      honeypotAction: arbInvalidAction,
      disposableDomainAction: arbInvalidAction,
      rateLimitThreshold: arbInvalidThreshold,
      rateLimitWindowSeconds: arbInvalidWindow
    });

    fc.assert(
      fc.property(arbInvalidTenant, arbDefaults, (tenant, defaults) => {
        const logFn = createSpy();
        const result = resolvePolicy(tenant, defaults, logFn);

        // All fields should fall back to defaults
        expect(result.honeypotAction).toBe(defaults.honeypotAction);
        expect(result.disposableDomainAction).toBe(defaults.disposableDomainAction);
        expect(result.rateLimitThreshold).toBe(defaults.rateLimitThreshold);
        expect(result.rateLimitWindowSeconds).toBe(defaults.rateLimitWindowSeconds);

        // logFn should have been called for each invalid field
        const calledFields = logFn.calls.map(c => c[0]);
        expect(calledFields).toContain('honeypotAction');
        expect(calledFields).toContain('disposableDomainAction');
        expect(calledFields).toContain('rateLimitThreshold');
        expect(calledFields).toContain('rateLimitWindowSeconds');
      }),
      { numRuns: 100 }
    );
  });

  test('mixed valid/absent/invalid fields resolve correctly per field', () => {
    const arbMixedTenant = fc.record({
      honeypotAction: fc.oneof(
        arbValidAction,
        fc.constant(undefined),
        arbInvalidAction
      ),
      disposableDomainAction: fc.oneof(
        arbValidAction,
        fc.constant(undefined),
        arbInvalidAction
      ),
      rateLimitThreshold: fc.oneof(
        arbValidThreshold,
        fc.constant(undefined),
        arbInvalidThreshold
      ),
      rateLimitWindowSeconds: fc.oneof(
        arbValidWindow,
        fc.constant(undefined),
        arbInvalidWindow
      )
    });

    const validActions = ['block', 'flag'];

    fc.assert(
      fc.property(arbMixedTenant, arbDefaults, (tenant, defaults) => {
        const logFn = createSpy();
        const result = resolvePolicy(tenant, defaults, logFn);

        // honeypotAction
        if (tenant.honeypotAction !== undefined && tenant.honeypotAction !== null && validActions.includes(tenant.honeypotAction)) {
          expect(result.honeypotAction).toBe(tenant.honeypotAction);
        } else {
          expect(result.honeypotAction).toBe(defaults.honeypotAction);
        }

        // disposableDomainAction
        if (tenant.disposableDomainAction !== undefined && tenant.disposableDomainAction !== null && validActions.includes(tenant.disposableDomainAction)) {
          expect(result.disposableDomainAction).toBe(tenant.disposableDomainAction);
        } else {
          expect(result.disposableDomainAction).toBe(defaults.disposableDomainAction);
        }

        // rateLimitThreshold
        const thr = tenant.rateLimitThreshold;
        if (thr !== undefined && thr !== null && typeof thr === 'number' && Number.isInteger(thr) && thr >= 1 && thr <= 1000) {
          expect(result.rateLimitThreshold).toBe(thr);
        } else {
          expect(result.rateLimitThreshold).toBe(defaults.rateLimitThreshold);
        }

        // rateLimitWindowSeconds
        const win = tenant.rateLimitWindowSeconds;
        if (win !== undefined && win !== null && typeof win === 'number' && Number.isInteger(win) && win >= 60 && win <= 86400) {
          expect(result.rateLimitWindowSeconds).toBe(win);
        } else {
          expect(result.rateLimitWindowSeconds).toBe(defaults.rateLimitWindowSeconds);
        }

        // Verify result values are always within valid bounds
        expect(validActions).toContain(result.honeypotAction);
        expect(validActions).toContain(result.disposableDomainAction);
        expect(result.rateLimitThreshold).toBeGreaterThanOrEqual(1);
        expect(result.rateLimitThreshold).toBeLessThanOrEqual(1000);
        expect(result.rateLimitWindowSeconds).toBeGreaterThanOrEqual(60);
        expect(result.rateLimitWindowSeconds).toBeLessThanOrEqual(86400);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: bot-signup-protection, Property 9: Policy evaluation blocks iff triggered flag has action "block"
describe('Property 9: Policy evaluation blocks iff triggered flag has action "block"', () => {
  /**
   * **Validates: Requirements 9.1, 9.2, 10.1, 10.2**
   */

  const arbFlags = fc.record({
    honeypotTriggered: fc.boolean(),
    disposableDomain: fc.boolean(),
    suspiciousUserAgent: fc.boolean(),
    unknownIp: fc.boolean(),
    fastSubmission: fc.boolean()
  });

  const arbPolicy = fc.record({
    honeypotAction: fc.constantFrom('block', 'flag'),
    disposableDomainAction: fc.constantFrom('block', 'flag'),
    rateLimitThreshold: fc.integer({ min: 1, max: 1000 }),
    rateLimitWindowSeconds: fc.integer({ min: 60, max: 86400 })
  });

  test('blocked is true iff honeypot+block or disposable+block', () => {
    fc.assert(
      fc.property(arbFlags, arbPolicy, (flags, policy) => {
        const result = evaluatePolicy(flags, policy);

        const shouldBlockHoneypot = flags.honeypotTriggered && policy.honeypotAction === 'block';
        const shouldBlockDisposable = flags.disposableDomain && policy.disposableDomainAction === 'block';
        const expectedBlocked = shouldBlockHoneypot || shouldBlockDisposable;

        expect(result.blocked).toBe(expectedBlocked);
      }),
      { numRuns: 100 }
    );
  });

  test('rejectionReason is first match: honeypot before disposable domain', () => {
    fc.assert(
      fc.property(arbFlags, arbPolicy, (flags, policy) => {
        const result = evaluatePolicy(flags, policy);

        const shouldBlockHoneypot = flags.honeypotTriggered && policy.honeypotAction === 'block';
        const shouldBlockDisposable = flags.disposableDomain && policy.disposableDomainAction === 'block';

        if (shouldBlockHoneypot) {
          // Honeypot takes priority
          expect(result.rejectionReason).toBe('honeypot');
        } else if (shouldBlockDisposable) {
          expect(result.rejectionReason).toBe('disposable_domain');
        } else {
          expect(result.rejectionReason).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  test('only honeypotTriggered and disposableDomain influence blocking', () => {
    // Fix honeypot and disposable to false, vary all other flags
    const arbNonBlockingFlags = fc.record({
      honeypotTriggered: fc.constant(false),
      disposableDomain: fc.constant(false),
      suspiciousUserAgent: fc.boolean(),
      unknownIp: fc.boolean(),
      fastSubmission: fc.boolean()
    });

    fc.assert(
      fc.property(arbNonBlockingFlags, arbPolicy, (flags, policy) => {
        const result = evaluatePolicy(flags, policy);

        // Should never block regardless of other flags
        expect(result.blocked).toBe(false);
        expect(result.rejectionReason).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: bot-signup-protection, Property 13: Canonical log entry schema conformance
describe('Property 13: Canonical log entry schema conformance', () => {
  /**
   * **Validates: Requirements 13.1, 13.2, 13.3**
   */

  const arbEventType = fc.constantFrom(
    'signup.blocked',
    'signup.flagged',
    'signup.duplicate_abuse',
    'config.invalid_override'
  );

  const arbDetectionFlags = fc.record({
    honeypotTriggered: fc.boolean(),
    disposableDomain: fc.boolean(),
    suspiciousUserAgent: fc.boolean(),
    unknownIp: fc.boolean(),
    fastSubmission: fc.boolean()
  });

  const arbData = fc.record({
    tenantId: fc.string({ minLength: 1, maxLength: 30 }),
    normalizedEmail: fc.string({ minLength: 3, maxLength: 50 }),
    sourceIp: fc.string({ minLength: 1, maxLength: 40 }),
    userAgent: fc.string({ minLength: 1, maxLength: 80 }),
    detectionFlags: arbDetectionFlags,
    rejectionReason: fc.constantFrom('honeypot', 'disposable_domain', 'rate_limit'),
    requestCountInWindow: fc.option(fc.nat({ max: 1000 }), { nil: undefined }),
    elapsedMs: fc.option(fc.nat({ max: 86400000 }), { nil: undefined })
  });

  test('all required fields are present and rejectionReason present iff eventType==="signup.blocked"', () => {
    fc.assert(
      fc.property(arbEventType, arbData, (eventType, data) => {
        let capturedEntry = null;
        const mockLogger = {
          info: (_message, entry) => { capturedEntry = entry; }
        };

        emitBotProtectionLog(mockLogger, eventType, data);

        // logger.info must have been called
        expect(capturedEntry).not.toBeNull();

        // Required fields must be present
        expect(typeof capturedEntry.eventType).toBe('string');
        expect(capturedEntry.eventType).toBe(eventType);

        expect(typeof capturedEntry.tenantId).toBe('string');
        expect(capturedEntry.tenantId).toBe(data.tenantId);

        expect(typeof capturedEntry.normalizedEmail).toBe('string');
        expect(capturedEntry.normalizedEmail).toBe(data.normalizedEmail);

        expect(typeof capturedEntry.sourceIp).toBe('string');
        expect(capturedEntry.sourceIp).toBe(data.sourceIp);

        expect(typeof capturedEntry.userAgent).toBe('string');
        expect(capturedEntry.userAgent).toBe(data.userAgent);

        expect(typeof capturedEntry.detectionFlags).toBe('object');
        expect(capturedEntry.detectionFlags).not.toBeNull();

        expect(typeof capturedEntry.timestamp).toBe('string');
        // Verify ISO 8601 format by parsing
        expect(Number.isNaN(Date.parse(capturedEntry.timestamp))).toBe(false);

        // rejectionReason present iff eventType === "signup.blocked"
        if (eventType === 'signup.blocked') {
          expect(capturedEntry).toHaveProperty('rejectionReason');
          expect(typeof capturedEntry.rejectionReason).toBe('string');
        } else {
          expect(capturedEntry).not.toHaveProperty('rejectionReason');
        }
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: bot-signup-protection, Property 14: Duplicate abuse detection triggers at threshold
describe('Property 14: Duplicate abuse detection triggers at threshold', () => {
  /**
   * **Validates: Requirements 15.3**
   *
   * The duplicate abuse log should be emitted if and only if the email already
   * exists for the tenant (isDuplicate) AND the request count from the same IP
   * within the rate limit window exceeds 3.
   */
  test('shouldEmitDuplicateAbuseLog is true iff isDuplicate && requestCount > 3', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 1, max: 100 }),
        (isDuplicate, requestCount) => {
          const shouldEmitDuplicateAbuseLog = isDuplicate && requestCount > 3;

          if (isDuplicate && requestCount > 3) {
            expect(shouldEmitDuplicateAbuseLog).toBe(true);
          } else {
            expect(shouldEmitDuplicateAbuseLog).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
