import type { User } from '@/contexts/AuthContext';

/**
 * Check if user has admin privileges
 */
export const isAdmin = (user: User | null): boolean => {
  return user?.isAdmin === true;
};

/**
 * Check if user has tenant admin privileges
 */
export const isTenantAdmin = (user: User | null): boolean => {
  return user?.isTenantAdmin === true;
};

/**
 * Check if user has any admin privileges (admin or tenant admin)
 */
export const hasAdminPrivileges = (user: User | null): boolean => {
  return isAdmin(user) || isTenantAdmin(user);
};

/**
 * Check if user can access admin-only features
 */
export const canAccessAdminFeatures = (user: User | null): boolean => {
  return isAdmin(user);
};

/**
 * Check if user can access tenant admin features
 */
export const canAccessTenantAdminFeatures = (user: User | null): boolean => {
  return isTenantAdmin(user) || isAdmin(user);
};

/**
 * Check if user can access billing features
 */
export const canAccessBilling = (user: User | null): boolean => {
  // Billing is available to both admin and tenant admin users
  return canAccessTenantAdminFeatures(user);
};

/**
 * Get user role display name
 */
export const getUserRoleDisplayName = (user: User | null): string => {
  if (!user) return 'Guest';

  if (isAdmin(user)) return 'Admin';
  if (isTenantAdmin(user)) return 'Tenant Admin';

  return 'User';
};

/**
 * Check if user has completed profile setup
 */
export const hasCompletedProfile = (user: User | null): boolean => {
  return user?.profileCompleted === true;
};

/**
 * Check if user's email is verified
 */
export const isEmailVerified = (user: User | null): boolean => {
  return user?.emailVerified === true;
};

/**
 * Get user's full name
 */
export const getUserFullName = (user: User | null): string => {
  if (!user) return '';

  const firstName = user.firstName || '';
  const lastName = user.lastName || '';

  return `${firstName} ${lastName}`.trim() || user.email || 'User';
};

/**
 * Get user's initials for avatar
 */
export const getUserInitials = (user: User | null): string => {
  if (!user) return 'U';

  const firstName = user.firstName || '';
  const lastName = user.lastName || '';

  if (firstName && lastName) {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  }

  if (firstName) {
    return firstName.charAt(0).toUpperCase();
  }

  if (user.email) {
    return user.email.charAt(0).toUpperCase();
  }

  return 'U';
};
