import { jest } from '@jest/globals';

process.env.TABLE_NAME = 'test-newsletter-table';

const ddbInstance = { send: jest.fn() };
const mockAgentInvoke = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ddbInstance),
  GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
  QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
  PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((value) => value),
  unmarshall: jest.fn((value) => value)
}));

jest.unstable_mockModule('@strands-agents/sdk', () => ({
  Agent: jest.fn(() => ({ invoke: mockAgentInvoke })),
  BedrockModel: jest.fn((config) => config)
}));

const { handler } = await import('../../functions/content/learn-content-profile.mjs');

const editorialOutput = {
  summary: 'Practical serverless content with strong reader engagement.',
  patterns: ['tutorials outperform announcements']
};

const statsItem = (issueNumber, publishedAt = '2026-07-01T12:00:00.000Z') => ({
  pk: `tenant1#${issueNumber}`,
  sk: 'stats',
  issueNumber,
  publishedAt
});

const linkItem = (issueNumber, suffix, overrides = {}) => ({
  pk: `tenant1#${issueNumber}`,
  sk: `link#${suffix}`,
  url: `https://example.com/${issueNumber}/${suffix}`,
  position: 1,
  clicks_total: 5,
  primaryTopic: 'serverless',
  summary: `Article ${suffix} from issue ${issueNumber}`,
  ...overrides
});

describe('learn-content-profile', () => {
  let issueLinks;
  let existingProfile;

  beforeEach(() => {
    jest.clearAllMocks();
    existingProfile = null;
    issueLinks = {
      42: [linkItem(42, 'a', { clicks_total: 30 }), linkItem(42, 'b', { primaryTopic: 'ai', clicks_total: 2 })],
      41: [linkItem(41, 'c')]
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve(existingProfile ? { Item: existingProfile } : {});
      }
      if (command.__type === 'Query' && command.IndexName === 'GSI1') {
        const issues = Object.keys(issueLinks).map(Number).sort((a, b) => b - a);
        return Promise.resolve({ Items: issues.map(n => statsItem(n)) });
      }
      if (command.__type === 'Query') {
        const issueNumber = command.ExpressionAttributeValues[':pk'].split('#')[1];
        return Promise.resolve({ Items: issueLinks[issueNumber] ?? [] });
      }
      return Promise.resolve({});
    });

    mockAgentInvoke.mockResolvedValue({ structuredOutput: editorialOutput });
  });

  const putCall = () => ddbInstance.send.mock.calls.map(call => call[0]).find(cmd => cmd.__type === 'PutItem');

  test('builds the profile from recent issue link records', async () => {
    await handler({ detail: { tenantId: 'tenant1' } });

    const profile = putCall().Item;
    expect(profile.pk).toBe('tenant1');
    expect(profile.sk).toBe('content-profile');
    expect(Object.keys(profile.issueDigests).sort()).toEqual(['41', '42']);
    expect(profile.topicWeights.serverless).toEqual({ featured: 2, clicks: 35 });
    expect(profile.topicWeights.ai).toEqual({ featured: 1, clicks: 2 });
    expect(profile.exemplars[0].url).toBe('https://example.com/42/a');
    expect(profile.editorialProfile.summary).toBe(editorialOutput.summary);
    expect(profile.editorialProfile.patterns).toEqual(editorialOutput.patterns);
    expect(profile.editorialProfile.issuesAnalyzed).toBe(2);
    expect(profile.editorialProfile.linksAnalyzed).toBe(3);
  });

  test('supports direct backfill invocation', async () => {
    await handler({ tenantId: 'tenant1', backfill: true });
    expect(putCall()).toBeDefined();
  });

  test('feeds the aggregated evidence to the learning agent', async () => {
    await handler({ detail: { tenantId: 'tenant1' } });

    const prompt = mockAgentInvoke.mock.calls[0][0];
    expect(prompt).toContain('Issues analyzed: 2');
    expect(prompt).toContain('serverless: featured 2 times, 35 reader clicks');
    expect(prompt).toContain('Article a from issue 42');
  });

  test('retains digests for issues whose link records expired', async () => {
    existingProfile = {
      pk: 'tenant1',
      sk: 'content-profile',
      issueDigests: {
        30: {
          issueNumber: 30,
          publishedAt: '2026-01-05T12:00:00.000Z',
          linkCount: 4,
          topics: { databases: { featured: 4, clicks: 12 } },
          topLinks: [{ url: 'https://old.com/db', summary: 'Old DB deep dive', primaryTopic: 'databases', clicks: 12 }]
        }
      }
    };

    await handler({ detail: { tenantId: 'tenant1' } });

    const profile = putCall().Item;
    expect(Object.keys(profile.issueDigests).sort()).toEqual(['30', '41', '42']);
    expect(profile.topicWeights.databases).toEqual({ featured: 4, clicks: 12 });
  });

  test('keeps the previous editorial profile when generation fails', async () => {
    existingProfile = {
      pk: 'tenant1',
      sk: 'content-profile',
      issueDigests: {},
      editorialProfile: { summary: 'Previous summary', patterns: [], issuesAnalyzed: 1, linksAnalyzed: 2 }
    };
    mockAgentInvoke.mockRejectedValue(new Error('model down'));

    await handler({ detail: { tenantId: 'tenant1' } });

    expect(putCall().Item.editorialProfile.summary).toBe('Previous summary');
  });

  test('does not write a profile when there is nothing to learn from', async () => {
    issueLinks = {};

    await handler({ detail: { tenantId: 'tenant1' } });

    expect(putCall()).toBeUndefined();
  });

  test('does nothing without a tenantId', async () => {
    await handler({ detail: {} });
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });
});
