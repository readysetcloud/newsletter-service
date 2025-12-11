import { useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface UseUnsavedChangesOptions {
  hasUnsavedChanges: boolean;
  message?: string;
  onNavigateAway?: () => void;
}

export const useUnsavedChanges = ({
  hasUnsavedChanges,
  message = 'You have unsaved changes. Are you sure you want to leave?',
  onNavigateAway
}: UseUnsavedChangesOptions) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Handle browser navigation (back button, refresh, etc.)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, message]);

  // Create a navigation function that checks for unsaved changes
  const navigateWithConfirmation = useCallback((to: string, options?: { replace?: boolean }) => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(message);
      if (!confirmed) {
        return false;
      }
      onNavigateAway?.();
    }

    navigate(to, options);
    return true;
  }, [hasUnsavedChanges, message, navigate, onNavigateAway]);

  return {
    navigateWithConfirmation,
    hasUnsavedChanges
  };
};
