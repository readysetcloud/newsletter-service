/**
 * Tests that useTheme reads/writes using STORAGE_KEYS.theme from brand config.
 * Validates: Requirements 3.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { STORAGE_KEYS } from '@/constants/brand';
import { useTheme } from '../useTheme';

describe('useTheme brand storage key', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';

    // jsdom doesn't implement matchMedia — stub it to return light theme
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should write to STORAGE_KEYS.theme on initial render', () => {
    renderHook(() => useTheme());

    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    expect(stored).toBeTruthy();
    expect(['light', 'dark']).toContain(stored);
  });

  it('should write to STORAGE_KEYS.theme when toggling', () => {
    const { result } = renderHook(() => useTheme());
    const initial = result.current.theme;

    act(() => {
      result.current.toggleTheme();
    });

    const expected = initial === 'dark' ? 'light' : 'dark';
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe(expected);
  });

  it('should read stored theme from STORAGE_KEYS.theme on mount', () => {
    localStorage.setItem(STORAGE_KEYS.theme, 'dark');

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('should not read from non-branded storage keys', () => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('wrong-theme', 'dark');

    const { result } = renderHook(() => useTheme());
    // matchMedia mock returns false → system theme is light
    expect(result.current.theme).toBe('light');
  });

  it('should write to STORAGE_KEYS.theme when setTheme is called', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('dark');

    act(() => {
      result.current.setTheme('light');
    });
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('light');
  });
});
