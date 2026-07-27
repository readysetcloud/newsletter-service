import { jest } from '@jest/globals';

// Mock instances
const sesInstance = { send: jest.fn() };
const schedulerInstance = { send: jest.fn() };
const eventBridgeInstance = { send: jest.fn() };
const ddbInstance = { send: jest.fn() };

jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn(() => sesInstance),
  SendEmailCommand: jest.fn((params) => ({ __type: 'SendEmail', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn(() => schedulerInstance),
  CreateScheduleCommand: jest.fn((params) => ({ __type: 'CreateSchedule', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => eventBridgeInstance),
  PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ddbInstance),
  QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
  UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => ({ marshalled: obj })),
  unmarshall: jest.fn((obj) => obj.unmarshalled || obj)
}));

jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  encrypt: jest.fn((email) => `encrypted_${email}`),
  sendWithRetry: jest.fn(async (fn) => await fn())
}));

jest.unstable_mockModule('../functions/utils/subscriber.mjs', () => ({
  listSubscribers: jest.fn(() => Promise.resolve({ subscribers: [], lastEvaluatedKey: undefined })),
  getSubscriberByEmail: jest.fn(() => Promise.resolve(null)),
  updateSubscriberSendMetadata: jest.fn(() => Promise.resolve())
}));

// The local-send utils module is intentionally NOT mocked: it is pure and this
// suite verifies the handler's real grouping/scheduling behavior.

const { handler } = await import('../functions/send-email-v2.mjs');
const { listSubscribers, updateSubscriberSendMetadata } = await import('../functions/utils/subscriber.mjs');

const mockVerifiedSender = () => {
  ddbInstance.send.mockResolvedValue({});
  ddbInstance.send.mockResolvedValueOnce({
    Items: [{
      unmarshalled: {
        senderId: 'sender-123',
        email: 'sender@example.com',
        verificationStatus: 'verified',
        isDefault: true
      }
    }]
  });
};

const baseEvent = (overrides = {}) => ({
  detail: {
    subject: 'Weekly Issue',
    html: '<p>content</p>',
    to: { list: 'main' },
    from: 'sender@example.com',
    tenantId: 'tenant-123',
    referenceNumber: 'tenant-123_42',
    localSend: { enabled: true, defaultTimeZone: 'America/New_York' },
    ...overrides
  }
});

const schedulerCalls = () => schedulerInstance.send.mock.calls.map(([cmd]) => cmd);
const eventBridgeCalls = () => eventBridgeInstance.send.mock.calls.map(([cmd]) => cmd);
const parseScheduleDetail = (cmd) => JSON.parse(JSON.parse(cmd.Target.Input).Entries[0].Detail);
const parseEventDetail = (cmd) => JSON.parse(cmd.Entries[0].Detail);

/** DynamoDB writes against the issue's progress item, with their call order. */
const progressWrites = () =>
  ddbInstance.send.mock.calls
    .map(([cmd], index) => ({ cmd, order: ddbInstance.send.mock.invocationCallOrder[index] }))
    .filter(({ cmd }) => cmd.__type === 'UpdateItem' && cmd.Key?.marshalled?.sk === 'sendProgress');

/** The fan-out's plan write (the one that sets the whole group map). */
const planWrite = () =>
  progressWrites().find(({ cmd }) => cmd.UpdateExpression.includes('#groups = :groups'));

/** Per-group completion writes, by the group label each targeted. */
const markedLabels = () =>
  progressWrites()
    .filter(({ cmd }) => cmd.UpdateExpression.includes('#groups.#label.#status'))
    .map(({ cmd }) => cmd.ExpressionAttributeNames['#label']);

describe('send-email-v2 local send', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.CONFIGURATION_SET = 'test-config-set';
    process.env.SES_TPS_LIMIT = '100';
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123:role/scheduler';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    listSubscribers.mockResolvedValue({ subscribers: [], lastEvaluatedKey: undefined });
    sesInstance.send.mockResolvedValue({ MessageId: 'msg-1' });
    schedulerInstance.send.mockResolvedValue({});
    eventBridgeInstance.send.mockResolvedValue({ FailedEntryCount: 0 });
  });

  describe('fan-out', () => {
    test('splits subscribers into per-timezone group sends plus a catch-all', async () => {
      mockVerifiedSender();

      // Future send: 9am New York (EST) on Jan 15 = 14:00 UTC.
      const sendAt = '2099-01-15T14:00:00.000Z';
      listSubscribers.mockResolvedValue({
        subscribers: [
          { email: 'ny@example.com', timeZone: 'America/New_York' },
          { email: 'la@example.com', timeZone: 'America/Los_Angeles' },
          { email: 'none@example.com', timeZone: null }
        ],
        lastEvaluatedKey: undefined
      });

      const result = await handler(baseEvent({ sendAt }));

      expect(result).toMatchObject({ sent: false, localSend: true, groups: 3 });

      // Nothing sent inline during fan-out.
      expect(sesInstance.send).not.toHaveBeenCalled();

      const schedules = schedulerCalls();
      // 3 future group schedules (all in 2099) + 1 catch-all.
      expect(schedules).toHaveLength(4);

      const byDetailZone = new Map(
        schedules.map((cmd) => [parseScheduleDetail(cmd).localSendGroup.timeZone, cmd])
      );

      // New York group fires at the base instant.
      expect(byDetailZone.get('America/New_York').ScheduleExpression).toBe('at(2099-01-15T14:00:00)');
      // Los Angeles 9am = 17:00 UTC.
      expect(byDetailZone.get('America/Los_Angeles').ScheduleExpression).toBe('at(2099-01-15T17:00:00)');
      // Unconfirmed subscribers fire at the base instant.
      expect(byDetailZone.get('__default__').ScheduleExpression).toBe('at(2099-01-15T14:00:00)');
      // Catch-all 30 minutes after the latest group (17:00 + 0:30).
      expect(byDetailZone.get('__catch_all__').ScheduleExpression).toBe('at(2099-01-15T17:30:00)');

      // Group payloads must not carry the fan-out drivers.
      const groupPayload = parseScheduleDetail(byDetailZone.get('America/New_York'));
      expect(groupPayload.localSend).toBeUndefined();
      expect(groupPayload.sendAt).toBeUndefined();
      expect(groupPayload.referenceNumber).toBe('tenant-123_42');
    });

    test('emits already-due groups immediately instead of scheduling them', async () => {
      mockVerifiedSender();

      // No sendAt: base = now. Zones far east of the default have already
      // passed the target wall clock, so they are re-emitted immediately.
      listSubscribers.mockResolvedValue({
        subscribers: [
          { email: 'ny@example.com', timeZone: 'America/New_York' }
        ],
        lastEvaluatedKey: undefined
      });

      const result = await handler(baseEvent());

      // The New York group (== default zone) is due now → immediate emit.
      expect(result).toMatchObject({ localSend: true, groups: 1, immediate: 1, scheduled: 0 });

      const events = eventBridgeCalls().filter((cmd) => cmd.__type === 'PutEvents');
      expect(events).toHaveLength(1);
      expect(parseEventDetail(events[0]).localSendGroup.timeZone).toBe('America/New_York');

      // Catch-all is still scheduled for later.
      const schedules = schedulerCalls();
      expect(schedules).toHaveLength(1);
      expect(parseScheduleDetail(schedules[0]).localSendGroup.timeZone).toBe('__catch_all__');
    });

    // D9, both halves. A timezone east of the base zone reaches its own 9am
    // *before* the base instant, so whether it gets one depends entirely on
    // when the fan-out runs. That is what the publish lead time buys
    // (IssueSendLeadTimeMinutes in template.yaml): the workflow starts at
    // (send instant − lead time), and the fan-out is then early enough to
    // schedule those groups instead of firing them at once.
    //
    // The pair is deliberate. The second test is the behavior this system had
    // for as long as the lead time was 0 — an eastward subscriber got the issue
    // at whatever hour the send instant happened to be for them, which is the
    // one thing local send exists to avoid.
    describe('eastward timezones', () => {
      const EASTWARD_SUBSCRIBERS = [
        { email: 'ny@example.com', timeZone: 'America/New_York' },
        { email: 'london@example.com', timeZone: 'Europe/London' },
        { email: 'tokyo@example.com', timeZone: 'Asia/Tokyo' }
      ];

      // 9am New York on 2099-01-15 (EST) = 14:00 UTC.
      const SEND_AT = '2099-01-15T14:00:00.000Z';

      // Only the clock is faked: the SES pacer and retry backoff still need
      // real timers, and this suite drives the handler to completion.
      const freezeAt = (instant) =>
        jest.useFakeTimers({
          doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
          now: new Date(instant)
        });

      afterEach(() => {
        jest.useRealTimers();
      });

      test('are scheduled for their own local morning when the workflow starts early', async () => {
        mockVerifiedSender();
        freezeAt('2099-01-14T14:00:00.000Z'); // 24h lead
        listSubscribers.mockResolvedValue({
          subscribers: EASTWARD_SUBSCRIBERS,
          lastEvaluatedKey: undefined
        });

        const result = await handler(baseEvent({ sendAt: SEND_AT }));

        // Nothing fired at fan-out time: every group has a future target.
        expect(result).toMatchObject({ groups: 3, immediate: 0, scheduled: 3 });
        expect(eventBridgeCalls().filter((cmd) => cmd.__type === 'PutEvents')).toHaveLength(0);

        const byZone = new Map(
          schedulerCalls().map((cmd) => [parseScheduleDetail(cmd).localSendGroup.timeZone, cmd])
        );
        // Each eastward group lands ahead of the base instant - 9am London is
        // 09:00Z, 9am Tokyo is 00:00Z - which is exactly what a zero lead time
        // cannot express.
        expect(byZone.get('Europe/London').ScheduleExpression).toBe('at(2099-01-15T09:00:00)');
        expect(byZone.get('Asia/Tokyo').ScheduleExpression).toBe('at(2099-01-15T00:00:00)');
        expect(byZone.get('America/New_York').ScheduleExpression).toBe('at(2099-01-15T14:00:00)');
        // The catch-all still hangs off the latest group, which is the base
        // instant here rather than a westward zone.
        expect(byZone.get('__catch_all__').ScheduleExpression).toBe('at(2099-01-15T14:30:00)');
      });

      test('are sent at once when the workflow starts at the send instant', async () => {
        mockVerifiedSender();
        freezeAt(SEND_AT); // lead time 0
        listSubscribers.mockResolvedValue({
          subscribers: EASTWARD_SUBSCRIBERS,
          lastEvaluatedKey: undefined
        });

        const result = await handler(baseEvent({ sendAt: SEND_AT }));

        // Both eastward groups are already past their local 9am, and so is the
        // base zone's own group: all three go out together, hours late for
        // London and Tokyo.
        expect(result).toMatchObject({ groups: 3, immediate: 3, scheduled: 0 });

        const emitted = eventBridgeCalls()
          .filter((cmd) => cmd.__type === 'PutEvents')
          .map((cmd) => parseEventDetail(cmd).localSendGroup.timeZone);
        expect(new Set(emitted)).toEqual(
          new Set(['America/New_York', 'Europe/London', 'Asia/Tokyo'])
        );
        // Only the catch-all is scheduled.
        expect(schedulerCalls()).toHaveLength(1);
      });
    });

    test('schedule names stay unique and within 64 chars for long reference numbers', async () => {
      mockVerifiedSender();

      // A reference number long enough that a name built as
      // local-<ref>-<label>-<timestamp> would truncate away both the label and
      // the timestamp, colliding same-prefix groups.
      const longRef = `tenant-${'x'.repeat(70)}_42`;
      listSubscribers.mockResolvedValue({
        subscribers: [
          { email: 'in1@example.com', timeZone: 'America/Indiana/Indianapolis' },
          { email: 'in2@example.com', timeZone: 'America/Indiana/Vincennes' },
          { email: 'ny@example.com', timeZone: 'America/New_York' }
        ],
        lastEvaluatedKey: undefined
      });

      await handler(baseEvent({
        sendAt: '2099-01-15T14:00:00.000Z',
        referenceNumber: longRef
      }));

      const names = schedulerCalls().map((cmd) => cmd.Name);
      // 3 zone groups + catch-all, every name unique and within the limit.
      expect(names).toHaveLength(4);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) {
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toMatch(/^local-[0-9a-z]+/);
        expect(name).toMatch(/^[0-9a-zA-Z-_.]+$/);
      }
    });

    test('falls back to a plain send when the default timezone is invalid', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({
        subscribers: [{ email: 'a@example.com', timeZone: 'America/New_York' }],
        lastEvaluatedKey: undefined
      });
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await handler(baseEvent({
        localSend: { enabled: true, defaultTimeZone: 'Not/AZone' }
      }));

      consoleSpy.mockRestore();
      // Plain send happened: SES called, no local-send group schedules.
      expect(result.sent).toBe(true);
      expect(sesInstance.send).toHaveBeenCalledTimes(1);
      expect(schedulerCalls()).toHaveLength(0);
    });

    test('ignores localSend when an A/B test is active', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({
        subscribers: [{ email: 'a@example.com', timeZone: 'America/New_York' }],
        lastEvaluatedKey: undefined
      });

      await handler(baseEvent({
        abTest: {
          dimension: 'sendTime',
          status: 'pending',
          evaluateAfterMinutes: 60,
          variants: [
            { variantId: 'a', sendAt: '2099-01-15T14:00:00.000Z' },
            { variantId: 'b', sendAt: '2099-01-15T18:00:00.000Z' }
          ]
        }
      }));

      // No local-send group artifacts anywhere.
      const localSchedules = schedulerCalls().filter((cmd) => cmd.Name?.startsWith('local-'));
      expect(localSchedules).toHaveLength(0);
      const localEvents = eventBridgeCalls()
        .filter((cmd) => cmd.__type === 'PutEvents')
        .filter((cmd) => parseEventDetail(cmd).localSendGroup);
      expect(localEvents).toHaveLength(0);
    });

    test('does not fan out single-recipient sends', async () => {
      mockVerifiedSender();

      const result = await handler(baseEvent({ to: { email: 'one@example.com' } }));

      expect(result.sent).toBe(true);
      expect(schedulerCalls()).toHaveLength(0);
    });
  });

  describe('group re-entry', () => {
    const subscriberPool = [
      { email: 'ny1@example.com', timeZone: 'America/New_York' },
      { email: 'ny2@example.com', timeZone: 'America/New_York' },
      { email: 'la@example.com', timeZone: 'America/Los_Angeles' },
      { email: 'none@example.com', timeZone: null }
    ];

    test('sends only to the group timezone members', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: subscriberPool, lastEvaluatedKey: undefined });

      const result = await handler(baseEvent({
        localSend: undefined,
        localSendGroup: { timeZone: 'America/New_York' }
      }));

      expect(result.sent).toBe(true);
      expect(result.recipients).toBe(2);
      const sentTo = sesInstance.send.mock.calls.map(([cmd]) => cmd.Destination.ToAddresses[0]);
      expect(sentTo.sort()).toEqual(['ny1@example.com', 'ny2@example.com']);
    });

    test('the default group takes subscribers without a confirmed timezone', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: subscriberPool, lastEvaluatedKey: undefined });

      const result = await handler(baseEvent({
        localSend: undefined,
        localSendGroup: { timeZone: '__default__' }
      }));

      expect(result.recipients).toBe(1);
      expect(sesInstance.send.mock.calls[0][0].Destination.ToAddresses[0]).toBe('none@example.com');
    });

    test('the catch-all group takes everyone not already sent', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({
        subscribers: [
          { email: 'ny1@example.com', timeZone: 'America/New_York', lastIssueSent: 'tenant-123_42' },
          { email: 'la@example.com', timeZone: 'America/Los_Angeles', lastIssueSent: null },
          { email: 'none@example.com', timeZone: null, lastIssueSent: 'tenant-123_41' }
        ],
        lastEvaluatedKey: undefined
      });

      const result = await handler(baseEvent({
        localSend: undefined,
        localSendGroup: { timeZone: '__catch_all__' }
      }));

      // ny1 already received issue 42 (idempotency filter); la + none get it now.
      expect(result.recipients).toBe(2);
      expect(result.skipped).toBe(1);
      const sentTo = sesInstance.send.mock.calls.map(([cmd]) => cmd.Destination.ToAddresses[0]);
      expect(sentTo.sort()).toEqual(['la@example.com', 'none@example.com']);
    });

    test('an empty group completes without sending', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({
        subscribers: [{ email: 'ny@example.com', timeZone: 'America/New_York' }],
        lastEvaluatedKey: undefined
      });

      const result = await handler(baseEvent({
        localSend: undefined,
        localSendGroup: { timeZone: 'Europe/London' }
      }));

      expect(result.sent).toBe(true);
      expect(result.recipients).toBe(0);
      expect(sesInstance.send).not.toHaveBeenCalled();
    });

    test('group sends update subscriber send metadata for idempotency', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: subscriberPool, lastEvaluatedKey: undefined });

      await handler(baseEvent({
        localSend: undefined,
        localSendGroup: { timeZone: 'America/Los_Angeles' }
      }));

      expect(updateSubscriberSendMetadata).toHaveBeenCalledWith(
        'tenant-123',
        'la@example.com',
        'tenant-123_42'
      );
    });
  });

  describe('peak-hour mode', () => {
    // Histograms: two subscribers peak at UTC hour 14, one at hour 02, and
    // one has too little data to trust (openHourTotal below the 5-sample
    // minimum). String keys/counts mirror what DynamoDB round-trips produce.
    const peakHourPool = [
      { email: 'p14a@example.com', openHours: { 14: 7, 2: 3 }, openHourTotal: 10 },
      { email: 'p14b@example.com', openHours: { '14': '6' }, openHourTotal: '6' },
      { email: 'p02@example.com', openHours: { 2: 5 }, openHourTotal: 5 },
      { email: 'nodata@example.com', openHours: { 9: 2 }, openHourTotal: 2 }
    ];

    const peakHourEvent = (overrides = {}) => baseEvent({
      localSend: { enabled: true, defaultTimeZone: 'America/New_York', mode: 'peak-hour' },
      ...overrides
    });

    test('fans out one schedule per peak hour, preserving the base minute', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: peakHourPool, lastEvaluatedKey: undefined });

      // Future send at 09:30 UTC: hour 14 lands the same day at 14:30; hour 2
      // has already passed, so it wraps to the next day at 02:30.
      const result = await handler(peakHourEvent({ sendAt: '2099-01-15T09:30:00.000Z' }));

      expect(result).toMatchObject({
        sent: false,
        localSend: true,
        mode: 'peak-hour',
        groups: 3,
        immediate: 0,
        scheduled: 3
      });
      expect(sesInstance.send).not.toHaveBeenCalled();

      const schedules = schedulerCalls();
      // 3 hour groups + 1 catch-all.
      expect(schedules).toHaveLength(4);

      const byGroup = new Map(schedules.map((cmd) => {
        const group = parseScheduleDetail(cmd).localSendGroup;
        return ['peakHour' in group ? group.peakHour : group.timeZone, cmd];
      }));

      // Hour 14 fires the same day at the base's minute.
      expect(byGroup.get(14).ScheduleExpression).toBe('at(2099-01-15T14:30:00)');
      // Hour 2 has passed at fan-out time — next-day wrap.
      expect(byGroup.get(2).ScheduleExpression).toBe('at(2099-01-16T02:30:00)');
      // Insufficient-data subscribers fire at the base instant.
      expect(byGroup.get(null).ScheduleExpression).toBe('at(2099-01-15T09:30:00)');
      // Catch-all 30 minutes after the latest group (next-day 02:30 + 0:30).
      expect(byGroup.get('__catch_all__').ScheduleExpression).toBe('at(2099-01-16T03:00:00)');

      // Group payloads must not carry the fan-out drivers.
      const groupPayload = parseScheduleDetail(byGroup.get(14));
      expect(groupPayload.localSend).toBeUndefined();
      expect(groupPayload.sendAt).toBeUndefined();
      expect(groupPayload.referenceNumber).toBe('tenant-123_42');
    });

    test('emits the default group immediately when no sendAt is given', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({
        subscribers: [{ email: 'nodata@example.com', openHours: null, openHourTotal: null }],
        lastEvaluatedKey: undefined
      });

      const result = await handler(peakHourEvent());

      // base = now → the default group is due immediately.
      expect(result).toMatchObject({ localSend: true, mode: 'peak-hour', groups: 1, immediate: 1, scheduled: 0 });

      const events = eventBridgeCalls().filter((cmd) => cmd.__type === 'PutEvents');
      expect(events).toHaveLength(1);
      expect(parseEventDetail(events[0]).localSendGroup).toEqual({ peakHour: null });

      // Catch-all is still scheduled and keeps the timezone-shaped key.
      const schedules = schedulerCalls();
      expect(schedules).toHaveLength(1);
      expect(parseScheduleDetail(schedules[0]).localSendGroup).toEqual({ timeZone: '__catch_all__' });
    });

    test('re-entry with a peakHour filters to that hour group', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: peakHourPool, lastEvaluatedKey: undefined });

      const result = await handler(baseEvent({
        localSend: undefined,
        localSendGroup: { peakHour: 14 }
      }));

      expect(result.sent).toBe(true);
      expect(result.recipients).toBe(2);
      const sentTo = sesInstance.send.mock.calls.map(([cmd]) => cmd.Destination.ToAddresses[0]);
      expect(sentTo.sort()).toEqual(['p14a@example.com', 'p14b@example.com']);
    });

    test('re-entry with peakHour null takes the insufficient-data subscribers', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: peakHourPool, lastEvaluatedKey: undefined });

      const result = await handler(baseEvent({
        localSend: undefined,
        localSendGroup: { peakHour: null }
      }));

      expect(result.recipients).toBe(1);
      expect(sesInstance.send.mock.calls[0][0].Destination.ToAddresses[0]).toBe('nodata@example.com');
    });

    test('re-entry still applies the lastIssueSent idempotency filter', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({
        subscribers: [
          { email: 'p14a@example.com', openHours: { 14: 7 }, openHourTotal: 7, lastIssueSent: 'tenant-123_42' },
          { email: 'p14b@example.com', openHours: { 14: 6 }, openHourTotal: 6, lastIssueSent: null }
        ],
        lastEvaluatedKey: undefined
      });

      const result = await handler(baseEvent({
        localSend: undefined,
        localSendGroup: { peakHour: 14 }
      }));

      expect(result.recipients).toBe(1);
      expect(result.skipped).toBe(1);
      expect(sesInstance.send.mock.calls[0][0].Destination.ToAddresses[0]).toBe('p14b@example.com');
    });

    test('timezone mode is unaffected by histogram data (regression)', async () => {
      mockVerifiedSender();

      const sendAt = '2099-01-15T14:00:00.000Z';
      listSubscribers.mockResolvedValue({
        subscribers: [
          // Carries a strong histogram, but timezone mode must ignore it.
          { email: 'ny@example.com', timeZone: 'America/New_York', openHours: { 2: 50 }, openHourTotal: 50 },
          { email: 'la@example.com', timeZone: 'America/Los_Angeles', openHours: { 3: 50 }, openHourTotal: 50 }
        ],
        lastEvaluatedKey: undefined
      });

      const result = await handler(baseEvent({
        sendAt,
        localSend: { enabled: true, defaultTimeZone: 'America/New_York', mode: 'timezone' }
      }));

      expect(result).toMatchObject({ localSend: true, mode: 'timezone', groups: 2 });

      const schedules = schedulerCalls();
      expect(schedules).toHaveLength(3);
      const byDetailZone = new Map(
        schedules.map((cmd) => [parseScheduleDetail(cmd).localSendGroup.timeZone, cmd])
      );
      expect(byDetailZone.get('America/New_York').ScheduleExpression).toBe('at(2099-01-15T14:00:00)');
      expect(byDetailZone.get('America/Los_Angeles').ScheduleExpression).toBe('at(2099-01-15T17:00:00)');
      expect(byDetailZone.get('__catch_all__').ScheduleExpression).toBe('at(2099-01-15T17:30:00)');
    });
  });
  describe('progress tracking', () => {
    const pool = [
      { email: 'ny@example.com', timeZone: 'America/New_York' },
      { email: 'la@example.com', timeZone: 'America/Los_Angeles' },
      { email: 'none@example.com', timeZone: null }
    ];

    test('records the plan, including the catch-all, before emitting any group', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: pool, lastEvaluatedKey: undefined });

      await handler(baseEvent());

      const plan = planWrite();
      expect(plan).toBeDefined();

      const groups = plan.cmd.ExpressionAttributeValues.marshalled[':groups'];
      expect(Object.keys(groups).sort()).toEqual([
        'America/Los_Angeles',
        'America/New_York',
        '__catch_all__',
        '__default__'
      ]);
      expect(Object.values(groups).every((group) => group.status === 'pending')).toBe(true);

      // Ordering is load-bearing: a group due now is emitted immediately and can
      // report back within milliseconds. If the plan were written second, that
      // report would find no group to update and the issue would never leave
      // `sending`.
      const firstEmit = eventBridgeInstance.send.mock.invocationCallOrder[0];
      expect(plan.order).toBeLessThan(firstEmit);
    });

    test('every group the fan-out emits reports against a label the plan created', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: pool, lastEvaluatedKey: undefined });

      await handler(baseEvent());

      const plannedLabels = Object.keys(planWrite().cmd.ExpressionAttributeValues.marshalled[':groups']);
      const groupPayloads = [
        ...eventBridgeCalls().filter((cmd) => cmd.__type === 'PutEvents').map(parseEventDetail),
        ...schedulerCalls().map(parseScheduleDetail)
      ];
      expect(groupPayloads.length).toBe(plannedLabels.length);

      // Re-enter the handler as each group and check where its progress landed.
      for (const payload of groupPayloads) {
        jest.clearAllMocks();
        mockVerifiedSender();
        listSubscribers.mockResolvedValue({ subscribers: pool, lastEvaluatedKey: undefined });
        sesInstance.send.mockResolvedValue({ MessageId: 'msg-1' });

        await handler({ detail: payload });

        const marked = markedLabels();
        expect(marked).toHaveLength(1);
        expect(plannedLabels).toContain(marked[0]);
      }
    });

    test('a group with nothing left to send still reports, so the issue can complete', async () => {
      mockVerifiedSender();
      // Everyone already received this issue, which is the normal state of the
      // world by the time the catch-all sweep runs.
      listSubscribers.mockResolvedValue({
        subscribers: pool.map((subscriber) => ({ ...subscriber, lastIssueSent: 'tenant-123_42' })),
        lastEvaluatedKey: undefined
      });

      await handler({
        detail: {
          ...baseEvent().detail,
          localSend: undefined,
          localSendGroup: { timeZone: '__catch_all__' }
        }
      });

      expect(markedLabels()).toEqual(['__catch_all__']);
      const write = progressWrites().find(({ cmd }) =>
        cmd.UpdateExpression.includes('#groups.#label.#status')
      );
      expect(write.cmd.ExpressionAttributeValues.marshalled[':recipients']).toBe(0);
    });

    test('a plain list send records no progress', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({ subscribers: pool, lastEvaluatedKey: undefined });

      await handler({ detail: { ...baseEvent().detail, localSend: undefined } });

      expect(progressWrites()).toHaveLength(0);
    });

    test('peak-hour groups report against their hour labels', async () => {
      mockVerifiedSender();
      listSubscribers.mockResolvedValue({
        subscribers: [
          { email: 'p14@example.com', openHours: { 14: 7 }, openHourTotal: 10 },
          { email: 'thin@example.com', openHours: { 3: 1 }, openHourTotal: 1 }
        ],
        lastEvaluatedKey: undefined
      });

      await handler(baseEvent({ localSend: { enabled: true, defaultTimeZone: 'America/New_York', mode: 'peak-hour' } }));

      const groups = Object.keys(planWrite().cmd.ExpressionAttributeValues.marshalled[':groups']);
      expect(groups).toContain('hour-14');
      expect(groups).toContain('default');
      expect(groups).toContain('__catch_all__');
    });
  });
});
