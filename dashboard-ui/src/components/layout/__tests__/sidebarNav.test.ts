import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, getNavSections, isNavItemActive } from '../sidebarNav';

describe('sidebarNav', () => {
  describe('NAV_ITEMS order and grouping', () => {
    it('is in audience-first priority order', () => {
      expect(NAV_ITEMS.map((i) => i.name)).toEqual([
        'Dashboard',
        'Issues',
        'Subscribers',
        'Templates',
        'Snippets',
        'Sponsors',
        'Brand',
        'Pricing',
      ]);
    });

    it('tags Templates and Snippets (and only those) with the "Content" group', () => {
      const grouped = NAV_ITEMS.filter((i) => i.group === 'Content').map((i) => i.name);
      expect(grouped).toEqual(['Templates', 'Snippets']);
      expect(NAV_ITEMS.filter((i) => i.group !== undefined && i.group !== 'Content')).toEqual([]);
    });
  });

  describe('getNavSections', () => {
    it('folds consecutive same-group items into one labeled section, preserving order', () => {
      const sections = getNavSections();
      expect(sections.map((s) => s.label)).toEqual([
        null, // Dashboard
        null, // Issues
        null, // Subscribers
        'Content', // Templates + Snippets
        null, // Sponsors
        null, // Brand
        null, // Pricing
      ]);

      const content = sections.find((s) => s.label === 'Content');
      expect(content?.items.map((i) => i.name)).toEqual(['Templates', 'Snippets']);

      // The flattened section items exactly reproduce NAV_ITEMS in order.
      expect(sections.flatMap((s) => s.items).map((i) => i.name)).toEqual(
        NAV_ITEMS.map((i) => i.name),
      );
    });

    it('keeps each ungrouped item in its own label-less section', () => {
      const sections = getNavSections([
        { name: 'A', href: '/a', icon: () => null, preloadKey: 'a', matchPaths: ['/a'] },
        { name: 'B', href: '/b', icon: () => null, preloadKey: 'b', matchPaths: ['/b'] },
      ]);
      expect(sections).toHaveLength(2);
      expect(sections.every((s) => s.label === null && s.items.length === 1)).toBe(true);
    });
  });

  describe('isNavItemActive', () => {
    const dashboard = NAV_ITEMS.find((i) => i.name === 'Dashboard')!;
    const subscribers = NAV_ITEMS.find((i) => i.name === 'Subscribers')!;

    it('matches Dashboard only on exact "/"', () => {
      expect(isNavItemActive(dashboard, '/')).toBe(true);
      expect(isNavItemActive(dashboard, '/issues')).toBe(false);
    });

    it('matches Subscribers on /subscribers and /segments via startsWith', () => {
      expect(isNavItemActive(subscribers, '/subscribers')).toBe(true);
      expect(isNavItemActive(subscribers, '/segments/abc')).toBe(true);
      expect(isNavItemActive(subscribers, '/sponsors')).toBe(false);
    });
  });
});
