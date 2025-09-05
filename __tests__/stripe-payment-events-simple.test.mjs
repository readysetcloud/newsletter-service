/**
 * @fileoverview Simple integration test for Stripe payment event handler
 */

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

    await expect(handler(invalidEvent)).rejects.toThrow('Missing required EventBridge fields: id, detail-type, source, detail');
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

    await expect(handler(nonStripeEvent)).rejects.toThrow('Unexpected event source: not-stripe. Expected: stripe');
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

    // Should throw for unknown event types
    await expect(handler(unknownEvent)).rejects.toThrow('Unsupported billing event type: invoice.unknown_event');
  });
});
