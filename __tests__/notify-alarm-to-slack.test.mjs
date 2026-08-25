import { jest } from '@jest/globals';

const { handler, renderAlarmMessage } = await import('../functions/notify-alarm-to-slack.mjs');

const alarmPayload = (overrides = {}) => ({
  AlarmName: 'newsletter-service-send-email-v2-errors',
  AlarmDescription: 'CRITICAL: an issue send invocation failed',
  NewStateValue: 'ALARM',
  NewStateReason: 'Threshold Crossed: 1 datapoint [2.0] was greater than the threshold (1.0).',
  StateChangeTime: '2026-08-20T10:15:00.000+0000',
  Trigger: {
    MetricName: 'Errors',
    Namespace: 'AWS/Lambda',
    Dimensions: [{ name: 'FunctionName', value: 'SendEmailV2Function' }]
  },
  ...overrides
});

const snsEvent = (...alarms) => ({
  Records: alarms.map((alarm) => ({
    Sns: {
      Subject: 'ALARM: newsletter-service',
      Message: typeof alarm === 'string' ? alarm : JSON.stringify(alarm)
    }
  }))
});

describe('notify-alarm-to-slack', () => {
  let fetchMock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test';
    process.env.ENVIRONMENT = 'production';
    process.env.AWS_REGION = 'us-east-1';
    fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
    global.fetch = fetchMock;
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('rendering', () => {
    test('leads with the alarm name and state so a phone preview is actionable', () => {
      const message = renderAlarmMessage(alarmPayload(), { environment: 'production', region: 'us-east-1' });

      // Fallback text carries the decision-relevant bits; a blocks-only
      // message renders blank in notification previews and screen readers.
      expect(message.text).toBe('ALARM: newsletter-service-send-email-v2-errors');
      expect(message.blocks[0].text.text).toContain('newsletter-service-send-email-v2-errors');
      expect(message.blocks[0].text.text).toContain(':rotating_light:');
    });

    test('distinguishes recovery from firing', () => {
      const message = renderAlarmMessage(
        alarmPayload({ NewStateValue: 'OK', NewStateReason: 'Threshold no longer breached' }),
        { environment: 'production' }
      );

      expect(message.text).toBe('RECOVERED: newsletter-service-send-email-v2-errors');
      expect(message.blocks[0].text.text).toContain(':white_check_mark:');
    });

    test('carries metric, dimensions and environment as fields', () => {
      const message = renderAlarmMessage(alarmPayload(), { environment: 'production' });
      const fieldText = message.blocks[1].fields.map((field) => field.text).join('\n');

      expect(fieldText).toContain('AWS/Lambda / Errors');
      expect(fieldText).toContain('FunctionName=SendEmailV2Function');
      expect(fieldText).toContain('production');
    });

    test('escapes mrkdwn so a threshold reason does not render mangled', () => {
      const message = renderAlarmMessage(
        alarmPayload({ NewStateReason: 'value [2.0] was > threshold & still climbing' }),
        {}
      );
      const reasonBlock = message.blocks.find((block) => block.text?.text?.includes('Why it fired'));

      expect(reasonBlock.text.text).toContain('&gt;');
      expect(reasonBlock.text.text).toContain('&amp;');
      expect(reasonBlock.text.text).not.toMatch(/[^&]> threshold/);
    });

    test('truncates a long reason rather than letting Slack reject the message', () => {
      const message = renderAlarmMessage(alarmPayload({ NewStateReason: 'x'.repeat(4000) }), {});
      const reasonBlock = message.blocks.find((block) => block.text?.text?.includes('Why it fired'));

      expect(reasonBlock.text.text.length).toBeLessThan(1600);
      expect(reasonBlock.text.text).toContain('...');
    });

    test('links straight to the alarm in the console when a region is known', () => {
      const message = renderAlarmMessage(alarmPayload(), { region: 'us-east-1' });
      const context = message.blocks.find((block) => block.type === 'context');

      expect(context.elements[0].text).toContain('us-east-1.console.aws.amazon.com');
      expect(context.elements[0].text).toContain('Open in CloudWatch');
    });

    test('omits optional sections when the alarm carries no detail', () => {
      const message = renderAlarmMessage(
        { AlarmName: 'bare', NewStateValue: 'ALARM' },
        {}
      );

      expect(message.blocks.some((block) => block.text?.text?.includes('What this means'))).toBe(false);
      expect(message.blocks.some((block) => block.text?.text?.includes('Why it fired'))).toBe(false);
    });
  });

  describe('delivery', () => {
    test('posts one Slack message per alarm record', async () => {
      const result = await handler(snsEvent(alarmPayload(), alarmPayload({ AlarmName: 'second-alarm' })));

      expect(result).toEqual({ delivered: 2, skipped: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe('https://hooks.slack.com/services/test');
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    });

    test('a malformed record does not cost the others their notification', async () => {
      const result = await handler(snsEvent('not json at all', alarmPayload()));

      expect(result).toEqual({ delivered: 1, skipped: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('skips a notification that is not a CloudWatch alarm', async () => {
      const result = await handler(snsEvent(JSON.stringify({ someOther: 'payload' })));

      expect(result).toEqual({ delivered: 0, skipped: 1 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('is a no-op when no webhook is configured, rather than failing', async () => {
      process.env.SLACK_WEBHOOK_URL = '';

      const result = await handler(snsEvent(alarmPayload()));

      expect(result).toEqual({ delivered: 0, skipped: 1 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('does not throw when Slack rejects the message', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      // A Slack outage must not fail the invocation - retrying would storm the
      // alerts topic during an incident that is already underway.
      await expect(handler(snsEvent(alarmPayload()))).resolves.toEqual({ delivered: 0, skipped: 1 });
    });

    test('does not throw when the webhook is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(handler(snsEvent(alarmPayload()))).resolves.toEqual({ delivered: 0, skipped: 1 });
    });

    test('handles an event with no records', async () => {
      await expect(handler({})).resolves.toEqual({ delivered: 0, skipped: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
