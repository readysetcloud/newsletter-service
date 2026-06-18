/**
 * Autocomplete logic for the template code editor.
 *
 * Two kinds of suggestions are offered based on what the user is typing right
 * before the cursor:
 *   - Data fields, e.g. `{{ ti` -> `title` (derived from sampleData keys).
 *   - Snippet partials, e.g. `{{> fo` -> `footer` (from GET /snippets).
 *
 * Pure functions so they can be unit tested without a DOM.
 */

export type SuggestionKind = 'field' | 'snippet';

export interface Suggestion {
  /** Text shown in the menu and inserted. */
  value: string;
  kind: SuggestionKind;
  /** Optional secondary label (e.g. snippet description). */
  detail?: string;
}

export interface AutocompleteContext {
  /** The kind of token being completed. */
  kind: SuggestionKind;
  /** The partial word already typed (used to filter and to know how much to replace). */
  query: string;
  /** Index in the text where the replaceable token starts. */
  start: number;
}

/**
 * Recursively collect dotted data-field paths from a sample-data object.
 * Arrays contribute their key (e.g. `items`) but not indexed paths.
 */
export function collectFieldPaths(
  data: unknown,
  prefix = '',
  depth = 0,
): string[] {
  if (depth > 4 || data === null || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }
  const paths: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectFieldPaths(value, path, depth + 1));
    }
  }
  return paths;
}

/**
 * Inspect the text immediately to the left of the cursor and decide whether an
 * autocomplete token is in progress. Returns null when not inside a mustache.
 */
export function getAutocompleteContext(
  text: string,
  cursor: number,
): AutocompleteContext | null {
  const before = text.slice(0, cursor);

  // Find the last unclosed `{{` before the cursor.
  const openIdx = before.lastIndexOf('{{');
  if (openIdx === -1) {
    return null;
  }
  // If a closing `}}` appears after the open and before the cursor, we are not
  // inside a mustache anymore.
  const closeIdx = before.indexOf('}}', openIdx);
  if (closeIdx !== -1 && closeIdx < cursor) {
    return null;
  }

  // The content of the mustache typed so far (after the braces).
  const innerStart = openIdx + 2;
  const inner = before.slice(innerStart);

  // Snippet partial: `{{>` optionally followed by spaces then a word.
  const partialMatch = /^\s*>\s*([a-zA-Z0-9_-]*)$/.exec(inner);
  if (partialMatch) {
    const query = partialMatch[1];
    return { kind: 'snippet', query, start: cursor - query.length };
  }

  // Data field: a bare word (allow dotted paths) after optional helper tokens.
  // Match the trailing identifier the user is currently typing.
  const fieldMatch = /([a-zA-Z0-9_.]*)$/.exec(inner);
  // Skip block/partial/comment openers — only complete plain expressions.
  if (/^\s*[#/>!^]/.test(inner)) {
    return null;
  }
  const query = fieldMatch ? fieldMatch[1] : '';
  return { kind: 'field', query, start: cursor - query.length };
}

/**
 * Build the filtered, ordered suggestion list for the current context.
 */
export function buildSuggestions(
  context: AutocompleteContext,
  fieldPaths: string[],
  snippets: { name: string; description?: string }[],
  limit = 8,
): Suggestion[] {
  const query = context.query.toLowerCase();

  if (context.kind === 'snippet') {
    return snippets
      .filter((s) => s.name.toLowerCase().startsWith(query))
      .slice(0, limit)
      .map((s) => ({ value: s.name, kind: 'snippet', detail: s.description }));
  }

  return fieldPaths
    .filter((path) => path.toLowerCase().startsWith(query) && path.toLowerCase() !== query)
    .slice(0, limit)
    .map((path) => ({ value: path, kind: 'field' }));
}
