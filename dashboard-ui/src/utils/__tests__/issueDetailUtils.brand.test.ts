/**
 * Tests that issueDetailUtils functions use STORAGE_KEYS from brand config.
 * Validates: Requirements 3.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '@/constants/brand';
import {
  savePreferences,
  loadPreferences,
  clearPreferences,
  saveScrollPosition,
  loadScrollPosition,
  clearScrollPosition,
  getDefaultPreferences,
} from '../issueDetailUtils';

describe('issueDetailUtils brand storage keys', () => {
  describe('preferences use STORAGE_KEYS.issueDetailPreferences', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('savePreferences writes to STORAGE_KEYS.issueDetailPreferences', () => {
      const prefs = getDefaultPreferences();
      savePreferences(prefs);

      const stored = localStorage.getItem(STORAGE_KEYS.issueDetailPreferences);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(prefs);
    });

    it('loadPreferences reads from STORAGE_KEYS.issueDetailPreferences', () => {
      const prefs = {
        expandedSections: ['engagement'],
        defaultComparison: 'best' as const,
        showPercentages: false,
        chartStyle: 'bar' as const,
      };
      localStorage.setItem(STORAGE_KEYS.issueDetailPreferences, JSON.stringify(prefs));

      const loaded = loadPreferences();
      expect(loaded).toEqual(prefs);
    });

    it('loadPreferences does not read from old un-prefixed key', () => {
      const prefs = {
        expandedSections: ['engagement'],
        defaultComparison: 'best' as const,
        showPercentages: false,
        chartStyle: 'bar' as const,
      };
      // Write to an old-style key without the brand prefix
      localStorage.setItem('issue-detail-preferences', JSON.stringify(prefs));

      const loaded = loadPreferences();
      // Should return defaults since the branded key has nothing
      expect(loaded).toEqual(getDefaultPreferences());
    });

    it('clearPreferences removes STORAGE_KEYS.issueDetailPreferences', () => {
      const prefs = getDefaultPreferences();
      savePreferences(prefs);
      expect(localStorage.getItem(STORAGE_KEYS.issueDetailPreferences)).not.toBeNull();

      clearPreferences();
      expect(localStorage.getItem(STORAGE_KEYS.issueDetailPreferences)).toBeNull();
    });
  });

  describe('scroll position uses STORAGE_KEYS.issueDetailScrollPosition', () => {
    beforeEach(() => {
      sessionStorage.clear();
    });

    it('saveScrollPosition writes to STORAGE_KEYS.issueDetailScrollPosition', () => {
      saveScrollPosition('issue-1', 300);

      const stored = sessionStorage.getItem(STORAGE_KEYS.issueDetailScrollPosition);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.issueId).toBe('issue-1');
      expect(parsed.position).toBe(300);
    });

    it('loadScrollPosition reads from STORAGE_KEYS.issueDetailScrollPosition', () => {
      const scrollData = {
        issueId: 'issue-2',
        position: 750,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(STORAGE_KEYS.issueDetailScrollPosition, JSON.stringify(scrollData));

      const loaded = loadScrollPosition('issue-2');
      expect(loaded).toBe(750);
    });

    it('loadScrollPosition does not read from old un-prefixed key', () => {
      const scrollData = {
        issueId: 'issue-3',
        position: 500,
        timestamp: Date.now(),
      };
      // Write to an old-style key without the brand prefix
      sessionStorage.setItem('issue-detail-scroll-position', JSON.stringify(scrollData));

      const loaded = loadScrollPosition('issue-3');
      expect(loaded).toBeNull();
    });

    it('clearScrollPosition removes STORAGE_KEYS.issueDetailScrollPosition', () => {
      saveScrollPosition('issue-4', 100);
      expect(sessionStorage.getItem(STORAGE_KEYS.issueDetailScrollPosition)).not.toBeNull();

      clearScrollPosition();
      expect(sessionStorage.getItem(STORAGE_KEYS.issueDetailScrollPosition)).toBeNull();
    });
  });
});
