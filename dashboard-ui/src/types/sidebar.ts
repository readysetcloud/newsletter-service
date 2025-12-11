import { ComponentType } from 'react';

export interface BadgeConfig {
  count?: number;
  status?: 'success' | 'warning' | 'error' | 'info';
  text?: string;
}

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  badge?: BadgeConfig;
  adminOnly?: boolean;
  tenantAdminOnly?: boolean;
  preloadKey?: string;
}

export interface NavigationGroup {
  id: string;
  label: string;
  items: NavigationItem[];
  adminOnly?: boolean;
  tenantAdminOnly?: boolean;
}

export interface SidebarState {
  collapsed: boolean;
  visible: boolean;
  preferences: SidebarPreferences;
}

export interface SidebarPreferences {
  collapsed: boolean;
  deviceSpecific: {
    desktop: boolean;
    tablet: boolean;
  };
}

export type ScreenSize = 'mobile' | 'tablet' | 'desktop';

export interface LayoutState {
  sidebarCollapsed: boolean;
  sidebarVisible: boolean;
  screenSize: ScreenSize;
}
