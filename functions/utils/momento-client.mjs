import { AuthClient, TopicClient, CacheClient, CredentialProvider, ExpiresIn, GenerateDisposableToken, TopicPublish } from '@gomomento/sdk';

/**
 * Shared Momento client utility for authentication token generation and cache operations
 */
class MomentoClientUtil {
  constructor() {
    this.authClient = null;
    this.topicClient = null;
    this.cacheClient = null;
    this.apiKey = process.env.MOMENTO_API_KEY;
    this.cacheName = process.env.MOMENTO_CACHE_NAME || 'newsletter-notifications';

    if (!this.apiKey) {
      console.warn('MOMENTO_API_KEY environment variable not set. Momento functionality will be disabled.');
    }
  }

  /**
   * Initialize the auth client for token generation
   * @returns {AuthClient} Momento auth client instance
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
   * Initialize the topic client for pub/sub operations
   * @param {string} authToken - Momento auth token for scoped access
   * @returns {TopicClient} Momento topic client instance
   */
  getTopicClient(authToken) {
    if (!authToken) {
      throw new Error('Auth token required for topic client');
    }

    return new TopicClient({
      credentialProvider: CredentialProvider.fromString(authToken)
    });
  }

  /**
   * Initialize the cache client for cache operations
   * @param {string} authToken - Momento auth token for scoped access
   * @returns {CacheClient} Momento cache client instance
   */
  getCacheClient(authToken) {
    if (!authToken) {
      throw new Error('Auth token required for cache client');
    }

    return new CacheClient({
      credentialProvider: CredentialProvider.fromString(authToken)
    });
  }

  /**
   * Generate a read-only token scoped to a specific tenant
   * @param {string} tenantId - Tenant ID for scoping permissions
   * @param {string} userId - User ID for logging and tracking
   * @returns {Promise<string>} Generated Momento auth token
   */
  async generateReadOnlyToken(tenantId, userId) {
    const authClient = this.getAuthClient();
    if (!authClient) {
      throw new Error('Momento auth client not available - check MOMENTO_API_KEY');
    }

    try {
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

      const tokenResponse = await authClient.generateDisposableToken(permissions, ExpiresIn.hours(1), { tokenId: tenantId });

      if (tokenResponse instanceof GenerateDisposableToken.Success) {
        console.log(`Generated read only token for tenant: ${tenantId}, user: ${userId}`);
        return tokenResponse.authToken;
      } else {
        throw new Error(`Token read only failed: ${tokenResponse.message()}`);
      }
    } catch (error) {
      console.error('Failed to generate read only token:', {
        error: error.message,
        tenantId,
        userId,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Generate a write-enabled token scoped to a specific tenant
   * @param {string} tenantId - Tenant ID for scoping permissions
   * @returns {Promise<string>} Generated Momento auth token
   */
  async generateWriteToken(tenantId) {
    const authClient = this.getAuthClient();
    if (!authClient) {
      throw new Error('Momento auth client not available - check MOMENTO_API_KEY');
    }

    try {
      const permissions = [
        {
          role: 'publishonly',
          cache: this.cacheName,
          topic: tenantId
        },
        {
          role: 'writeonly',
          cache: this.cacheName,
          item: {
            keyPrefix: `${tenantId}:`,
          }
        }
      ];

      const tokenResponse = await authClient.generateDisposableToken(permissions, ExpiresIn.hours(1), { tokenId: tenantId });

      if (tokenResponse instanceof GenerateDisposableToken.Success) {
        console.log(`Generated write token for tenant: ${tenantId}`);
        return tokenResponse.authToken;
      } else {
        throw new Error(`Token generation failed: ${tokenResponse.message}`);
      }
    } catch (error) {
      console.error('Failed to generate write token:', {
        error: error.message,
        tenantId,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Publish a notification to a tenant-specific channel
   * @param {string} authToken - Write-enabled Momento auth token
   * @param {string} tenantId - Tenant ID for channel scoping
   * @param {object} notification - Notification payload
   * @returns {Promise<void>}
   */
  async publishNotification(authToken, tenantId, notification) {
    try {
      const topicClient = this.getTopicClient(authToken);

      const publishResponse = await topicClient.publish(this.cacheName, tenantId, JSON.stringify(notification));

      if (publishResponse instanceof TopicPublish.Success) {
        console.log(`Published notification to topic: ${tenantId}`, {
          tenantId,
          notificationType: notification.type,
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error(`Publish failed: ${publishResponse.message}`);
      }
    } catch (error) {
      console.error('Failed to publish notification:', {
        error: error.message,
        tenantId,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
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
}

// Export singleton instance
export const momentoClient = new MomentoClientUtil();

// Export class for testing
export { MomentoClientUtil };
