import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
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
export const recordSuppression = async (tenantId, emailAddress, method, metadata = {}) => {
  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: tenantId,
        sk: suppressionSk(emailAddress),
        email: emailAddress.toLowerCase(),
        unsubscribedAt: new Date().toISOString(),
        method,
        ...(metadata.ipAddress && { ipAddress: metadata.ipAddress }),
        ...(metadata.userAgent && { userAgent: metadata.userAgent })
      })
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
      })
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
