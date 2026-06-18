import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderWithSnippets } from '../functions/utils/render-template.mjs';

// Shared fixtures consumed by BOTH this JS send-path test and the Rust preview
// test (`template_render::tests::render_conformance_fixtures`). Each case pins
// the exact HTML both renderers must produce, so if either engine drifts on a
// shared fixture its test fails — guaranteeing preview == delivered output.
const fixturesPath = fileURLToPath(new URL('./fixtures/render-conformance.json', import.meta.url));
const cases = JSON.parse(readFileSync(fixturesPath, 'utf8'));

describe('render conformance (JS send path)', () => {
  it('has shared fixtures to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) {
    it(`renders "${testCase.name}" to the shared expected HTML`, () => {
      const out = renderWithSnippets(testCase.template, testCase.data, testCase.snippets ?? []);
      expect(out).toBe(testCase.expected);
    });
  }
});
