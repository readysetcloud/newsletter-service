import { DynamoDBClient, UpdateItemCommand, PutItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, getTenant } from '../utils/helpers.mjs';
import { publishSubscriberEvent, publishEvent, EVENT_TYPES } from '../utils/event-publisher.mjs';
import {
  extractRequestMetadata,
  isValidEmail,
  normalizeEmail,
  evaluateHoneypot,
  isDisposableDomain,
  isSuspiciousUserAgent,
  isSuspiciousEmailPattern,
  sanitizeElapsedMs,
  isFastSubmission,
  buildDetectionFlags,
  resolvePolicy,
  evaluatePolicy,
  emitBotProtectionLog,
  disposableDomainSet
} from '../utils/bot-protection.mjs';
import { sanitizeName } from '../utils/subscriber-name.mjs';
import { checkRateLimit } from '../utils/rate-limiter.mjs';
import { createLogger } from '../utils/structured-logger.mjs';
import { getMostRecentPublishedIssue, incrementIssueCounter } from '../utils/issue-attribution.mjs';
import { getSuppression, suppressionConditionCheck } from '../utils/suppression.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  const correlationId = event?.requestContext?.requestId || crypto.randomUUID?.() || Date.now().toString();
  let logger;

  try {
    const { tenant: tenantId } = event.pathParameters;
    logger = createLogger(correlationId, tenantId);

    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return formatResponse(404, 'Tenant not found');
    }

    if (!event.body) {
      return formatResponse(400, 'Missing request body');
    }

    const contact = JSON.parse(event.body);

    if (!contact.email) {
      return formatResponse(400, 'Email is required');
    }

    // Step 1: Validate email format
    if (!isValidEmail(contact.email)) {
      return formatResponse(400, 'Invalid email format');
    }

    // Step 2: Normalize email
    const normalizedEmail = normalizeEmail(contact.email);

    // Names are free-form and unauthenticated — normalize once here so the
    // stored record and the SUBSCRIBER_ADDED event carry the same value.
    contact.firstName = sanitizeName(contact.firstName);
    contact.lastName = sanitizeName(contact.lastName);

    // Step 3: Extract request metadata
    const { sourceIp, userAgent, unknownIp } = extractRequestMetadata(event);

    // Step 4: Resolve tenant policy
    const envDefaults = {
      honeypotAction: process.env.HONEYPOT_ACTION || 'block',
      disposableDomainAction: process.env.DISPOSABLE_DOMAIN_ACTION || 'flag',
      rateLimitThreshold: parseInt(process.env.RATE_LIMIT_THRESHOLD || '10', 10),
      rateLimitWindowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '3600', 10)
    };

    const policy = resolvePolicy(tenant, envDefaults, (fieldName, invalidValue) => {
      emitBotProtectionLog(logger, 'config.invalid_override', {
        tenantId,
        normalizedEmail,
        sourceIp,
        userAgent,
        detectionFlags: {},
        fieldName,
        invalidValue
      });
    });

    // Step 5: Check rate limit
    const rateLimitResult = await checkRateLimit(tenantId, sourceIp, policy);

    if (rateLimitResult.limited) {
      emitBotProtectionLog(logger, 'signup.blocked', {
        tenantId,
        normalizedEmail,
        sourceIp,
        userAgent,
        detectionFlags: { honeypotTriggered: false, disposableDomain: false, suspiciousUserAgent: false, unknownIp, fastSubmission: false },
        rejectionReason: 'rate_limit',
        requestCountInWindow: rateLimitResult.count
      });

      return {
        statusCode: 429,
        body: JSON.stringify({ message: 'Too many requests' }),
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimitResult.retryAfterSeconds),
          ...process.env.ORIGIN && { 'Access-Control-Allow-Origin': process.env.ORIGIN }
        }
      };
    }

    // Step 6: Run detection pipeline
    const uaPatterns = (process.env.SUSPICIOUS_UA_PATTERNS || 'bot,crawler,spider,curl,wget,python,http')
      .split(',')
      .map(p => p.trim().toLowerCase());

    const honeypotTriggered = evaluateHoneypot(contact.website);
    const disposableDomain = isDisposableDomain(normalizedEmail, disposableDomainSet);
    const suspiciousUa = isSuspiciousUserAgent(userAgent, uaPatterns);
    const suspiciousEmail = isSuspiciousEmailPattern(normalizedEmail);
    const sanitizedElapsedMs = sanitizeElapsedMs(contact.elapsedMs);
    const fastSubmission = isFastSubmission(sanitizedElapsedMs);

    // Step 7: Build detection flags
    const detectionFlags = buildDetectionFlags(honeypotTriggered, disposableDomain, suspiciousUa, unknownIp, fastSubmission, suspiciousEmail);

    // Step 8: Evaluate policy
    const policyResult = evaluatePolicy(detectionFlags, policy);

    if (policyResult.blocked) {
      // Silent HTTP 201 — no record created
      emitBotProtectionLog(logger, 'signup.blocked', {
        tenantId,
        normalizedEmail,
        sourceIp,
        userAgent,
        detectionFlags,
        rejectionReason: policyResult.rejectionReason,
        requestCountInWindow: rateLimitResult.count,
        elapsedMs: sanitizedElapsedMs
      });

      // Optional EventBridge publish for blocked signups
      if (process.env.PUBLISH_BLOCKED_EVENTS === 'true') {
        await publishEvent('newsletter-service', 'Signup Blocked', {
          tenantId,
          normalizedEmail,
          sourceIp,
          userAgent,
          rejectionReason: policyResult.rejectionReason
        });
      }

      return formatResponse(201, 'Contact added');
    }

    // Step 8.5: Refuse an address that has already opted out.
    //
    // This endpoint is unauthenticated and takes a caller-supplied address, so
    // a submission here is not evidence that its owner sent it — anyone who
    // knows an address could use this to erase that person's opt-out and put
    // them back on the list. Reactivation needs proof of ownership (a
    // confirmation link sent to the address itself), which does not exist yet,
    // so until it does a suppressed address stays suppressed.
    //
    // A suppressed address gets the same silent 201 the bot filters return, so
    // this endpoint still says nothing about whether an address is known.
    //
    // A read failure is different: nobody is added either way — an unreachable
    // consent store must never read as consent — but a legitimate signup lost
    // to a transient blip deserves to be told, so the form can surface an
    // error and the person can try again rather than silently never hearing
    // from us. The failure is independent of whether a record exists, so
    // reporting it leaks nothing.
    let suppression;
    try {
      suppression = await getSuppression(tenantId, normalizedEmail);
    } catch (suppressionErr) {
      console.error('Refusing signup: consent state could not be read', {
        tenantId,
        error: suppressionErr.message
      });
      return formatResponse(500, 'Something went wrong');
    }

    if (suppression) {
      emitBotProtectionLog(logger, 'signup.suppressed', {
        tenantId,
        normalizedEmail,
        sourceIp,
        userAgent,
        detectionFlags,
        rejectionReason: 'previously_unsubscribed',
        requestCountInWindow: rateLimitResult.count
      });
      return formatResponse(201, 'Contact added');
    }

    // Step 9: Attempt to create subscriber (duplicate check via ConditionExpression)
    const isNew = await addSubscriber(tenantId, contact, normalizedEmail, {
      sourceIp,
      userAgent,
      detectionFlags,
      requestCountInWindow: rateLimitResult.count,
      elapsedMs: sanitizedElapsedMs
    });

    if (isNew) {
      // Emit signup.flagged log if any detection flag is true
      const anyFlagSet = Object.values(detectionFlags).some(v => v === true);
      if (anyFlagSet) {
        emitBotProtectionLog(logger, 'signup.flagged', {
          tenantId,
          normalizedEmail,
          sourceIp,
          userAgent,
          detectionFlags,
          requestCountInWindow: rateLimitResult.count,
          elapsedMs: sanitizedElapsedMs
        });
      }

      const addedAt = new Date().toISOString();
      const timestamp = Date.now();

      await updateSubscriberCount(tenantId);
      await createSubscriberEventRecord(tenantId, normalizedEmail, addedAt, timestamp);

      // Attribute the new subscriber to the most recently sent issue
      try {
        const recentIssue = await getMostRecentPublishedIssue(tenantId);
        if (recentIssue) {
          await incrementIssueCounter(recentIssue.pk, 'subscribes');
        }
      } catch (attrErr) {
        console.warn('Failed to increment subscribe counter:', { tenantId, error: attrErr.message });
      }

      await publishSubscriberEvent(
        tenantId,
        null,
        EVENT_TYPES.SUBSCRIBER_ADDED,
        {
          email: normalizedEmail,
          firstName: contact.firstName || null,
          lastName: contact.lastName || null,
          subscriberCount: tenant.subscribers + 1,
          addedAt
        }
      );
    } else {
      // Duplicate — emit duplicate_abuse log if requestCount > 3
      if (rateLimitResult.count > 3) {
        emitBotProtectionLog(logger, 'signup.duplicate_abuse', {
          tenantId,
          normalizedEmail,
          sourceIp,
          userAgent,
          detectionFlags,
          requestCountInWindow: rateLimitResult.count
        });
      }
    }

    return formatResponse(201, 'Contact added');
  }
  catch (err) {
    if (logger) {
      logger.error('Add subscriber error', err);
    } else {
      console.error('Add subscriber error:', err);
    }
    return formatResponse(500, 'Something went wrong');
  }
};

const addSubscriber = async (tenantId, contact, normalizedEmail, detectionData) => {
  const addedAt = new Date().toISOString();

  const subscriberItem = {
    tenantId,
    email: normalizedEmail,
    addedAt,
    ...(contact.firstName && { firstName: contact.firstName }),
    ...(contact.lastName && { lastName: contact.lastName }),
    // Detection attributes
    sourceIp: detectionData.sourceIp,
    userAgent: detectionData.userAgent,
    // Detection flags
    honeypotTriggered: detectionData.detectionFlags.honeypotTriggered,
    disposableDomain: detectionData.detectionFlags.disposableDomain,
    suspiciousUserAgent: detectionData.detectionFlags.suspiciousUserAgent,
    unknownIp: detectionData.detectionFlags.unknownIp,
    fastSubmission: detectionData.detectionFlags.fastSubmission,
    suspiciousEmailPattern: detectionData.detectionFlags.suspiciousEmailPattern,
    // Additional detection attributes
    requestCountInWindow: detectionData.requestCountInWindow,
    ...(detectionData.elapsedMs !== null && detectionData.elapsedMs !== undefined && { elapsedMs: detectionData.elapsedMs })
  };

  try {
    // The consent check is committed with the write, not merely performed
    // before it. A preflight read leaves a window where an unsubscribe lands
    // between the check and the Put, ending with an active subscriber and a
    // suppression on record at once. Inside the transaction the record is a
    // real guard: if a suppression exists at commit time, nothing is written.
    await ddb.send(new TransactWriteItemsCommand({
      TransactItems: [
        suppressionConditionCheck(tenantId, normalizedEmail),
        {
          Put: {
            TableName: process.env.SUBSCRIBERS_TABLE_NAME,
            Item: marshall(subscriberItem),
            ConditionExpression: 'attribute_not_exists(tenantId)'
          }
        }
      ]
    }));
    return true;
  } catch (err) {
    // Only the two guards this transaction declares mean "not added, and that
    // is fine". DynamoDB also cancels transactions for conflicts, throttling
    // and validation errors, and treating those as an ordinary no-op would
    // return `201 Contact added` having added nobody — the same false success
    // this handler deliberately stopped returning for consent-read failures.
    // Anything else rethrows so the handler answers 500 and the signup can be
    // retried.
    if (err.name === 'TransactionCanceledException') {
      // Positions match TransactItems: [suppression check, subscriber put].
      const codes = (err.CancellationReasons || []).map((reason) => reason.Code);

      if (codes[0] === 'ConditionalCheckFailed') {
        // The race this transaction exists to lose: the opt-out arrived after
        // the preflight read and must win.
        console.info(`Subscriber not added for ${tenantId}; a suppression landed mid-request`);
        return false;
      }

      if (codes[1] === 'ConditionalCheckFailed') {
        // The ordinary duplicate.
        return false;
      }

      console.error(`Subscriber transaction cancelled for ${tenantId}`, { reasons: codes });
    }

    throw err;
  }
};

const updateSubscriberCount = async (tenantId) => {
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    }),
    UpdateExpression: 'SET #subscribers = #subscribers + :val',
    ExpressionAttributeNames: {
      '#subscribers': 'subscribers'
    },
    ExpressionAttributeValues: {
      ':val': { N: '1' }
    }
  }));
};

const createSubscriberEventRecord = async (tenantId, email, addedAt, timestamp) => {
  const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days from now

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({
      pk: tenantId,
      sk: `subscriber#${timestamp}#${email}`,
      GSI1PK: tenantId,
      GSI1SK: `subscriber#${timestamp}`,
      email,
      addedAt,
      ttl
    })
  }));
};
