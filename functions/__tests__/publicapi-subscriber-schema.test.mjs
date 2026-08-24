import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(__dirname, '..', '..', 'publicapi.yaml');

/**
 * Pull one schema's block out of components.schemas by indentation, so the
 * assertions below cannot accidentally read a neighbouring schema's fields.
 */
const extractSchemaBlock = (spec, schemaName) => {
  const lines = spec.split('\n');
  const startIndex = lines.findIndex((line) => line === `    ${schemaName}:`);
  if (startIndex === -1) throw new Error(`Schema ${schemaName} not found in publicapi.yaml`);

  const block = [];
  for (const line of lines.slice(startIndex + 1)) {
    // A non-blank line back at the schema's own indent starts the next schema.
    if (line.trim() !== '' && !line.startsWith('      ')) break;
    block.push(line);
  }
  return block.join('\n');
};

describe('publicapi Subscriber schema', () => {
  let subscriberBlock;

  beforeAll(async () => {
    const spec = await readFile(SPEC_PATH, 'utf-8');
    subscriberBlock = extractSchemaBlock(spec, 'Subscriber');
  });

  /**
   * POST /{tenant}/subscribers runs the "Validate All" request validator, which
   * enables validateRequestBody. Any constraint declared here is enforced by API
   * Gateway *before* add-subscriber.mjs runs, so a maxLength on a name turns the
   * handler's truncation into a 400 the reader cannot work around — including
   * for names that would have fitted once whitespace was collapsed.
   *
   * The cap belongs in sanitizeName, which truncates. This is a deployment-only
   * failure mode, invisible to every other test in the suite.
   */
  it('declares no length constraint on names, which would reject instead of truncate', () => {
    expect(subscriberBlock).toContain('firstName:');
    expect(subscriberBlock).toContain('lastName:');

    // Matched as a YAML key, not as a word — the schema's own description
    // explains why the constraint is absent, and a substring check would
    // trip over that explanation.
    const declaredKeys = subscriberBlock
      .split('\n')
      .filter((line) => /^\s*maxLength\s*:/.test(line));
    expect(declaredKeys).toEqual([]);
  });

  /**
   * The same deployment-only failure mode as the names above, one step further.
   * `timeZone` is optional enrichment for local send, and the handler is built
   * to ignore an unusable one and fall back to geolocating the signup IP. A
   * `type: string` here would pre-empt all of that with a 400 from API
   * Gateway — including for `"timeZone": null`, which is what a client sends
   * for free when its own zone lookup comes back empty. Losing a subscriber
   * over a field that only ever refines send timing is not a trade worth
   * making, so the property declares no type at all.
   */
  it('declares no type on timeZone, so a non-string never rejects the signup', () => {
    expect(subscriberBlock).toContain('timeZone:');

    const lines = subscriberBlock.split('\n');
    const start = lines.findIndex((line) => /^\s*timeZone\s*:/.test(line));
    // The property's own lines run until the next key at its indent.
    const own = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() !== '' && /^ {8}\S/.test(line)) break;
      own.push(line);
    }

    expect(own.filter((line) => /^\s*type\s*:/.test(line))).toEqual([]);
  });

  it('still constrains email, where rejecting is the intended behavior', () => {
    expect(subscriberBlock).toContain('minLength: 4');
  });
});
