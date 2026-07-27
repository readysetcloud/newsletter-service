/**
 * Substitutes `{{token}}` placeholders — the dashboard's mirror of
 * `renderTokens` in `functions/utils/tenant-settings.mjs`, used to preview
 * what a subject line or issue URL will actually look like.
 *
 * Deliberately not a template engine: these values produce an email subject
 * and a URL, where literal substitution is the whole requirement. Unknown
 * tokens are left in place so a typo stays visible rather than silently
 * blanking part of the preview.
 */
export function renderTokens(
  template: string,
  tokens: Record<string, string | number | undefined>
): string {
  if (typeof template !== 'string') return '';

  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) => {
    const value = tokens[name];
    return value === undefined || value === null ? match : String(value);
  });
}
