/**
 * Throw unless every entry in a `PutEvents` response was accepted.
 *
 * EventBridge answers the API call successfully while rejecting individual
 * entries, so an awaited `PutEvents` is not a published event. Every place
 * that hands work to another Lambda this way had the same defect: the caller
 * treated "the call returned" as "the event is on the bus", and a rejected
 * entry silently dropped whatever it was carrying — an issue send, a timezone
 * group, an A/B variant, a welcome email, a pricing recalculation.
 *
 * Its own module rather than `helpers.mjs`: the send path should not import a
 * grab-bag of crypto, tenant caching and response formatting to get a ten-line
 * assertion, and neither should every test that mocks it. (helpers used to drag
 * in octokit and the Powertools parameter clients on top of that, which is what
 * made the split urgent; those are gone now, the reason is not.)
 *
 * @param {{FailedEntryCount?: number, Entries?: Array<{ErrorCode?: string, ErrorMessage?: string}>}} result
 * @param {string} what - what was being published, for the error message
 */
export const assertEventsPublished = (result, what) => {
  if (!result?.FailedEntryCount) {
    return;
  }

  const [failure] = (result.Entries || []).filter((entry) => entry.ErrorCode);
  throw new Error(
    `${what} rejected by EventBridge: ${failure?.ErrorCode || 'unknown'} ${failure?.ErrorMessage || ''}`.trim()
  );
};
