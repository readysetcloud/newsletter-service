import React from 'react';
import { useNavigationConfig, useNavigationState } from '@/hooks';
import { getTooltipText } from '@/utils/navigationUtils';

/**
 * Example component showing how to use the navigation configuration and state hooks
 */
export const NavigationUsage: React.FC = () => {
  const { navigationGroups, isLoading, error } = useNavigationConfig();
  const {
    layoutState,
    activeItemId,
    toggleSidebar,
    isMobile,
    isTablet,
    isDesktop
  } = useNavigationState();

  if (isLoading) {
    return <div>Loading navigation...</div>;
  }

  if (error) {
    return <div>Error loading navigation: {error}</div>;
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Navigation Configuration Example</h2>

      {/* Screen size info */}
      <div className="mb-4 p-3 bg-gray-100 rounded">
        <h3 className="font-semibold">Screen Size Info:</h3>
        <p>Current screen: {layoutState.screenSize}</p>
        <p>Is Mobile: {isMobile ? 'Yes' : 'No'}</p>
        <p>Is Tablet: {isTablet ? 'Yes' : 'No'}</p>
        <p>Is Desktop: {isDesktop ? 'Yes' : 'No'}</p>
        <p>Sidebar Collapsed: {layoutState.sidebarCollapsed ? 'Yes' : 'No'}</p>
        <p>Sidebar Visible: {layoutState.sidebarVisible ? 'Yes' : 'No'}</p>
        <p>Active Item: {activeItemId || 'None'}</p>
      </div>

      {/* Toggle button */}
      <button
        onClick={toggleSidebar}
        className="mb-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Toggle Sidebar
      </button>

      {/* Navigation groups */}
      <div className="space-y-6">
        {navigationGroups.map(group => (
          <div key={group.id} className="border rounded p-4">
            <h3 className="font-semibold text-lg mb-3">
              {group.label || 'Main Navigation'}
            </h3>

            <div className="space-y-2">
              {group.items.map(item => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-2 rounded ${
                    activeItemId === item.id ? 'bg-blue-100' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <item.icon className="w-5 h-5" />
                    <span>{item.label}</span>
                    <span className="text-sm text-gray-500">({item.href})</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    {item.badge && (
                      <span
                        className={`px-2 py-1 text-xs rounded ${
                          item.badge.status === 'error' ? 'bg-red-100 text-red-800' :
                          item.badge.status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                          item.badge.status === 'info' ? 'bg-blue-100 text-blue-800' :
                          'bg-green-100 text-green-800'
                        }`}
                        title={getTooltipText(item.label, item.badge)}
                      >
                        {item.badge.text || item.badge.count}
                      </span>
                    )}

                    {item.adminOnly && (
                      <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">
                        Admin
                      </span>
                    )}

                    {item.tenantAdminOnly && (
                      <span className="px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded">
                        Tenant Admin
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
