import Handlebars from 'handlebars';

/**
 * Scans a template source for partial references (`{{> name }}`) and registers
 * any that are not already registered on `hbs` as an empty-string partial. This
 * guarantees a referenced-but-missing snippet renders as empty rather than
 * throwing during compilation.
 *
 * NOTE (parity with the Rust preview renderer in `template_render.rs`): this
 * scan is intentionally permissive on the *name* charset (`[\w./-]+`) where the
 * Rust scan requires a leading letter (`[a-zA-Z][a-zA-Z0-9_-]*`). Snippet names
 * are validated to the stricter rule on write, so for any real snippet both
 * scans pick up the same references — the only divergence would be on partial
 * names that could never be a stored snippet anyway.
 *
 * @param {object} hbs - Handlebars instance.
 * @param {string} source - Template source to scan.
 */
export const registerMissingPartialsAsEmpty = (hbs, source) => {
  const partialRegex = /\{\{\s*>\s*([\w./-]+)/g;
  let match;
  while ((match = partialRegex.exec(source)) !== null) {
    const name = match[1];
    if (!hbs.partials[name]) {
      console.warn(`Partial '${name}' not found, registering as empty`);
      hbs.registerPartial(name, '');
    }
  }
};

/**
 * Renders Handlebars `templateContent` against `data`, registering `snippets`
 * as partials and treating any referenced-but-missing partial as an empty
 * string. This is the JS send-path counterpart to the Rust preview renderer
 * (`template_render::render_template`); both must produce identical output so
 * the live preview matches the delivered email.
 *
 * Everything is compiled with `noEscape: true` so authored HTML fields render
 * verbatim, mirroring `handlebars::no_escape` on the Rust side.
 *
 * @param {string} templateContent - Handlebars template source.
 * @param {object} data - Data to render against.
 * @param {Array<{name?: string, content?: string}>} snippets - Tenant snippets.
 * @returns {string} Rendered HTML.
 */
export const renderWithSnippets = (templateContent, data, snippets = []) => {
  const hbs = Handlebars.create();

  // Register each snippet as a partial, compiled with noEscape so snippet
  // output matches the no-escape rendering used for the template itself.
  for (const snippet of snippets) {
    if (snippet.name) {
      hbs.registerPartial(snippet.name, hbs.compile(snippet.content ?? '', { noEscape: true }));
    }
  }

  // Any partial referenced by the template OR by a snippet body that is not a
  // known snippet renders as empty instead of throwing during compilation.
  registerMissingPartialsAsEmpty(hbs, templateContent);
  for (const snippet of snippets) {
    if (snippet.content) {
      registerMissingPartialsAsEmpty(hbs, snippet.content);
    }
  }

  return hbs.compile(templateContent, { noEscape: true })(data);
};
