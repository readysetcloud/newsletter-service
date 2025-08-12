# Notification System Documentation

## Overview

The notification system provides real-time notifications using Momento Topics. It consists of three main components:

1. **NotificationService** - Handles Momento topic subscriptions and message processing
2. **NotificationProvider** - React context for application-wide notification state
3. **useNotifications** - Custom hook for easy notification management

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Momento       │    │ NotificationService │    │ NotificationProvider │
│   Topics        │───▶│                  │───▶│                 │
│                 │    │ - Subscribe      │    │ - State Mgmt    │
└─────────────────┘    │ - Message Handle │    │ - Local Storage │
                       └──────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │ useNotifications │
                                               │ Hook            │
                                               │ - Helper funcs  │
                                               │ - Utilities     │
                                               └─────────────────┘
```

## Setup

The notification system is automatically initialized when a user authenticates. The setup process:

1. User authenticates via AWS Cognito
2. NotificationProvider detects authentication
3. Initializes NotificationService with auth token
4. Subscribes to user-specific Momento topic
5. Starts receiving real-time notifications

## Usage

### Basic Usage

```typescript
import { useNotifications } from '@/hooks/useNotifications';

function MyComponent() {
  const {
    notifications,
    unreadCount,
    isSubscribed,
    showSuccess,
    showError,
    markAsRead,
    markAllAsRead
  } = useNotifications();

  // Show a success notification
  const handleSuccess = () => {
    showSuccess('Success!', 'Operation completed successfully');
  };

  // Show an error notification
  const handleError = () => {
    showError('Error!', 'Something went wrong');
  };

  return (
    <div>
      <p>Unread notifications: {unreadCount}</p>
      <p>Connection status: {isSubscribed ? 'Connected' : 'Disconnected'}</p>

      <button onClick={handleSuccess}>Show Success</button>
      <button onClick={handleError}>Show Error</button>
      <button onClick={markAllAsRead}>Mark All Read</button>
    </div>
  );
}
```

### Advanced Usage

```typescript
import { useNotifications } from '@/hooks/useNotifications';

function NotificationManager() {
  const {
    notifications,
    getRecentNotifications,
    getUnreadNotifications,
    getNotificationsByType,
    removeNotification,
    clearAllNotifications
  } = useNotifications();

  // Get recent notifications (last 5)
  const recentNotifications = getRecentNotifications(5);

  // Get only unread notifications
  const unreadNotifications = getUnreadNotifications();

  // Get error notifications only
  const errorNotifications = getNotificationsByType('error');

  return (
    <div>
      <h3>Recent Notifications</h3>
      {recentNotifications.map(notification => (
        <div key={notification.id}>
          <h4>{notification.title}</h4>
          <p>{notification.message}</p>
          <button onClick={() => removeNotification(notification.id)}>
            Remove
          </button>
        </div>
      ))}

      <button onClick={clearAllNotifications}>
        Clear All Notifications
      </button>
    </div>
  );
}
```

## Notification Types

The system supports four notification types:

- **info** - General information (blue)
- **success** - Success messages (green)
- **warning** - Warning messages (yellow)
- **error** - Error messages (red)

## Data Model

```typescript
interface Notification {
  id: string;                    // Unique identifier
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;                 // Notification title
  message: string;               // Notification message
  timestamp: string;             // ISO timestamp
  read: boolean;                 // Read status
  actionUrl?: string;            // Optional action URL
}
```

## Momento Integration

### Topic Structure

- **Cache Name**: `newsletter-notifications`
- **Topic Name**: `user-notifications-{userId}`

### Message Format

Messages sent to Momento topics should follow this format:

```json
{
  "id": "notification-123",
  "type": "info",
  "title": "New Issue Published",
  "message": "Your newsletter issue has been published successfully",
  "timestamp": "2024-01-15T10:30:00Z",
  "actionUrl": "/dashboard"
}
```

### Authentication

The service uses the user's JWT token from AWS Cognito for Momento authentication. The token is automatically refreshed as needed.

## Local Storage

Notifications are persisted in localStorage under the key `newsletter-notifications`. This ensures notifications persist across browser sessions.

## Error Handling

The system includes comprehensive error handling:

- **Connection Errors**: Automatic reconnection attempts
- **Message Parsing Errors**: Graceful error handling with logging
- **Authentication Errors**: Automatic token refresh
- **Storage Errors**: Fallback to in-memory storage

## Testing

### Debug Component

In development mode, a debug component is available on the dashboard:

```typescript
import { NotificationDebug } from '@/components/notifications/NotificationDebug';

// Shows connection status, notification stats, and test buttons
<NotificationDebug />
```

### Manual Testing

You can manually test notifications by:

1. Using the debug component test buttons
2. Calling the helper functions directly
3. Publishing messages to Momento topics externally

## Configuration

### Environment Variables

The notification system uses these configuration values:

- **Cache Name**: `newsletter-notifications` (hardcoded)
- **Topic Name**: `user-notifications` (hardcoded, user ID appended)
- **Auth Token**: Retrieved from AWS Cognito session

### Customization

To customize the notification system:

1. **Change topic names**: Update `NotificationContext.tsx`
2. **Add notification types**: Extend the `Notification` type
3. **Modify storage**: Update localStorage key in `NotificationContext.tsx`
4. **Custom styling**: Update notification components

## Troubleshooting

### Common Issues

1. **Not receiving notifications**
   - Check authentication status
   - Verify Momento credentials
   - Check browser console for errors

2. **Notifications not persisting**
   - Check localStorage permissions
   - Verify JSON serialization

3. **Connection issues**
   - Check network connectivity
   - Verify Momento service status
   - Check authentication token validity

### Debug Information

The debug component provides:
- Connection status
- Notification statistics
- Test notification buttons
- Recent notification list

## Performance Considerations

- Notifications are limited to 1000 items in memory
- Local storage is cleaned up periodically
- Automatic reconnection with exponential backoff
- Efficient message handling with minimal re-renders

## Security

- All communication uses HTTPS/WSS
- JWT tokens are securely managed by AWS Amplify
- User-specific topics prevent cross-user message leakage
- Input sanitization for notification content
