/**
 * @fileoverview Unit tests for get-subscription-status Lambda function
 */

import { jest } from '@jest/globals';

// Mock dependencies
const mockGetSubscriptionRecord = jest.fn();

jest.unstable_mockModule('../functions/billing/subscription-data.mjs', () => ({
  getSubscriptionRecord: mockGetSubscriptionRecord
}));

// Import the handler after mocking
const { handler } = await import('../functions/billing/get-subscription-status.mjs');

describe('get-subscription-status Lambda function', () => {
  const mockTenantId = 'tenant-123';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  describe('Successful subscription status retrieval', () => {
    test('should return active subscription status with billing info', async () => {
      const mockSubscriptionRecord = {
        pk: mockTenantId,
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        status: 'active',
        planId: 'pro',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        cancelAtPeriodEnd: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      };

      mockGetSubscriptionRecord.mockResolvedValue(mockSubscriptionRecord);

      const event = {
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
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toEqual({
        status: 'active',
        plan: {
          id: 'pro',
          name: 'Pro',
          limits: {
            subscribers: 10000,
            monthlyEmails: 100000,
            customDomain: true,
            sponsorReminders: true
          }
        },
        isActive: true,
        billingInfo: {
          currentPeriodStart: '2024-01-01T00:00:00Z',
          currentPeriodEnd: '2024-02-01T00:00:00Z',
          cancelAtPeriodEnd: false,
          stripeSubscriptionId: 'sub_test123'
        },
        updatedAt: '2024-01-01T00:00:00Z'
      });

      expect(mockGetSubscriptionRecord).toHaveBeenCalledWith(mockTenantId);
    });

    test('should return trialing subscription as active', async () => {
      const mockSubscriptionRecord = {
        pk: mockTenantId,
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        status: 'trialing',
        planId: 'creator',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        cancelAtPeriodEnd: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      };

      mockGetSubscriptionRecord.mockResolvedValue(mockSubscriptionRecord);

      const event = {
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
      expect(responseBody.status).toBe('trialing');
      expect(responseBody.isActive).toBe(true);
      expect(responseBody.plan.id).toBe('creator');
      expect(responseBody.plan.name).toBe('Creator');
    });

    test('should return cancelled subscription as inactive', async () => {
      const mockSubscriptionRecord = {
        pk: mockTenantId,
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        status: 'cancelled',
        planId: 'pro',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        cancelAtPeriodEnd: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z'
      };

      mockGetSubscriptionRecord.mockResolvedValue(mockSubscriptionRecord);

      const event = {
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
      expect(responseBody.status).toBe('cancelled');
      expect(responseBody.isActive).toBe(false);
      expect(responseBody.billingInfo.cancelAtPeriodEnd).toBe(true);
    });

    test('should return free plan when no subscription record exists', async () => {
      mockGetSubscriptionRecord.mockResolvedValue(null);

      const event = {
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
      expect(responseBody).toEqual({
        status: 'free',
        plan: {
          name: "Free",
          priceId: null,
          cognitoGroup: 'free-tier',
          limits: {
            subscribers: 500,
            monthlyEmails: 2500,
            customDomain: false,
            sponsorReminders: false
          }
        },
        isActive: false,
        billingInfo: null
      });

      expect(mockGetSubscriptionRecord).toHaveBeenCalledWith(mockTenantId);
    });
  });

  describe('Error handling', () => {
    test('should return 401 when no tenant ID in JWT claims', async () => {
      const event = {
        requestContext: {
          authorizer: {
            claims: {}
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Unauthorized: No tenant ID found');

      expect(mockGetSubscriptionRecord).not.toHaveBeenCalled();
    });

    test('should return 401 when no authorizer context', async () => {
      const event = {
        requestContext: {}
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Unauthorized: No tenant ID found');
    });

    test('should return 400 when getSubscriptionRecord throws tenant ID validation error', async () => {
      mockGetSubscriptionRecord.mockRejectedValue(new Error('Tenant ID is required'));

      const event = {
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
      expect(responseBody.error).toBe('Invalid request: Tenant ID is required');
    });

    test('should return 500 when database operation fails', async () => {
      mockGetSubscriptionRecord.mockRejectedValue(new Error('DynamoDB connection failed'));

      const event = {
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Internal server error');
      expect(responseBody.message).toBe('An error occurred');
    });

    test('should include error message in development environment', async () => {
      process.env.NODE_ENV = 'development';
      const errorMessage = 'Database connection timeout';
      mockGetSubscriptionRecord.mockRejectedValue(new Error(errorMessage));

      const event = {
        requestContext: {
          authorizer: {
            claims: {
              'custom:tenantId': mockTenantId
            }
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Internal server error');
      expect(responseBody.message).toBe(errorMessage);
    });
  });

  describe('Edge cases', () => {
    test('should handle subscription with unknown plan ID gracefully', async () => {
      const mockSubscriptionRecord = {
        pk: mockTenantId,
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        status: 'active',
        planId: 'unknown_plan',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        cancelAtPeriodEnd: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      };

      mockGetSubscriptionRecord.mockResolvedValue(mockSubscriptionRecord);

      const event = {
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
      expect(responseBody.plan.name).toBe('Unknown');
      expect(responseBody.plan.limits).toEqual({});
    });

    test('should handle past_due status as inactive', async () => {
      const mockSubscriptionRecord = {
        pk: mockTenantId,
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        status: 'past_due',
        planId: 'pro',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        cancelAtPeriodEnd: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      };

      mockGetSubscriptionRecord.mockResolvedValue(mockSubscriptionRecord);

      const event = {
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
      expect(responseBody.status).toBe('past_due');
      expect(responseBody.isActive).toBe(false);
    });
  });
});
