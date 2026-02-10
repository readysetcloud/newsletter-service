/**
 * Tests for issue detail utility functions
 */

import { vi } from 'vitest';
import {
  savePreferences,
  loadPreferences,
  clearPreferences,
  updatePreference,
  getDefaultPreferences,
  saveScrollPosition,
  loadScrollPosition,
  clearScrollPosition,
} from '../issueDetailUtils';

describe('User Preferences', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  describe('getDefaultPreferences', () => {
    it('should return default preferences with correct structure', () => {
      const defaults = getDefaultPreferences();

      expect(defaults).toEqual({
        expandedSections: [],
        defaultComparison: 'average',
        showPercentages: true,
        chartStyle: 'line',
      });
    });
  });

  describe('savePreferences and loadPreferences', () => {
    it('should save and load preferences correctly', () => {
      const preferences = {
        expandedSections: ['engagement', 'audience'],
        defaultComparison: 'last' as const,
        showPercentages: false,
        chartStyle: 'bar' as const,
      };

      const saved = savePreferences(preferences);
      expect(saved).toBe(true);

      const loaded = loadPreferences();
      expect(loaded).toEqual(preferences);
    });

    it('should return default preferences when nothing is saved', () => {
      const loaded = loadPreferences();
      expect(loaded).toEqual(getDefaultPreferences());
    });

    it('should handle localStorage quota exceeded error', () => {
      // Mock localStorage.setItem to throw QuotaExceededError
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = vi.fn(() => {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      });

      const preferences = getDefaultPreferences();
      const saved = savePreferences(preferences);

      expect(saved).toBe(false);

      // Restore original
      Storage.prototype.setItem = originalSetItem;
    });
  });

  describe('clearPreferences', () => {
    it('should clear saved preferences', () => {
      const preferences = getDefaultPreferences();
      savePreferences(preferences);

      const cleared = clearPreferences();
      expect(cleared).toBe(true);

      const loaded = loadPreferences();
      expect(loaded).toEqual(getDefaultPreferences());
    });
  });

  describe('updatePreference', () => {
    it('should update a single preference field', () => {
      const initialPreferences = getDefaultPreferences();
      savePreferences(initialPreferences);

      const updated = updatePreference('defaultComparison', 'best');
      expect(updated).toBe(true);

      const loaded = loadPreferences();
      expect(loaded.defaultComparison).toBe('best');
      expect(loaded.expandedSections).toEqual([]);
      expect(loaded.showPercentages).toBe(true);
    });

    it('should update expandedSections array', () => {
      const updated = updatePreference('expandedSections', ['engagement', 'deliverability']);
      expect(updated).toBe(true);

      const loaded = loadPreferences();
      expect(loaded.expandedSections).toEqual(['engagement', 'deliverability']);
    });
  });
});

describe('Scroll Position', () => {
  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
  });

  describe('saveScrollPosition and loadScrollPosition', () => {
    it('should save and load scroll position correctly', () => {
      const issueId = 'issue-123';
      const position = 500;

      const saved = saveScrollPosition(issueId, position);
      expect(saved).toBe(true);

      const loaded = loadScrollPosition(issueId);
      expect(loaded).toBe(position);
    });

    it('should return null when no scroll position is saved', () => {
      const loaded = loadScrollPosition('issue-123');
      expect(loaded).toBeNull();
    });

    it('should return null when loading for different issue', () => {
      saveScrollPosition('issue-123', 500);

      const loaded = loadScrollPosition('issue-456');
      expect(loaded).toBeNull();
    });

    it('should return null when saved data is expired', () => {
      const issueId = 'issue-123';
      const position = 500;

      // Save with old timestamp
      const scrollData = {
        issueId,
        position,
        timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
      };
      sessionStorage.setItem('issue-detail-scroll-position', JSON.stringify(scrollData));

      // Load with 5 minute max age (default)
      const loaded = loadScrollPosition(issueId);
      expect(loaded).toBeNull();
    });

    it('should load scroll position within max age', () => {
      const issueId = 'issue-123';
      const position = 500;

      // Save with recent timestamp
      const scrollData = {
        issueId,
        position,
        timestamp: Date.now() - 2 * 60 * 1000, // 2 minutes ago
      };
      sessionStorage.setItem('issue-detail-scroll-position', JSON.stringify(scrollData));

      // Load with 5 minute max age (default)
      const loaded = loadScrollPosition(issueId);
      expect(loaded).toBe(position);
    });

    it('should return null when saved data structure is invalid', () => {
      sessionStorage.setItem('issue-detail-scroll-position', 'invalid json');
      const loaded = loadScrollPosition('issue-123');
      expect(loaded).toBeNull();
    });

    it('should handle sessionStorage errors gracefully', () => {
      // Mock sessionStorage.setItem to throw error
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = vi.fn(() => {
        throw new Error('Storage error');
      });

      const saved = saveScrollPosition('issue-123', 500);
      expect(saved).toBe(false);

      // Restore original
      Storage.prototype.setItem = originalSetItem;
    });
  });

  describe('clearScrollPosition', () => {
    it('should clear saved scroll position', () => {
      saveScrollPosition('issue-123', 500);

      const cleared = clearScrollPosition();
      expect(cleared).toBe(true);

      const loaded = loadScrollPosition('issue-123');
      expect(loaded).toBeNull();
    });
  });
});
