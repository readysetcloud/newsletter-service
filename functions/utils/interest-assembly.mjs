/**
 * Interest-aware issue assembly ("contentAssembly").
 *
 * When an issue opts in (contentAssembly: { enabled: true } on the issue
 * record), the reorderable middle sections of the rendered email are wrapped in
 * HTML comment markers at render time. At send time the sections are extracted
 * ONCE, each section is assigned a topic derived from the LLM-classified
 * `link#` records of the links it contains, and the sections are re-ordered PER
 * RECIPIENT by the subscriber's interest scores. Everything here is pure string
 * manipulation — no I/O, no template renders — so the per-recipient cost is
 * comparable to the existing __EMAIL__ token replacement.
 *
 * Fail-open by design: any structural surprise (missing/malformed markers,
 * nested markers, unexpected inter-section content) yields `null` from
 * extractSections and the caller falls back to the canonical HTML. Assembly
 * must never break or block a send.
 */

// Marker grammar. The start marker optionally carries a topic hint
// (`<!--ia-section start topic="serverless"-->`). V1 injects markers WITHOUT a
// topic (link classification runs in a parallel state-machine branch, so topics
// are not reliably known at render time); topics are derived at send time from
// the issue's `link#` records via deriveSectionTopics.
const START_MARKER_RE = /<!--ia-section start(?: topic="([a-zA-Z0-9_-]*)")?-->/g;
const END_MARKER = '<!--ia-section end-->';

/**
 * Builds the start marker for a reorderable section.
 * @param {string} [topic] - Optional topic hint embedded in the marker.
 * @returns {string}
 */
export const sectionStartMarker = (topic) =>
  topic ? `<!--ia-section start topic="${topic}"-->` : '<!--ia-section start-->';

/**
 * Builds the end marker for a reorderable section.
 * @returns {string}
 */
export const sectionEndMarker = () => END_MARKER;

/**
 * Splits marked-up HTML into a fixed prefix, an ordered list of reorderable
 * sections, and a fixed suffix. Markers are consumed (they never appear in the
 * returned fragments), so reassembling in any order yields marker-free HTML.
 *
 * Returns null when the HTML carries no markers or the markers are malformed
 * (nested/unbalanced markers, or non-whitespace content between two sections),
 * signalling the caller to fall back to the original HTML.
 *
 * @param {string} html - Rendered email HTML.
 * @returns {{prefix: string, sections: Array<{html: string, topic: string|null}>, suffix: string}|null}
 */
export const extractSections = (html) => {
  if (typeof html !== 'string' || html.length === 0) {
    return null;
  }

  const boundaries = [];
  START_MARKER_RE.lastIndex = 0;
  let match;
  while ((match = START_MARKER_RE.exec(html)) !== null) {
    boundaries.push({ type: 'start', index: match.index, length: match[0].length, topic: match[1] || null });
  }

  let endIndex = html.indexOf(END_MARKER);
  while (endIndex !== -1) {
    boundaries.push({ type: 'end', index: endIndex, length: END_MARKER.length, topic: null });
    endIndex = html.indexOf(END_MARKER, endIndex + END_MARKER.length);
  }

  if (boundaries.length === 0) {
    return null;
  }

  boundaries.sort((a, b) => a.index - b.index);

  // Validate strict start/end alternation (no nesting, no orphans).
  const sections = [];
  let open = null;
  let cursor = null; // end of the previous section's end marker
  let prefix = null;

  for (const boundary of boundaries) {
    if (boundary.type === 'start') {
      if (open) {
        return null; // nested/unclosed start marker
      }
      if (prefix === null) {
        prefix = html.slice(0, boundary.index);
      } else {
        // Content between two sections must be whitespace only; anything else
        // means the structure isn't what we expect — bail out.
        const gap = html.slice(cursor, boundary.index);
        if (gap.trim().length > 0) {
          return null;
        }
        // Keep the (whitespace) gap attached to the preceding section so the
        // document's separators travel with it on reorder.
        sections[sections.length - 1].html += gap;
      }
      open = boundary;
    } else {
      if (!open) {
        return null; // end marker without a start
      }
      sections.push({
        html: html.slice(open.index + open.length, boundary.index),
        topic: open.topic
      });
      cursor = boundary.index + boundary.length;
      open = null;
    }
  }

  if (open || sections.length === 0) {
    return null; // unterminated section
  }

  return {
    prefix: prefix ?? '',
    sections,
    suffix: html.slice(cursor)
  };
};

// Matches href attributes (double-quoted, as produced by showdown/handlebars).
const HREF_RE = /href="([^"]+)"/g;

/**
 * Resolves the destination URL for an href found in section HTML. Links may
 * have been rewritten to click-tracking redirects (`...?u=<encoded original>`),
 * in which case the original URL is recovered from the `u` query parameter —
 * that original URL is what the `link#<hash(url)>` records are keyed on.
 * @param {string} href
 * @returns {string} The (best-effort) original destination URL.
 */
const resolveDestinationUrl = (href) => {
  const queryIndex = href.indexOf('?');
  if (queryIndex !== -1) {
    const query = href.slice(queryIndex + 1);
    for (const pair of query.split('&')) {
      if (pair.startsWith('u=')) {
        try {
          return decodeURIComponent(pair.slice(2));
        } catch {
          return href;
        }
      }
    }
  }
  return href;
};

/**
 * Builds a destination-url -> primaryTopic map from the issue's `link#` records
 * (written by update-link-tracking at staging time). Unclassified records are
 * skipped.
 * @param {Array<{url?: string, primaryTopic?: string}>} linkRecords
 * @returns {Map<string, string>}
 */
export const buildLinkTopicMap = (linkRecords) => {
  const map = new Map();
  for (const record of linkRecords ?? []) {
    if (record?.url && typeof record.primaryTopic === 'string' && record.primaryTopic) {
      map.set(record.url, record.primaryTopic);
    }
  }
  return map;
};

/**
 * Assigns a topic to each section by majority vote of the primaryTopic of the
 * classified links the section contains. Sections with no classified links keep
 * a null topic (they are treated as "no data" by the ranking: original relative
 * order, after interest-matched sections). A topic already present on a section
 * (from a marker hint) is preserved.
 *
 * Pure: returns new section objects; input is not mutated.
 *
 * @param {Array<{html: string, topic: string|null}>} sections
 * @param {Map<string, string>} linkTopicByUrl - From buildLinkTopicMap.
 * @returns {Array<{html: string, topic: string|null}>}
 */
export const deriveSectionTopics = (sections, linkTopicByUrl) => {
  return sections.map((section) => {
    if (section.topic) {
      return { ...section };
    }

    const counts = new Map();
    HREF_RE.lastIndex = 0;
    let match;
    while ((match = HREF_RE.exec(section.html)) !== null) {
      const topic = linkTopicByUrl.get(resolveDestinationUrl(match[1]));
      if (topic) {
        counts.set(topic, (counts.get(topic) ?? 0) + 1);
      }
    }

    let winner = null;
    let winnerCount = 0;
    // Map preserves insertion order, so ties resolve to the first-seen topic.
    for (const [topic, count] of counts) {
      if (count > winnerCount) {
        winner = topic;
        winnerCount = count;
      }
    }

    return { ...section, topic: winner };
  });
};

/**
 * Orders sections for one subscriber:
 *  1. Sections whose topic has a numeric interest score (and is not excluded),
 *     sorted by score descending — stable, so ties keep original order.
 *  2. Sections with no topic / no score for their topic, in original order.
 *  3. Sections whose topic the subscriber excluded, last, in original order.
 *
 * When the subscriber has no interest data matching any section topic AND no
 * exclusions matching any section topic, the ORIGINAL order is returned.
 *
 * Pure and stable; the returned array contains the same section objects.
 *
 * @param {Array<{html: string, topic: string|null}>} sections
 * @param {Record<string, {score?: number}>|null|undefined} interestScores
 * @param {string[]|null|undefined} excludedTopics
 * @returns {Array<{html: string, topic: string|null}>}
 */
export const rankSectionsForSubscriber = (sections, interestScores, excludedTopics) => {
  const excluded = new Set(Array.isArray(excludedTopics) ? excludedTopics : []);

  const scoreFor = (section) => {
    if (!section.topic || excluded.has(section.topic)) {
      return null;
    }
    const score = interestScores?.[section.topic]?.score;
    return typeof score === 'number' && Number.isFinite(score) ? score : null;
  };

  const scored = [];
  const neutral = [];
  const last = [];

  sections.forEach((section, index) => {
    // An excluded topic is treated as score 0 relevance: always last.
    if (section.topic && excluded.has(section.topic)) {
      last.push(section);
      return;
    }
    const score = scoreFor(section);
    if (score !== null) {
      scored.push({ section, score, index });
    } else {
      neutral.push(section);
    }
  });

  // No interest data matching any section and nothing excluded: original order.
  if (scored.length === 0 && last.length === 0) {
    return sections.slice();
  }

  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  return [...scored.map((entry) => entry.section), ...neutral, ...last];
};

/**
 * Reassembles the final HTML from the fixed prefix/suffix and the ordered
 * sections. Output never contains assembly markers (extractSections consumed
 * them).
 * @param {string} prefix
 * @param {Array<{html: string}>} orderedSections
 * @param {string} suffix
 * @returns {string}
 */
export const assembleHtml = (prefix, orderedSections, suffix) =>
  prefix + orderedSections.map((section) => section.html).join('') + suffix;

/**
 * One-shot per-send preparation: extract sections from the rendered HTML and
 * resolve their topics from the issue's link records. Returns null (fall back
 * to canonical HTML) when the HTML has no usable markers or no section could be
 * assigned a topic — with no topics there is nothing to personalize.
 *
 * @param {string} html - Rendered email HTML (with markers).
 * @param {Array<{url?: string, primaryTopic?: string}>} linkRecords
 * @returns {{prefix: string, sections: Array, suffix: string, originalHtml: string}|null}
 */
export const prepareAssembly = (html, linkRecords) => {
  const extracted = extractSections(html);
  if (!extracted) {
    return null;
  }

  const sections = deriveSectionTopics(extracted.sections, buildLinkTopicMap(linkRecords));
  if (!sections.some((section) => section.topic)) {
    return null;
  }

  return {
    prefix: extracted.prefix,
    sections,
    suffix: extracted.suffix,
    // Canonical order with markers stripped — what "no interest data"
    // recipients receive, kept identical to assembleHtml(original order).
    originalHtml: assembleHtml(extracted.prefix, sections, extracted.suffix)
  };
};

/**
 * Produces the personalized HTML for one subscriber. Defensive: any error
 * falls back to the canonical (marker-stripped) HTML. O(sections) string work.
 *
 * @param {{prefix: string, sections: Array, suffix: string, originalHtml: string}} prepared
 * @param {{interestScores?: Record<string, {score?: number}>, excludedTopics?: string[]}|null|undefined} subscriber
 * @returns {string}
 */
export const assembleForSubscriber = (prepared, subscriber) => {
  try {
    if (!subscriber?.interestScores && !subscriber?.excludedTopics) {
      return prepared.originalHtml;
    }
    const ordered = rankSectionsForSubscriber(
      prepared.sections,
      subscriber.interestScores,
      subscriber.excludedTopics
    );
    return assembleHtml(prepared.prefix, ordered, prepared.suffix);
  } catch (err) {
    console.error('[ASSEMBLY] Failed to personalize section order, using original', { error: err.message });
    return prepared.originalHtml;
  }
};
