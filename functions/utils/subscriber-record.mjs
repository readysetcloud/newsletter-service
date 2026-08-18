/**
 * Telling real subscribers apart from the segment bookkeeping that shares
 * their table.
 *
 * The segments feature stores its records in the subscribers table under the
 * same tenant partition, overloading the `email` sort key:
 *
 *   SEGMENT#<segmentId>                    the segment itself
 *   SEGMENT#<segmentId>#MEMBER#<email>     a membership row
 *   SEGMENT_NAME#<lowercased name>         the name-uniqueness guard
 *   SEGMENT_JOB#<jobId>                    an in-flight rebuild job
 *
 * Every one of them begins with `SEGMENT`, so a single prefix check covers the
 * set. A tenant query returns them interleaved with subscribers, and any caller
 * that forgets to exclude them treats bookkeeping keys as sendable addresses.
 */

/**
 * Sort-key prefix owned by the segments feature.
 *
 * Deliberately not exported. It is tempting to hand it to a DynamoDB
 * `FilterExpression` so a count can be done server-side, but `email` is the
 * subscribers table's sort key and DynamoDB rejects key attributes in a filter
 * — that query fails at runtime, not at review. Readers page the rows and use
 * the predicate below.
 */
const SEGMENT_KEY_PREFIX = 'SEGMENT';

/**
 * Whether a raw record from the subscribers table is an actual subscriber.
 *
 * A record with no `email` is not one either: the attribute is this table's
 * sort key, so its absence means the item is not shaped like anything the
 * subscriber paths can use.
 *
 * @param {object} record - Unmarshalled item from the subscribers table
 * @returns {boolean}
 */
export const isSubscriberRecord = (record) =>
  typeof record?.email === 'string' && !record.email.startsWith(SEGMENT_KEY_PREFIX);
