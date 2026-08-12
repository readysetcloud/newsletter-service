import {
  classifyScannerClicks,
  DEFAULT_MIN_DISTINCT_LINKS,
  DEFAULT_WINDOW_SECONDS
} from '../utils/scanner-clicks.mjs';

const BASE = Date.parse('2025-03-01T12:00:00Z');

/** Build a click event `offsetSeconds` after the base instant. */
const click = (hash, linkUrl, offsetSeconds, sk = `click#${hash}#${linkUrl}#${offsetSeconds}`) => ({
  sk,
  subscriberEmailHash: hash,
  linkUrl,
  timestamp: new Date(BASE + offsetSeconds * 1000).toISOString()
});

/** A scanner-shaped sweep: every link at once, from one subscriber. */
const sweep = (hash, linkCount, startOffset = 0) =>
  Array.from({ length: linkCount }, (_, i) =>
    click(hash, `https://example.com/a${i}`, startOffset + i)
  );

describe('classifyScannerClicks', () => {
  describe('sweep detection', () => {
    it('flags a burst across many distinct links from one subscriber', () => {
      const { summary, scannerClickIds } = classifyScannerClicks(sweep('reader-a', 6));

      expect(summary.scannerClicks).toBe(6);
      expect(summary.humanClicks).toBe(0);
      expect(summary.scannerSubscribers).toBe(1);
      expect(scannerClickIds.size).toBe(6);
    });

    it('leaves a reader clicking a few links alone', () => {
      const clicks = [
        click('reader-a', 'https://example.com/one', 0),
        click('reader-a', 'https://example.com/two', 30),
        click('reader-a', 'https://example.com/three', 90)
      ];

      const { summary } = classifyScannerClicks(clicks);

      expect(summary.scannerClicks).toBe(0);
      expect(summary.humanClicks).toBe(3);
      expect(summary.scannerRate).toBe(0);
    });

    it('leaves links spread beyond the window alone even when there are many', () => {
      // Eight distinct links, but paced well apart — a reader working through
      // an issue, not a sweep.
      const clicks = Array.from({ length: 8 }, (_, i) =>
        click('reader-a', `https://example.com/a${i}`, i * (DEFAULT_WINDOW_SECONDS + 10))
      );

      const { summary } = classifyScannerClicks(clicks);

      expect(summary.scannerClicks).toBe(0);
      expect(summary.humanClicks).toBe(8);
    });

    it('does not fire one link short of the threshold', () => {
      const { summary } = classifyScannerClicks(sweep('reader-a', DEFAULT_MIN_DISTINCT_LINKS - 1));
      expect(summary.scannerClicks).toBe(0);
    });

    it('fires exactly at the threshold', () => {
      const { summary } = classifyScannerClicks(sweep('reader-a', DEFAULT_MIN_DISTINCT_LINKS));
      expect(summary.scannerClicks).toBe(DEFAULT_MIN_DISTINCT_LINKS);
    });

    it('does not pool separate subscribers into one burst', () => {
      // Six clicks in six seconds, but one link each from six people — a
      // popular link at send time, not a sweep.
      const clicks = Array.from({ length: 6 }, (_, i) =>
        click(`reader-${i}`, `https://example.com/a${i}`, i)
      );

      const { summary } = classifyScannerClicks(clicks);

      expect(summary.scannerClicks).toBe(0);
      expect(summary.humanClicks).toBe(6);
    });

    it('counts repeat hits inside a burst as part of the sweep', () => {
      const clicks = [
        ...sweep('reader-a', 4),
        // Same URL again, still inside the window — part of the same pass.
        click('reader-a', 'https://example.com/a0', 5, 'click#repeat')
      ];

      const { summary } = classifyScannerClicks(clicks);

      expect(summary.scannerClicks).toBe(5);
    });

    it('flags only the sweeping subscriber when both kinds are present', () => {
      const clicks = [
        ...sweep('scanner', 5),
        click('reader-a', 'https://example.com/one', 200),
        click('reader-a', 'https://example.com/two', 400)
      ];

      const { summary } = classifyScannerClicks(clicks);

      expect(summary.scannerClicks).toBe(5);
      expect(summary.humanClicks).toBe(2);
      expect(summary.scannerSubscribers).toBe(1);
      expect(summary.scannerRate).toBe(71.4);
    });

    it('flags a later burst even after quiet earlier activity', () => {
      const clicks = [
        click('reader-a', 'https://example.com/one', 0),
        click('reader-a', 'https://example.com/two', 3600),
        ...sweep('reader-a', 5, 7200)
      ];

      const { summary } = classifyScannerClicks(clicks);

      expect(summary.scannerClicks).toBe(5);
      expect(summary.humanClicks).toBe(2);
    });
  });

  describe('unattributable clicks', () => {
    it('neither classifies nor discards clicks with no subscriber id', () => {
      const clicks = [
        ...sweep('unknown', 6).map((c) => ({ ...c, subscriberEmailHash: 'unknown' })),
        click('reader-a', 'https://example.com/one', 0)
      ];

      const { summary } = classifyScannerClicks(clicks);

      expect(summary.unattributedClicks).toBe(6);
      expect(summary.scannerClicks).toBe(0);
      expect(summary.humanClicks).toBe(1);
      // The rate is over what could be classified, not the raw total.
      expect(summary.scannerRate).toBe(0);
    });

    it('treats a missing hash the same as an explicit unknown', () => {
      const clicks = [{ sk: 'click#1', linkUrl: 'https://example.com/one', timestamp: new Date(BASE).toISOString() }];
      const { summary } = classifyScannerClicks(clicks);
      expect(summary.unattributedClicks).toBe(1);
    });

    it('sets no rate when nothing could be attributed', () => {
      const clicks = sweep('unknown', 3).map((c) => ({ ...c, subscriberEmailHash: 'unknown' }));
      const { summary } = classifyScannerClicks(clicks);

      // Null rather than 0 — "no data" and "no scanners" are different answers.
      expect(summary.scannerRate).toBeNull();
    });

    it('sets aside events with an unusable timestamp rather than guessing', () => {
      const clicks = sweep('reader-a', 5).map((c) => ({ ...c, timestamp: 'not-a-date' }));
      const { summary } = classifyScannerClicks(clicks);

      expect(summary.unattributedClicks).toBe(5);
      expect(summary.scannerClicks).toBe(0);
    });
  });

  describe('edges and configuration', () => {
    it('handles an empty or missing click list', () => {
      for (const input of [[], null, undefined]) {
        const { summary } = classifyScannerClicks(input);
        expect(summary.totalClicks).toBe(0);
        expect(summary.scannerClicks).toBe(0);
        expect(summary.scannerRate).toBeNull();
      }
    });

    it('honours overridden thresholds and reports them back', () => {
      const clicks = sweep('reader-a', 3);

      const strict = classifyScannerClicks(clicks, { minDistinctLinks: 3 });
      expect(strict.summary.scannerClicks).toBe(3);
      expect(strict.summary.thresholds).toEqual({ minDistinctLinks: 3, windowSeconds: DEFAULT_WINDOW_SECONDS });

      const lenient = classifyScannerClicks(clicks, { minDistinctLinks: 10 });
      expect(lenient.summary.scannerClicks).toBe(0);
    });

    it('respects a narrowed window', () => {
      const clicks = [
        click('reader-a', 'https://example.com/a', 0),
        click('reader-a', 'https://example.com/b', 20),
        click('reader-a', 'https://example.com/c', 40),
        click('reader-a', 'https://example.com/d', 55)
      ];

      expect(classifyScannerClicks(clicks).summary.scannerClicks).toBe(4);
      expect(classifyScannerClicks(clicks, { windowSeconds: 10 }).summary.scannerClicks).toBe(0);
    });

    it('always accounts for every click exactly once', () => {
      const clicks = [
        ...sweep('scanner', 5),
        click('reader-a', 'https://example.com/one', 100),
        ...sweep('unknown', 2).map((c) => ({ ...c, subscriberEmailHash: 'unknown' }))
      ];

      const { summary } = classifyScannerClicks(clicks);

      expect(summary.scannerClicks + summary.humanClicks + summary.unattributedClicks).toBe(
        summary.totalClicks
      );
    });
  });
});
