import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  sectionStartMarker,
  sectionEndMarker,
  extractSections,
  buildLinkTopicMap,
  deriveSectionTopics,
  rankSectionsForSubscriber,
  assembleHtml,
  prepareAssembly,
  assembleForSubscriber
} from '../functions/utils/interest-assembly.mjs';

const wrap = (inner, topic) => `${sectionStartMarker(topic)}${inner}${sectionEndMarker()}`;

const buildHtml = (sectionHtmls, { prefix = '<html><body>PREFIX', suffix = 'SUFFIX</body></html>', gap = '\n  ' } = {}) =>
  prefix + sectionHtmls.map((s) => wrap(s)).join(gap) + suffix;

describe('interest-assembly markers', () => {
  it('emits a start marker with and without a topic hint', () => {
    expect(sectionStartMarker()).toBe('<!--ia-section start-->');
    expect(sectionStartMarker('serverless')).toBe('<!--ia-section start topic="serverless"-->');
    expect(sectionEndMarker()).toBe('<!--ia-section end-->');
  });
});

describe('extractSections', () => {
  it('splits prefix, sections, and suffix and consumes the markers', () => {
    const html = buildHtml(['<h3>A</h3><p>one</p>', '<h3>B</h3><p>two</p>']);
    const result = extractSections(html);

    expect(result).not.toBeNull();
    expect(result.prefix).toBe('<html><body>PREFIX');
    expect(result.suffix).toBe('SUFFIX</body></html>');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].html).toContain('<h3>A</h3>');
    // Whitespace between sections is retained (attached to the previous one).
    expect(result.sections[0].html.endsWith('\n  ')).toBe(true);
    expect(result.sections[1].html).toBe('<h3>B</h3><p>two</p>');
    for (const section of result.sections) {
      expect(section.html).not.toContain('ia-section');
    }
  });

  it('parses a topic hint from the start marker', () => {
    const html = `pre${wrap('<p>x</p>', 'devops')}post`;
    const result = extractSections(html);
    expect(result.sections[0].topic).toBe('devops');
  });

  it('defaults topic to null when the marker has no hint', () => {
    const result = extractSections(`pre${wrap('<p>x</p>')}post`);
    expect(result.sections[0].topic).toBeNull();
  });

  it('returns null when there are no markers', () => {
    expect(extractSections('<html><body>plain issue</body></html>')).toBeNull();
    expect(extractSections('')).toBeNull();
    expect(extractSections(undefined)).toBeNull();
  });

  it('returns null for an end marker without a start', () => {
    expect(extractSections(`pre${sectionEndMarker()}post`)).toBeNull();
  });

  it('returns null for an unterminated start marker', () => {
    expect(extractSections(`pre${sectionStartMarker()}<p>x</p>`)).toBeNull();
  });

  it('returns null for nested start markers', () => {
    const html = `pre${sectionStartMarker()}<p>${sectionStartMarker()}x</p>${sectionEndMarker()}post`;
    expect(extractSections(html)).toBeNull();
  });

  it('returns null when non-whitespace content sits between two sections', () => {
    const html = `pre${wrap('<p>a</p>')}<div>stray</div>${wrap('<p>b</p>')}post`;
    expect(extractSections(html)).toBeNull();
  });
});

describe('deriveSectionTopics', () => {
  const linkMap = buildLinkTopicMap([
    { url: 'https://a.com/serverless-1', primaryTopic: 'serverless' },
    { url: 'https://a.com/serverless-2', primaryTopic: 'serverless' },
    { url: 'https://a.com/ai', primaryTopic: 'ai' },
    { url: 'https://a.com/unclassified' } // no primaryTopic -> skipped
  ]);

  it('assigns the majority primaryTopic of the section links', () => {
    const sections = [{
      html: '<a href="https://a.com/serverless-1">x</a> <a href="https://a.com/serverless-2">y</a> <a href="https://a.com/ai">z</a>',
      topic: null
    }];
    expect(deriveSectionTopics(sections, linkMap)[0].topic).toBe('serverless');
  });

  it('resolves tracking-redirect links via the u query parameter', () => {
    const tracked = `https://redirect.example.com/track?u=${encodeURIComponent('https://a.com/ai')}&cid=t%2342&p=1&s=__EMAIL_HASH__`;
    const sections = [{ html: `<a href="${tracked}">go</a>`, topic: null }];
    expect(deriveSectionTopics(sections, linkMap)[0].topic).toBe('ai');
  });

  it('leaves topic null for sections with no classified links', () => {
    const sections = [
      { html: '<p>no links at all</p>', topic: null },
      { html: '<a href="https://a.com/unclassified">u</a>', topic: null },
      { html: '<a href="https://elsewhere.com/x">not in map</a>', topic: null }
    ];
    for (const section of deriveSectionTopics(sections, linkMap)) {
      expect(section.topic).toBeNull();
    }
  });

  it('breaks ties by the first topic seen in the section', () => {
    const sections = [{
      html: '<a href="https://a.com/ai">1</a><a href="https://a.com/serverless-1">2</a>',
      topic: null
    }];
    expect(deriveSectionTopics(sections, linkMap)[0].topic).toBe('ai');
  });

  it('preserves a topic already present from a marker hint', () => {
    const sections = [{ html: '<a href="https://a.com/ai">1</a>', topic: 'security' }];
    expect(deriveSectionTopics(sections, linkMap)[0].topic).toBe('security');
  });

  it('does not mutate its input', () => {
    const sections = [{ html: '<a href="https://a.com/ai">1</a>', topic: null }];
    deriveSectionTopics(sections, linkMap);
    expect(sections[0].topic).toBeNull();
  });
});

describe('rankSectionsForSubscriber', () => {
  const sections = [
    { html: 'S-ai', topic: 'ai' },
    { html: 'S-serverless', topic: 'serverless' },
    { html: 'S-none', topic: null },
    { html: 'S-devops', topic: 'devops' }
  ];

  const order = (result) => result.map((s) => s.html);

  it('sorts matching topics by score descending, then unmatched in original order', () => {
    const interestScores = {
      ai: { score: 2, lastScoredAt: 'x' },
      devops: { score: 7.5, lastScoredAt: 'x' }
    };
    expect(order(rankSectionsForSubscriber(sections, interestScores, []))).toEqual([
      'S-devops', 'S-ai', 'S-serverless', 'S-none'
    ]);
  });

  it('is a stable sort: ties keep original relative order', () => {
    const interestScores = {
      ai: { score: 3 },
      serverless: { score: 3 },
      devops: { score: 3 }
    };
    expect(order(rankSectionsForSubscriber(sections, interestScores, []))).toEqual([
      'S-ai', 'S-serverless', 'S-devops', 'S-none'
    ]);
  });

  it('returns the original order when the subscriber has no interest data', () => {
    expect(order(rankSectionsForSubscriber(sections, undefined, undefined))).toEqual(order(sections));
    expect(order(rankSectionsForSubscriber(sections, {}, []))).toEqual(order(sections));
    expect(order(rankSectionsForSubscriber(sections, null, null))).toEqual(order(sections));
  });

  it('returns the original order when no score matches any section topic', () => {
    const interestScores = { databases: { score: 99 } };
    expect(order(rankSectionsForSubscriber(sections, interestScores, []))).toEqual(order(sections));
  });

  it('ranks excluded topics last, never first', () => {
    const interestScores = { ai: { score: 100 } };
    const result = order(rankSectionsForSubscriber(sections, interestScores, ['ai']));
    // ai is excluded despite its high score.
    expect(result).toEqual(['S-serverless', 'S-none', 'S-devops', 'S-ai']);
  });

  it('sinks excluded topics even when the subscriber has no scores', () => {
    const result = order(rankSectionsForSubscriber(sections, undefined, ['serverless']));
    expect(result).toEqual(['S-ai', 'S-none', 'S-devops', 'S-serverless']);
  });

  it('ignores malformed scores (non-numeric)', () => {
    const interestScores = { ai: { score: 'high' }, devops: { score: 4 } };
    expect(order(rankSectionsForSubscriber(sections, interestScores, []))).toEqual([
      'S-devops', 'S-ai', 'S-serverless', 'S-none'
    ]);
  });
});

describe('assembleHtml / prepareAssembly / assembleForSubscriber', () => {
  const linkRecords = [
    { url: 'https://a.com/one', primaryTopic: 'ai' },
    { url: 'https://a.com/two', primaryTopic: 'serverless' }
  ];
  const html = buildHtml([
    '<h3>One</h3><a href="https://a.com/one">1</a>',
    '<h3>Two</h3><a href="https://a.com/two">2</a>',
    '<h3>Three</h3><p>no links</p>'
  ]);

  it('prepareAssembly extracts sections and derives topics once', () => {
    const prepared = prepareAssembly(html, linkRecords);
    expect(prepared).not.toBeNull();
    expect(prepared.sections.map((s) => s.topic)).toEqual(['ai', 'serverless', null]);
    // The canonical HTML equals the original with markers stripped.
    expect(prepared.originalHtml).not.toContain('ia-section');
    expect(prepared.originalHtml).toBe(html.replace(/<!--ia-section start-->|<!--ia-section end-->/g, ''));
  });

  it('prepareAssembly returns null when no markers are present', () => {
    expect(prepareAssembly('<html><body>plain</body></html>', linkRecords)).toBeNull();
  });

  it('prepareAssembly returns null when no section gets a topic', () => {
    expect(prepareAssembly(html, [])).toBeNull();
    expect(prepareAssembly(html, [{ url: 'https://elsewhere.com', primaryTopic: 'ai' }])).toBeNull();
  });

  it('assembleForSubscriber reorders for an interested subscriber and strips markers', () => {
    const prepared = prepareAssembly(html, linkRecords);
    const result = assembleForSubscriber(prepared, {
      interestScores: { serverless: { score: 5 }, ai: { score: 1 } }
    });

    expect(result).not.toContain('ia-section');
    expect(result.indexOf('<h3>Two</h3>')).toBeLessThan(result.indexOf('<h3>One</h3>'));
    expect(result.indexOf('<h3>One</h3>')).toBeLessThan(result.indexOf('<h3>Three</h3>'));
    expect(result.startsWith('<html><body>PREFIX')).toBe(true);
    expect(result.endsWith('SUFFIX</body></html>')).toBe(true);
  });

  it('assembleForSubscriber returns the canonical order for subscribers without data', () => {
    const prepared = prepareAssembly(html, linkRecords);
    expect(assembleForSubscriber(prepared, undefined)).toBe(prepared.originalHtml);
    expect(assembleForSubscriber(prepared, {})).toBe(prepared.originalHtml);
  });

  it('assembleForSubscriber falls back to canonical HTML if ranking throws', () => {
    const prepared = prepareAssembly(html, linkRecords);
    const poisoned = {
      ...prepared,
      sections: null // force rankSectionsForSubscriber to throw
    };
    poisoned.originalHtml = prepared.originalHtml;
    const result = assembleForSubscriber(poisoned, { interestScores: { ai: { score: 1 } } });
    expect(result).toBe(prepared.originalHtml);
  });
});

describe('interest-assembly properties', () => {
  const arbSectionHtml = fc.stringMatching(/^[a-zA-Z0-9 <>/="'.-]{1,40}$/)
    .filter((s) => !s.includes('ia-section'));
  const arbTopic = fc.constantFrom('ai', 'serverless', 'eda', 'devops', 'security', 'databases', null);
  const arbSections = fc.array(
    fc.record({ html: arbSectionHtml, topic: arbTopic }),
    { minLength: 1, maxLength: 8 }
  );
  const arbScores = fc.dictionary(
    fc.constantFrom('ai', 'serverless', 'eda', 'devops', 'security', 'databases'),
    fc.record({ score: fc.double({ min: 0, max: 50, noNaN: true }) }),
    { maxKeys: 6 }
  );
  const arbExcluded = fc.uniqueArray(
    fc.constantFrom('ai', 'serverless', 'eda', 'devops', 'security', 'databases'),
    { maxLength: 3 }
  );

  it('every section appears exactly once in the ranked output, for arbitrary inputs', () => {
    fc.assert(
      fc.property(arbSections, arbScores, arbExcluded, (sections, scores, excluded) => {
        const ranked = rankSectionsForSubscriber(sections, scores, excluded);
        expect(ranked).toHaveLength(sections.length);
        // Same multiset of section objects (identity-preserving).
        const remaining = new Set(sections.map((_, i) => i));
        for (const section of ranked) {
          const index = sections.indexOf(section);
          expect(remaining.has(index)).toBe(true);
          remaining.delete(index);
        }
        expect(remaining.size).toBe(0);
      }),
      { numRuns: 200 }
    );
  });

  it('round-trips: extract + assemble in original order is byte-identical to marker-stripped input', () => {
    const arbChunk = fc.stringMatching(/^[a-zA-Z0-9 <>/="'\n.-]{0,60}$/)
      .filter((s) => !s.includes('ia-section'));
    fc.assert(
      fc.property(
        arbChunk,
        fc.array(fc.tuple(arbChunk, arbTopic), { minLength: 1, maxLength: 6 }),
        arbChunk,
        (prefix, sectionSpecs, suffix) => {
          const html =
            prefix +
            sectionSpecs.map(([inner, topic]) => wrap(inner, topic ?? undefined)).join('') +
            suffix;
          const extracted = extractSections(html);
          expect(extracted).not.toBeNull();
          const reassembled = assembleHtml(extracted.prefix, extracted.sections, extracted.suffix);
          const stripped = html.replace(/<!--ia-section start(?: topic="[a-zA-Z0-9_-]*")?-->|<!--ia-section end-->/g, '');
          expect(reassembled).toBe(stripped);
          expect(reassembled).not.toContain('ia-section');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('no interest data yields byte-identical output to the canonical order for arbitrary marked HTML', () => {
    fc.assert(
      fc.property(arbSections, (sections) => {
        const html = buildHtml(sections.map((s) => s.html), { gap: '' });
        const extracted = extractSections(html);
        expect(extracted).not.toBeNull();
        const ranked = rankSectionsForSubscriber(extracted.sections, undefined, undefined);
        const output = assembleHtml(extracted.prefix, ranked, extracted.suffix);
        const canonical = assembleHtml(extracted.prefix, extracted.sections, extracted.suffix);
        expect(output).toBe(canonical);
      }),
      { numRuns: 200 }
    );
  });

  it('excluded topics never rank first when any non-excluded section exists', () => {
    fc.assert(
      fc.property(arbSections, arbScores, arbExcluded, (sections, scores, excluded) => {
        const excludedSet = new Set(excluded);
        const hasNonExcluded = sections.some((s) => !s.topic || !excludedSet.has(s.topic));
        const ranked = rankSectionsForSubscriber(sections, scores, excluded);
        if (hasNonExcluded && ranked.length > 0) {
          const first = ranked[0];
          expect(first.topic && excludedSet.has(first.topic)).toBeFalsy();
        }
      }),
      { numRuns: 200 }
    );
  });
});
