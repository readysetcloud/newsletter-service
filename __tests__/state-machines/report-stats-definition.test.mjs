import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Structural checks on the report-stats ASL definition. Pure JSON analysis, in
 * the same spirit as the stage-issue definition test next to it.
 *
 * It exists because the weekly report failed at the same state every week from
 * June onward and nobody could see why from the definition. The execution input
 * carries `issueId` as a JSON number, the `Generate Insights` task forwarded it
 * untouched, and the Rust handler behind that task declares the field as a
 * string. Deserialization failed before the handler body ran, which is not in
 * the task's retry list and has no catch, so the execution died there and the
 * report was never compiled or sent.
 *
 * Nothing about that is visible in a Lambda unit test: the bug lives in the
 * seam between a state machine and a handler in another language. Checking the
 * definition is the only place it can be caught mechanically.
 */

const definitionPath = fileURLToPath(
  new URL('../../state-machines/report-stats.asl.json', import.meta.url)
);
const definition = JSON.parse(readFileSync(definitionPath, 'utf8'));

const states = definition.States;

describe('report-stats definition', () => {
  it('reaches Compile And Send Report from Generate Insights', () => {
    // The step the whole state machine exists to get to. Every failed
    // execution stopped one state short of it.
    expect(states['Generate Insights'].Next).toBe('Compile And Send Report');
    expect(states['Compile And Send Report']).toBeDefined();
  });

  describe('Generate Insights payload', () => {
    const payload = states['Generate Insights'].Parameters.Payload;

    it('passes issueId as a string', () => {
      // `$$.Execution.Input.issueId` is a number, and forwarding it raw is
      // what broke the report. States.Format is the cast: its output is
      // always a string, whatever the input type.
      expect(payload['issueId.$']).toBe("States.Format('{}', $$.Execution.Input.issueId)");
    });

    it('sends the bare issue number, not the composite key', () => {
      // The handler builds `<tenantId>#<issueId>` itself. Passing the
      // composite here would produce `tenant#tenant#231`.
      expect(payload['issueId.$']).not.toContain('#');
      expect(payload['tenantId.$']).toBe('$$.Execution.Input.tenant.id');
    });
  });

  it('uses the intrinsic-function suffix wherever a payload field is a path', () => {
    // A `.$` key whose value is neither a path nor an intrinsic is a
    // States.Runtime error at execution time, and an unsuffixed key holding
    // what looks like a path silently sends the literal string instead.
    const problems = [];

    // Reserved fields that take a bare path by definition - the `.$` suffix is
    // only for the payload-shaping keys inside Parameters and ResultSelector.
    const RESERVED_PATH_FIELDS = new Set([
      'InputPath',
      'OutputPath',
      'ResultPath',
      'ItemsPath',
      // A Choice rule compares a bare path too.
      'Variable',
    ]);

    const walk = (node, where) => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${where}[${i}]`));
        return;
      }
      if (!node || typeof node !== 'object') return;

      for (const [key, value] of Object.entries(node)) {
        if (key.endsWith('.$')) {
          if (typeof value !== 'string') {
            problems.push(`${where}.${key} is not a string`);
          } else if (!value.startsWith('$') && !value.startsWith('States.')) {
            problems.push(`${where}.${key} is neither a path nor an intrinsic: ${value}`);
          }
        } else if (
          typeof value === 'string'
          && /^\$\$?\./.test(value)
          && !RESERVED_PATH_FIELDS.has(key)
        ) {
          problems.push(`${where}.${key} looks like a path but has no .$ suffix`);
        } else {
          walk(value, `${where}.${key}`);
        }
      }
    };

    walk(states, 'States');

    expect(problems).toEqual([]);
  });
});
