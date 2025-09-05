/**
 * @fileoverview Simple integration test for Stripe payment event handler
 */

import { jest } from '@jest/globals';

describe('Stripe Payment Events Handler - Integration', () => {
  test('should export handler function', async () => {
    // Mock environment variables
    process.env.TABLE_NAME = 'test-table';

    // Import the handler
    const { handler } = await import('../functions/billing/stripe-payment-events.mjs');

    // Verify handler is a function
    expect(typeof handler).toBe('function');
  });

  test('should handle invalid event structure gracefully', async () => {
    process.env.TABLE_NAME = 'test-table';

    const { handler } = await import('../functions/billing/stripe-payment-events.mjs');

    const invalidEvent = {
      // Missing required fields
    };

    await expect(handler(invalidEvent)).rejects.toThrow('Invalid EventBridge event structure');
  });

  test('should handle non-stripe event source', async () => {
    process.env.TABLE_NAME = 'test-table';

    const { handler } = await import('../functions/billing/stripe-payment-events.mjs');

    const nonStripeEvent = {
      id: 'event-123',
      source: 'not-stripe',
      'detail-type': 'invoice.payment_succeeded',
      detail: { id: 'test' }
    };

    await expect(handler(nonStripeEvent)).rejects.toThrow('Unexpected event source: not-stripe');
  });

  test('should handle unhandled event types gracefully', async () => {
    process.env.TABLE_NAME = 'test-table';

    const { handler } = await import('../functions/billing/stripe-payment-events.mjs');

    const unknownEvent = {
      id: 'event-123',
      source: 'stripe',
      'detail-type': 'invoice.unknown_event',
      detail: { id: 'test' }
    };

    // Should not throw for unknown event types
    await expect(handler(unknownEvent)).resolves.toBeUndefined();
  });
});
