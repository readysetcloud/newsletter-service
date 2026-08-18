import { DynamoDBClient, UpdateItemCommand, GetItemCommand, DeleteItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

/**
 * Suppression records: durable proof that a subscriber revoked consent, kept
 * apart from the subscriber row precisely because that row gets deleted.
 *
 * Unsubscribing used to be a hard delete and nothing else. That left two holes:
 * no record existed to answer "did this person unsubscribe?" (the only proof of
 * compliance there is), and a re-import of any list snapshot that predated the
 * unsubscribe silently put the person back on the list — the classic way a
 * sender ends up mailing people who opted out.
 *
 * The record lives in the newsletter table under the tenant partition
 * (`pk: tenantId, sk: suppression#<email>`), NOT in the Subscribers table.
 * Several code paths — JS and Rust — walk a tenant's Subscribers partition and
 * recognize non-subscriber rows by prefix (`SEGMENT#...`); a new prefix there
 * would need every one of those walkers updated in both languages, and any one
 * missed would count suppressions as subscribers. Nothing enumerates
 * subscribers from the newsletter table, so this location adds no filter burden.
 *
 * Who writes and who honors it:
 *  - Every subscriber-initiated unsubscribe (footer link, one-click header,
 *    manual form, spam complaint) records one, via `unsubscribeUser`.
 *  - Both add paths — bulk import and the public signup endpoint — refuse a
 *    suppressed address. Signup is unauthenticated and accepts a
 *    caller-supplied address, so a submission there is not proof that the
 *    owner sent it; treating it as fresh consent would have let anyone erase
 *    someone else's opt-out. Reactivation is therefore blocked pending a
 *    confirmed opt-in flow (see `clearSuppression`).
 *  - Operator actions (dashboard delete, bounce cleanup) do NOT suppress:
 *    neither is a consent revocation, and the operator may re-add on purpose.
 */

const suppressionSk = (email) => `suppression#${email.toLowerCase()}`;

/**
 * The key of an address's suppression record.
 */
export const suppressionKey = (tenantId, email) => ({
  pk: tenantId,
  sk: suppressionSk(email)
});

/**
 * A `TransactWriteItems` ConditionCheck asserting no suppression exists for an
 * address, to be committed alongside the subscriber write.
 *
 * Reading the record and then writing the subscriber is a check-then-act race:
 * an unsubscribe landing between the two leaves an active subscriber *and* a
 * suppression, which is the one state that must not exist. Committing the check
 * with the write makes the record an actual guard — the transaction fails if a
 * suppression appears at any point before it commits.
 */
export const suppressionConditionCheck = (tenantId, email) => ({
  ConditionCheck: {
    TableName: process.env.TABLE_NAME,
    Key: marshall(suppressionKey(tenantId, email)),
    ConditionExpression: 'attribute_not_exists(pk)'
  }
});

/**
 * Read every suppression on record for a tenant, as a Set of addresses.
 *
 * One query per send rather than a lookup per recipient. Throws for the same
 * reason the single-address read does: an unreadable consent store must never
 * be treated as "nobody has opted out".
 */
export const listSuppressedEmails = async (tenantId) => {
  const suppressed = new Set();
  let exclusiveStartKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
      ExpressionAttributeValues: marshall({ ':pk': tenantId, ':prefix': 'suppression#' }),
      ProjectionExpression: 'email',
      // Strongly consistent for the same reason the single-address read is:
      // this is the last check before mail leaves, so a suppression written
      // moments earlier must not be briefly invisible to it. Runs against the
      // base table, so DynamoDB supports it.
      ConsistentRead: true,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey })
    }));

    for (const item of result.Items || []) {
      const { email } = unmarshall(item);
      if (email) {
        suppressed.add(email.toLowerCase());
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return suppressed;
};

/**
 * Record a consent revocation. Written before the subscriber row is deleted so
 * that a failure here stops the removal entirely rather than leaving the
 * person unsubscribed with no durable record — which is the state a later CSV
 * import would quietly undo. Written even when the address is not currently on
 * the list: an unsubscribe click on an old email is still a statement about
 * future sends.
 *
 * Throws on failure. Consent state fails closed: the caller must not report a
 * durable unsubscribe it could not record, so the one-click endpoint answers
 * 5xx and the mail provider retries.
 */
/**
 * Which revocation methods carry proof that the address's owner is the one
 * acting.
 *
 * `one-click` and `encrypted-link` both require a token we minted into a
 * message delivered to that address, and a `complaint` comes from the
 * recipient's own mail provider. `manual-form` is the odd one out: it is the
 * no-token fallback where anyone can type any address, so it proves nothing
 * about who sent it.
 *
 * The distinction is recorded rather than acted on. Every suppression blocks
 * mail today — erring toward honouring an opt-out is the right default, and an
 * unverified request is still far more likely to be genuine than malicious.
 * But a suppression is durable and the add paths refuse to clear it, so an
 * unverified one is a state a third party can impose on someone with no
 * self-service way out. The confirmed re-opt-in flow needs to know which
 * suppressions were never verified in the first place, and that fact only
 * exists if it is written down when the record is made.
 *
 * `verified` is monotonic: it moves false → true and never back. Unlike the
 * other fields here, the question it answers is not "what happened first?" but
 * "has proof of ownership *ever* arrived?" — and proof arriving second is
 * still proof. Write-once would have discarded it: someone typing their
 * address into the fallback form and then using the real one-click link would
 * stay marked unverified forever. `lastVerified` cannot stand in for that
 * either, since manual → complaint → manual leaves both fields false with no
 * trace that a verified revocation ever happened.
 */
const VERIFIED_METHODS = new Set(['one-click', 'encrypted-link', 'complaint']);

export const recordSuppression = async (tenantId, emailAddress, method, metadata = {}) => {
  const now = new Date().toISOString();
  const names = { '#unsubscribedAt': 'unsubscribedAt', '#method': 'method' };
  const values = {
    ':now': now,
    ':method': method,
    ':email': emailAddress.toLowerCase(),
    ':verified': VERIFIED_METHODS.has(method)
  };

  // An `UpdateItem` with `if_not_exists`, not a `Put`.
  //
  // A Put to this deterministic key overwrote the record every time anything
  // touched it: a provider retrying a one-click POST, a spam complaint landing
  // after the person had already used the footer link, someone clicking an old
  // issue months later. Each of those rewrote `unsubscribedAt` and `method`,
  // so the record kept only the most recent duplicate signal.
  //
  // The fact this record exists to hold is *when consent was first revoked* —
  // that is the date that answers "were we allowed to send this?". So the
  // original instant and method are written once and never overwritten, while
  // `lastUnsubscribedAt` / `lastMethod` track the operational history. Retries
  // stay idempotent without erasing the chronology.
  let updateExpression =
    'SET #unsubscribedAt = if_not_exists(#unsubscribedAt, :now), '
    + '#method = if_not_exists(#method, :method), '
    // Verified proof latches on; an unverified signal only fills the gap when
    // nothing has been recorded yet, so it can never clear an earlier `true`.
    + (VERIFIED_METHODS.has(method)
      ? 'verified = :verified, '
      : 'verified = if_not_exists(verified, :verified), ')
    + 'email = :email, lastUnsubscribedAt = :now, lastMethod = :method, lastVerified = :verified';

  if (metadata.ipAddress) {
    values[':ipAddress'] = metadata.ipAddress;
    updateExpression += ', ipAddress = if_not_exists(ipAddress, :ipAddress), lastIpAddress = :ipAddress';
  }
  if (metadata.userAgent) {
    values[':userAgent'] = metadata.userAgent;
    updateExpression += ', userAgent = if_not_exists(userAgent, :userAgent), lastUserAgent = :userAgent';
  }

  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: suppressionSk(emailAddress)
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values)
    }));
  } catch (err) {
    console.error('Failed to write suppression record', {
      tenantId,
      method,
      error: err.message
    });
    throw err;
  }
};

/**
 * The outstanding consent revocation for an address, or null if there is none.
 *
 * Throws when the store cannot be read. "We checked and there is no
 * suppression" and "we could not check" are different facts, and collapsing
 * them into null made an unavailable consent store read as implicit consent —
 * a transient DynamoDB failure during an import would have re-subscribed
 * opted-out people. Callers must treat a throw as "cannot add this address"
 * and surface it, not swallow it.
 */
export const getSuppression = async (tenantId, emailAddress) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: suppressionSk(emailAddress)
      }),
      // A just-written suppression must not read as absent. This narrows the
      // window but does not close it — see `suppressionConditionCheck`, which
      // is what actually makes the record a write-time guard.
      ConsistentRead: true
    }));

    return result.Item ? unmarshall(result.Item) : null;
  } catch (err) {
    console.error('Failed to read suppression record', { tenantId, error: err.message });
    throw err;
  }
};

/**
 * Lift a suppression.
 *
 * Deliberately not wired to the public signup endpoint. That endpoint is
 * unauthenticated and takes a caller-supplied address, so a submission there
 * proves nothing about who sent it — anyone who knows an address could have
 * used it to erase that person's opt-out. Reactivation needs proof of
 * ownership (a confirmation link sent to the address itself), which is not
 * built yet; until it is, nothing in the request path calls this.
 *
 * Idempotent; never throws.
 */
export const clearSuppression = async (tenantId, emailAddress) => {
  try {
    await ddb.send(new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: suppressionSk(emailAddress)
      })
    }));
  } catch (err) {
    console.error('Failed to clear suppression record', { tenantId, error: err.message });
  }
};
