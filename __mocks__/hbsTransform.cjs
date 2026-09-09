/**
 * Lets a test import a `.hbs` file the same way the bundler does at build
 * time: as its own source string.
 *
 * The previous stand-in was a single module that read `analytics-report.hbs`
 * and handed it to every importer, so any suite touching a different template
 * rendered the wrong one. That is why the monthly report compiler had no
 * tests - it failed on a helper belonging to the weekly template.
 */
module.exports = {
  process(sourceText) {
    return { code: `export default ${JSON.stringify(sourceText)};` };
  },
  // Jest caches transform output; the key has to change when the template does.
  getCacheKey(sourceText, sourcePath) {
    return `hbs:${sourcePath}:${sourceText.length}`;
  }
};
