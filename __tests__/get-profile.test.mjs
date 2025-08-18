// __tests__/get-profile.test.mjs
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let cognitoSend;
let ddbSend;
let AdminGetUserCommand;
let ListUsersCommand;
let GetItemCommand;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    // Fresh, per-load mocks
    cognitoSend = jest.fn();
    ddbSend = jest.fn();

    // Cognito mock: distinct client + commands
    jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
      CognitoIdentityProviderClient: jest.fn(() => ({ send: cognitoSend })),
      AdminGetUserCommand: jest.fn((params) => ({ __type: 'AdminGetUser', ...params })),
      ListUsersCommand: jest.fn((params) => ({ __type: 'ListUsers', ...params })),
    }));

    // DynamoDB mock: distinct client + command
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
    }));

    // util-dynamodb passthroughs (keep simple)
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: (obj) => obj,
      unmarshall: (item) => item,
    }));

    // helpers
    const mockFormatResponse = jest.fn((statusCode, body) => ({
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      formatResponse: mockFormatResponse,
    }));

    // auth
    jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
      getUserContext: jest.fn((event) => {
        if (!event.requestContext?.authorizer) {
          throw new Error('Invalid authorization context');
        }
        const a = event.requestContext.authorizer;
        return {
          userId: a.userId,
          email: a.email,
          tenantId: a.tenantId,
          role: a.role,
          isAdmin: a.isAdmin === 'true',
          isTenantAdmin: a.isTenantAdmin === 'true',
        };
      }),
      formatAuthError: jest.fn((message) => ({
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })),
    }));

    // Import AFTER mocks, inside isolation
    ({ handler } = await import('../functions/admin/get-profile.mjs'));
    ({ AdminGetUserCommand, ListUsersCommand } = await import('@aws-sdk/client-cognito-identity-provider'));
    ({ GetItemCommand } = await import('@aws-sdk/client-dynamodb'));
  });
};

const makeAttributes = (attrs = {}) =>
  Object.entries(attrs).map(([Name, Value]) => ({ Name, Value }));

describe('Get Profile (isolated, separate Cognito & DDB sends)', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.USER_POOL_ID = 'us-east-1_testpool123';
    process.env.TABLE_NAME = 'table-dev';
    await loadIsolated();
  });

  // ---------- /me (own profile) ----------
  it('returns full own profile with brand data', async () => {
    const sub = 'sub-123';
    const tenantId = 'tenant-abc';

    // AdminGetUser (own profile by email)
    cognitoSend.mockResolvedValueOnce({
      UserAttributes: makeAttributes({
        sub,
        email: 'me@example.com',
        given_name: 'John',
        family_name: 'Doe',
        'custom:profile_links':
          '[{"name":"GitHub","url":"https://github.com/john"},{"name":"X","url":"https://x.com/john"}]',
        zoneinfo: 'America/Chicago',
        locale: 'en-US',
        'custom:profile_updated_at': '2024-01-01T00:00:00Z',
      }),
      UserLastModifiedDate: new Date('2024-03-01T00:00:00Z'),
    });

    // DDB tenant
    ddbSend.mockResolvedValueOnce({
      Item: {
        pk: tenantId,
        sk: 'tenant',
        brandName: 'My Brand',
        website: 'https://brand.example',
        industry: 'tech',
        brandDescription: 'We do things',
        brandLogo: 'https://brand.example/logo.png',
        tags: ['tech', 'newsletter'],
        updatedAt: '2024-01-02T00:00:00Z',
      },
    });

    const event = {
      requestContext: {
        authorizer: {
          userId: sub,
          email: 'me@example.com',
          tenantId,
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false',
        },
      },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.userId).toBe(sub);
    expect(body.email).toBe('me@example.com');
    expect(body.brand).toEqual({
      brandId: tenantId,
      brandName: 'My Brand',
      website: 'https://brand.example',
      industry: 'tech',
      brandDescription: 'We do things',
      brandLogo: 'https://brand.example/logo.png',
      tags: ['tech', 'newsletter'],
      lastUpdated: '2024-01-02T00:00:00Z',
    });
    expect(body.profile.firstName).toBe('John');
    expect(body.profile.lastName).toBe('Doe');
    expect(body.profile.links).toEqual([
      { name: 'GitHub', url: 'https://github.com/john' },
      { name: 'X', url: 'https://x.com/john' },
    ]);
    expect(body.preferences.timezone).toBe('America/Chicago');
    expect(body.preferences.locale).toBe('en-US');
    expect(body.lastModified).toBeDefined();

    // Sanity: command types
    expect(cognitoSend).toHaveBeenCalledTimes(1);
    expect(cognitoSend.mock.calls[0][0].__type).toBe('AdminGetUser');
    expect(ddbSend).toHaveBeenCalledTimes(1);
    expect(ddbSend.mock.calls[0][0].__type).toBe('GetItem');
  });

  it('handles missing optional own attributes', async () => {
    const sub = 'sub-123';
    const tenantId = 'tenant-abc';

    cognitoSend.mockResolvedValueOnce({
      UserAttributes: makeAttributes({
        sub,
        email: 'me@example.com',
      }),
      UserLastModifiedDate: new Date('2024-03-01T00:00:00Z'),
    });

    ddbSend.mockResolvedValueOnce({
      Item: { pk: tenantId, sk: 'tenant', brandName: 'Brand' },
    });

    const event = {
      requestContext: {
        authorizer: {
          userId: sub,
          email: 'me@example.com',
          tenantId,
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false',
        },
      },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.firstName).toBeUndefined();
    expect(body.profile.lastName).toBeUndefined();
    expect(body.profile.links).toBeUndefined();
    expect(body.preferences.timezone).toBeUndefined();
    expect(body.preferences.locale).toBeUndefined();
  });

  it('handles invalid JSON links in own profile', async () => {
    const sub = 'sub-123';

    cognitoSend.mockResolvedValueOnce({
      UserAttributes: makeAttributes({
        sub,
        email: 'me@example.com',
        'custom:profile_links': 'not-json',
      }),
      UserLastModifiedDate: new Date('2024-03-01T00:00:00Z'),
    });

    ddbSend.mockResolvedValueOnce({ Item: null });

    const event = {
      requestContext: {
        authorizer: {
          userId: sub,
          email: 'me@example.com',
          tenantId: null,
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false',
        },
      },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).profile.links).toBeUndefined();
  });

  // ---------- /profiles/{userId} (public profile) ----------
  it('returns public profile by sub (ListUsers -> AdminGetUser -> DDB)', async () => {
    const otherSub = 'sub-999';
    const tenantId = 'tenant-xyz';

    // 1) ListUsers -> find email
    cognitoSend.mockResolvedValueOnce({
      Users: [
        {
          Attributes: makeAttributes({
            sub: otherSub,
            email: 'other@example.com',
          }),
        },
      ],
    });

    // 2) AdminGetUser -> full attributes
    cognitoSend.mockResolvedValueOnce({
      UserAttributes: makeAttributes({
        sub: otherSub,
        email: 'other@example.com',
        given_name: 'Jane',
        family_name: 'Smith',
        'custom:tenant_id': tenantId,
        'custom:profile_links':
          '[{"name":"Portfolio","url":"https://janesmith.dev"}]',
      }),
      UserLastModifiedDate: new Date('2024-01-03T00:00:00Z'),
    });

    // 3) DDB tenant lookup
    ddbSend.mockResolvedValueOnce({
      Item: {
        pk: tenantId,
        sk: 'tenant',
        brandName: 'Other Brand',
        tags: ['design', 'creative'],
      },
    });

    const event = {
      requestContext: {
        authorizer: {
          userId: 'sub-123',
          email: 'me@example.com',
          tenantId: 'tenant-abc',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false',
        },
      },
      // IMPORTANT: key must match your handler (userId)
      pathParameters: { userId: otherSub },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const profile = JSON.parse(res.body);

    expect(profile.userId).toBeUndefined();
    expect(profile.email).toBeUndefined();
    expect(profile.brand.brandName).toBe('Other Brand');
    expect(profile.brand.tags).toEqual(['design', 'creative']);
    expect(profile.firstName).toBe('Jane');
    expect(profile.lastName).toBe('Smith');
    expect(profile.links).toEqual([{ name: 'Portfolio', url: 'https://janesmith.dev' }]);

    // sanity: order
    expect(cognitoSend).toHaveBeenCalledTimes(2);
    expect(cognitoSend.mock.calls[0][0].__type).toBe('ListUsers');
    expect(cognitoSend.mock.calls[1][0].__type).toBe('AdminGetUser');
    expect(ddbSend).toHaveBeenCalledTimes(1);
    expect(ddbSend.mock.calls[0][0].__type).toBe('GetItem');
  });

  it('returns 404 when requested sub not found (ListUsers empty)', async () => {
    cognitoSend.mockResolvedValueOnce({ Users: [] });

    const event = {
      requestContext: {
        authorizer: {
          userId: 'sub-123',
          email: 'me@example.com',
          tenantId: 'tenant-abc',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false',
        },
      },
      pathParameters: { userId: 'sub-does-not-exist' },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(404);
    // Only 1 call: ListUsers
    expect(cognitoSend).toHaveBeenCalledTimes(1);
    expect(cognitoSend.mock.calls[0][0].__type).toBe('ListUsers');
    expect(ddbSend).not.toHaveBeenCalled();
  });

  // ---------- Generic ----------
  it('returns 401 when auth context missing', async () => {
    const res = await handler({});
    expect(res.statusCode).toBe(401);
    expect(cognitoSend).not.toHaveBeenCalled();
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it('returns 500 on Cognito error (first call)', async () => {
    cognitoSend.mockRejectedValueOnce(new Error('Cognito service error'));

    const event = {
      requestContext: {
        authorizer: {
          userId: 'sub-123',
          email: 'me@example.com',
          tenantId: 'tenant-abc',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false',
        },
      },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(500);
  });
});
