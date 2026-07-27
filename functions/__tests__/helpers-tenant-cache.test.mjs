import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, GetItemCommand } = await import('@aws-sdk/client-dynamodb');
const { getTenant } = await import('../utils/helpers.mjs');

// getTenant memoizes for the life of the execution environment, and it used to
// write every tenant to a property literally named `tenantId` rather than to the
// id itself. One slot for all tenants means the first tenant a warm container
// saw was handed back for every tenant after it — and callers use this for the
// address outbound mail goes to and for the tenant's own GitHub credential.
describe('getTenant cache', () => {
  let mockSend;
  let originalEnv;

  const tenantRecord = (id) => ({
    Item: marshall({ pk: id, sk: 'tenant', email: `${id}@example.com`, apiKeyParameter: `/${id}/key` })
  });

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn((command) => {
      const key = unmarshall(command.input.Key);
      return Promise.resolve(tenantRecord(key.pk));
    });
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  test('returns each tenant its own record', async () => {
    const first = await getTenant('tenant-a');
    const second = await getTenant('tenant-b');

    expect(first.email).toBe('tenant-a@example.com');
    expect(second.email).toBe('tenant-b@example.com');
    expect(second.apiKeyParameter).toBe('/tenant-b/key');
  });

  test('serves a repeat lookup from cache rather than DynamoDB', async () => {
    await getTenant('tenant-c');
    const reads = mockSend.mock.calls.length;

    const cached = await getTenant('tenant-c');

    expect(cached.email).toBe('tenant-c@example.com');
    expect(mockSend.mock.calls.length).toBe(reads);
  });

  test('throws when the tenant does not exist', async () => {
    mockSend.mockResolvedValue({});

    await expect(getTenant('missing-tenant')).rejects.toThrow("Tenant 'missing-tenant' not found");
  });

  test('reads the tenant record by its own key', async () => {
    await getTenant('tenant-d');

    const command = mockSend.mock.calls.map(([c]) => c).find((c) => c instanceof GetItemCommand);
    expect(unmarshall(command.input.Key)).toEqual({ pk: 'tenant-d', sk: 'tenant' });
  });
});
