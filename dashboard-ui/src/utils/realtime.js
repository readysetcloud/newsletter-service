/**
 * Simple utility functions for realtime functionality
 * Keeps the realtime logic clean and testable
 */

export const createRealtimeMessage = (type, payload) => ({
  type,
  payload,
  timestamp: new Date().toISOString()
});

export const isValidRealtimeMessage = (message) => {
  return message &&
         typeof message === 'object' &&
         typeof message.type === 'string' &&
         message.payload !== undefined;
};

export const formatNotification = (type, title, message, options = {}) => ({
  type,
  title,
  message,
  timestamp: new Date(),
  ...options
});

// Common notification creators for newsletter events
export const createNewsletterNotifications = {
  issueStarted: (issueTitle) => formatNotification(
    'info',
    'Newsletter Sending Started',
    `Started sending "${issueTitle}" to subscribers`,
    { persistent: false }
  ),

  issueCompleted: (issueTitle, recipientCount) => formatNotification(
    'success',
    'Newsletter Sent Successfully',
    `"${issueTitle}" sent to ${recipientCount} subscribers`,
    { persistent: false }
  ),

  issueFailed: (issueTitle, error) => formatNotification(
    'error',
    'Newsletter Send Failed',
    `Failed to send "${issueTitle}": ${error}`,
    { persistent: true }
  ),

  subscriberAdded: (count) => formatNotification(
    'success',
    'New Subscriber',
    `You now have ${count} subscribers`,
    { persistent: false }
  ),

  subscribersImported: (importedCount, totalCount) => formatNotification(
    'success',
    'Subscribers Imported',
    `Successfully imported ${importedCount} subscribers. Total: ${totalCount}`,
    { persistent: false }
  ),

  bounceAlert: (bounceCount, issueTitle) => formatNotification(
    'warning',
    'High Bounce Rate Detected',
    `${bounceCount} bounces detected for "${issueTitle}"`,
    { persistent: true }
  )
};
