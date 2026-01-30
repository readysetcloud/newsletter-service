import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';

const scheduler = new SchedulerClient();

export const handler = async (event) => {
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

    const scheduleTime = calculateScheduleTime(publishedAt, '24h');
    const scheduleName = `aggregate-${tenantId}-${issueNumber}-24h`;

    await scheduler.send(new CreateScheduleCommand({
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
    }));

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
