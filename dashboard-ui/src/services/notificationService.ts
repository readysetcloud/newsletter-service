import {
  TopicClient,
  CredentialProvider,
  Configurations,
  TopicSubscribe,
  TopicItem,
  SubscribeCallOptions
} from '@gomomento/sdk-web';
import type { Notification } from '../types';
import {
  extractMomentoTokenFromJWT,
  extractTenantIdFromJWT,
  validateMomentoTokenInfo,
  type MomentoTokenInfo
} from '../utils/jwtUtils';

export interface NotificationServiceConfig {
  jwtToken: string;
  tenantId: string;
  userId: string;
}

export interface NotificationMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  actionUrl?: string;
}

export class NotificationService {
  private topicClient: TopicClient | null = null;
  private subscription: TopicSubscribe.Response | null = null;
  private config: NotificationServiceConfig | null = null;
  private momentoTokenInfo: MomentoTokenInfo | null = null;
  private messageHandlers: Set<(notification: Notification) => void> = new Set();
  private isSubscribed = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second

  constructor() {
    // Initialize with empty state
  }

  /**
   * Initialize the notification service with JWT token
   */
  async initialize(config: NotificationServiceConfig): Promise<void> {
    try {
      this.config = config;

      // Extract Momento token from JWT
      this.momentoTokenInfo = extractMomentoTokenFromJWT(config.jwtToken);

      if (!this.momentoTokenInfo) {
        throw new Error('No Momento token found in JWT');
      }

      // Validate the token
      const validation = validateMomentoTokenInfo(this.momentoTokenInfo);
      if (!validation.isValid) {
        throw new Error(`Invalid Momento token: ${validation.errors.join(', ')}`);
      }

      // Create credential provider with Momento auth token
      const credentialProvider = CredentialProvider.fromString({
        authToken: this.momentoTokenInfo.token,
      });

      // Initialize topic client
      this.topicClient = new TopicClient({
        configuration: Configurations.Browser.v1(),
        credentialProvider,
      });

      console.log('NotificationService initialized successfully with tenant:', config.tenantId);
    } catch (error) {
      console.error('Failed to initialize NotificationService:', error);
      throw new Error(`Failed to initialize notification service: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Subscribe to tenant-specific notification channels
   */
  async subscribe(): Promise<void> {
    if (!this.topicClient || !this.config || !this.momentoTokenInfo) {
      throw new Error('NotificationService not initialized');
    }

    if (this.isSubscribed) {
      console.log('Already subscribed to notifications');
      return;
    }

    try {
      // Subscribe to multiple tenant-specific channels including system error channels
      const channels = [
        `tenant:${this.config.tenantId}:notifications`,
        `tenant:${this.config.tenantId}:issues`,
        `tenant:${this.config.tenantId}:subscribers`,
        `tenant:${this.config.tenantId}:brand`,
        `tenant:${this.config.tenantId}:system`,
        `tenant:${this.config.tenantId}:errors`,
        `tenant:${this.config.tenantId}:system-alerts`,
        `system:global-alerts`, // Global system alerts
        `system:service-status` // Service status updates
      ];

      const subscribeOptions: SubscribeCallOptions = {
        onItem: (item: TopicItem) => {
          this.handleIncomingMessage(item);
        },
        onError: (error: any) => {
          console.error('Topic subscription error:', error);
          this.handleSubscriptionError(error);
        },
      };

      // Subscribe to all channels
      const subscriptionPromises = channels.map(async (channel) => {
        try {
          const subscribeResponse = await this.topicClient!.subscribe(
            this.momentoTokenInfo!.cacheName,
            channel,
            subscribeOptions
          );

          if (subscribeResponse instanceof TopicSubscribe.Error) {
            console.warn(`Failed to subscribe to channel ${channel}: ${subscribeResponse.message()}`);
            return null;
          }

          console.log(`Successfully subscribed to channel: ${channel}`);
          return subscribeResponse;
        } catch (error) {
          console.warn(`Error subscribing to channel ${channel}:`, error);
          return null;
        }
      });

      // Wait for all subscriptions to complete
      const subscriptions = await Promise.all(subscriptionPromises);
      const successfulSubscriptions = subscriptions.filter(sub => sub !== null);

      if (successfulSubscriptions.length === 0) {
        throw new Error('Failed to subscribe to any notification channels');
      }

      // Store the first successful subscription as the main one
      this.subscription = successfulSubscriptions[0];
      this.isSubscribed = true;
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection

      console.log(`Successfully subscribed to ${successfulSubscriptions.length}/${channels.length} notification channels for tenant: ${this.config.tenantId}`);
    } catch (error) {
      console.error('Failed to subscribe to notifications:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from topic and clean up resources
   */
  async unsubscribe(): Promise<void> {
    if (this.subscription && 'unsubscribe' in this.subscription) {
      try {
        (this.subscription as any).unsubscribe();
      } catch (error) {
        console.warn('Error during unsubscribe:', error);
      }
      this.subscription = null;
    }

    this.isSubscribed = false;
    this.reconnectAttempts = 0;
    console.log('Unsubscribed from notifications');
  }

  /**
   * Add a message handler for incoming notifications
   */
  addMessageHandler(handler: (notification: Notification) => void): void {
    this.messageHandlers.add(handler);
  }

  /**
   * Remove a message handler
   */
  removeMessageHandler(handler: (notification: Notification) => void): void {
    this.messageHandlers.delete(handler);
  }

  /**
   * Get subscription status
   */
  getSubscriptionStatus(): boolean {
    return this.isSubscribed;
  }

  /**
   * Handle incoming messages from Momento topic
   */
  private handleIncomingMessage(item: TopicItem): void {
    try {
      const messageData = item.valueString();
      let notificationMessage: NotificationMessage;

      // Try to parse as NotificationMessage first, then handle different formats
      try {
        notificationMessage = JSON.parse(messageData);
      } catch (parseError) {
        // Handle raw string messages or different formats
        notificationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'info',
          title: 'System Message',
          message: messageData,
          timestamp: new Date().toISOString()
        };
      }

      // Enhance system error messages
      if (this.isSystemErrorMessage(notificationMessage)) {
        notificationMessage = this.enhanceSystemErrorMessage(notificationMessage);
      }

      // Convert to Notification format
      const notification: Notification = {
        id: notificationMessage.id,
        type: notificationMessage.type,
        title: notificationMessage.title,
        message: notificationMessage.message,
        timestamp: notificationMessage.timestamp,
        read: false,
        actionUrl: notificationMessage.actionUrl,
      };

      // Notify all registered handlers
      this.messageHandlers.forEach(handler => {
        try {
          handler(notification);
        } catch (error) {
          console.error('Error in notification handler:', error);
        }
      });

      console.log('Processed notification:', notification.title);
    } catch (error) {
      console.error('Failed to process incoming notification:', error);

      // Create a fallback error notification
      const fallbackNotification: Notification = {
        id: `error-${Date.now()}`,
        type: 'error',
        title: 'Message Processing Error',
        message: 'Failed to process an incoming notification. Some information may be missing.',
        timestamp: new Date().toISOString(),
        read: false
      };

      this.messageHandlers.forEach(handler => {
        try {
          handler(fallbackNotification);
        } catch (handlerError) {
          console.error('Error in fallback notification handler:', handlerError);
        }
      });
    }
  }

  /**
   * Check if a message is a system error message
   */
  private isSystemErrorMessage(message: NotificationMessage): boolean {
    return (
      message.type === 'error' ||
      message.title.toLowerCase().includes('error') ||
      message.title.toLowerCase().includes('failed') ||
      message.title.toLowerCase().includes('unavailable') ||
      message.message.toLowerCase().includes('error') ||
      message.message.toLowerCase().includes('failed')
    );
  }

  /**
   * Enhance system error messages with better user-friendly content
   */
  private enhanceSystemErrorMessage(message: NotificationMessage): NotificationMessage {
    const enhanced = { ...message };

    // Map common system errors to user-friendly messages
    const errorMappings: Record<string, { title: string; message: string; actionUrl?: string }> = {
      'MOMENTO_TOKEN_EXPIRED': {
        title: 'Session Expired',
        message: 'Your session has expired. Please refresh the page to continue receiving notifications.',
        actionUrl: window.location.href
      },
      'MOMENTO_CONNECTION_FAILED': {
        title: 'Connection Issue',
        message: 'Unable to connect to the notification service. Retrying automatically...'
      },
      'MOMENTO_SUBSCRIPTION_ERROR': {
        title: 'Notification Service Error',
        message: 'There was an issue with the notification service. Some updates may be delayed.'
      },
      'RATE_LIMIT_EXCEEDED': {
        title: 'Rate Limit Exceeded',
        message: 'Too many requests. Please wait a moment before trying again.'
      },
      'SERVICE_UNAVAILABLE': {
        title: 'Service Temporarily Unavailable',
        message: 'The notification service is temporarily unavailable. We\'re working to restore it.'
      },
      'AUTHENTICATION_FAILED': {
        title: 'Authentication Error',
        message: 'There was an authentication issue. Please sign in again.'
      }
    };

    // Check if this is a known error type
    for (const [errorType, mapping] of Object.entries(errorMappings)) {
      if (message.message.includes(errorType) || message.title.includes(errorType)) {
        enhanced.title = mapping.title;
        enhanced.message = mapping.message;
        if (mapping.actionUrl) {
          enhanced.actionUrl = mapping.actionUrl;
        }
        break;
      }
    }

    // Ensure error type is set correctly
    if (enhanced.type !== 'error') {
      enhanced.type = 'error';
    }

    return enhanced;
  }

  /**
   * Handle subscription errors and implement reconnection logic
   */
  private handleSubscriptionError(error: any): void {
    console.error('Subscription error occurred:', error);
    this.isSubscribed = false;

    // Check if we should attempt to reconnect
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

      console.log(`Attempting to reconnect to notifications (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);

      setTimeout(async () => {
        try {
          await this.subscribe();
        } catch (reconnectError) {
          console.error('Reconnection attempt failed:', reconnectError);
        }
      }, delay);
    } else {
      console.error('Max reconnection attempts reached. Notification service will remain disconnected.');
      // Notify handlers about connection failure
      this.notifyConnectionError();
    }
  }

  /**
   * Notify handlers about connection errors
   */
  private notifyConnectionError(): void {
    const errorNotification: Notification = {
      id: `connection-error-${Date.now()}`,
      type: 'error',
      title: 'Connection Lost',
      message: 'Real-time notifications are temporarily unavailable. Please refresh the page to reconnect.',
      timestamp: new Date().toISOString(),
      read: false
    };

    this.messageHandlers.forEach(handler => {
      try {
        handler(errorNotification);
      } catch (error) {
        console.error('Error in notification handler:', error);
      }
    });
  }

  /**
   * Check if Momento token is expired and needs refresh
   */
  private isTokenExpired(): boolean {
    if (!this.momentoTokenInfo) {
      return true;
    }
    return this.momentoTokenInfo.isExpired;
  }

  /**
   * Refresh the service with a new JWT token
   */
  async refreshToken(newJwtToken: string): Promise<void> {
    if (!this.config) {
      throw new Error('Service not initialized');
    }

    // Unsubscribe from current connection
    await this.unsubscribe();

    // Update config with new JWT token
    const newConfig = {
      ...this.config,
      jwtToken: newJwtToken
    };

    // Reinitialize with new token
    await this.initialize(newConfig);

    // Resubscribe
    await this.subscribe();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.unsubscribe();
    this.messageHandlers.clear();
    this.topicClient = null;
    this.config = null;
    this.momentoTokenInfo = null;
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): {
    isSubscribed: boolean;
    isTokenExpired: boolean;
    reconnectAttempts: number;
    tenantId?: string;
  } {
    return {
      isSubscribed: this.isSubscribed,
      isTokenExpired: this.isTokenExpired(),
      reconnectAttempts: this.reconnectAttempts,
      tenantId: this.config?.tenantId
    };
  }
}

// Singleton instance
export const notificationService = new NotificationService();
