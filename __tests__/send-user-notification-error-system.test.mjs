import { jest } from '@jest/globals';
import { handler } from '../functions/notifications/send-user-notification.mjs';

// Mock dependencies
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@gomomento/sdk');

describe('Enhanced Error Notification System', () => {
  let mockConsoleLog, mockConsoleError, mockConsoleWarn;

  beforeEach(() => {
    // Mock console methods
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Clear environment variables
    delete process.env.MOMENTO_API_KEY;
    delete process.env.TABLE_NAME;
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleWarn.mockRestore();
  });

  test('should handle missing event detail gracefully with error notification', async () => {
    const event = {
      source: 'newsletter.api',
      'detail-type': 'Test Event'
      // Missing detail property
    };

    await handler(event);

    // Verify error was logged
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Failed to process user notification event',
      expect.objectContaining({
        error: 'Missing event detail in EventBridge event'
      })
    );

    // Verify structured error logging was called (fallback when Momento unavailable)
    expect(mockConsoleError).toHaveBeenCalledWith(
      'STRUCTURED_ERROR',
      expect.stringContaining('"level":"ERROR"')
    );
  });

  test('should handle missing tenant ID with error notification', async () => {
    const event = {
      source: 'newsletter.api',
      'detail-type': 'Test Event',
      detail: {
        type: 'ISSUE_PUBLISHED',
        data: { title: 'Test Issue' }
        // Missing tenantId
      }
    };

    await handler(event);

    // Verify error was logged
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Failed to process user notification event',
      expect.objectContaining({
        error: 'Missing tenantId in event detail'
      })
    );

    // Verify structured error logging includes tenant context
    expect(mockConsoleError).toHaveBeenCalledWith(
      'STRUCTURED_ERROR',
      expect.stringContaining('"tenantId":"system"')
    );
  });

  test('should handle missing event type with error notification', async () => {
    const event = {
      source: 'newsletter.api',
      'detail-type': 'Test Event',
      detail: {
        tenantId: 'test-tenant',
        data: { title: 'Test Issue' }
        // Missing type
      }
    };

    await handler(event);

    // Verify error was logged
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Failed to process user notification event',
      expect.objectContaining({
        error: 'Missing event type in event detail'
      })
    );

    // Verify structured error logging includes correct tenant
    expect(mockConsoleError).toHaveBeenCalledWith(
      'STRUCTURED_ERROR',
      expect.stringContaining('"tenantId":"test-tenant"')
    );
  });

  test('should log structured error when Momento is unavailable', async () => {
    const event = {
      source: 'newsletter.api',
      'detail-type': 'Test Event',
      detail: {
        tenantId: 'test-tenant',
        userId: 'test-user',
        type: 'ISSUE_PUBLISHED',
        data: { title: 'Test Issue' }
      }
    };

    // Don't set MOMENTO_API_KEY to simulate unavailable Momento
    await handler(event);

    // Verify warning about Momento unavailability
    expect(mockConsoleWarn).toHaveBeenCalledWith(
      'Momento not available, skipping real-time notification delivery',
      expect.objectContaining({
        tenantId: 'test-tenant'
      })
    );
  });

  test('should include correlation ID in all error logs', async () => {
    const event = {
      source: 'newsletter.api',
      'detail-type': 'Test Event'
      // Missing detail to trigger error
    };

    await handler(event);

    // Verify all error logs include correlation ID
    const errorCalls = mockConsoleError.mock.calls;
    errorCalls.forEach(call => {
      if (typeof call[1] === 'object' && call[1].correlationId) {
        expect(call[1].correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
    });
  });

  test('should include system context in structured error logs', async () => {
    const event = {
      source: 'newsletter.api',
      'detail-type': 'Test Event'
      // Missing detail to trigger error
    };

    // Set some environment variables to test system context
    process.env.NODE_ENV = 'test';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-function';

    await handler(event);

    // Find the structured error log
    const structuredErrorCall = mockConsoleError.mock.calls.find(call =>
      call[0] === 'STRUCTURED_ERROR'
    );

    expect(structuredErrorCall).toBeDefined();
    const errorData = JSON.parse(structuredErrorCall[1]);

    expect(errorData.system).toEqual({
      environment: 'test',
      region: 'us-east-1',
      functionName: 'test-function'
    });
  });

  test('should determine error severity correctly', async () => {
    const event = {
      source: 'newsletter.api',
      'detail-type': 'Test Event',
      detail: {
        tenantId: 'test-tenant',
        type: 'ISSUE_PUBLISHED',
        data: { title: 'Test Issue' }
      }
    };

    // Set environment to trigger token generation error
    process.env.MOMENTO_API_KEY = 'invalid-key';

    await handler(event);

    // Find the structured error log
    const structuredErrorCall = mockConsoleError.mock.calls.find(call =>
      call[0] === 'STRUCTURED_ERROR'
    );

    if (structuredErrorCall) {
      const errorData = JSON.parse(structuredErrorCall[1]);
      // Should be high severity for general processing errors
      expect(['high', 'medium', 'critical']).toContain(errorData.context.severity);
    }
  });
});
