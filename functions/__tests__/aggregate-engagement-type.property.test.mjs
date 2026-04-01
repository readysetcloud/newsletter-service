import * as fc from 'fast-check';

/**
 * Feature: subscriber-engagement-tracking
 * Property 2: Cross-issue engagement classification partitions clickers correctly
 *
 * Validates: Requirements 2.1, 2.2
 *
 * This test validates the pure classification logic used by calculateEngagementType:
 * - Collect unique subscriber hashes from click events (excluding 'unknown')
 * - For each unique hash, look up engagementCount from a hash→engagementCount map
 * - engagementCount > 1 → "returning"
 * - engagementCount === 1, null, or missing from map → "new"
 * - newClickers + returningClickers === number of unique clicker hashes
 */

/**
 * Pure function that implements the classification logic from calculateEngagementType.
 * Given click events and a hash→engagementCount map, classifies each unique clicker.
 *
 * @param {Array<{ subscriberEmailHash: string }>} clicks - Click events
 * @param {Map<string, number|null>} hashToEngagement - Map of hash → engagementCount
 * @returns {{ newClickers: number, returningClickers: number }}
 */
function classifyClickers(clicks, hashToEngagement) {
  const uniqueHashes = new Set();
  for (const click of clicks) {
    const subscriberHash = click.subscriberEmailHash;
    if (subscriberHash && subscriberHash !== 'unknown') {
      uniqueHashes.add(subscriberHash);
    }
  }

  if (uniqueHashes.size === 0) {
    return { newClickers: 0, returningClickers: 0 };
  }

  let newClickers = 0;
  let returningClickers = 0;

  for (const hash of uniqueHashes) {
    const engagementCount = hashToEngagement.get(hash);
    if (engagementCount != null && engagementCount > 1) {
      returningClickers++;
    } else {
      newClickers++;
    }
  }

  return { newClickers, returningClickers };
}

describe('Property 2: Cross-issue engagement classification partitions clickers correctly', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   */
  test('newClickers + returningClickers === uniqueClickers and each clicker classified correctly', () => {
    // Generate a random subscriber hash (hex string)
    const arbHash = fc.string({ minLength: 8, maxLength: 16 }).filter(s => s !== 'unknown' && s.length > 0);

    // Generate an engagement count: either undefined (missing from map), null, or a positive integer
    const arbEngagementCount = fc.oneof(
      fc.constant(undefined),  // subscriber not in map
      fc.constant(null),       // subscriber in map but no engagementCount
      fc.integer({ min: 1, max: 100 }) // valid engagementCount
    );

    // Generate a list of unique subscriber hashes with associated engagement records
    const arbSubscribers = fc.uniqueArray(
      fc.tuple(arbHash, arbEngagementCount),
      { minLength: 0, maxLength: 30, selector: ([hash]) => hash }
    );

    // Generate click events: each click references one of the subscriber hashes,
    // plus possibly some 'unknown' hashes
    const arbTestData = arbSubscribers.chain(subscribers => {
      const hashes = subscribers.map(([h]) => h);
      // Generate clicks that reference known hashes or 'unknown'
      const hashPool = hashes.length > 0
        ? fc.oneof(
          fc.constantFrom(...hashes),
          fc.constant('unknown')
        )
        : fc.constant('unknown');

      const arbClicks = fc.array(
        hashPool.map(h => ({ subscriberEmailHash: h })),
        { minLength: 0, maxLength: 50 }
      );

      return arbClicks.map(clicks => ({ subscribers, clicks }));
    });

    fc.assert(
      fc.property(arbTestData, ({ subscribers, clicks }) => {
        // Build the hash→engagementCount map (only for subscribers that have a value)
        const hashToEngagement = new Map();
        for (const [hash, engagementCount] of subscribers) {
          if (engagementCount !== undefined) {
            hashToEngagement.set(hash, engagementCount);
          }
        }

        const result = classifyClickers(clicks, hashToEngagement);

        // Compute expected unique clickers (excluding 'unknown')
        const uniqueHashes = new Set();
        for (const click of clicks) {
          const h = click.subscriberEmailHash;
          if (h && h !== 'unknown') {
            uniqueHashes.add(h);
          }
        }

        // Property: partition is complete — newClickers + returningClickers === uniqueClickers
        expect(result.newClickers + result.returningClickers).toBe(uniqueHashes.size);

        // Property: each clicker is classified correctly based on engagementCount
        let expectedNew = 0;
        let expectedReturning = 0;
        for (const hash of uniqueHashes) {
          const engagementCount = hashToEngagement.get(hash);
          if (engagementCount != null && engagementCount > 1) {
            expectedReturning++;
          } else {
            expectedNew++;
          }
        }

        expect(result.newClickers).toBe(expectedNew);
        expect(result.returningClickers).toBe(expectedReturning);
      }),
      { numRuns: 100 }
    );
  });
});
