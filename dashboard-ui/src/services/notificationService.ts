import {
  TopicClient,
  CredentialProvider,
  Configurations,
  TopicSubscribe,
  TopicItem,
  SubscribeCallOptions
} from '@gomomento/sdk-web';
import type { Notification } from '../types';

export interface NotificationServiceConfig {
  authToken: string;
  cacheName: string;
  topicName: string;
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
  private messageHandlers: Set<(notification: Notification) => void> = new Set();
  private isSubscribed = false;

  constructor() {
    // Initialize with empty state
  }

  /**
   * Initialize the notification service with Momento configuration
   */
  async initialize(config: NotificationServiceConfig): Promise<void> {
    try {
      this.config = config;

      // Create credential provider with auth token
      const credentialProvider = CredentialProvider.fromString({
        authToken: config.authToken,
      });

      // Initialize topic client
      this.topicClient = new TopicClient({
        configuration: Configurations.Browser.v1(),
        credentialProvider,
      });

      console.log('NotificationService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize NotificationService:', error);
      throw new Error('Failed to initialize notification service');
    }
  }

  /**
   * Subscribe to user-specific topic for real-time notifications
   */
  async subscribe(userId: string): Promise<void> {
    if (!this.topicClient || !this.config) {
      throw new Error('NotificationService not initialized');
    }

    if (this.isSubscribed) {
      console.log('Already subscribed to notifications');
      return;
    }

    try {
      const topicName = `${this.config.topicName}-${userId}`;

      const subscribeOptions: SubscribeCallOptions = {
        onItem: (item: TopicItem) => {
          this.handleIncomingMessage(item);
        },
        onError: (error: any) => {
          console.error('Topic subscription error:', error);
          this.handleSubscriptionError(error);
        },
      };

      const subscribeResponse = await this.topicClient.subscribe(
        this.config.cacheName,
        topicName,
        subscribeOptions
      );

      if (subscribeResponse instanceof TopicSubscribe.Error) {
        throw new Error(`Failed to subscribe to topic: ${subscribeResponse.message()}`);
      }

      this.subscription = subscribeResponse;
      this.isSubscribed = true;

      console.log(`Successfully subscribed to topic: ${topicName}`);
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
      (this.subscription as any).unsubscribe();
      this.subscription = null;
    }

    this.isSubscribed = false;
    this.messageHandlers.clear();
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
      const notificationMessage: NotificationMessage = JSON.parse(messageData);

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
    }
  }

  /**
   * Handle subscription errors
   */
  private handleSubscriptionError(error: any): void {
    console.error('Subscription error occurred:', error);
    this.isSubscribed = false;

    // Attempt to reconnect after a delay
    setTimeout(() => {
      if (this.config) {
        console.log('Attempting to reconnect to notifications...');
        // Note: In a real implementation, you might want to extract userId from config
        // For now, we'll let the NotificationProvider handle reconnection
      }
    }, 5000);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.unsubscribe();
    this.topicClient = null;
    this.config = null;
  }
}

// Singleton instance
export const notificationService = new NotificationService();
