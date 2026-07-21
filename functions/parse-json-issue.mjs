/**
 * Prepares a non-markdown issue ("json" or "html") for publishing.
 *
 * - json: `content` is a JSON string holding the template data object directly
 *   (the same shape `parse-md-to-json` derives from markdown); it is validated.
 * - html: `content` is a pre-rendered email master; it is carried through on the
 *   data object as `__master` and sent verbatim by publish-issue (no template
 *   render). This is the bring-your-own-renderer path.
 *
 * Either way this produces the identical output contract as `parse-md-to-json`
 * so the rest of the state machine is unchanged:
 *
 *   { data, sendAtDate, listCleanupDate, reportStatsDate, subject }
 */
export const handler = async (state) => {
  const issueNumber = Number(state.issueId);
  if (!Number.isFinite(issueNumber) || issueNumber < 1) {
    throw new Error('Invalid or missing issueId');
  }

  let data;
  if (state.contentType === 'html') {
    // html mode: `content` is a pre-rendered email master, not structured data.
    // Carry it on the data object under `__master` so publish-issue sends it
    // verbatim (skipping the template render). No parsing/validation of the HTML.
    data = { metadata: { number: issueNumber }, __master: String(state.content ?? '') };
  } else {
    try {
      data = typeof state.content === 'string' ? JSON.parse(state.content) : state.content;
    } catch (err) {
      throw new Error(`Issue content is not valid JSON: ${err.message}`);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Issue content must be a JSON object');
    }

    // The publish step reads data.metadata.number, so guarantee it matches the
    // issue regardless of what the author supplied.
    data.metadata = { ...(data.metadata ?? {}) };
    data.metadata.number = issueNumber;
  }

  const now = new Date();
  const scheduled = state.futureDate ? new Date(state.futureDate) : null;
  const hasFutureSend = scheduled && !Number.isNaN(scheduled.getTime()) && scheduled > now;

  const sendAtDate = hasFutureSend ? scheduled.toISOString() : 'now';

  // Mirror parse-md-to-json: schedule downstream jobs relative to the send day
  // at 14:00, cleanup +3 days and stats report +5 days.
  const baseDate = hasFutureSend ? new Date(scheduled) : new Date(now);
  baseDate.setHours(14, 0, 0, 0);

  const listCleanupDate = new Date(baseDate);
  listCleanupDate.setDate(listCleanupDate.getDate() + 3);

  const reportStatsDate = new Date(baseDate);
  reportStatsDate.setDate(reportStatsDate.getDate() + 5);

  const subject =
    (typeof state.subject === 'string' && state.subject.trim()) ||
    (typeof data.metadata.title === 'string' && data.metadata.title.trim()) ||
    `Newsletter Issue #${issueNumber}`;

  return {
    data,
    sendAtDate,
    listCleanupDate: listCleanupDate.toISOString().split('.')[0],
    reportStatsDate: reportStatsDate.toISOString().split('.')[0],
    subject
  };
};
