/**
 * @fileoverview Unit tests for create-checkout-session Lambtion
 */

import { jest } from '@jest/globals';

// Mock dependencies
const mockGetParameter = jest.fn();
const mockDynamoSend = jest.fn();
const mockStripeCheckoutCreate = jest.fn();

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
    checkout: {
      sessions: {
        create: mockStripeCheckoutCreate
      }
    }
  }))
}));

// Import the handler after mocking
const { handler } = await import('../functions/billing/create-checkout-session.mjs');

describe('create-checkout-session Lambda function', () => {
  const mockTenantId = 'tenant-123';
  const mockStripeCustomerId = 'cus_test123';
  const mockSessionId = 'cs_test123';
  const mockSessionUrl = 'https://checkout.stripe.com/pay/cs_test123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Set environment variables
    process.env.TABLE_NAME = 'test-table';
    process.env.STRIPE_API_KEY_PARAM = '/stripe/api-key';

    // Default mocks
    mockGetParameter.mockResolvedValue('sk_test_123');
    mockStripeCheckoutCreate.mockResolvedValue({
      id: mockSessionId,
      url: mockSessionUrl
    });
  });

  describe('successful checkout session creation', () => {
    beforeEach(() => {
      // Mock tenant lookup
      mockDynamoSend.mockImplementation((command) => {
        if (command.Key.pk === mockTenantId && command.Key.sk === 'tenant') {
          return Promise.resolve({
            Item: {
              pk: mockTenantId,
              sk: 'tenant',
              stripeCustomerId: mockStripeCustomerId,
              name: 'Test Tenant'
            }
          });
        }
        // Mock subscription lookup (no existing subscription)
        if (command.Key.pk === mockTenantId && command.Key.sk === 'subscription') {
          return Promise.resolve({ Item: null });
        }
        return Promise.resolve({ Item: null });
      });
    });

    test('should create checkout session for creator plan', async () => {
      const event = {
        body: JSON.stringify({
          planId: 'creator',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel'
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

      expect(result.statusCode).toBe(200);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.sessionId).toBe(mockSessionId);
      expect(responseBody.url).toBe(mockSessionUrl);

      // Verify Stripe checkout session creation
      expect(mockStripeCheckoutCreate).toHaveBeenCalledWith({
        customer: mockStripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: 'price_creator_monthly',
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        metadata: {
          tenantId: mockTenantId,
          planId: 'creator'
        },
        subscription_data: {
          metadata: {
            tenantId: mockTenantId,
            planId: 'creator'
          }
        },
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        customer_update: {
          address: 'auto',
          name: 'auto'
        }
      });
    });
  });

  describe('validation errors', () => {
    test('should return 401 when no tenant ID in claims', async () => {
      const event = {
        body: JSON.stringify({
          planId: 'creator',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel'
        }),
        requestContext: {
          authorizer: {
            claims: {}
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Unauthorized: No tenant ID found');
    });

    test('should return 400 for missing planId', async () => {
      const event = {
        body: JSON.stringify({
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel'
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

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Invalid request');
      expect(responseBody.details).toContain('planId is required');
    });

    test('should return 400 for free plan', async () => {
      const event = {
        body: JSON.stringify({
          planId: 'free',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel'
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

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Invalid request');
      expect(responseBody.details).toContain('Cannot create checkout session for free plan');
    });
  });

  describe('tenant validation', () => {
    test('should return 404 when tenant not found', async () => {
      mockDynamoSend.mockResolvedValue({ Item: null });

      const event = {
        body: JSON.stringify({
          planId: 'creator',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel'
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

      expect(result.statusCode).toBe(404);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Tenant not found');
    });
  });

  describe('CORS headers', () => {
    test('should include CORS headers in successful response', async () => {
      mockDynamoSend.mockImplementation((command) => {
        if (command.Key.pk === mockTenantId && command.Key.sk === 'tenant') {
          return Promise.resolve({
            Item: {
              pk: mockTenantId,
              sk: 'tenant',
              stripeCustomerId: mockStripeCustomerId,
              name: 'Test Tenant'
            }
          });
        }
        if (command.Key.pk === mockTenantId && command.Key.sk === 'subscription') {
          return Promise.resolve({ Item: null });
        }
        return Promise.resolve({ Item: null });
      });

      const event = {
        body: JSON.stringify({
          planId: 'creator',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel'
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

      expect(result.headers).toEqual({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
    });
  });
});
