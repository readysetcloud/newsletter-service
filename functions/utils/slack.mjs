/**
 * Post a rendered payload to a Slack incoming webhook.
 *
 * Fail-soft by contract: an unset webhook is a no-op, and a webhook that
 * rejects or is unreachable is logged rather than thrown. This is a
 * notification channel - it must never be the reason an alarm handler fails,
 * because the alternative is a failed invocation on the very path that exists
 * to tell someone something already went wrong.
 *
 * Mirrors the postToSlack contract used in olivias-garden-foundation so the
 * two services behave the same way when a webhook goes bad.
 *
 * @param {string} webhookUrl - Slack incoming webhook URL ('' disables posting)
 * @param {object} payload - Slack message payload (Block Kit)
 * @param {object} [context] - Log context, e.g. { alarmName, newState }
 * @returns {Promise<boolean>} true when Slack accepted the message
 */
export const postToSlack = async (webhookUrl, payload, context = {}) => {
  if (!webhookUrl?.trim()) {
    console.info(JSON.stringify({
      level: 'info',
      ...context,
      message: 'Slack webhook not configured; skipping notification'
    }));
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      // Without a bound, a hung webhook holds the invocation to the Lambda
      // timeout - a slow Slack should not stretch alarm handling.
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      console.error(JSON.stringify({
        level: 'error',
        ...context,
        status: response.status,
        message: 'Slack webhook returned non-success'
      }));
      return false;
    }

    console.info(JSON.stringify({
      level: 'info',
      ...context,
      message: 'Delivered Slack notification'
    }));
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      ...context,
      message: 'Slack webhook request failed',
      error: error instanceof Error ? error.message : String(error)
    }));
    return false;
  }
};

/**
 * Slack mrkdwn treats &, < and > as markup. Alarm text carries reasons and
 * metric expressions that contain all three (`threshold > 1`, `a && b`), so
 * they have to be escaped or the message renders mangled.
 */
export const escapeSlackMrkdwn = (text) => {
  if (typeof text !== 'string') {
    return text;
  }
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
};

/**
 * Slack rejects a message whose text exceeds the block limit, which would turn
 * a long alarm reason into no notification at all.
 */
export const truncate = (text, limit) => {
  if (typeof text !== 'string') {
    return null;
  }
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`;
};
