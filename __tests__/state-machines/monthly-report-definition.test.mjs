import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Structural checks on the monthly-report definition, which now serves both
 * the scheduled job and reports a tenant asks for over a range they picked.
 *
 * Two properties matter enough to pin. Every task has to route failures
 * somewhere, because an on-demand report exists as a `pending` row from the
 * moment it is requested and an unhandled failure would leave it that way
 * forever. And every payload path has to resolve, because a `.$` reference to
 * an absent key is a States.Runtime error at execution time — the exact class
 * of bug that kept the weekly report from ever being sent.
 */

const definition = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../state-machines/monthly-report.asl.json', import.meta.url)),
    'utf8'
  )
);

const states = definition.States;
const tasks = Object.entries(states).filter(([, s]) => s.Type === 'Task');

/** Where a catch is deliberately absent, and why. */
const TERMINAL_WRITERS = new Set(['Record Empty Range', 'Mark Report Failed']);

describe('monthly-report definition', () => {
  it('routes every failure to the state that records it', () => {
    const unguarded = tasks
      .filter(([name]) => !TERMINAL_WRITERS.has(name))
      .filter(([, s]) => !(s.Catch || []).some(c => c.ErrorEquals.includes('States.ALL')))
      .map(([name]) => name);

    expect(unguarded).toEqual([]);
  });

  it('does not catch inside the states that record an ending', () => {
    // A failure to record a failure has nowhere useful to go, and routing it
    // back into the same task would loop.
    for (const name of TERMINAL_WRITERS) {
      expect(states[name].Catch).toBeUndefined();
    }
  });

  it('ends as failed once the failure is recorded', () => {
    expect(states['Mark Report Failed'].Next).toBe('Report Failed');
    expect(states['Report Failed'].Type).toBe('Fail');
  });

  it('resolves an on-demand report that covers a range with no issues', () => {
    // Without this branch the pending row would never be answered.
    const adhoc = states['Has Issues?'].Choices.find(c => c.StringEquals === 'adhoc');

    expect(adhoc).toBeDefined();
    expect(adhoc.Variable).toBe('$.reportType');
    expect(adhoc.Next).toBe('Record Empty Range');
  });

  it('tells the compile step which report it is finishing', () => {
    const payload = states['Compile And Send Report'].Parameters.Payload;

    expect(payload['reportId.$']).toBe('$.reportId');
    expect(payload['reportType.$']).toBe('$.reportType');
    expect(payload['deliverEmail.$']).toBe('$.deliverEmail');
  });

  it('uses the intrinsic-function suffix wherever a payload field is a path', () => {
    const problems = [];

    // Reserved fields that take a bare path by definition.
    const RESERVED_PATH_FIELDS = new Set([
      'InputPath', 'OutputPath', 'ResultPath', 'ItemsPath',
      // A Choice rule compares a bare path too.
      'Variable'
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

  it('forwards everything the later states read into the first task', () => {
    /*
     * `Build Report Data` sets `OutputPath: $.Payload`, so its return value
     * *replaces* the execution state. A field it is never handed cannot be
     * echoed back, and every later `$.x` then resolves against nothing.
     *
     * This is not hypothetical: the four fields carrying an on-demand report's
     * identity were read by the compile step and by the empty-range choice
     * while the first task was still being handed only the original five.
     * Every execution would have failed. The existing checks all passed,
     * because each looked at one state at a time.
     */
    const first = states['Build Report Data'];
    const forwarded = new Set(
      Object.keys(first.Parameters.Payload)
        .filter(key => key.endsWith('.$'))
        .map(key => key.slice(0, -2))
    );

    // Produced during the execution rather than carried into it.
    const PRODUCED = new Set(['hasIssues', 'reportData', 'insights', 'error']);

    const readLater = new Set();
    const collect = (node) => {
      if (Array.isArray(node)) return node.forEach(collect);
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        const path = key.endsWith('.$') || key === 'Variable' ? value : null;
        if (typeof path === 'string' && path.startsWith('$.')) {
          readLater.add(path.slice(2).split('.')[0]);
        } else {
          collect(value);
        }
      }
    };
    for (const [name, state] of Object.entries(states)) {
      if (name !== 'Build Report Data') collect(state);
    }

    const unreachable = [...readLater].filter(
      field => !forwarded.has(field) && !PRODUCED.has(field)
    );

    expect(unreachable).toEqual([]);
  });

  it('reads only fields both callers actually send', () => {
    // The scheduled job and the on-demand endpoint each build the execution
    // input by hand. A path either of them omits is a runtime failure, so the
    // set read here is the contract between them.
    const SENT_BY_BOTH = new Set([
      'tenant', 'reportId', 'reportType', 'deliverEmail',
      'month', 'monthLabel', 'periodLabel', 'periodStart', 'periodEnd',
      // Produced during the execution rather than sent.
      'hasIssues', 'reportData', 'insights', 'error'
    ]);

    const read = new Set();
    const collect = (node) => {
      if (Array.isArray(node)) return node.forEach(collect);
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key.endsWith('.$') && typeof value === 'string' && value.startsWith('$.')) {
          read.add(value.slice(2).split('.')[0]);
        } else {
          collect(value);
        }
      }
    };
    collect(states);

    expect([...read].filter(f => !SENT_BY_BOTH.has(f))).toEqual([]);
  });
});
