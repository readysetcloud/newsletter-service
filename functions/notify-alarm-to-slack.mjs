import { postToSlack, escapeSlackMrkdwn, truncate } from './utils/slack.mjs';

/**
 * Fan CloudWatch alarm notifications out to Slack.
 *
 * Subscribed to the stack's critical-alerts SNS topic, which every alarm in
 * the template targets. Before this existed the topic had no subscriptions at
 * all, so every alarm fired into nothing - correct alarms, nobody notified.
 *
 * SNS delivers each notification as its own record, but a subscription can
 * carry several, so each is handled independently: one malformed or
 * unrenderable record must not cost the others their notification.
 */

const STATE_PRESENTATION = {
  ALARM: { emoji: ':rotating_light:', label: 'ALARM' },
  OK: { emoji: ':white_check_mark:', label: 'RECOVERED' },
  INSUFFICIENT_DATA: { emoji: ':grey_question:', label: 'INSUFFICIENT DATA' }
};

const presentationFor = (state) =>
  STATE_PRESENTATION[state] ?? { emoji: ':warning:', label: state || 'UNKNOWN' };

/**
 * Build the Slack message for one CloudWatch alarm notification.
 *
 * Deliberately leads with what the reader has to decide - which alarm, what
 * state, in which environment - and keeps the reason and dimensions below it,
 * so a phone notification preview is already actionable.
 */
export const renderAlarmMessage = (alarm, { environment, region } = {}) => {
  const { emoji, label } = presentationFor(alarm.NewStateValue);
  const alarmName = escapeSlackMrkdwn(truncate(alarm.AlarmName, 200) ?? 'Unnamed alarm');
  const description = escapeSlackMrkdwn(truncate(alarm.AlarmDescription, 1500));
  const reason = escapeSlackMrkdwn(truncate(alarm.NewStateReason, 1500));

  const metric = alarm.Trigger?.MetricName;
  const namespace = alarm.Trigger?.Namespace;
  const dimensions = Array.isArray(alarm.Trigger?.Dimensions)
    ? alarm.Trigger.Dimensions
      .map((dimension) => `${dimension.name ?? dimension.Name}=${dimension.value ?? dimension.Value}`)
      .join(', ')
    : null;

  const fields = [
    { type: 'mrkdwn', text: `*State*\n${label}` },
    { type: 'mrkdwn', text: `*Environment*\n${escapeSlackMrkdwn(environment) ?? 'unknown'}` }
  ];

  if (metric) {
    fields.push({ type: 'mrkdwn', text: `*Metric*\n${escapeSlackMrkdwn(namespace ? `${namespace} / ${metric}` : metric)}` });
  }
  if (dimensions) {
    fields.push({ type: 'mrkdwn', text: `*Dimensions*\n${escapeSlackMrkdwn(truncate(dimensions, 300))}` });
  }
  if (alarm.StateChangeTime) {
    fields.push({ type: 'mrkdwn', text: `*Changed*\n${escapeSlackMrkdwn(alarm.StateChangeTime)}` });
  }

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${emoji} ${alarmName}*` } },
    { type: 'section', fields }
  ];

  if (description) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*What this means*\n${description}` } });
  }
  if (reason) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Why it fired*\n${reason}` } });
  }

  // Straight to the alarm's own console page - the first thing anyone opens.
  if (region && alarm.AlarmName) {
    const consoleUrl = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(alarm.AlarmName)}`;
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${consoleUrl}|Open in CloudWatch>` }]
    });
  }

  return {
    // Fallback text is what a notification preview and a screen reader use;
    // a blocks-only message shows as blank in both.
    text: `${label}: ${alarm.AlarmName ?? 'alarm'}`,
    blocks
  };
};

const parseAlarmRecord = (record) => {
  const raw = record?.Sns?.Message;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed?.AlarmName ? parsed : null;
  } catch {
    return null;
  }
};

export const handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  if (records.length === 0) {
    console.warn('Alarm notification carried no SNS records');
    return { delivered: 0, skipped: 0 };
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const environment = process.env.ENVIRONMENT;
  const region = process.env.AWS_REGION;

  let delivered = 0;
  let skipped = 0;

  for (const record of records) {
    const alarm = parseAlarmRecord(record);

    if (!alarm) {
      // Something other than a CloudWatch alarm reached the topic. Log the
      // subject rather than the body: an unknown payload on an alerts topic is
      // worth seeing, but it is not worth failing the batch over.
      console.warn('Skipping notification that is not a CloudWatch alarm', {
        subject: record?.Sns?.Subject ?? null
      });
      skipped++;
      continue;
    }

    const posted = await postToSlack(
      webhookUrl,
      renderAlarmMessage(alarm, { environment, region }),
      { alarmName: alarm.AlarmName, newState: alarm.NewStateValue }
    );

    if (posted) {
      delivered++;
    } else {
      skipped++;
    }
  }

  // Never throws: a Slack outage must not retry-storm the alerts topic, and
  // the alarm itself is already recorded in CloudWatch regardless.
  return { delivered, skipped };
};
