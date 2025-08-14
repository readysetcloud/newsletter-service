import { AuthClient, TopicClient, CredentialProvider, ExpiresIn, GenerateDisposableToken  } from '@gomomento/sdk';

/**
 * Non-blocking Momento client utility with timeout handling and graceful degradation
 */
class NonBlockingMomentoClient {
  constructor() {
    this.authClient = null;
    this.apiKey = process.env.MOMENTO_API_KEY;
    this.cacheName = process.env.MOMENTO_CACHE_NAME || 'newsletter-notifications';
    this.defaultTimeout = parseInt(process.env.MOEOUT_MS || '5000'); // 5 second default timeout
    this.tokenCache = new Map(); // Simple in-memory token cache
    this.tokenCacheTTL = 30 * 60 * 1000; // 30 minutes in milliseconds

    if (!this.apiKey) {
      console.warn('MOMENTO_API_KEY environment variable not set. Momento functionality will be disabled.');
    }
  }

  /**
   * Initialize the auth client with lazy loading
   * @returns {AuthClient|null} Momento auth client instance
   */
  getAuthClient() {
    if (!this.apiKey) {
      return null;
    }

    if (!this.authClient) {
      this.authClient = new AuthClient({
        credentialProvider: CredentialProvider.fromString(this.apiKey)
      });
    }
    return this.authClient;
  }

  /**
   * Create a timeout promise that rejects after specified milliseconds
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {string} operation - Operation name for error message
   * @returns {Promise} Promise that rejects after timeout
   */
  createTimeoutPromise(timeoutMs, operation) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Execute an operation with timeout handling
   * @param {Function} operation - Async operation to execute
   * @param {string} operationName - Name for logging
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise} Promise that resolves or rejects with timeout
   */
  async withTimeout(operation, operationName, timeoutMs = this.defaultTimeout) {
    try {
      return await Promise.race([
        operation(),
        this.createTimeoutPromise(timeoutMs, operationName)
      ]);
    } catch (error) {
      if (error.message.includes('timed out')) {
        console.warn(`${operationName} timed out after ${timeoutMs}ms`, {
          operation: operationName,
          timeout: timeoutMs,
          timestamp: new Date().toISOString()
        });
      }
      throw error;
    }
  }

  /**
   * Get cached token or generate new one
   * @param {string} tenantId - Tenant ID for scoping
   * @param {string} tokenType - Type of token ('read' or 'write')
   * @returns {Promise<string|null>} Token or null if failed
   */
  async getCachedOrGenerateToken(tenantId, tokenType) {
    const cacheKey = `${tenantId}:${tokenType}`;
    const cached = this.tokenCache.get(cacheKey);

    // Check if cached token is still valid (with 5 minute buffer)
    if (cached && (Date.now() - cached.timestamp) < (this.tokenCacheTTL - 5 * 60 * 1000)) {
      console.log(`Using cached ${tokenType} token for tenant: ${tenantId}`);
      return cached.token;
    }

    // Generate new token
    try {
      const token = tokenType === 'write'
        ? await this.generateWriteTokenInternal(tenantId)
        : await this.generateReadOnlyTokenInternal(tenantId);

      // Cache the token
      this.tokenCache.set(cacheKey, {
        token,
        timestamp: Date.now()
      });

      return token;
    } catch (error) {
      console.error(`Failed to generate ${tokenType} token for tenant: ${tenantId}`, error);
      return null;
    }
  }

  /**
   * Generate a write token with timeout handling (internal method)
   * @param {string} tenantId - Tenant ID for scoping
   * @returns {Promise<string>} Generated token
   */
  async generateWriteTokenInternal(tenantId) {
    const authClient = this.getAuthClient();
    if (!authClient) {
      throw new Error('Momento auth client not available - check MOMENTO_API_KEY');
    }

    const permissions = [
      {
        role: 'publishonly',
        cache: this.cacheName,
        topic: tenantId
      }
    ];

    const tokenResponse = await authClient.generateDisposableToken(
      {permissions},
      ExpiresIn.hours(1),
      { tokenId: tenantId }
    );

    if (tokenResponse instanceof GenerateDisposableToken.Success) {
      return tokenResponse.authToken;
    } else {
      throw new Error(`Token generation failed: ${tokenResponse.message()}`);
    }
  }

  /**
   * Generate a read-only token with timeout handling (internal method)
   * @param {string} tenantId - Tenant ID for scoping
   * @returns {Promise<string>} Generated token
   */
  async generateReadOnlyTokenInternal(tenantId) {
    const authClient = this.getAuthClient();
    if (!authClient) {
      throw new Error('Momento auth client not available - check MOMENTO_API_KEY');
    }

    const permissions = [
      {
        role: 'subscribeonly',
        cache: this.cacheName,
        topic: tenantId
      },
      {
        role: 'readonly',
        cache: this.cacheName,
        item: {
          keyPrefix: `${tenantId}:`
        }
      }
    ];

    const tokenResponse = await authClient.generateDisposableToken(
      {permissions},
      ExpiresIn.hours(1),
      { tokenId: tenantId }
    );

    if (tokenResponse instanceof GenerateDisposableToken.Success) {
      return tokenResponse.authToken;
    } else {
      throw new Error(`Token generation failed: ${tokenResponse.message()}`);
    }
  }

  /**
   * Generate a write token with timeout and graceful failure handling
   * @param {string} tenantId - Tenant ID for scoping
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<string|null>} Generated token or null if failed
   */
  async generateWriteToken(tenantId, timeoutMs = this.defaultTimeout) {
    if (!this.isAvailable()) {
      console.warn('Momento not available - skipping token generation');
      return null;
    }

    try {
      return await this.withTimeout(
        () => this.getCachedOrGenerateToken(tenantId, 'write'),
        'generateWriteToken',
        timeoutMs
      );
    } catch (error) {
      console.error('Non-blocking write token generation failed', {
        tenantId,
        error: error.message,
        timeout: timeoutMs,
        timestamp: new Date().toISOString()
      });
      return null; // Graceful failure
    }
  }

  /**
   * Generate a read-only token with timeout and graceful failure handling
   * @param {string} tenantId - Tenant ID for scoping
   * @param {string} userId - User ID for logging
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<string|null>} Generated token or null if failed
   */
  async generateReadOnlyToken(tenantId, userId, timeoutMs = this.defaultTimeout) {
    if (!this.isAvailable()) {
      console.warn('Momento not available - skipping token generation');
      return null;
    }

    try {
      return await this.withTimeout(
        () => this.getCachedOrGenerateToken(tenantId, 'read'),
        'generateReadOnlyToken',
        timeoutMs
      );
    } catch (error) {
      console.error('Non-blocking read-only token generation failed', {
        tenantId,
        userId,
        error: error.message,
        timeout: timeoutMs,
        timestamp: new Date().toISOString()
      });
      return null;
    }
  }

  /**
   * Publish notification with timeout and graceful failure handling
   * @param {string} authToken - Momento auth token
   * @param {string} tenantId - Tenant ID for channel scoping
   * @param {object} notification - Notification payload
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<boolean>} True if successful, false if failed
   */
  async publishNotification(authToken, tenantId, notification, timeoutMs = this.defaultTimeout) {
    if (!authToken) {
      console.warn('No auth token available - skipping notification publishing');
      return false;
    }

    try {
      await this.withTimeout(
        async () => {
          const topicClient = new TopicClient({
            credentialProvider: CredentialProvider.fromString(authToken)
          });

          const publishResponse = await topicClient.publish(
            this.cacheName,
            tenantId,
            JSON.stringify(notification)
          );

          if (publishResponse instanceof TopicPublish.Success) {
            console.log(`Published notification to topic: ${tenantId}`, {
              tenantId,
              notificationType: notification.type,
              notificationId: notification.id,
              timestamp: new Date().toISOString()
            });
            return true;
          } else {
            throw new Error(`Publish failed: ${publishResponse.message()}`);
          }
        },
        'publishNotification',
        timeoutMs
      );

      return true;
    } catch (error) {
      console.error('Non-blocking notification publishing failed', {
        tenantId,
        notificationId: notification.id,
        error: error.message,
        timeout: timeoutMs,
        timestamp: new Date().toISOString()
      });
      return false; // Graceful failure
    }
  }

  /**
   * Publish notification with automatic token generation and retry logic
   * @param {string} tenantId - Tenant ID for channel scoping
   * @param {object} notification - Notification payload
   * @param {object} options - Options for timeout, retries, etc.
   * @returns {Promise<boolean>} True if successful, false if failed
   */
  async publishNotificationWithRetry(tenantId, notification, options = {}) {
    const {
      maxRetries = 2,
      timeoutMs = this.defaultTimeout,
      retryDelayMs = 1000
    } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Generate token with timeout
        const writeToken = await this.generateWriteToken(tenantId, 1, timeoutMs);

        if (!writeToken) {
          console.warn(`Failed to generate write token for tenant: ${tenantId}, attempt ${attempt + 1}`);
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
            continue;
          }
          return false;
        }

        // Publish with timeout
        const success = await this.publishNotification(writeToken, tenantId, notification, timeoutMs);

        if (success) {
          if (attempt > 0) {
            console.log(`Notification published successfully after ${attempt + 1} attempts`, {
              tenantId,
              notificationId: notification.id
            });
          }
          return true;
        }

        // If not successful and we have retries left, wait and try again
        if (attempt < maxRetries) {
          console.log(`Retrying notification publish for tenant: ${tenantId}, attempt ${attempt + 2}`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }

      } catch (error) {
        console.error(`Notification publish attempt ${attempt + 1} failed`, {
          tenantId,
          notificationId: notification.id,
          error: error.message,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1
        });

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
      }
    }

    console.error(`All notification publish attempts failed for tenant: ${tenantId}`, {
      tenantId,
      notificationId: notification.id,
      attempts: maxRetries + 1
    });
    return false;
  }

  /**
   * Check if Momento is available and configured
   * @returns {boolean} True if Momento is available
   */
  isAvailable() {
    return !!this.apiKey;
  }

  /**
   * Get the configured cache name
   * @returns {string} Cache name
   */
  getCacheName() {
    return this.cacheName;
  }

  /**
   * Clear the token cache (useful for testing or manual cache invalidation)
   */
  clearTokenCache() {
    this.tokenCache.clear();
    console.log('Token cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {object} Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    const validTokens = Array.from(this.tokenCache.entries()).filter(
      ([_, cached]) => (now - cached.timestamp) < this.tokenCacheTTL
    );

    return {
      totalCached: this.tokenCache.size,
      validTokens: validTokens.length,
      expiredTokens: this.tokenCache.size - validTokens.length,
      cacheHitRate: this.tokenCache.size > 0 ? (validTokens.length / this.tokenCache.size) : 0
    };
  }
}

// Export singleton instance
export const nonBlockingMomentoClient = new NonBlockingMomentoClient();

// Export class for testing
export { NonBlockingMomentoClient };

/**
 * Usage examples:
 *
 * // Generate token with timeout (won't block if Momento is slow)
 * const token = await nonBlockingMomentoClient.generateWriteToken('tenant-123', 1, 3000);
 * if (token) {
 *   console.log('Token generated successfully');
 * } else {
 *   console.log('Token generation failed or timed out - continuing without real-time features');
 * }
 *
 * // Publish notification with automatic retry and timeout
 * const success = await nonBlockingMomentoClient.publishNotificationWithRetry('tenant-123', notification, {
 *   maxRetries: 2,
 *   timeoutMs: 3000,
 *   retryDelayMs: 1000
 * });
 *
 * if (!success) {
 *   console.log('Notification publishing failed - user will not receive real-time notification');
 *   // Application continues normally, notification is still stored in DynamoDB
 * }
 */
