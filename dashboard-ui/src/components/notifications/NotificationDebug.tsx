
import { useNotifications } from '../../hooks/useNotifications';

/**
 * Debug component to test notification functionality
 * This component shows the current notification state and provides test buttons
 */
export function NotificationDebug() {
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    isSubscribed,
    showSuccess,
    showError,
    showInfo,
    showWarning,
    markAllAsRead,
    clearAllNotifications,
  } = useNotifications();

  const handleTestNotification = (type: 'success' | 'error' | 'info' | 'warning') => {
    const messages = {
      success: { title: 'Success!', message: 'This is a test success notification' },
      error: { title: 'Error!', message: 'This is a test error notification' },
      info: { title: 'Info', message: 'This is a test info notification' },
      warning: { title: 'Warning!', message: 'This is a test warning notification' },
    };

    const { title, message } = messages[type];

    switch (type) {
      case 'success':
        showSuccess(title, message);
        break;
      case 'error':
        showError(title, message);
        break;
      case 'info':
        showInfo(title, message);
        break;
      case 'warning':
        showWarning(title, message);
        break;
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-4">Notification Debug Panel</h3>

      {/* Connection Status */}
      <div className="mb-4">
        <h4 className="font-medium mb-2">Connection Status</h4>
        <div className="flex items-center space-x-4">
          <span className={`px-2 py-1 rounded text-sm ${
            isSubscribed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {isSubscribed ? 'Connected to Momento' : 'Not Connected'}
          </span>
          {isLoading && (
            <span className="px-2 py-1 rounded text-sm bg-yellow-100 text-yellow-800">
              Loading...
            </span>
          )}
          {error && (
            <span className="px-2 py-1 rounded text-sm bg-red-100 text-red-800">
              Error: {error}
            </span>
          )}
        </div>
      </div>

      {/* Notification Stats */}
      <div className="mb-4">
        <h4 className="font-medium mb-2">Notification Stats</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 p-3 rounded">
            <div className="text-2xl font-bold text-blue-600">{notifications.length}</div>
            <div className="text-sm text-gray-600">Total Notifications</div>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <div className="text-2xl font-bold text-red-600">{unreadCount}</div>
            <div className="text-sm text-gray-600">Unread</div>
          </div>
        </div>
      </div>

      {/* Test Buttons */}
      <div className="mb-4">
        <h4 className="font-medium mb-2">Test Notifications</h4>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleTestNotification('success')}
            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Test Success
          </button>
          <button
            onClick={() => handleTestNotification('error')}
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Test Error
          </button>
          <button
            onClick={() => handleTestNotification('info')}
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Test Info
          </button>
          <button
            onClick={() => handleTestNotification('warning')}
            className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600"
          >
            Test Warning
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mb-4">
        <h4 className="font-medium mb-2">Actions</h4>
        <div className="flex gap-2">
          <button
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300"
          >
            Mark All Read
          </button>
          <button
            onClick={clearAllNotifications}
            disabled={notifications.length === 0}
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Recent Notifications */}
      <div>
        <h4 className="font-medium mb-2">Recent Notifications</h4>
        <div className="max-h-64 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-gray-500 text-sm">No notifications</p>
          ) : (
            <div className="space-y-2">
              {notifications.slice(0, 5).map((notification) => (
                <div
                  key={notification.id}
                  className={`p-3 rounded border-l-4 ${
                    notification.type === 'success' ? 'border-green-500 bg-green-50' :
                    notification.type === 'error' ? 'border-red-500 bg-red-50' :
                    notification.type === 'warning' ? 'border-yellow-500 bg-yellow-50' :
                    'border-blue-500 bg-blue-50'
                  } ${!notification.read ? 'font-medium' : 'opacity-75'}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-sm">{notification.title}</div>
                      <div className="text-sm text-gray-600">{notification.message}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(notification.timestamp).toLocaleString()}
                      </div>
                    </div>
                    {!notification.read && (
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
