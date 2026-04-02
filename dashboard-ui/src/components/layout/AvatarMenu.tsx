import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import {
  UserIcon,
  EnvelopeIcon,
  KeyIcon,
  CreditCardIcon,
  MoonIcon,
  SunIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { UserIcon as UserSolidIcon } from '@heroicons/react/24/solid';
import { getInitials } from './avatarUtils';

export function AvatarMenu() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const initials = getInitials(user?.firstName, user?.lastName);
  const showBilling = user?.isAdmin === true || user?.isTenantAdmin === true;

  // Build menu items list for arrow key navigation
  const getMenuItems = useCallback(() => {
    const items: { id: string; type: 'link' | 'button' }[] = [
      { id: 'profile', type: 'link' },
      { id: 'senders', type: 'link' },
      { id: 'api-keys', type: 'link' },
    ];
    if (showBilling) {
      items.push({ id: 'billing', type: 'link' });
    }
    items.push({ id: 'theme-toggle', type: 'button' });
    items.push({ id: 'logout', type: 'button' });
    return items;
  }, [showBilling]);

  const toggle = useCallback(() => {
    setIsOpen(prev => {
      if (prev) {
        setActiveIndex(-1);
      }
      return !prev;
    });
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
    buttonRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        close();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, close]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, close]);

  const handleButtonKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      }
      setActiveIndex(0);
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const items = getMenuItems();
    const itemCount = items.length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(prev => (prev + 1) % itemCount);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(prev => (prev - 1 + itemCount) % itemCount);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(itemCount - 1);
        break;
      case 'Tab':
        close();
        break;
    }
  };

  // Focus active item when activeIndex changes
  useEffect(() => {
    if (isOpen && activeIndex >= 0 && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex, isOpen]);

  const handleLogout = async () => {
    close();
    try {
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const setItemRef = (index: number) => (el: HTMLElement | null) => {
    itemRefs.current[index] = el;
  };

  if (!user) return null;

  const linkItems = [
    { id: 'profile', label: 'Profile', href: '/profile', icon: UserSolidIcon },
    { id: 'senders', label: 'Sender Emails', href: '/senders', icon: EnvelopeIcon },
    { id: 'api-keys', label: 'API Keys', href: '/api-keys', icon: KeyIcon },
    ...(showBilling
      ? [{ id: 'billing', label: 'Billing', href: '/billing', icon: CreditCardIcon }]
      : []),
  ];

  const themeToggleIndex = linkItems.length;
  const logoutIndex = linkItems.length + 1;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        onKeyDown={handleButtonKeyDown}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label="User menu"
        className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-100 text-primary-700 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
      >
        {initials ? (
          <span>{initials}</span>
        ) : (
          <UserIcon className="w-5 h-5" aria-hidden="true" />
        )}
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label="User menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 mt-2 w-64 rounded-lg bg-surface shadow-lg ring-1 ring-border z-50"
        >
          {/* Header: email + role badge */}
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-medium text-foreground truncate">{user.email}</p>
            {user.role && (
              <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                {user.role}
              </span>
            )}
          </div>

          {/* Link items */}
          <div className="py-1">
            {linkItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  ref={setItemRef(idx) as React.Ref<HTMLAnchorElement>}
                  role="menuitem"
                  tabIndex={activeIndex === idx ? 0 : -1}
                  onClick={close}
                  className="flex items-center w-full px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Icon className="w-4 h-4 mr-3" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Theme toggle */}
          <div className="py-1">
            <button
              ref={setItemRef(themeToggleIndex) as React.Ref<HTMLButtonElement>}
              type="button"
              role="menuitem"
              tabIndex={activeIndex === themeToggleIndex ? 0 : -1}
              onClick={() => {
                toggleTheme();
              }}
              className="flex items-center w-full px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {theme === 'dark' ? (
                <SunIcon className="w-4 h-4 mr-3" aria-hidden="true" />
              ) : (
                <MoonIcon className="w-4 h-4 mr-3" aria-hidden="true" />
              )}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>

            {/* Logout */}
            <button
              ref={setItemRef(logoutIndex) as React.Ref<HTMLButtonElement>}
              type="button"
              role="menuitem"
              tabIndex={activeIndex === logoutIndex ? 0 : -1}
              onClick={handleLogout}
              className="flex items-center w-full px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowRightOnRectangleIcon className="w-4 h-4 mr-3" aria-hidden="true" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
