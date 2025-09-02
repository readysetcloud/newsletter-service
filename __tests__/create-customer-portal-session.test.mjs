/**
 * @fileoverview Unit tests for create-customer-portal-session Lambdan
 */

import { jest } from '@jest/globals';

// Mock dependencies
const mockGetParameter = jest.fn();
const mockDynamoSend = jest.fn();
const mockStripeBillingPortalCreate = jest.fn();

jest.unstable_mockModule('@aws-lambda-powertools/parameters/ssm', () => ({
  getParameter: mockGetParameter
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockDynamoSend
  })),
  GetItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

jest.unstable_mockModule('stripe', () => ({
  default: jest.fn(() => ({
    billingPortal: {
      sessions: {
        create: mockStripeBillingPortalCreate
      }
    }
  }))
}));

// Import the handler after mocking
const { handler } = await import('../functions/billing/create-customer-portal-session.mjs');

describe('create-customer-portal-session Lambda function', () => {
  const mockTenantId = 'tenant-123';
  const mockStripeCustomerId = 'cus_test123';
  const mockSessionId = 'bps_test123';
  const mockSessionUrl = 'https://billing.stripe.com/session/bps_test123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Set environment variables
    process.env.TABLE_NAME = 'test-table';
    process.env.STRIPE_API_KEY_PARAM = '/stripe/api-key';

    // Default mocks
    mockGetParameter.mockResolvedValue('sk_test_123');
    mockStripeBillingPortalCreate.mockResolvedValue({
      id: mockSessionId,
      url: mockSessionUrl
    });
  });

  describe('successful customer portal session creation', () => {
    beforeEach(() => {
      // Mock tenant lookup
      mockDynamoSend.mockResolvedValue({
        Item: {
          pk: mockTenantId,
          sk: 'tenant',
          stripeCustomerId: mockStripeCustomerId,
          name: 'Test Tenant'
        }
      });
    });

    test('should create customer portal session for admin user', async () => {
      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.sessionId).toBe(mockSessionId);
      expect(responseBody.url).toBe(mockSessionUrl);

      // Verify Stripe billing portal session creation
      expect(mockStripeBillingPortalCreate).toHaveBeenCalledWith({
        customer: mockStripeCustomerId,
        return_url: 'https://example.com/billing'
      });
    });

    test('should handle valid HTTPS return URL', async () => {
      const returnUrl = 'https://dashboard.example.com/billing?tab=subscription';
      const event = {
        body: JSON.stringify({
          returnUrl: returnUrl
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockStripeBillingPortalCreate).toHaveBeenCalledWith({
        customer: mockStripeCustomerId,
        return_url: returnUrl
      });
    });
  });

  describe('authorization errors', () => {
    test('should return 401 when no tenant ID in claims', async () => {
      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Unauthorized: No tenant ID found');
    });

    test('should return 403 when user is not admin', async () => {
      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-member']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(403);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Forbidden: Admin access required');
    });

    test('should return 403 when user has no groups', async () => {
      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(403);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Forbidden: Admin access required');
    });
  });

  describe('validation errors', () => {
    test('should return 400 for missing returnUrl', async () => {
      const event = {
        body: JSON.stringify({}),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Invalid request');
      expect(responseBody.details).toContain('returnUrl is required');
    });

    test('should return 400 for invalid returnUrl', async () => {
      const event = {
        body: JSON.stringify({
          returnUrl: 'not-a-valid-url'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Invalid request');
      expect(responseBody.details).toContain('returnUrl must be a valid URL');
    });
  });

  describe('tenant validation', () => {
    test('should return 404 when tenant not found', async () => {
      mockDynamoSend.mockResolvedValue({ Item: null });

      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(404);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Tenant not found');
    });

    test('should return 400 when tenant has no Stripe customer ID', async () => {
      mockDynamoSend.mockResolvedValue({
        Item: {
          pk: mockTenantId,
          sk: 'tenant',
          name: 'Test Tenant'
          // No stripeCustomerId
        }
      });

      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('No billing account found. Please contact support to set up billing.');
    });
  });

  describe('Stripe API errors', () => {
    beforeEach(() => {
      mockDynamoSend.mockResolvedValue({
        Item: {
          pk: mockTenantId,
          sk: 'tenant',
          stripeCustomerId: mockStripeCustomerId,
          name: 'Test Tenant'
        }
      });
    });

    test('should return 500 when Stripe API fails', async () => {
      mockStripeBillingPortalCreate.mockRejectedValue(new Error('Stripe API error'));

      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Internal server error');
    });
  });

  describe('CORS headers', () => {
    test('should include CORS headers in successful response', async () => {
      mockDynamoSend.mockResolvedValue({
        Item: {
          pk: mockTenantId,
          sk: 'tenant',
          stripeCustomerId: mockStripeCustomerId,
          name: 'Test Tenant'
        }
      });

      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.headers).toEqual({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
    });

    test('should include CORS headers in error response', async () => {
      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId
              // No groups - should trigger 403
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(result.headers).toEqual({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
    });
  });

  describe('DynamoDB errors', () => {
    test('should return 500 when DynamoDB query fails', async () => {
      mockDynamoSend.mockRejectedValue(new Error('DynamoDB error'));

      const event = {
        body: JSON.stringify({
          returnUrl: 'https://example.com/billing'
        }),
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId,
              'cognito:groups': ['tenant-admin']
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Internal server error');
    });
  });
});
