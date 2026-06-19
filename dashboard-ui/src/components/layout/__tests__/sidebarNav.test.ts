import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, getNavSections, isNavItemActive } from '../sidebarNav';

describe('sidebarNav', () => {
  describe('NAV_ITEMS order and grouping', () => {
    it('is in priority order with Brand standalone at the end', () => {
      expect(NAV_ITEMS.map((i) => i.name)).toEqual([
        'Dashboard',
        'Issues',
        'Subscribers',
        'Templates',
        'Snippets',
        'Sponsors',
        'Pricing',
        'Brand',
      ]);
    });

    it('assigns each grouped item to the expected section', () => {
      const groupOf = (name: string) => NAV_ITEMS.find((i) => i.name === name)?.group;
      expect(groupOf('Issues')).toBe('Publish');
      expect(groupOf('Subscribers')).toBe('Publish');
      expect(groupOf('Templates')).toBe('Content');
      expect(groupOf('Snippets')).toBe('Content');
      expect(groupOf('Sponsors')).toBe('Monetization');
      expect(groupOf('Pricing')).toBe('Monetization');
    });

    it('leaves Dashboard and Brand ungrouped', () => {
      const ungrouped = NAV_ITEMS.filter((i) => i.group === undefined).map((i) => i.name);
      expect(ungrouped).toEqual(['Dashboard', 'Brand']);
    });
  });

  describe('getNavSections', () => {
    it('folds consecutive same-group items into one labeled section, preserving order', () => {
      const sections = getNavSections();
      expect(sections.map((s) => s.label)).toEqual([
        null, // Dashboard
        'Publish', // Issues + Subscribers
        'Content', // Templates + Snippets
        'Monetization', // Sponsors + Pricing
        null, // Brand
      ]);

      const labelled = (label: string) =>
        sections.find((s) => s.label === label)?.items.map((i) => i.name);
      expect(labelled('Publish')).toEqual(['Issues', 'Subscribers']);
      expect(labelled('Content')).toEqual(['Templates', 'Snippets']);
      expect(labelled('Monetization')).toEqual(['Sponsors', 'Pricing']);

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
