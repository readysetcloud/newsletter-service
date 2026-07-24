import { jest } from '@jest/globals';

process.env.TABLE_NAME = 'test-newsletter-table';

const ddbInstance = { send: jest.fn() };
const mockAgentInvoke = jest.fn();
const mockGetTenant = jest.fn();
let capturedAgentConfig;

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ddbInstance),
  GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
  UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((value) => value),
  unmarshall: jest.fn((value) => value)
}));

jest.unstable_mockModule('@strands-agents/sdk', () => ({
  Agent: jest.fn((config) => {
    capturedAgentConfig = config;
    return { invoke: mockAgentInvoke };
  }),
  BedrockModel: jest.fn((config) => config)
}));

jest.unstable_mockModule('@strands-agents/sdk/vended-tools/http-request', () => ({
  httpRequest: { name: 'httpRequest' }
}));

jest.unstable_mockModule('../../functions/utils/helpers.mjs', () => ({
  getTenant: mockGetTenant
}));

const { handler } = await import('../../functions/content/vet-content-candidate.mjs');

const goodVerdict = {
  recommendation: 'include',
  score: 0.85,
  title: 'Serverless Patterns Deep Dive',
  summary: 'A practical walkthrough of event-driven patterns.',
  reasons: ['relevant to focus', 'substantive article']
};

const candidateItem = (overrides = {}) => ({
  pk: 'tenant1#content-candidate#abc123',
  sk: 'candidate',
  tenantId: 'tenant1',
  urlHash: 'abc123',
  url: 'https://lnkd.in/xyz',
  originalUrl: 'https://lnkd.in/xyz',
  anchorText: 'must read',
  status: 'pending',
  submittedAt: '2026-07-20T12:00:00.000Z',
  post: { author: 'Jane Doe', text: 'This is great' },
  ...overrides
});

describe('vet-content-candidate', () => {
  let currentItem;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedAgentConfig = undefined;
    currentItem = candidateItem();

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve(currentItem ? { Item: currentItem } : {});
      }
      return Promise.resolve({});
    });

    mockAgentInvoke.mockResolvedValue({ structuredOutput: goodVerdict });

    mockGetTenant.mockResolvedValue({
      name: 'Ready, Set, Cloud!',
      brandDescription: 'Serverless and cloud content for builders',
      industry: 'Cloud computing'
    });

    global.fetch = jest.fn().mockResolvedValue({
      url: 'https://realblog.com/serverless-patterns',
      headers: { get: () => 'text/html' },
      text: async () => '<html></html>'
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  const invoke = (detail = { tenantId: 'tenant1', urlHash: 'abc123' }) => handler({ detail });

  test('vets a pending candidate and stores the verdict with the resolved URL', async () => {
    await invoke();

    const getCall = ddbInstance.send.mock.calls[0][0];
    expect(getCall.Key).toEqual({ pk: 'tenant1#content-candidate#abc123', sk: 'candidate' });

    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.__type).toBe('UpdateItem');
    expect(updateCall.UpdateExpression).toContain('resolvedUrl = :resolvedUrl');
    expect(updateCall.UpdateExpression).toContain('verdict = :verdict');
    expect(updateCall.ExpressionAttributeValues[':status']).toBe('vetted');
    expect(updateCall.ExpressionAttributeValues[':resolvedUrl']).toBe('https://realblog.com/serverless-patterns');
    expect(updateCall.ExpressionAttributeValues[':verdict']).toEqual(goodVerdict);
  });

  test('grounds the system prompt in the tenant brand', async () => {
    await invoke();

    expect(mockGetTenant).toHaveBeenCalledWith('tenant1');
    expect(capturedAgentConfig.systemPrompt).toContain('Ready, Set, Cloud!');
    expect(capturedAgentConfig.systemPrompt).toContain('Serverless and cloud content for builders');
  });

  test('passes post context and resolved URL to the agent prompt', async () => {
    await invoke();

    const prompt = mockAgentInvoke.mock.calls[0][0];
    expect(prompt).toContain('URL: https://realblog.com/serverless-patterns');
    expect(prompt).toContain('Originally shared as: https://lnkd.in/xyz');
    expect(prompt).toContain('Shared by: Jane Doe');
    expect(prompt).toContain('Post text: This is great');
  });

  test('marks the candidate failed when the agent errors', async () => {
    mockAgentInvoke.mockRejectedValue(new Error('model unavailable'));
    await invoke();

    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[':status']).toBe('failed');
    expect(updateCall.UpdateExpression).not.toContain('verdict');
  });

  test('marks the candidate failed on an invalid recommendation', async () => {
    mockAgentInvoke.mockResolvedValue({ structuredOutput: { ...goodVerdict, recommendation: 'definitely' } });
    await invoke();

    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[':status']).toBe('failed');
  });

  test('clamps out-of-range scores', async () => {
    mockAgentInvoke.mockResolvedValue({ structuredOutput: { ...goodVerdict, score: 4.2 } });
    await invoke();

    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[':verdict'].score).toBe(1);
  });

  test('skips candidates that are not pending', async () => {
    currentItem = candidateItem({ status: 'vetted' });
    await invoke();

    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
  });

  test('does nothing when the candidate is missing', async () => {
    currentItem = null;
    await invoke();

    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
  });

  test('does nothing without tenantId and urlHash', async () => {
    await invoke({});

    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('continues on the submitted URL when redirect resolution fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    await invoke();

    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.UpdateExpression).not.toContain('resolvedUrl');
    expect(updateCall.ExpressionAttributeValues[':status']).toBe('vetted');
    expect(mockAgentInvoke.mock.calls[0][0]).toContain('URL: https://lnkd.in/xyz');
  });
});
