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

  it('still constrains email, where rejecting is the intended behavior', () => {
    expect(subscriberBlock).toContain('minLength: 4');
  });
});
