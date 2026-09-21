import { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand } from '@aws-sdk/client-scheduler';

const scheduler = new SchedulerClient();

/** Detail-type raised when a local-send issue has finished delivering. */
const SEND_COMPLETED = 'Issue Send Completed';

/**
 * Schedules the 24-hour analytics aggregation for an issue.
 *
 * Two events reach this handler, and the distinction matters:
 *
 * - **Issue Handed Off** fires when the rendered issue is passed to the send
 *   path. For a straightforward send that is also when it goes out, so
 *   `publishedAt + 24h` is the right window.
 * - **Issue Send Completed** fires when a local-send issue has genuinely
 *   finished delivering, which can be the better part of a day after the
 *   hand-off: groups fan out by timezone and the catch-all sweeps behind the
 *   last of them. Measured from the hand-off, the 24-hour window closes while
 *   later subscribers are still being sent to, counting them as deliveries
 *   that had no chance to open and deflating open rate.
 *
 * The hand-off still schedules, so a non-local issue is unaffected and a local
 * one always has a window booked. Completion then pushes that window out to 24
 * hours after the last email actually left. The aggregator independently
 * refuses to run while a send is in flight, so an early firing defers rather
 * than publishing a half-sent number.
 */
export const handler = async (event) => {
  try {
    if (event['detail-type'] === SEND_COMPLETED) {
      return await rescheduleForCompletedSend(event.detail);
    }

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
 * Move an issue's aggregation window to 24 hours after its send finished.
 *
 * `baseAt` rides along on the completion event as the aggregator's
 * `publishedAt` input. For a local-send issue that value is close to inert:
 * every open and click carries its own per-recipient send stamp, and the
 * aggregator only falls back to the issue-wide instant for records written
 * before those stamps existed.
 *
 * Update rather than create, because the hand-off already booked this name.
 * A missing schedule is not an error worth failing on - it just means the
 * hand-off never got one booked, so this creates it instead.
 *
 * @param {{tenantId?: string, issueNumber?: number|string, baseAt?: string}} detail
 */
const rescheduleForCompletedSend = async (detail) => {
  const { tenantId, issueNumber, baseAt } = detail || {};

  if (!tenantId || !issueNumber || !baseAt) {
    // Without a base instant there is nothing to hand the aggregator. The
    // hand-off's schedule stands, and the in-flight guard keeps it honest.
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

  const scheduleTime = ensureFutureScheduleTime(
    calculateScheduleTime(new Date().toISOString(), '24h')
  );
  const scheduleName = aggregationScheduleName(tenantId, issueNumber);
  const input = buildScheduleInput({
    scheduleName,
    scheduleTime,
    tenantId,
    issueNumber,
    publishedAt: baseAt
  });

  try {
    await scheduler.send(new UpdateScheduleCommand(input));
    console.log(`Moved schedule ${scheduleName} to ${scheduleTime} (send completed)`);
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err;
    }
    await scheduler.send(new CreateScheduleCommand(input));
    console.log(`Created schedule ${scheduleName} for ${scheduleTime} (send completed, none existed)`);
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
