import { useState } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { createNewsletterNotifications } from '../utils/realtime';

/**
 * Demo component to test realtime notifications
 * Remove this in production - it's just for testing the system
 */
export default function RealtimeDemo() {
  const { addNotification, isConnected } = useNotifications();
  const [testCounter, setTestCounter] = useState(1);

  const testNotifications = [
    () => addNotification(createNewsletterNotifications.issueStarted(`Test Newsletter #${testCounter}`)),
    () => addNotification(createNewsletterNotifications.issueCompleted(`Test Newsletter #${testCounter}`, 1250)),
    () => addNotification(createNewsletterNotifications.subscriberAdded(1251)),
    () => addNotification(createNewsletterNotifications.subscribersImported(50, 1301)),
    () => addNotification(createNewsletterNotifications.bounceAlert(12, `Test Newsletter #${testCounter}`)),
    () => addNotification(createNewsletterNotifications.issueFailed(`Test Newsletter #${testCounter}`, 'Rate limit exceeded'))
  ];

  const runTest = (testFn) => {
    testFn();
    setTestCounter(prev => prev + 1);
  };

  // Only show in development
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="fixed bottom-4 left-4 bg-white border rounded-lg shadow-lg p-4 max-w-xs">
      <h3 className="text-sm font-medium mb-2">Realtime Demo</h3>
      <p className="text-xs text-gray-600 mb-3">
        Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </p>

      <div className="space-y-1">
        <button
          onClick={() => runTest(testNotifications[0])}
          className="w-full text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded"
        >
          Issue Started
        </button>
        <button
          onClick={() => runTest(testNotifications[1])}
          className="w-full text-xs px-2 py-1 bg-green-100 hover:bg-green-200 rounded"
        >
          Issue Completed
        </button>
        <button
          onClick={() => runTest(testNotifications[2])}
          className="w-full text-xs px-2 py-1 bg-green-100 hover:bg-green-200 rounded"
        >
          New Subscriber
        </button>
        <button
          onClick={() => runTest(testNotifications[3])}
          className="w-full text-xs px-2 py-1 bg-green-100 hover:bg-green-200 rounded"
        >
          Bulk Import
        </button>
        <button
          onClick={() => runTest(testNotifications[4])}
          className="w-full text-xs px-2 py-1 bg-yellow-100 hover:bg-yellow-200 rounded"
        >
          Bounce Alert
        </button>
        <button
          onClick={() => runTest(testNotifications[5])}
          className="w-full text-xs px-2 py-1 bg-red-100 hover:bg-red-200 rounded"
        >
          Send Failed
        </button>
      </div>
    </div>
  );
}
