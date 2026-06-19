/**
 * Shared markdown-to-HTML formatting used by the issue content preview and the
 * content heatmap. Both renderers must produce identical structure for non-link
 * elements so that the heatmap overlay lines up with the plain preview — the
 * only thing the heatmap customizes is how individual links are rendered.
 *
 * This is intentionally the same lightweight regex-based parser that the
 * dashboard has always used for newsletter content. It supports headings, bold,
 * italic, links, unordered lists, blockquotes and inline code.
 */

export interface RenderLinkContext {
  /**
   * Zero-based index of this link among all markdown links in the content, in
   * document order. Mirrors the order links are wrapped for click tracking on
   * the backend (see functions/update-link-tracking.mjs).
   */
  index: number;
}

export interface FormatMarkdownOptions {
  /**
   * Custom renderer for markdown links. Receives the (already inline-formatted)
   * anchor text, the URL, and context describing the link's position. Must
   * return an HTML string. When omitted, links render with the default
   * newsletter styling.
   */
  renderLink?: (anchorText: string, url: string, context: RenderLinkContext) => string;
}

/** Default anchor rendering — kept byte-for-byte compatible with the historic preview output. */
export const defaultRenderLink = (anchorText: string, url: string): string =>
  `<a href="${url}" class="text-primary-600 hover:text-primary-700 underline decoration-primary-300 hover:decoration-primary-500 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded" target="_blank" rel="noopener noreferrer">${anchorText}</a>`;

/**
 * Converts markdown content into the dashboard's HTML representation.
 *
 * @param text - Raw markdown content.
 * @param options - Optional hooks, e.g. a custom link renderer for the heatmap.
 * @returns An HTML string suitable for `dangerouslySetInnerHTML`.
 */
export function formatMarkdown(text: string, options: FormatMarkdownOptions = {}): string {
  const renderLink = options.renderLink ?? defaultRenderLink;
  let formatted = text;

  formatted = formatted.replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-6 mb-3 text-foreground">$1</h3>');
  formatted = formatted.replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-8 mb-4 text-foreground">$1</h2>');
  formatted = formatted.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-8 mb-4 text-foreground">$1</h1>');

  formatted = formatted.replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="font-bold"><em class="italic">$1</em></strong>');
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>');
  formatted = formatted.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>');

  let linkIndex = 0;
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, anchorText: string, url: string) => {
    const html = renderLink(anchorText, url, { index: linkIndex });
    linkIndex += 1;
    return html;
  });

  formatted = formatted.replace(/^- (.+)$/gim, '<li class="ml-4 text-foreground">$1</li>');
  formatted = formatted.replace(/(<li.*<\/li>)/s, '<ul class="list-disc space-y-2 my-4 pl-4">$1</ul>');

  formatted = formatted.replace(/^> (.+)$/gim, '<blockquote class="border-l-4 border-primary-500 pl-4 py-2 italic my-4 text-muted-foreground bg-muted/30 rounded-r">$1</blockquote>');

  formatted = formatted.replace(/`([^`]+)`/g, '<code class="bg-muted px-2 py-0.5 rounded text-sm font-mono text-foreground border border-border">$1</code>');

  formatted = formatted.replace(/\n\n/g, '</p><p class="mb-4 text-foreground leading-relaxed">');
  formatted = `<p class="mb-4 text-foreground leading-relaxed">${formatted}</p>`;

  return formatted;
}

/** Escapes text for safe inclusion in HTML element content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escapes a value for safe inclusion inside a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
