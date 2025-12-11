import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSenderStatus } from '@/hooks/useSenderStatus';
import { getFilteredNavigation } from '@/config/navigation';
import { generateSenderBadge } from '@/utils/navigationUtils';
import type { NavigationGroup } from '@/types/sidebar';

/**
 * Hook that provides navigation configuration with role-based filtering
 * and dynamic status badges
 */
export const useNavigationConfig = () => {
  const { user } = useAuth();
  const senderStatus = useSenderStatus();

  // Get filtered navigation based on user role
  const navigationGroups = useMemo(() => {
    const filteredGroups = getFilteredNavigation(user);

    // Add dynamic badges to navigation items
    return filteredGroups.map(group => ({
      ...group,
      items: group.items.map(item => {
        // Add sender status badge to sender emails item
        if (item.id === 'senders') {
          const badge = generateSenderBadge(senderStatus);
          return {
            ...item,
            badge
          };
        }

        return item;
      })
    }));
  }, [user, senderStatus]);

  return {
    navigationGroups,
    isLoading: senderStatus.loading,
    error: senderStatus.error,
    refreshSenderStatus: senderStatus.refresh
  };
};
