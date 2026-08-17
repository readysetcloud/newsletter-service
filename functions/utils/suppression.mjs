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
 *  - Bulk import refuses to re-add a suppressed address.
 *  - The single-address signup endpoint treats a fresh signup as new consent:
 *    it clears the record and proceeds. That is the deliberate difference —
 *    the person can always come back; a CSV cannot bring them back.
 *  - Operator actions (dashboard delete, bounce cleanup) do NOT suppress:
 *    neither is a consent revocation, and the operator may re-add on purpose.
 */

const suppressionSk = (email) => `suppression#${email.toLowerCase()}`;

/**
 * Record a consent revocation. Written before the subscriber row is deleted so
 * a crash between the two still leaves the revocation on record, and written
 * even when the address is not currently on the list — an unsubscribe click on
 * an old email is still a statement about future sends.
 *
 * Never throws: the removal itself must not fail because its paper trail
 * could not be written.
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
    return true;
  } catch (err) {
    console.error('Failed to write suppression record', {
      tenantId,
      method,
      error: err.message
    });
    return false;
  }
};

/**
 * Whether an address has an outstanding consent revocation.
 * Fails open (returns null) on error: the callers that consult this are add
 * paths, and "could not check" must not turn into "could not import anything".
 * Returns the record when suppressed, null otherwise.
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
    return null;
  }
};

/**
 * Lift a suppression — only ever called when the person themselves re-subscribes
 * through the signup endpoint, which is fresh consent. Idempotent; never throws.
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
