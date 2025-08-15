import { jest } from '@jest/globals';

// Mock the Momento SDK
const mockGenerateDisposableToken = jest.fn();
const mockPublish = jest.fn();

jest.unstable_mockModule('@gomomento/sdk', () => ({
  AuthClient: jest.fn(() => ({
    generateDisposableToken: mockGenerateDisposableToken
  })),
  TopicClient: jest.fn(() => ({
    publish: mockPublish
  })),
  CredentialProvider: {
    fromString: jest.fn()
  },
  ExpiresIn: {
    hours: jest.fn(h => ({ hours: h }))
  },
  GenerateDisp {
    Success: class {
      constructor(authToken) {
        this.authToken = authToken;
      }
    }
  },
  TopicPublish: {
    Success: class {}
  }
}));

// Import after mocking
const { NonBlockingMomentoClient } = await import('../non-blocking-momento.mjs');

describe('NonBlockingMomentoClient', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up environment
    process.env.MOMENTO_API_KEY = 'test-api-key';
    process.env.MOMENTO_CACHE_NAME = 'test-cache';
    process.env.MOMENTO_TIMEOUT_MS = '2000';

    client = new NonBlockingMomentoClient();
  });

  afterEach(() => {
    delete process.env.MOMENTO_API_KEY;
    delete process.env.MOMENTO_CACHE_NAME;
    delete process.env.MOMENTO_TIMEOUT_MS;
  });

  describe('timeout handling', () => {
    it('should timeout and return null for slow token generation', async () => {
      // Mock a slow response
      mockGenerateDisposableToken.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 5000)) // 5 second delay
      );

      const result = await client.generateWriteToken('tenant-123', 1, 1000); // 1 second timeout

      expect(result).toBeNull();
    });

    it('should succeed with fast token generation', async () => {
      const { GenerateDisposableToken } = await import('@gomomento/sdk');

      mockGenerateDisposableToken.mockResolvedValue(
        new GenerateDisposableToken.Success('test-token')
      );

      const result = await client.generateWriteToken('tenant-123', 1, 2000);

      expect(result).toBe('test-token');
    });

    it('should timeout and return false for slow notification publishing', async () => {
      // Mock a slow publish response
      mockPublish.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 5000)) // 5 second delay
      );

      const result = await client.publishNotification(
        'test-token',
        'tenant-123',
        { id: 'test', type: 'TEST' },
        1000 // 1 second timeout
      );

      expect(result).toBe(false);
    });
  });

  describe('token caching', () => {
    it('should cache tokens and reuse them', async () => {
      const { GenerateDisposableToken } = await import('@gomomento/sdk');

      mockGenerateDisposableToken.mockResolvedValue(
        new GenerateDisposableToken.Success('cached-token')
      );

      // First call should generate token
      const result1 = await client.generateWriteToken('tenant-123');
      expect(result1).toBe('cached-token');
      expect(mockGenerateDisposableToken).toHaveBeenCalledTimes(1);

      // Second call should use cached token
      const result2 = await client.generateWriteToken('tenant-123');
      expect(result2).toBe('cached-token');
      expect(mockGenerateDisposableToken).toHaveBeenCalledTimes(1); // Still only called once
    });

    it('should provide cache statistics', () => {
      const stats = client.getCacheStats();

      expect(stats).toHaveProperty('totalCached');
      expect(stats).toHaveProperty('validTokens');
      expect(stats).toHaveProperty('expiredTokens');
      expect(stats).toHaveProperty('cacheHitRate');
    });
  });

  describe('graceful degradation', () => {
    it('should return null when Momento is not available', async () => {
      delete process.env.MOMENTO_API_KEY;
      const clientWithoutKey = new NonBlockingMomentoClient();

      const result = await clientWithoutKey.generateWriteToken('tenant-123');

      expect(result).toBeNull();
    });

    it('should return false when publishing without token', async () => {
      const result = await client.publishNotification(
        null,
        'tenant-123',
        { id: 'test', type: 'TEST' }
      );

      expect(result).toBe(false);
    });
  });

  describe('retry logic', () => {
    it('should retry failed operations', async () => {
      const { GenerateDisposableToken, TopicPublish } = await import('@gomomento/sdk');

      // First call fails, second succeeds
      mockGenerateDisposableToken
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(new GenerateDisposableToken.Success('retry-token'));

      mockPublish.mockResolvedValue(new TopicPublish.Success());

      const result = await client.publishNotificationWithRetry(
        'tenant-123',
        { id: 'test', type: 'TEST' },
        { maxRetries: 2, timeoutMs: 1000, retryDelayMs: 100 }
      );

      expect(result).toBe(true);
      expect(mockGenerateDisposableToken).toHaveBeenCalledTimes(2);
    });

    it('should give up after max retries', async () => {
      mockGenerateDisposableToken.mockRejectedValue(new Error('Persistent error'));

      const result = await client.publishNotificationWithRetry(
        'tenant-123',
        { id: 'test', type: 'TEST' },
        { maxRetries: 1, timeoutMs: 1000, retryDelayMs: 100 }
      );

      expect(result).toBe(false);
      expect(mockGenerateDisposableToken).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });
  });

  describe('performance comparison', () => {
    it('should complete quickly even with slow Momento', async () => {
      // Mock slow Momento operations
      mockGenerateDisposableToken.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 3000))
      );

      const startTime = Date.now();

      // This should timeout quickly and return null
      const result = await client.generateWriteToken('tenant-123', 1, 500); // 500ms timeout

      const duration = Date.now() - startTime;

      expect(result).toBeNull();
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });
  });
});

describe('Blocking vs Non-Blocking Comparison', () => {
  it('should demonstrate the difference in behavior', async () => {
    console.log('\n=== Blocking vs Non-Blocking Momento Client Comparison ===\n');

    // Simulate slow Momento service
    const slowOperation = () => new Promise(resolve =>
      setTimeout(() => resolve('slow-result'), 3000)
    );

    console.log('1. Blocking approach (simulated):');
    console.log('   - Waits for Momento token generation (3 seconds)');
    console.log('   - Waits for Momento publishing (3 seconds)');
    console.log('   - Total time: ~6 seconds');
    console.log('   - If Momento fails, entire operation fails');

    console.log('\n2. Non-blocking approach:');
    const client = new NonBlockingMomentoClient();

    const startTime = Date.now();

    // This will timeout quickly
    const tokenResult = await client.generateWriteToken('tenant-123', 1, 1000);
    const publishResult = await client.publishNotification(
      'test-token',
      'tenant-123',
      { id: 'test', type: 'TEST' },
      1000
    );

    const duration = Date.now() - startTime;

    console.log(`   - Token generation: ${tokenResult ? 'Success' : 'Failed/Timeout'}`);
    console.log(`   - Publishing: ${publishResult ? 'Success' : 'Failed/Timeout'}`);
    console.log(`   - Total time: ${duration}ms`);
    console.log('   - DynamoDB storage would still succeed');
    console.log('   - User gets response quickly');

    expect(duration).toBeLessThan(3000); // Much faster than blocking approach
  });
});
