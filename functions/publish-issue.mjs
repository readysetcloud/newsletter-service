import Handlebars from 'handlebars';
import defaultTemplate from '../templates/newsletter.hbs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { getTenant } from './utils/helpers.mjs';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { publishIssueEvent, EVENT_TYPES } from './utils/event-publisher.mjs';
import { recordIssueEvent, ISSUE_EVENTS } from './utils/issue-timeline.mjs';
import { renderWithSnippets } from './utils/render-template.mjs';

const eventBridge = new EventBridgeClient();
const ddb = new DynamoDBClient();

export const handler = async (state) => {
  try {
    // html-mode issues arrive pre-rendered (the master rides on data.__master)
    // and are sent verbatim; otherwise render the structured data via the template.
    // Gated on contentType (not the presence of __master) so a json template whose
    // data legitimately includes a top-level __master field is never mistaken for
    // a pre-rendered master.
    const html = state.contentType === 'html'
      ? (state.data?.__master ?? '')
      : await renderTemplate(state.data, state.tenantId, state.templateId);

    if (state.isPreview) {
      await sendEmail({
        subject: `[Preview] ${state.subject}`,
        html,
        to: { email: state.email },
        sendAt: state.sendAtDate,
        tenantId: state.tenantId
      });
    } else {
      const tenant = await getTenant(state.tenantId);
      const publishedAt = resolvePublishedAt(state.sendAtDate);
      const subscriberCount = await readSubscriberCount(state.tenantId);
      await setupIssueStats(tenant, state.data.metadata.number, state.subject, publishedAt, subscriberCount);

      // Send configs (abTest, localSend, contentAssembly) are persisted on the
      // issue record by the API. Reading them here (rather than threading them
      // through the state machine) keeps every state machine entry point
      // unchanged and works for unconfigured issues by default.
      const { abTest, localSend, contentAssembly } = await getIssueSendConfig(state.tenantId, state.data.metadata.number);

      const activeAbTest = (abTest?.dimension === 'subject' || abTest?.dimension === 'sendTime') ? abTest : undefined;

      // Local send and A/B testing both control send timing/audience split, so
      // they are mutually exclusive; A/B wins when both are configured.
      let activeLocalSend;
      if (localSend?.enabled) {
        if (activeAbTest) {
          console.warn('Local send ignored: issue has an active A/B test', {
            tenantId: state.tenantId,
            issueNumber: state.data.metadata.number
          });
        } else {
          activeLocalSend = localSend;
        }
      }

      // Interest-aware assembly and A/B testing are mutually exclusive: for a
      // measurable test, every recipient of a variant must receive identical
      // content, so a per-recipient section order would poison the results.
      // Assembly DOES compose with local send (order is personalized within
      // each timezone/peak-hour group send).
      let assemblyEnabled = contentAssembly?.enabled === true;
      if (assemblyEnabled && activeAbTest) {
        console.warn('[ASSEMBLY] Skipping personalized section order - an A/B test is active for this issue');
        assemblyEnabled = false;
      }

      // Claim `sending` before handing off, not after.
      //
      // The state machine's `Update Issue Record - Success` writes `published`
      // under `#status <> :sending`, and that guard is only load-bearing if the
      // record already reads `sending` by the time it runs. It did not. The
      // fan-out sets `sending` from inside send-email-v2, which EventBridge
      // invokes asynchronously and which first validates the sender and pages
      // the entire subscriber list — while the state machine has only two
      // Scheduler entries and one DynamoDB write left to do. The workflow won
      // that race essentially every time, so a local-send issue read
      // `published` from the moment the workflow ended until the fan-out caught
      // up, with deliveries still hours from finishing. Everything downstream
      // was correct — the fan-out reclaims `sending`, the last group publishes —
      // but anyone looking in that window was told the issue had gone out when
      // most of the list had not been mailed.
      //
      // Doing it here closes the window rather than narrowing it: the claim is
      // synchronous and ordered before the event, so the guard cannot be
      // reached first. Failure is non-fatal — a missed claim restores exactly
      // the old racy behaviour rather than stopping a send that is otherwise
      // ready to go.
      const claimed = activeLocalSend
        ? await claimSending(state.tenantId, state.data.metadata.number)
        : false;

      try {
        await sendEmail({
          subject: state.subject,
          html,
          to: { list: tenant.list },
          sendAt: state.sendAtDate,
          referenceNumber: `${tenant.pk}_${state.data.metadata.number}`,
          tenantId: state.tenantId,
          abTest: activeAbTest,
          localSend: activeLocalSend,
          contentAssembly: assemblyEnabled ? { enabled: true } : undefined
        });
      } catch (err) {
        // The claim has to come back off, or the issue is stranded.
        //
        // `sending` exists to tell the rest of the system that a fan-out owns
        // this issue's terminal status. If the hand-off throws there is no
        // fan-out, and nothing will ever move it: the state machine's failure
        // write refuses to stamp `failed` over `sending` (by design — that
        // condition is what stops it lying about a send in flight), the
        // handshake does not treat `sending` as re-sendable, and the resend
        // endpoint only accepts `published`. The issue would sit there with no
        // route back, having sent nothing.
        //
        // Releasing it restores exactly the state the claim found, so the
        // failure write behaves as it did before the claim existed.
        if (claimed) {
          await releaseSending(state.tenantId, state.data.metadata.number);
        }
        throw err;
      }

      // The hand-off, recorded as its own fact rather than folded into
      // "published". They are not the same event and the gap between them is
      // where issue 227 was lost: the workflow finished and wrote `published`,
      // while the mail was still owed to a Scheduler entry that never fired.
      // A hand-off with no `send_deferred` or `sending_started` after it is
      // that failure, visible at a glance.
      await recordIssueEvent({
        tenantId: state.tenantId,
        issueNumber: state.data.metadata.number,
        type: ISSUE_EVENTS.SEND_HANDED_OFF,
        detail: {
          sendAt: state.sendAtDate ?? 'now',
          subscribers: subscriberCount,
          ...(activeAbTest && { abTest: activeAbTest.dimension }),
          ...(activeLocalSend && { localSend: activeLocalSend.mode ?? 'timezone' })
        }
      });

      await publishIssueEvent(
        state.tenantId,
        state.tenant?.id || 'system',
        EVENT_TYPES.ISSUE_PUBLISHED,
        {
          issueId: `${state.tenantId}#${state.data.metadata.number}`,
          issueNumber: state.data.metadata.number,
          subject: state.subject,
          publishedAt,
          subscriberCount,
          metadata: state.data.metadata
        }
      );
    }

    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false };
  }
};

/**
 * Renders the issue data into HTML.
 *
 * When a templateId is supplied, the tenant's selected template is loaded from
 * DynamoDB along with the tenant's snippets (registered as Handlebars partials).
 * Any partial referenced by the template that is missing is registered as an
 * empty string so a missing snippet never fails the send.
 *
 * When no templateId is supplied, the static default newsletter template is used.
 *
 * @param {Object} data - Issue data to render against.
 * @param {string} [tenantId] - Tenant identifier (required when templateId is set).
 * @param {string} [templateId] - Optional selected template identifier.
 * @returns {Promise<string>} Rendered HTML.
 */
const renderTemplate = async (data, tenantId, templateId) => {
  if (!templateId) {
    return Handlebars.compile(defaultTemplate)(data);
  }

  const templateContent = await getTemplateContent(tenantId, templateId);
  if (!templateContent) {
    console.warn(`Template '${templateId}' not found for tenant '${tenantId}', falling back to default template`);
    return Handlebars.compile(defaultTemplate)(data);
  }

  const snippets = await getSnippets(tenantId);
  // Delegate to the shared renderer so the send path and the conformance test
  // exercise identical logic (snippets as partials, missing partial -> empty,
  // noEscape to mirror the Rust preview renderer in template_render.rs).
  return renderWithSnippets(templateContent, data, snippets);
};

/**
 * Loads a template's Handlebars content for a tenant.
 * @param {string} tenantId - Tenant identifier.
 * @param {string} templateId - Template identifier.
 * @returns {Promise<string|null>} Template content, or null if not found.
 */
const getTemplateContent = async (tenantId, templateId) => {
  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: `template#${templateId}`
    })
  }));

  if (!result.Item) {
    return null;
  }

  const template = unmarshall(result.Item);
  return template.content ?? null;
};

/**
 * Loads the persisted send-time configurations for an issue, if any.
 * The API stores `abTest`, `localSend`, and `contentAssembly` as JSON strings
 * on the issue record (sk "newsletter"), mirroring how `metadata` is persisted.
 * @param {string} tenantId - Tenant identifier.
 * @param {number|string} issueNumber - Issue number.
 * @returns {Promise<{abTest: Object|null, localSend: Object|null, contentAssembly: Object|null}>} Parsed configs (null when not set/invalid).
 */
const getIssueSendConfig = async (tenantId, issueNumber) => {
  const config = { abTest: null, localSend: null, contentAssembly: null };

  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: `${tenantId}#${issueNumber}`,
        sk: 'newsletter'
      }),
      ProjectionExpression: 'abTest, localSend, contentAssembly'
    }));

    if (!result.Item) {
      return config;
    }

    const record = unmarshall(result.Item);
    for (const field of ['abTest', 'localSend', 'contentAssembly']) {
      if (!record[field]) {
        continue;
      }
      try {
        config[field] = typeof record[field] === 'string' ? JSON.parse(record[field]) : record[field];
      } catch (err) {
        console.error(`Failed to parse ${field} config for issue`, { tenantId, issueNumber, error: err.message });
      }
    }

    return config;
  } catch (err) {
    console.error('Failed to load send config for issue', { tenantId, issueNumber, error: err.message });
    return config;
  }
};

/**
 * Loads all snippets for a tenant via GSI1.
 * @param {string} tenantId - Tenant identifier.
 * @returns {Promise<Array<{name: string, content: string}>>} List of snippets.
 */
const getSnippets = async (tenantId) => {
  const result = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :gsi1pk',
    ExpressionAttributeValues: marshall({
      ':gsi1pk': `snippet#${tenantId}`
    })
  }));

  return (result.Items ?? []).map(item => unmarshall(item));
};

/**
 * Sends an email via the newsletter service
 * @param {Object} params - Email parameters
 * @param {string} params.subject - Email subject line
 * @param {string} params.html - HTML content of the email
 * @param {Object} params.to - Recipient configuration
 * @param {string} [params.to.email] - Individual recipient email address
 * @param {string} [params.to.list] - SES list name for bulk sending
 * @param {string} [params.sendAt] - ISO date string for scheduled sending
 * @param {Object} [params.abTest] - Optional A/B test configuration (variants, testFraction, evaluateAfterMinutes, ...)
 * @param {Object} [params.contentAssembly] - Optional interest-aware assembly flag ({ enabled: true })
 */
const sendEmail = async (params) => {
  const result = await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'newsletter-service',
      DetailType: 'Send Email v2',
      Detail: JSON.stringify({
        subject: params.subject,
        to: {
          ...params.to.email && { email: params.to.email },
          ...params.to.list && { list: params.to.list }
        },
        html: params.html,
        ...params.sendAt && { sendAt: params.sendAt },
        ...params.referenceNumber && { referenceNumber: params.referenceNumber },
        ...params.tenantId && { tenantId: params.tenantId },
        ...params.abTest && { abTest: params.abTest },
        ...params.localSend && { localSend: params.localSend },
        ...params.contentAssembly && { contentAssembly: params.contentAssembly },
        replacements: {
          emailAddress: "__EMAIL__",
          emailAddressHash: "__EMAIL_HASH__"
        }
      })
    }]
  }));

  // EventBridge returns a successful API response while rejecting individual
  // entries, so an awaited call is not a published event. Unchecked, the
  // publish recorded SEND_HANDED_OFF and reported success for an issue whose
  // only send entry was refused — the issue looks sent and nothing was.
  if (result.FailedEntryCount > 0) {
    const [failure] = (result.Entries || []).filter((entry) => entry.ErrorCode);
    throw new Error(
      `Send Email v2 event rejected by EventBridge: ${failure?.ErrorCode || 'unknown'} ${failure?.ErrorMessage || ''}`.trim()
    );
  }
};

const padIssueNumber = (issueNumber) => {
  return String(issueNumber).padStart(5, '0');
};

/**
 * Moves the issue to `sending` so the state machine's terminal write stands
 * down and lets the local-send fan-out own the final status.
 *
 * Conditional on the issue still being `in progress` — the status the claim
 * state left it at. Anything else means something has already moved it and is
 * better informed than this: a redelivered publish event for an issue that has
 * since completed must not drag it back to `sending`.
 *
 * Never throws. A send that is ready to go must not be stopped by a status
 * write, and the failure mode of not writing it is the pre-existing race, not
 * a lost or duplicated email.
 *
 * @param {string} tenantId
 * @param {number|string} issueNumber
 * @returns {Promise<boolean>} Whether this call is the one that took the claim,
 *   and therefore the one responsible for releasing it if the hand-off fails
 */
const claimSending = async (tenantId, issueNumber) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: `${tenantId}#${issueNumber}`, sk: 'newsletter' }),
      UpdateExpression: 'SET #status = :sending, updatedAt = :now',
      ConditionExpression: '#status = :inProgress',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({
        ':sending': 'sending',
        ':inProgress': 'in progress',
        ':now': new Date().toISOString()
      })
    }));

    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log('[PUBLISH] Issue is no longer in progress - leaving its status alone', {
        tenantId,
        issueNumber
      });
      return false;
    }
    console.error('[PUBLISH] Failed to claim sending before the local-send fan-out', {
      tenantId,
      issueNumber,
      error: err.message
    });
    return false;
  }
};

/**
 * Puts the issue back to `in progress` after a hand-off that never happened.
 *
 * Conditional on it still reading `sending`, because the claim is not the only
 * thing that writes that status: if the fan-out somehow got going before the
 * hand-off reported failure, it owns the issue and this must not take it back.
 *
 * Never throws, for the same reason the claim does not — but the consequence of
 * failing here is worse, so it says so loudly. An issue left at `sending` with
 * no fan-out behind it has no route back through the state machine or the API,
 * and needs a hand.
 *
 * @param {string} tenantId
 * @param {number|string} issueNumber
 */
const releaseSending = async (tenantId, issueNumber) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: `${tenantId}#${issueNumber}`, sk: 'newsletter' }),
      UpdateExpression: 'SET #status = :inProgress, updatedAt = :now',
      ConditionExpression: '#status = :sending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({
        ':inProgress': 'in progress',
        ':sending': 'sending',
        ':now': new Date().toISOString()
      })
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log('[PUBLISH] Issue is no longer sending - leaving its status alone', {
        tenantId,
        issueNumber
      });
      return;
    }
    console.error(
      '[PUBLISH] Could not release the sending claim after a failed hand-off - the issue is '
      + 'stuck at `sending` with no fan-out and needs manual repair',
      { tenantId, issueNumber, error: err.message }
    );
  }
};

/**
 * When the issue actually goes out — which is not when this function runs.
 *
 * The publish workflow starts `IssueSendLeadTimeMinutes` before the send instant
 * so the local-send fan-out can schedule eastward timezone groups for their own
 * morning, and only the *delivery* is deferred from here: this code renders,
 * seeds the stats record and announces the publish immediately. Anchoring
 * `publishedAt` on the current time therefore dated the whole analytics timeline
 * a lead time early, and the consequence was not cosmetic. `schedule-aggregation`
 * schedules consolidation for `publishedAt + 24h`, so with a 26h lead it ran two
 * hours *before* the first email went out, wrote empty analytics, and stamped
 * `statsPhase: consolidated` — which `aggregate-issue-analytics` treats as a
 * refusal to run again (`statsPhase <> :consolidated`). The issue's analytics
 * would have been permanently empty. Open and click attribution reads the same
 * field.
 *
 * `sendAtDate` is the parse step's answer for the same question and already
 * carries the scheduled instant, so this only has to distinguish a real future
 * send from its `'now'` sentinel. A past or unparseable value falls back to now:
 * the send is going out immediately in that case, which is exactly what the old
 * behavior assumed and the only thing it was ever right about.
 *
 * @param {string|undefined} sendAtDate - `'now'`, or the send instant as ISO
 * @returns {string} ISO instant to date the issue's analytics from
 */
const resolvePublishedAt = (sendAtDate) => {
  const now = new Date();
  const sendInstant = sendAtDate && sendAtDate !== 'now' ? new Date(sendAtDate) : null;

  return sendInstant && !Number.isNaN(sendInstant.getTime()) && sendInstant > now
    ? sendInstant.toISOString()
    : now.toISOString();
};

/**
 * The tenant's subscriber count, read fresh for this snapshot.
 *
 * Not taken from `getTenant()`: that memoizes the whole tenant record for the
 * life of a warm execution environment, and `subscribers` is mutable. A
 * container that loaded the tenant before a run of signups would snapshot a
 * count from an arbitrary point in the past and freeze it into the issue's
 * stats forever — a wrong number is worse here than the missing one this PR
 * spent its first commit learning to represent.
 *
 * Strongly consistent, and projected down to the single field, since the point
 * is to be current rather than cheap.
 *
 * This defines `subscribers` as the list size at publish (content freeze), not
 * at delivery — the publish workflow starts up to the send lead time before
 * mail actually goes out. That is the reading the field has always had; if the
 * product wants list-size-at-send, the snapshot belongs in the send path
 * instead, which is a deliberate move rather than a fix.
 *
 * Returns undefined when the tenant has no count recorded, which
 * `setupIssueStats` omits rather than writing as a zero.
 */
const readSubscriberCount = async (tenantId) => {
  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: tenantId, sk: 'tenant' }),
    ProjectionExpression: '#subscribers',
    ExpressionAttributeNames: { '#subscribers': 'subscribers' },
    ConsistentRead: true
  }));

  if (!result.Item) {
    return undefined;
  }

  const { subscribers } = unmarshall(result.Item);
  return typeof subscribers === 'number' ? subscribers : undefined;
};

const setupIssueStats = async (tenant, issueNumber, subject, publishedAt, subscriberCount) => {
  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: `${tenant.pk}#${issueNumber}`,
        sk: 'stats',
        GSI1PK: `${tenant.pk}#issue`,
        GSI1SK: padIssueNumber(issueNumber),
        subject,
        publishedAt,
        opens: 0,
        bounces: 0,
        rejects: 0,
        complaints: 0,
        deliveries: 0,
        sends: 0,
        // Omitted rather than written as a placeholder when the tenant record
        // has no count: the API distinguishes "no snapshot" from "zero", and
        // marshalling an undefined here would throw and fail the publish.
        ...(typeof subscriberCount === 'number' && { subscribers: subscriberCount }),
        failedAddresses: [],
        statsPhase: 'realtime'
      }),
      // Seed the record; never reset one that already exists.
      //
      // This is a PutItem, so it replaces the whole item — and every route back
      // through `Publish` runs it. Unconditional, a resend of an issue that had
      // already gone out zeroed its sends, deliveries, opens, clicks and
      // consolidated analytics, and re-staging a `failed` issue that had partly
      // delivered did the same. The counters are the only record of what
      // actually reached people; they are not the publish step's to discard.
      //
      // A resend that genuinely needs fresh counters does not exist: the send
      // path's idempotency filter means a resend only ever *adds* recipients to
      // an issue, so its numbers should accumulate, not restart.
      ConditionExpression: 'attribute_not_exists(pk)'
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log('[PUBLISH] Stats already exist for this issue - keeping them', {
        tenantId: tenant.pk,
        issueNumber
      });
      await backfillSubscriberSnapshot(tenant, issueNumber, subscriberCount);
      return;
    }
    throw err;
  }
};

/**
 * Write the list-size snapshot onto a stats record the seed did not create.
 *
 * The seed is the only writer of `subscribers`, and it only runs when it also
 * creates the record. But it is not the only writer that can *create* it:
 * `handle-email-status` opens one with `ADD <stat> :val` on the first SES
 * event, `aggregate-issue-analytics` opens one with its `statsPhase` claim, and
 * the attribution counters (`subscribes`, `unsubscribes`, `manualRemovals`) are
 * bare `ADD`s. DynamoDB upserts all of those, so whichever lands first leaves a
 * stats record with every counter and no `subscribers` — permanently, because
 * the seed then declines to touch it. The dashboard reads that hole as a list
 * that fell to zero.
 *
 * Guarded on the attribute rather than the item so it can only ever fill a
 * hole: an issue that already has its snapshot (every resend, every re-stage)
 * fails the condition and keeps the number it was published with.
 */
const backfillSubscriberSnapshot = async (tenant, issueNumber, subscriberCount) => {
  if (typeof subscriberCount !== 'number') {
    return;
  }

  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: `${tenant.pk}#${issueNumber}`, sk: 'stats' }),
      UpdateExpression: 'SET subscribers = :subscribers',
      ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(subscribers)',
      ExpressionAttributeValues: marshall({ ':subscribers': subscriberCount })
    }));

    console.log('[PUBLISH] Backfilled the subscriber snapshot on an existing stats record', {
      tenantId: tenant.pk,
      issueNumber,
      subscribers: subscriberCount
    });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return;
    }
    // Never fail a publish over the snapshot. The issue still sends; the
    // dashboard shows the issue without a list size, which is what it now
    // renders for any issue that has none.
    console.error('[PUBLISH] Could not backfill the subscriber snapshot', {
      tenantId: tenant.pk,
      issueNumber,
      error: err.message
    });
  }
};
