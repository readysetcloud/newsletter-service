import { jest } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');

process.env.TABLE_NAME = 'test-newsletter-table';

const { handler } = await import('../content/submit-content-candidate.mjs');

const conditionalFailure = () => {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
};

describe('submit-content-candidate', () => {
  let mockDdbSend;
  let mockEbSend;

  beforeEach(() => {
    mockDdbSend = jest.fn().mockResolvedValue({});
    mockEbSend = jest.fn().mockResolvedValue({});
    DynamoDBClient.prototype.send = mockDdbSend;
    EventBridgeClient.prototype.send = mockEbSend;
    jest.clearAllMocks();
  });

  const invoke = (body, tenantId = 'tenant1') => handler({
    requestContext: { authorizer: tenantId ? { tenantId } : {} },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });

  describe('auth and validation', () => {
    test('returns 403 without tenant context', async () => {
      const res = await invoke({ links: [{ url: 'https://example.com' }] }, null);
      expect(res.statusCode).toBe(403);
    });

    test('returns 400 when body is missing', async () => {
      const res = await invoke(undefined);
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when body is invalid JSON', async () => {
      const res = await invoke('{not json');
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when links is missing or empty', async () => {
      for (const links of [undefined, [], 'https://example.com']) {
        const res = await invoke({ links });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).message).toMatch(/links/);
      }
    });

    test('returns 400 when links exceeds the max', async () => {
      const links = Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/${i}` }));
      const res = await invoke({ links });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for an unknown source', async () => {
      const res = await invoke({ links: [{ url: 'https://example.com' }], source: 'carrier-pigeon' });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/source/);
    });

    test('returns 400 when post is not an object', async () => {
      const res = await invoke({ links: [{ url: 'https://example.com' }], post: 'hello' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('happy path', () => {
    test('stores a normalized candidate and publishes a vetting event', async () => {
      const res = await invoke({
        links: [{ url: 'https://Example.com/article/?utm_source=li', anchorText: 'Great read' }],
        source: 'linkedin',
        post: { author: 'Jane Doe', text: 'Loved this piece', url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/' }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.accepted).toHaveLength(1);
      expect(body.accepted[0].url).toBe('https://example.com/article');
      expect(body.duplicates).toHaveLength(0);
      expect(body.invalid).toHaveLength(0);

      expect(mockDdbSend).toHaveBeenCalledTimes(1);
      const putInput = mockDdbSend.mock.calls[0][0].input;
      expect(mockDdbSend.mock.calls[0][0]).toBeInstanceOf(PutItemCommand);
      expect(putInput.ConditionExpression).toBe('attribute_not_exists(pk)');

      const item = unmarshall(putInput.Item);
      expect(item.pk).toBe(`tenant1#content-candidate#${item.urlHash}`);
      expect(item.sk).toBe('candidate');
      expect(item.GSI1PK).toBe('tenant1#content-candidates');
      expect(item.GSI1SK).toBe(`${item.submittedAt}#${item.urlHash}`);
      expect(item.status).toBe('pending');
      expect(item.url).toBe('https://example.com/article');
      expect(item.originalUrl).toBe('https://Example.com/article/?utm_source=li');
      expect(item.anchorText).toBe('Great read');
      expect(item.source).toBe('linkedin');
      expect(item.post).toEqual({
        author: 'Jane Doe',
        text: 'Loved this piece',
        url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/'
      });
      expect(item.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));

      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const eventEntry = mockEbSend.mock.calls[0][0].input.Entries[0];
      expect(eventEntry.DetailType).toBe('Content Candidate Submitted');
      const detail = JSON.parse(eventEntry.Detail);
      expect(detail).toMatchObject({ tenantId: 'tenant1', urlHash: item.urlHash });
    });

    test('accepts plain string links', async () => {
      const res = await invoke({ links: ['https://example.com/post'] });
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).accepted[0].url).toBe('https://example.com/post');
    });

    test('reports duplicates without publishing events for them', async () => {
      mockDdbSend
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(conditionalFailure());

      const res = await invoke({
        links: [{ url: 'https://example.com/new' }, { url: 'https://example.com/existing' }]
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.accepted).toHaveLength(1);
      expect(body.duplicates).toEqual(['https://example.com/existing']);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
    });

    test('returns 200 when everything is a duplicate or invalid', async () => {
      mockDdbSend.mockRejectedValue(conditionalFailure());

      const res = await invoke({ links: [{ url: 'https://example.com/existing' }, { url: 'notaurl' }] });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.accepted).toHaveLength(0);
      expect(body.duplicates).toEqual(['https://example.com/existing']);
      expect(body.invalid).toEqual(['notaurl']);
      expect(mockEbSend).not.toHaveBeenCalled();
    });

    test('rejects non-http links as invalid without failing the request', async () => {
      const res = await invoke({ links: [{ url: 'ftp://example.com/file' }, { url: 'https://example.com/good' }] });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.invalid).toEqual(['ftp://example.com/file']);
      expect(body.accepted).toHaveLength(1);
    });

    test('drops empty post context', async () => {
      await invoke({ links: [{ url: 'https://example.com/a' }], post: { author: '  ' } });
      const item = unmarshall(mockDdbSend.mock.calls[0][0].input.Item);
      expect(item.post).toBeUndefined();
    });

    test('propagates unexpected DynamoDB errors', async () => {
      mockDdbSend.mockRejectedValue(new Error('boom'));
      await expect(invoke({ links: [{ url: 'https://example.com/a' }] })).rejects.toThrow('boom');
    });
  });
});
