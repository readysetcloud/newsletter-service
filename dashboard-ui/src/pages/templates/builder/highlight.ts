/**
 * Minimal, dependency-free Handlebars syntax highlighter.
 *
 * Produces an HTML string (with the same character layout as the source, so it
 * can sit underneath a transparent <textarea> in a code editor overlay). Only
 * Handlebars mustaches are highlighted — everything else is rendered as plain,
 * HTML-escaped text. This avoids pulling in a full editor/highlighter library
 * for what is, in practice, simple token coloring.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char);
}

/**
 * Matches a Handlebars mustache: `{{ ... }}` or `{{{ ... }}}`, including block
 * (`#`/`/`), partial (`>`), comment (`!`) and raw variants.
 */
const MUSTACHE = /\{\{\{?[^}]*\}?\}\}/g;

/**
 * Highlight Handlebars source into HTML. The returned markup preserves the
 * original text layout (newlines included) so it can be overlaid on a textarea.
 */
export function highlightHandlebars(source: string): string {
  let result = '';
  let lastIndex = 0;

  for (const match of source.matchAll(MUSTACHE)) {
    const start = match.index ?? 0;
    // Plain text before this mustache.
    result += escapeHtml(source.slice(lastIndex, start));

    const token = match[0];
    const inner = token.replace(/^\{\{\{?/, '').replace(/\}?\}\}$/, '');
    const trimmed = inner.trim();

    let cls = 'hbs-var';
    if (trimmed.startsWith('!')) {
      cls = 'hbs-comment';
    } else if (trimmed.startsWith('>')) {
      cls = 'hbs-partial';
    } else if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('^')) {
      cls = 'hbs-block';
    }

    result += `<span class="${cls}">${escapeHtml(token)}</span>`;
    lastIndex = start + token.length;
  }

  result += escapeHtml(source.slice(lastIndex));
  // A trailing newline is collapsed by browsers in the overlay; pad it so the
  // highlight layer stays the same height as the textarea content.
  if (source.endsWith('\n')) {
    result += '\n';
  }
  return result;
}
