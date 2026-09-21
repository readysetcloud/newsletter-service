import { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand } from '@aws-sdk/client-scheduler';

const scheduler = new SchedulerClient();

/** Detail-type raised once a local-send issue's fan-out plan is committed. */
const FANOUT_PLANNED = 'Issue Fanout Planned';

/** Detail-type raised when a local-send issue has finished delivering. */
const SEND_COMPLETED = 'Issue Send Completed';

/**
 * Schedules the 24-hour analytics aggregation for an issue.
 *
 * Three events reach this handler, booking progressively better windows for
 * the same schedule name:
 *
 * - **Issue Handed Off** fires when the rendered issue is passed to the send
 *   path. For a straightforward send that is also when it goes out, so
 *   `publishedAt + 24h` is right and is the only event that will arrive.
 * - **Issue Fanout Planned** fires moments later for a local send, once the
 *   plan is committed and `catchAllAt` is known. A local send keeps delivering
 *   for hours after hand-off - groups go out by timezone and the catch-all
 *   sweeps behind the last of them - so the hand-off window closes while later
 *   subscribers are still being sent to, counting them as deliveries that had
 *   no chance to open and deflating open rate. This moves it to 24 hours after
 *   the catch-all: the earliest window guaranteed to be past the whole send.
 * - **Issue Send Completed** fires when delivery genuinely finished, usually a
 *   little ahead of the catch-all deadline, and pulls the window back in so
 *   results are not held longer than they need to be.
 *
 * Booking at plan time rather than only at completion is what makes this
 * durable: the completion announcement is best-effort by design, so either
 * event alone has to be enough. The aggregator independently refuses to run
 * while a send is in flight, so even a stale firing defers rather than
 * publishing a half-sent number.
 */
export const handler = async (event) => {
  const detailType = event['detail-type'];

  // Both local-send paths sit outside the try below, deliberately.
  //
  // The hand-off path can afford to swallow: a non-local issue's window is
  // never in doubt. These two cannot. Returning a `{statusCode: 500}` object
  // from an asynchronously-invoked Lambda is a *successful* invocation as far
  // as EventBridge is concerned, so a swallowed scheduler failure here would
  // never be retried - and the window it failed to move is exactly the one
  // that fires mid-send and defers itself out of existence. The throw has to
  // escape the handler for the invocation's retry policy to see a failure.
  if (detailType === FANOUT_PLANNED) {
    return await scheduleForPlannedFanOut(event.detail);
  }

  if (detailType === SEND_COMPLETED) {
    return await rescheduleForCompletedSend(event.detail);
  }

  try {
    const { tenantId, data } = event.detail;
    const { issueNumber, publishedAt } = data || {};

    if (!tenantId || !issueNumber || !publishedAt) {
      console.error('Missing required parameters:', { tenantId, issueNumber, publishedAt });
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing required parameters' })
      };
    }

    const scheduleTime = ensureFutureScheduleTime(
      calculateScheduleTime(publishedAt, '24h')
    );
    const scheduleName = aggregationScheduleName(tenantId, issueNumber);

    await scheduler.send(new CreateScheduleCommand(
      buildScheduleInput({ scheduleName, scheduleTime, tenantId, issueNumber, publishedAt })
    ));

    console.log(`Created schedule ${scheduleName} for ${scheduleTime}`);

    return {
      success: true,
      scheduleName,
      scheduleTime
    };
  } catch (err) {
    console.error('Schedule creation error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to create schedule', error: err.message })
    };
  }
};

/**
 * Book the window for 24 hours after the catch-all sweep, as soon as the
 * fan-out plan says when that is.
 *
 * This is what makes the local-send window durable. The completion
 * announcement is best-effort by design - it is gated behind an exactly-once
 * stamp and swallows publish failures so a lost notification can never cause
 * the final group to redeliver - so if it were the only thing that re-booked
 * the window, losing one publish would leave the issue with no consolidated
 * analytics at all. Booking here too means either event alone is sufficient.
 *
 * @param {{tenantId?: string, issueNumber?: number|string, baseAt?: string, catchAllAt?: string}} detail
 */
const scheduleForPlannedFanOut = async (detail) => {
  const { tenantId, issueNumber, baseAt, catchAllAt } = detail || {};

  if (!tenantId || !issueNumber || !baseAt || !catchAllAt) {
    console.error('Fan-out planned without the fields needed to schedule aggregation', {
      tenantId,
      issueNumber,
      baseAt,
      catchAllAt
    });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing required parameters' })
    };
  }

  return bookAggregation({
    tenantId,
    issueNumber,
    publishedAt: baseAt,
    scheduleTime: ensureFutureScheduleTime(calculateScheduleTime(catchAllAt, '24h')),
    reason: 'fan-out planned'
  });
};

/**
 * Pull the window in to 24 hours after delivery actually finished, which is
 * usually a little ahead of the catch-all deadline booked at plan time.
 *
 * `baseAt` rides along as the aggregator's `publishedAt` input. For a
 * local-send issue that value is close to inert: every open and click carries
 * its own per-recipient send stamp, and the aggregator only falls back to the
 * issue-wide instant for records written before those stamps existed.
 *
 * @param {{tenantId?: string, issueNumber?: number|string, baseAt?: string}} detail
 */
const rescheduleForCompletedSend = async (detail) => {
  const { tenantId, issueNumber, baseAt } = detail || {};

  if (!tenantId || !issueNumber || !baseAt) {
    // Without a base instant there is nothing to hand the aggregator. The
    // fan-out's window stands, and that one is already past the send.
    console.error('Send completed without the fields needed to reschedule aggregation', {
      tenantId,
      issueNumber,
      baseAt
    });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing required parameters' })
    };
  }

  return bookAggregation({
    tenantId,
    issueNumber,
    publishedAt: baseAt,
    scheduleTime: ensureFutureScheduleTime(
      calculateScheduleTime(new Date().toISOString(), '24h')
    ),
    reason: 'send completed'
  });
};

/**
 * Move the issue's aggregation window, or create it when nothing booked one.
 *
 * Update rather than create, because hand-off books this name first and a
 * second schedule would mean two aggregations racing over one issue. A missing
 * schedule is not worth failing on - it just means hand-off never got one
 * booked - but every other scheduler failure propagates so the invocation
 * fails and is retried.
 */
const bookAggregation = async ({ tenantId, issueNumber, publishedAt, scheduleTime, reason }) => {
  const scheduleName = aggregationScheduleName(tenantId, issueNumber);
  const input = buildScheduleInput({ scheduleName, scheduleTime, tenantId, issueNumber, publishedAt });

  try {
    await scheduler.send(new UpdateScheduleCommand(input));
    console.log(`Moved schedule ${scheduleName} to ${scheduleTime} (${reason})`);
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err;
    }
    await scheduler.send(new CreateScheduleCommand(input));
    console.log(`Created schedule ${scheduleName} for ${scheduleTime} (${reason}, none existed)`);
  }

  return {
    success: true,
    scheduleName,
    scheduleTime
  };
};

const aggregationScheduleName = (tenantId, issueNumber) => `aggregate-${tenantId}-${issueNumber}-24h`;

const buildScheduleInput = ({ scheduleName, scheduleTime, tenantId, issueNumber, publishedAt }) => ({
  Name: scheduleName,
  GroupName: 'newsletter',
  ScheduleExpression: `at(${scheduleTime})`,
  Target: {
    Arn: process.env.AGGREGATION_FUNCTION_ARN,
    RoleArn: process.env.SCHEDULER_ROLE_ARN,
    Input: JSON.stringify({ tenantId, issueNumber, publishedAt })
  },
  FlexibleTimeWindow: {
    Mode: 'OFF'
  }
});

export function calculateScheduleTime(publishedAt, delay) {
  const publishTime = new Date(publishedAt);

  let delayMs;
  if (delay === '24h') {
    delayMs = 24 * 60 * 60 * 1000;
  } else if (delay === '7d') {
    delayMs = 7 * 24 * 60 * 60 * 1000;
  } else if (delay === '30d') {
    delayMs = 30 * 24 * 60 * 60 * 1000;
  } else {
    throw new Error(`Unsupported delay: ${delay}`);
  }

  const scheduleTime = new Date(publishTime.getTime() + delayMs);

  return scheduleTime.toISOString().replace(/\.\d{3}Z$/, '');
}

export function ensureFutureScheduleTime(scheduleTime) {
  const minScheduleTime = new Date(Date.now() + 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, '');
  const scheduleTimestamp = new Date(`${scheduleTime}Z`).getTime();
  const minTimestamp = new Date(`${minScheduleTime}Z`).getTime();

  return scheduleTimestamp < minTimestamp ? minScheduleTime : scheduleTime;
}
