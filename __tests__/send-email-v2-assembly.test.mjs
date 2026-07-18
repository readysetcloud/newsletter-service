import { jest } from '@jest/globals';

// Integration tests for the interest-aware assembly (contentAssembly) path of
// send-email-v2. Mock setup mirrors __tests__/send-email-v2.test.mjs.

// Mock instances
const sesInstance = { send: jest.fn() };
const schedulerInstance = { send: jest.fn() };
const eventBridgeInstance = { send: jest.fn() };
const ddbInstance = { send: jest.fn() };

// Mock AWS SDK
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

// Mock helpers
jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  encrypt: jest.fn((email) => `encrypted_${email}`),
  sendWithRetry: jest.fn(async (fn) => await fn())
}));

// Mock subscriber utility
jest.unstable_mockModule('../functions/utils/subscriber.mjs', () => ({
  listSubscribers: jest.fn(() => Promise.resolve({
    subscribers: [],
    lastEvaluatedKey: undefined
  })),
  getSubscriberByEmail: jest.fn(() => Promise.resolve(null)),
  updateSubscriberSendMetadata: jest.fn(() => Promise.resolve())
}));

// Import after mocks (the real interest-assembly util is used on purpose).
const { handler } = await import('../functions/send-email-v2.mjs');
const { listSubscribers } = await import('../functions/utils/subscriber.mjs');
const { sectionStartMarker, sectionEndMarker } = await import('../functions/utils/interest-assembly.mjs');

const wrap = (inner) => `${sectionStartMarker()}${inner}${sectionEndMarker()}`;

const markedHtml =
  '<html><body><p>Hello __EMAIL__</p>' +
  wrap('<h3>AI news</h3><a href="https://links.dev/ai-article">read</a>') +
  wrap('<h3>Serverless news</h3><a href="https://links.dev/serverless-article">read</a>') +
  wrap('<h3>Career corner</h3><a href="https://links.dev/career-article">read</a>') +
  '<footer>bye</footer></body></html>';

const strippedHtml = markedHtml
  .replace(/<!--ia-section start-->/g, '')
  .replace(/<!--ia-section end-->/g, '');

const linkItems = [
  { unmarshalled: { sk: 'link#1', url: 'https://links.dev/ai-article', primaryTopic: 'ai' } },
  { unmarshalled: { sk: 'link#2', url: 'https://links.dev/serverless-article', primaryTopic: 'serverless' } },
  { unmarshalled: { sk: 'link#3', url: 'https://links.dev/career-article', primaryTopic: 'career' } }
];

const senderQueryResult = {
  Items: [{
    unmarshalled: {
      senderId: 'sender-123',
      email: 'sender@example.com',
      verificationStatus: 'verified',
      isDefault: false
    }
  }]
};

// Distinguish the sender lookup (GSI1 query) from the link-records query
// (base-table query with a begins_with on sk).
const isLinkQuery = (cmd) =>
  cmd.__type === 'Query' && (cmd.KeyConditionExpression || '').includes(':linkPrefix');

const mockDdb = ({ linkQueryError = null, links = linkItems } = {}) => {
  ddbInstance.send.mockImplementation((cmd) => {
    if (isLinkQuery(cmd)) {
      if (linkQueryError) {
        return Promise.reject(linkQueryError);
      }
      return Promise.resolve({ Items: links });
    }
    if (cmd.__type === 'Query') {
      return Promise.resolve(senderQueryResult);
    }
    return Promise.resolve({});
  });
};

const baseDetail = (overrides = {}) => ({
  subject: 'Weekly Issue',
  html: markedHtml,
  to: { list: 'main-list' },
  from: 'sender@example.com',
  tenantId: 'tenant-123',
  referenceNumber: 'tenant-123_42',
  replacements: { emailAddress: '__EMAIL__', emailAddressHash: '__EMAIL_HASH__' },
  contentAssembly: { enabled: true },
  ...overrides
});

const sentHtmlFor = (email) => {
  const call = sesInstance.send.mock.calls.find(
    ([cmd]) => cmd.Destination.ToAddresses[0] === email
  );
  expect(call).toBeDefined();
  return call[0].Content.Simple.Body.Html.Data;
};

describe('send-email-v2 interest-aware assembly', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.CONFIGURATION_SET = 'test-config-set';
    process.env.SES_TPS_LIMIT = '100';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });
    mockDdb();
  });

  test('reorders sections per recipient by interest and still applies token replacement', async () => {
    listSubscribers.mockResolvedValue({
      subscribers: [
        {
          email: 'serverless-fan@example.com',
          interestScores: { serverless: { score: 9 }, ai: { score: 1 } }
        },
        {
          email: 'career-fan@example.com',
          interestScores: { career: { score: 4 } }
        }
      ],
      lastEvaluatedKey: undefined
    });

    const result = await handler({ detail: baseDetail() });
    expect(result.sent).toBe(true);
    expect(result.recipients).toBe(2);

    const serverlessHtml = sentHtmlFor('serverless-fan@example.com');
    expect(serverlessHtml.indexOf('Serverless news')).toBeLessThan(serverlessHtml.indexOf('AI news'));
    expect(serverlessHtml.indexOf('AI news')).toBeLessThan(serverlessHtml.indexOf('Career corner'));
    // Markers are stripped and personalization tokens replaced AFTER reordering.
    expect(serverlessHtml).not.toContain('ia-section');
    expect(serverlessHtml).toContain('Hello serverless-fan@example.com');
    expect(serverlessHtml).not.toContain('__EMAIL__');
    // Fixed chrome stays in place.
    expect(serverlessHtml.startsWith('<html><body><p>Hello serverless-fan@example.com</p>')).toBe(true);
    expect(serverlessHtml.endsWith('<footer>bye</footer></body></html>')).toBe(true);

    const careerHtml = sentHtmlFor('career-fan@example.com');
    expect(careerHtml.indexOf('Career corner')).toBeLessThan(careerHtml.indexOf('AI news'));
    expect(careerHtml.indexOf('AI news')).toBeLessThan(careerHtml.indexOf('Serverless news'));
  });

  test('subscribers without interest data get the original order (markers stripped)', async () => {
    listSubscribers.mockResolvedValue({
      subscribers: [
        { email: 'no-data@example.com' },
        { email: 'fan@example.com', interestScores: { career: { score: 2 } } }
      ],
      lastEvaluatedKey: undefined
    });

    await handler({ detail: baseDetail() });

    const noDataHtml = sentHtmlFor('no-data@example.com');
    expect(noDataHtml).toBe(
      strippedHtml
        .replace(/__EMAIL__/g, 'no-data@example.com')
        .replace(/__EMAIL_HASH__/g, 'encrypted_no-data@example.com')
    );
  });

  test('excluded topics rank last even for high scores elsewhere', async () => {
    listSubscribers.mockResolvedValue({
      subscribers: [
        {
          email: 'excluder@example.com',
          interestScores: { ai: { score: 10 } },
          excludedTopics: ['ai']
        }
      ],
      lastEvaluatedKey: undefined
    });

    await handler({ detail: baseDetail() });

    const html = sentHtmlFor('excluder@example.com');
    expect(html.indexOf('Serverless news')).toBeLessThan(html.indexOf('Career corner'));
    expect(html.indexOf('Career corner')).toBeLessThan(html.indexOf('AI news'));
  });

  test('loads link records exactly once regardless of recipient count', async () => {
    listSubscribers.mockResolvedValue({
      subscribers: Array.from({ length: 12 }, (_, i) => ({
        email: `user${i}@example.com`,
        interestScores: { serverless: { score: i } }
      })),
      lastEvaluatedKey: undefined
    });

    await handler({ detail: baseDetail() });

    const linkQueries = ddbInstance.send.mock.calls.filter(([cmd]) => isLinkQuery(cmd));
    expect(linkQueries).toHaveLength(1);
    expect(linkQueries[0][0].ExpressionAttributeValues.marshalled[':pk']).toBe('tenant-123#42');
    expect(sesInstance.send).toHaveBeenCalledTimes(12);
  });

  test('without the contentAssembly flag the HTML is sent untouched and no link query runs', async () => {
    listSubscribers.mockResolvedValue({
      subscribers: [{ email: 'a@example.com', interestScores: { ai: { score: 5 } } }],
      lastEvaluatedKey: undefined
    });

    await handler({ detail: baseDetail({ contentAssembly: undefined }) });

    expect(ddbInstance.send.mock.calls.filter(([cmd]) => isLinkQuery(cmd))).toHaveLength(0);
    // Markers travel through untouched (harmless HTML comments).
    const html = sentHtmlFor('a@example.com');
    expect(html).toContain('<!--ia-section start-->');
    expect(html.indexOf('AI news')).toBeLessThan(html.indexOf('Serverless news'));
  });

  test('no markers in the HTML (JSON-template issue): sends canonically and never queries links', async () => {
    listSubscribers.mockResolvedValue({
      subscribers: [{ email: 'a@example.com', interestScores: { ai: { score: 5 } } }],
      lastEvaluatedKey: undefined
    });

    const result = await handler({
      detail: baseDetail({ html: '<html><body><p>Hi __EMAIL__</p><p>No markers here</p></body></html>' })
    });

    expect(result.sent).toBe(true);
    expect(ddbInstance.send.mock.calls.filter(([cmd]) => isLinkQuery(cmd))).toHaveLength(0);
    expect(sentHtmlFor('a@example.com')).toContain('Hi a@example.com');
  });

  test('no classified link records: falls back to the event HTML for everyone', async () => {
    mockDdb({ links: [] });
    listSubscribers.mockResolvedValue({
      subscribers: [{ email: 'a@example.com', interestScores: { ai: { score: 5 } } }],
      lastEvaluatedKey: undefined
    });

    const result = await handler({ detail: baseDetail() });

    expect(result.sent).toBe(true);
    // Original order preserved (markers remain as inert comments).
    const html = sentHtmlFor('a@example.com');
    expect(html.indexOf('AI news')).toBeLessThan(html.indexOf('Serverless news'));
  });

  test('link record query failure never blocks the send', async () => {
    mockDdb({ linkQueryError: new Error('DynamoDB unavailable') });
    listSubscribers.mockResolvedValue({
      subscribers: [
        { email: 'a@example.com', interestScores: { serverless: { score: 5 } } },
        { email: 'b@example.com' }
      ],
      lastEvaluatedKey: undefined
    });

    const result = await handler({ detail: baseDetail() });

    expect(result.sent).toBe(true);
    expect(result.recipients).toBe(2);
    // Fallback: canonical order for everyone.
    const html = sentHtmlFor('a@example.com');
    expect(html.indexOf('AI news')).toBeLessThan(html.indexOf('Serverless news'));
  });

  test('assembly is skipped when a managed A/B test is active (variants must be identical)', async () => {
    listSubscribers.mockResolvedValue({
      subscribers: Array.from({ length: 20 }, (_, i) => ({
        email: `user${i}@example.com`,
        interestScores: { serverless: { score: i } }
      })),
      lastEvaluatedKey: undefined
    });
    schedulerInstance.send.mockResolvedValue({});

    const result = await handler({
      detail: baseDetail({
        abTest: {
          dimension: 'subject',
          testFraction: 0.5,
          evaluateAfterMinutes: 60,
          variants: [
            { variantId: 'a', subject: 'A' },
            { variantId: 'b', subject: 'B' }
          ]
        }
      })
    });

    expect(result.sent).toBe(true);
    expect(ddbInstance.send.mock.calls.filter(([cmd]) => isLinkQuery(cmd))).toHaveLength(0);
    // Every variant recipient receives the identical (unreordered) HTML modulo tokens.
    for (const [cmd] of sesInstance.send.mock.calls) {
      const html = cmd.Content.Simple.Body.Html.Data;
      expect(html.indexOf('AI news')).toBeLessThan(html.indexOf('Serverless news'));
    }
  });

  test('paginates the link record query and uses all pages', async () => {
    let callCount = 0;
    ddbInstance.send.mockImplementation((cmd) => {
      if (isLinkQuery(cmd)) {
        callCount += 1;
        if (callCount === 1) {
          expect(cmd.ExclusiveStartKey).toBeUndefined();
          return Promise.resolve({ Items: [linkItems[0]], LastEvaluatedKey: { pk: 'x' } });
        }
        expect(cmd.ExclusiveStartKey).toEqual({ pk: 'x' });
        return Promise.resolve({ Items: [linkItems[1], linkItems[2]] });
      }
      if (cmd.__type === 'Query') {
        return Promise.resolve(senderQueryResult);
      }
      return Promise.resolve({});
    });

    listSubscribers.mockResolvedValue({
      subscribers: [{ email: 'fan@example.com', interestScores: { career: { score: 3 } } }],
      lastEvaluatedKey: undefined
    });

    await handler({ detail: baseDetail() });

    expect(callCount).toBe(2);
    const html = sentHtmlFor('fan@example.com');
    // The career topic came from page 2 of the link query.
    expect(html.indexOf('Career corner')).toBeLessThan(html.indexOf('AI news'));
  });
});
