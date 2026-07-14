import { jest } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const mockDdbSend = jest.fn();
const mockInvoke = jest.fn();
const mockAgent = jest.fn(() => ({ invoke: mockInvoke }));
const mockBedrockModel = jest.fn();
const mockPutItemCommand = jest.fn((input) => ({ input }));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDdbSend })),
  PutItemCommand: mockPutItemCommand
}));

jest.unstable_mockModule('@strands-agents/sdk', () => ({
  Agent: mockAgent,
  BedrockModel: mockBedrockModel
}));

const { handler } = await import('../setup-voting-options.mjs');

describe('setup-voting-options handler', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      TABLE_NAME: process.env.TABLE_NAME,
      MODEL_ID: process.env.MODEL_ID
    };
    process.env.TABLE_NAME = 'test-table';
    process.env.MODEL_ID = 'test-model';
    mockDdbSend.mockResolvedValue({});
    mockInvoke.mockResolvedValue({
      structuredOutput: {
        options: [
          { description: 'DSQL vs Aurora' },
          { description: 'Cloud locally' },
          { description: 'AI task failures' },
          { description: 'Edge performance' }
        ]
      }
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv.TABLE_NAME;
    process.env.MODEL_ID = originalEnv.MODEL_ID;
  });

  test('generates, stores, and returns four normalized voting options', async () => {
    const result = await handler({
      tenant: { id: 'tenant123' },
      issueId: '  ISSUE-42 ',
      content: '# Newsletter content'
    });

    expect(result).toEqual([
      { id: 'issue-42-0', description: 'DSQL vs Aurora' },
      { id: 'issue-42-1', description: 'Cloud locally' },
      { id: 'issue-42-2', description: 'AI task failures' },
      { id: 'issue-42-3', description: 'Edge performance' }
    ]);

    expect(mockBedrockModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'test-model'
    }));
    expect(mockInvoke).toHaveBeenCalledWith(expect.stringContaining('# Newsletter content'), expect.objectContaining({
      limits: expect.objectContaining({ turns: 1 })
    }));

    expect(mockPutItemCommand).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'test-table'
    }));
    const item = unmarshall(mockPutItemCommand.mock.calls[0][0].Item);
    expect(item).toEqual({
      pk: 'tenant123#issue-42',
      sk: 'votes',
      options: result,
      'issue-42-0': 0,
      'issue-42-1': 0,
      'issue-42-2': 0,
      'issue-42-3': 0
    });
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
  });

  test('retries generation and returns empty array when no valid options are produced', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockInvoke.mockResolvedValue({ structuredOutput: { options: [] } });

    const result = await handler({
      tenant: { id: 'tenant123' },
      issueId: '42',
      content: '# Newsletter content'
    });

    expect(result).toEqual([]);
    expect(mockAgent).toHaveBeenCalledTimes(3);
    expect(mockDdbSend).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
