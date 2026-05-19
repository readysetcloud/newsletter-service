import { jest } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import zlib from 'zlib';

const { DynamoDBClient, PutItemCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.MAX_CONCURRENCY = '5';

const { handler } = await import('../process-campaign-click.mjs');

const buildLogsEvent = (logEvents) => {
  const payload = JSON.stringify({
    messageType: 'DATA_MESSAGE',
    owner: '123456789012',
    logGroup: '/aws/cloudfront/function/campaign-short-redirect',
    logStream: 'stream',
    subscriptionFilters: ['filter'],
    logEvents,
  });
  return {
    awslogs: { data: zlib.gzipSync(payload).toString('base64') },
  };
};

const wrappedLog = (json) => `2026-05-18T12:00:00Z ${JSON.stringify(json)}`;

describe('process-campaign-click', () => {
  let mockDdbSend;

  beforeEach(() => {
    mockDdbSend = jest.fn().mockResolvedValue({});
    DynamoDBClient.prototype.send = mockDdbSend;
    jest.clearAllMocks();
  });

  test('returns processed=0 for empty payload', async () => {
    const res = await handler(buildLogsEvent([]));
    const body = JSON.parse(res.body);
    expect(body.processed).toBe(0);
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  test('returns processed=0 when payload is undecodable', async () => {
    const res = await handler({ awslogs: { data: 'not-base64-gzipped' } });
    expect(res.statusCode).toBe(200);
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  test('writes a ClickEvent (with TTL) and increments AGGREGATE for one click', async () => {
    const ts = Date.parse('2026-05-18T12:00:00Z');
    const event = buildLogsEvent([
      { timestamp: ts, message: wrappedLog({ code: 'aB3xKp', u: 'https://dest.com', src: 'linkedin', ip: '1.2.3.4', s: null }) },
    ]);

    const res = await handler(event);
    expect(JSON.parse(res.body).processed).toBe(2);

    const puts = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof PutItemCommand);
    expect(puts).toHaveLength(1);
    const eventItem = unmarshall(puts[0].input.Item);
    expect(eventItem.pk).toBe('CAMPAIGN_LINK_CODE#aB3xKp');
    expect(eventItem.sk).toMatch(/^CLICK#2026-05-18T12:00:00\.000Z#[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(eventItem.code).toBe('aB3xKp');
    expect(eventItem.src).toBe('linkedin');
    expect(eventItem.destinationUrl).toBe('https://dest.com');
    expect(typeof eventItem.ttl).toBe('number');

    const updates = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof UpdateItemCommand);
    expect(updates).toHaveLength(1);
    const updateKey = unmarshall(updates[0].input.Key);
    expect(updateKey.pk).toBe('CAMPAIGN_LINK_CODE#aB3xKp');
    expect(updateKey.sk).toBe('AGGREGATE');
    expect(updates[0].input.UpdateExpression).toMatch(/ADD totalClicks/);
  });

  test('defaults src to "web" when not provided', async () => {
    const event = buildLogsEvent([
      { timestamp: Date.now(), message: wrappedLog({ code: 'aB3xKp', u: 'https://x.com' }) },
    ]);
    await handler(event);

    const updateCmd = mockDdbSend.mock.calls
      .map((c) => c[0])
      .find((c) => c instanceof UpdateItemCommand);
    expect(updateCmd.input.ExpressionAttributeNames['#src']).toBe('web');
  });

  test('skips log lines without a code field', async () => {
    const event = buildLogsEvent([
      { timestamp: Date.now(), message: 'plain text no JSON' },
      { timestamp: Date.now(), message: wrappedLog({ cid: 'something', u: 'https://x.com', src: 'web' }) },
      { timestamp: Date.now(), message: wrappedLog({ code: 123, u: 'https://x.com' }) },
    ]);
    const res = await handler(event);
    expect(JSON.parse(res.body).processed).toBe(0);
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  test('initializes byDay/bySrc maps on first ValidationException and retries', async () => {
    let updateCalls = 0;
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof UpdateItemCommand) {
        updateCalls++;
        if (updateCalls === 1) {
          const err = new Error('path does not exist');
          err.name = 'ValidationException';
          return Promise.reject(err);
        }
      }
      return Promise.resolve({});
    });

    const event = buildLogsEvent([
      { timestamp: Date.now(), message: wrappedLog({ code: 'aB3xKp', u: 'https://x.com', src: 'web' }) },
    ]);
    const res = await handler(event);
    expect(JSON.parse(res.body).processed).toBe(2);
    expect(updateCalls).toBeGreaterThanOrEqual(3);
  });

  test('processes multiple events in one invocation', async () => {
    const event = buildLogsEvent([
      { timestamp: Date.now(), message: wrappedLog({ code: 'AAA111', u: 'https://x.com' }) },
      { timestamp: Date.now(), message: wrappedLog({ code: 'BBB222', u: 'https://y.com' }) },
    ]);
    const res = await handler(event);
    expect(JSON.parse(res.body).processed).toBe(4);

    const puts = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof PutItemCommand);
    expect(puts).toHaveLength(2);
  });

  test('reports failures without throwing', async () => {
    const fatal = new Error('boom');
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof PutItemCommand) return Promise.reject(fatal);
      return Promise.resolve({});
    });

    const event = buildLogsEvent([
      { timestamp: Date.now(), message: wrappedLog({ code: 'AAA111', u: 'https://x.com' }) },
    ]);
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.failed).toBeGreaterThan(0);
  });
});
