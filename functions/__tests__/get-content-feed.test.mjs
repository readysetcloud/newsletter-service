import { jest } from '@jest/globals';
import crypto from 'crypto';
import { marshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, GetItemCommand, QueryCommand } = await import('@aws-sdk/client-dynamodb');

process.env.TABLE_NAME = 'test-newsletter-table';

const { handler } = await import('../content/get-content-feed.mjs');

const makeApiKey = (tenantId = 'tenant1', keyId = 'key1') => {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, k: keyId, ts: 1700000000 })).toString('base64url');
  return `ak_${payload}.supersecret`;
};

const apiKey = makeApiKey();
const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

const candidate = (overrides = {}) => ({
  pk: 'tenant1#content-candidate#abc123',
  sk: 'candidate',
  tenantId: 'tenant1',
  urlHash: 'abc123',
  url: 'https://example.com/article',
  source: 'linkedin',
  status: 'vetted',
  submittedAt: '2026-07-20T12:00:00.000Z',
  vettedAt: '2026-07-20T12:01:00.000Z',
  verdict: {
    recommendation: 'include',
    score: 0.9,
    title: 'A Great Article',
    summary: 'Why this rocks.',
    reasons: ['relevant', 'high quality']
  },
  ...overrides
});

describe('get-content-feed', () => {
  let mockDdbSend;
  let queryResults;

  beforeEach(() => {
    queryResults = [];
    mockDdbSend = jest.fn().mockImplementation((command) => {
      if (command instanceof QueryCommand) {
        return Promise.resolve({ Items: queryResults.map(item => marshall(item, { removeUndefinedValues: true })) });
      }
      if (command instanceof GetItemCommand) {
        const sk = command.input.Key.sk.S;
        if (sk.startsWith('apikey#')) {
          return Promise.resolve({
            Item: marshall({
              pk: 'tenant1',
              sk,
              tenantId: 'tenant1',
              keyId: 'key1',
              hashedKey,
              status: 'active'
            })
          });
        }
        if (sk === 'tenant') {
          return Promise.resolve({ Item: marshall({ pk: 'tenant1', sk: 'tenant', name: 'Test Newsletter' }) });
        }
      }
      return Promise.resolve({});
    });
    DynamoDBClient.prototype.send = mockDdbSend;
    jest.clearAllMocks();
  });

  const invoke = ({ headers, query } = {}) => handler({
    headers,
    queryStringParameters: query
  });

  describe('auth', () => {
    test('returns 403 when no key is provided', async () => {
      const res = await invoke();
      expect(res.statusCode).toBe(403);
    });

    test('returns 403 for an invalid key', async () => {
      const res = await invoke({ query: { key: 'ak_garbage' } });
      expect(res.statusCode).toBe(403);
    });

    test('accepts the key via Authorization header', async () => {
      const res = await invoke({ headers: { Authorization: apiKey } });
      expect(res.statusCode).toBe(200);
    });

    test('accepts the key via query parameter', async () => {
      const res = await invoke({ query: { key: apiKey } });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('validation', () => {
    test('returns 400 for invalid days', async () => {
      for (const days of ['0', '32', 'abc', '2.5']) {
        const res = await invoke({ query: { key: apiKey, days } });
        expect(res.statusCode).toBe(400);
      }
    });

    test('returns 400 for an unknown format', async () => {
      const res = await invoke({ query: { key: apiKey, format: 'atom' } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('rss output', () => {
    test('returns an RSS document with vetted include/maybe items sorted by recommendation then score', async () => {
      queryResults = [
        candidate({ urlHash: 'skipme', verdict: { ...candidate().verdict, recommendation: 'skip' } }),
        candidate({ urlHash: 'maybe1', url: 'https://example.com/maybe', verdict: { ...candidate().verdict, recommendation: 'maybe', score: 0.5, title: 'Maybe Article' } }),
        candidate({ urlHash: 'pending1', status: 'pending', verdict: undefined }),
        candidate({ urlHash: 'lower', url: 'https://example.com/lower', verdict: { ...candidate().verdict, score: 0.7, title: 'Lower Score' } }),
        candidate()
      ];

      const res = await invoke({ query: { key: apiKey } });

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toMatch(/application\/rss\+xml/);
      expect(res.body).toContain('<rss version="2.0">');
      expect(res.body).toContain('Test Newsletter - Content Candidates');
      expect(res.body).toContain('A Great Article');
      expect(res.body).toContain('Maybe Article');
      expect(res.body).not.toContain('skipme');
      expect(res.body).not.toContain('pending1');

      // include items come before maybe items, higher scores first
      const order = ['A Great Article', 'Lower Score', 'Maybe Article']
        .map(title => res.body.indexOf(title));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order.every(index => index >= 0)).toBe(true);
    });

    test('includes evidence citations in item descriptions', async () => {
      queryResults = [candidate({
        verdict: { ...candidate().verdict, evidence: ['similar to Lambda tutorial from issue #40'] }
      })];

      const res = await invoke({ query: { key: apiKey } });

      expect(res.body).toContain('Backed by: similar to Lambda tutorial from issue #40');
    });

    test('escapes XML entities', async () => {
      queryResults = [candidate({
        url: 'https://example.com/a?b=1&c=2',
        verdict: { ...candidate().verdict, title: 'Ampersands & <Angles>' }
      })];

      const res = await invoke({ query: { key: apiKey } });

      expect(res.body).toContain('Ampersands &amp; &lt;Angles&gt;');
      expect(res.body).toContain('https://example.com/a?b=1&amp;c=2');
    });

    test('queries GSI1 with the tenant partition and trailing window', async () => {
      await invoke({ query: { key: apiKey, days: '14' } });

      const queryCall = mockDdbSend.mock.calls.find(call => call[0] instanceof QueryCommand);
      const input = queryCall[0].input;
      expect(input.IndexName).toBe('GSI1');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :pk AND GSI1SK >= :since');
      expect(input.ExpressionAttributeValues[':pk'].S).toBe('tenant1#content-candidates');

      const since = new Date(input.ExpressionAttributeValues[':since'].S).getTime();
      const expected = Date.now() - 14 * 24 * 60 * 60 * 1000;
      expect(Math.abs(since - expected)).toBeLessThan(5000);
    });
  });

  describe('json output', () => {
    test('returns all candidates including pending and skipped', async () => {
      queryResults = [
        candidate(),
        candidate({ urlHash: 'pending1', url: 'https://example.com/pending', status: 'pending', verdict: undefined, vettedAt: undefined }),
        candidate({ urlHash: 'resolved1', resolvedUrl: 'https://real-destination.com/post' })
      ];

      const res = await invoke({ query: { key: apiKey, format: 'json' } });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.count).toBe(3);
      expect(body.items).toHaveLength(3);

      const pending = body.items.find(item => item.urlHash === 'pending1');
      expect(pending.status).toBe('pending');
      expect(pending.verdict).toBeUndefined();

      const resolved = body.items.find(item => item.urlHash === 'resolved1');
      expect(resolved.url).toBe('https://real-destination.com/post');
      expect(resolved.submittedUrl).toBe('https://example.com/article');
    });
  });
});
