/**
 * Logic for inserting snippet references into the issue body as Hugo-style
 * shortcodes (`{{< name param="..." >}}`).
 *
 * The issue body is Markdown, so snippets are referenced with the shortcode
 * idiom (not the Handlebars `{{> name }}` partial syntax used inside templates).
 * The backend body-snippet bridge resolves these at publish time. These are pure
 * functions so they can be unit tested without a DOM.
 */

import type { Snippet, SnippetParameter, SnippetSummary } from '@/types/api';

/**
 * Filter snippet summaries by a free-text query (case-insensitive substring on
 * the name). An empty query returns the list unchanged.
 */
export function filterSnippetsByName<T extends { name: string }>(
  snippets: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return snippets;
  return snippets.filter((snippet) => snippet.name.toLowerCase().includes(q));
}

/** A snippet's default value rendered as the string that seeds an attribute. */
function defaultAttrValue(parameter: SnippetParameter): string {
  const { defaultValue } = parameter;
  if (defaultValue === undefined || defaultValue === null) return '';
  return String(defaultValue);
}

/**
 * Build the shortcode text to insert for a snippet. Every declared parameter is
 * scaffolded as an attribute (so the author sees the available knobs), seeded
 * with its default value when present, otherwise left empty to fill in. A
 * snippet with no parameters inserts as a bare `{{< name >}}`.
 *
 * @example
 *   buildShortcodeInsertion({ name: 'robotVoice',
 *     parameters: [{ name: 'text', type: 'textarea', required: true }] })
 *   // => '{{< robotVoice text="" >}}'
 */
export function buildShortcodeInsertion(
  snippet: Pick<Snippet, 'name' | 'parameters'>,
): string {
  const parameters = snippet.parameters ?? [];
  if (parameters.length === 0) {
    return `{{< ${snippet.name} >}}`;
  }
  const attrs = parameters
    .map((parameter) => `${parameter.name}="${defaultAttrValue(parameter)}"`)
    .join(' ');
  return `{{< ${snippet.name} ${attrs} >}}`;
}

/** Narrowing helper so callers can pass either summaries or full snippets. */
export type InsertableSnippet = SnippetSummary | Snippet;
