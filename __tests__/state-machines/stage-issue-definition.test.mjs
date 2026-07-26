import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Structural linter for the stage-issue ASL definition. Pure JSON analysis - no
// AWS, no SFN Local, no Docker. It exists because the definition had zero test
// coverage and a `$.Execution.Input.tenant.id` typo (single `$`, an unretryable
// States.Runtime error at runtime) sat in it undetected for months. Anything
// mechanically checkable about the definition belongs here rather than in a
// reviewer's head.
//
// Phase 0a of docs/stage-issue-simplification-plan.md.

const definitionPath = fileURLToPath(new URL('../../state-machines/stage-issue.asl.json', import.meta.url));
const templatePath = fileURLToPath(new URL('../../template.yaml', import.meta.url));

const definition = JSON.parse(readFileSync(definitionPath, 'utf8'));
const templateText = readFileSync(templatePath, 'utf8');

const STATE_MACHINE_RESOURCE = 'StageIssueStateMachine';

// ===========================================================================
// EXPECTED SHAPE - the constants a later phase has to update on purpose.
//
// Every one of these is an exact-match assertion. That is deliberate: the point
// of this file is that structural change to the definition is always a visible,
// intentional edit rather than something that drifts in unnoticed. If a phase
// makes one of these red, update the constant in the same commit as the change.
// ===========================================================================

// Counted over the whole tree, including states nested inside Parallel branches.
// Phase 3 merged the markdown and json/html tails into one path: ten top-level
// states and one whole Parallel went, and `total` lost the 12 states that used
// to be duplicated across two Parallels' branches. The `Choice` count is
// unchanged at 5 and that is the interesting number - two of them (`Route By
// Content Type`, `Social Copy Applies?`) are now the *only* content-type
// branches, in place of a fork that ran two near-identical tails, and one
// (`Publish Success?`) replaces the pair that used to check the same thing per
// path, including the `$[0]`/`$[1]` indexed one.
const EXPECTED_STATE_COUNTS = {
  topLevel: 23,
  total: 27,
  Choice: 5,
  Fail: 1,
  Parallel: 1,
  Pass: 3,
  Succeed: 2,
  Task: 14,
  Wait: 1
};

// States that no transition can reach, per scope. MUST BE EMPTY and must stay
// empty - a state nothing points at is either a bug or leftovers.
//
// It was already empty before Phase 2, which is worth recording because the
// plan expected otherwise: the four dead preview states were *graph*-reachable
// (`Send email preview?` and `Send JSON Preview?` routed to them whenever
// `$$.Execution.Input.isPreview` was true) and only semantically dead, because
// no producer set isPreview. A reachability check could never have flagged
// them; PREVIEW_STATES below is what holds the line now.
const KNOWN_UNREACHABLE_STATES = [];

// The dead preview path Phase 2 deleted, asserted absent. Kept as a named
// constant rather than dropped entirely so a reintroduced preview branch fails
// a test instead of quietly re-adding a second publish path to the definition.
// The live preview mechanism is `send-test-email.mjs` invoking `publish-issue`
// with `isPreview: true` directly - it never involved this state machine.
const PREVIEW_STATES = [
  'Publish JSON Preview',
  'Send JSON Preview?',
  'Send Preview',
  'Send email preview?'
];

// Task states with no `Retry`, i.e. one throttle or transient service error
// away from taking their `Catch` branch. Phase 1 gave every one of these a
// Catch, so the failure is now recorded rather than silent - but the retry gap
// itself is still open and this list still has to shrink.
const TASKS_WITHOUT_RETRY = [
  'Get Existing Issue',
  'Mark Issue In Progress',
  'Notify of Success',
  'Save Issue Record',
  'Schedule Issue Report',
  'Schedule List Cleanup',
  'Trigger Site Rebuild',
  'Update Issue Metadata',
  'Update Issue Record - Failure',
  'Update Issue Record - Success'
];

// Phase 1's Catch coverage, pinned exactly: `state -> [catcher, ...]` in Catch
// order, because order is behavior. The specific-error catchers have to stay
// ahead of their `States.ALL` sibling or the ALL catcher swallows them - which
// for the two conditional writes would silently break the local-send handshake
// (a `sending` issue would get relabelled `failed` instead of leaving the final
// transition to the fan-out).
//
// Only top-level states appear here. States inside a Parallel branch
// deliberately have no Catch at all: a Catch target must resolve within its own
// scope, so a branch cannot name `Update Issue Record - Failure`, and swallowing
// the error in-branch would hide it from the record entirely. Their errors
// surface through the enclosing Parallel's catcher instead.
const EXPECTED_CATCH_ROUTES = {
  // Straight to the notification, because the fallback `$social` is assigned
  // before publish rather than by a placeholder state on this edge.
  'Generate Social Copy': ['States.ALL -> Notify of Success ($.error)'],
  'Get Existing Issue': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  'Mark Issue In Progress': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  // Post-publish courtesy email: a failure here must not relabel an issue that
  // published fine, because `Has Issue Been Processed?` treats `failed` as
  // re-processable and a re-stage would send the issue twice.
  'Notify of Success': ['States.ALL -> Success ($.error)'],
  'Parse Issue': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  'Publish': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  'Save Issue Record': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  'Schedule Tasks and Update': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  'Trigger Site Rebuild': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  // Link extraction runs ahead of `Publish` now, so this catcher fires with
  // nothing delivered - failing the issue here costs a rehearsal, not a send.
  'Update Web Links': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  // The failure writer cannot catch to itself, and there is nothing left to
  // record once recording is what failed.
  'Update Issue Record - Failure': ['States.ALL -> Fail (error discarded)'],
  'Update Issue Record - Success': [
    'DynamoDB.ConditionalCheckFailedException -> Social Copy Applies? (error discarded)',
    'States.ALL -> Update Issue Record - Failure ($.error)'
  ]
};

// The states `Update Issue Record - Failure` can be entered from that are not
// catchers. Each one has to supply `$.error` itself, since the failure write
// reads it. Kept as a constant so adding a plain `Next` into the failure writer
// forces a decision about where its error cause comes from.
const NON_CATCH_ENTRIES_TO_FAILURE_WRITE = ['Record Publish Rejection'];

// ===========================================================================
// Definition traversal helpers
// ===========================================================================

// Each Parallel branch is its own scope: its own StartAt, its own state names,
// and Next/Default/Catch targets that may only resolve within that branch.
const collectScopes = (asl) => {
  const scopes = [];

  const visit = (states, startAt, label) => {
    scopes.push({ label, startAt, states });
    for (const [name, state] of Object.entries(states)) {
      (state.Branches ?? []).forEach((branch, index) => {
        visit(branch.States, branch.StartAt, `${label} > ${name} branch ${index}`);
      });
      // No Map states in this definition today, but handle them so adding one
      // does not silently create an unchecked scope.
      for (const key of ['Iterator', 'ItemProcessor']) {
        if (state[key]) {
          visit(state[key].States, state[key].StartAt, `${label} > ${name} ${key}`);
        }
      }
    }
  };

  visit(asl.States, asl.StartAt, 'top level');
  return scopes;
};

const scopes = collectScopes(definition);

// Flat list of every state in the definition, tagged with the scope it lives in.
const allStates = scopes.flatMap((scope) =>
  Object.entries(scope.states).map(([name, state]) => ({ name, state, scope: scope.label }))
);

const stateNames = allStates.map(({ name }) => name);

// A state's own fields, minus the sub-workflow containers. Nested states are
// already in `allStates` as scope members of their own, so walking them again
// through the parent would attribute their strings to the Parallel state.
const NESTED_KEYS = ['Branches', 'Iterator', 'ItemProcessor'];
const ownBody = (state) =>
  Object.fromEntries(Object.entries(state).filter(([key]) => !NESTED_KEYS.includes(key)));

// The only state types that can carry a `Catch`.
const CATCHABLE_TYPES = ['Task', 'Parallel', 'Map'];

const FAILURE_WRITE = 'Update Issue Record - Failure';

// One line per catcher, in declaration order. ResultPath is part of the contract
// here, not decoration: `$.error` is what the failure write reads, and `null`
// means the catcher throws the error away on purpose.
const describeCatchers = (state) =>
  (state.Catch ?? []).map((catcher) => {
    const landing = catcher.ResultPath === null ? 'error discarded' : catcher.ResultPath;
    return `${(catcher.ErrorEquals ?? []).join(',')} -> ${catcher.Next} (${landing})`;
  });

const transitionTargets = (state) => {
  const targets = [];
  if (state.Next) targets.push(state.Next);
  if (state.Default) targets.push(state.Default);
  for (const choice of state.Choices ?? []) if (choice.Next) targets.push(choice.Next);
  for (const catcher of state.Catch ?? []) if (catcher.Next) targets.push(catcher.Next);
  return targets;
};

// Walks every string in a JSON subtree, reporting a readable path to each one.
const walkStrings = (node, path, visit) => {
  if (typeof node === 'string') {
    visit(node, path);
  } else if (Array.isArray(node)) {
    node.forEach((child, index) => walkStrings(child, `${path}[${index}]`, visit));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      walkStrings(value, `${path}.${key}`, visit);
    }
  }
};

// Walks every `<field>.$` key in a JSON subtree - the JSONPath-valued fields.
const walkDollarFields = (node, path, visit) => {
  if (Array.isArray(node)) {
    node.forEach((child, index) => walkDollarFields(child, `${path}[${index}]`, visit));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith('.$')) visit(value, `${path}.${key}`);
      walkDollarFields(value, `${path}.${key}`, visit);
    }
  }
};

const INTRINSIC = /^States\.[A-Za-z]+\(/;
const VARIABLE_REFERENCE = /^\$[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

// Variables declared by `Assign` blocks. ASL variables are visible to nested
// scopes, so a single flat set is the right model here - `$sendAtDate` is
// assigned at the top of a Parallel branch and read two scopes deeper inside
// `Schedule Tasks and Update`.
const assignedVariables = new Set(
  allStates.flatMap(({ state }) => Object.keys(state.Assign ?? {}).map((key) => key.replace(/\.\$$/, '')))
);

// `$name` / `$name.field` references, including those appearing as intrinsic
// arguments (`States.Format('at({})', $reportStatsDate)`). Skips `$$.` context
// paths and `$.` state-data paths, neither of which is a variable reference.
const variableReferencesIn = (value) => {
  const names = [];
  for (const match of value.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (match.index > 0 && value[match.index - 1] === '$') continue;
    names.push(match[1]);
  }
  return names;
};

const substitutionTokensIn = (value) => [...value.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1]);

// ===========================================================================
// template.yaml DefinitionSubstitutions
// ===========================================================================

// Text-parsed rather than YAML-parsed: template.yaml is full of CloudFormation
// short tags (!Sub, !GetAtt, !Select) that a plain YAML loader rejects, and all
// this needs is the substitution key names.
const readDeclaredSubstitutions = (yamlText, resourceName) => {
  const lines = yamlText.split('\n');
  const resourceLine = lines.findIndex((line) => line === `  ${resourceName}:`);
  if (resourceLine === -1) {
    throw new Error(`Could not find resource "${resourceName}" in template.yaml`);
  }

  let index = resourceLine + 1;
  // Scan the resource's own body (indent > 2) for the DefinitionSubstitutions key.
  while (index < lines.length && !/^ {6}DefinitionSubstitutions:\s*$/.test(lines[index])) {
    if (/^ {0,2}\S/.test(lines[index])) {
      throw new Error(`No DefinitionSubstitutions block inside resource "${resourceName}"`);
    }
    index += 1;
  }

  const keys = [];
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (/^ {0,6}\S/.test(line)) break; // dedented back to a sibling key - block over
    const match = line.match(/^ {8}([A-Za-z0-9_]+):/);
    if (match) keys.push(match[1]);
  }

  return keys;
};

// ===========================================================================
// Tests
// ===========================================================================

describe('stage-issue definition: context paths', () => {
  // D1 and its whole family. `$$.Execution` is the context object; `$.Execution`
  // is a lookup for a key named "Execution" in the state's data, which is never
  // what anyone means.
  // Zero tolerance now that Phase 1 has fixed the one occurrence. There is no
  // allow-list on purpose: every `$.Execution` in this definition has been a bug,
  // and the failure mode is bad enough - an unretryable throw the moment the
  // state is entered - to be worth an unconditional rule.
  it('uses no single-dollar $.Execution paths', () => {
    const offenders = [];

    for (const { name, state } of allStates) {
      walkStrings(ownBody(state), `$.${name}`, (value, path) => {
        if (/^\$\.Execution/.test(value)) offenders.push(`${path} = ${value}`);
      });
    }

    expect(offenders.sort()).toEqual([]);
  });

  it('gives every ".$" field a value of a recognized form', () => {
    const unrecognized = [];

    for (const { name, state } of allStates) {
      walkDollarFields(ownBody(state), `$.${name}`, (value, path) => {
        if (typeof value !== 'string') {
          unrecognized.push(`${path} is not a string`);
          return;
        }
        const recognized =
          INTRINSIC.test(value) ||
          value.startsWith('$$.') ||
          value === '$' ||
          value.startsWith('$.') ||
          value.startsWith('$[') ||
          VARIABLE_REFERENCE.test(value);
        if (!recognized) unrecognized.push(`${path} = ${value}`);
      });
    }

    expect(unrecognized).toEqual([]);
  });

  // Phase 3 retired the `$[0]` / `$[1]` reads of the publish Parallel's output.
  // Indexed parallel output is the most brittle construct available in ASL:
  // the index is a branch ordinal with nothing naming it, so reordering the
  // branches silently repoints the reference at a different result.
  it('reads no Parallel output by branch index', () => {
    const indexed = [];

    for (const { name, state } of allStates) {
      walkStrings(ownBody(state), `$.${name}`, (value, path) => {
        if (/^\$\[\d/.test(value)) indexed.push(`${path} = ${value}`);
      });
    }

    expect(indexed).toEqual([]);
  });

  it('resolves every $variable reference to an Assign block that declares it', () => {
    const undeclared = [];

    for (const { name, state } of allStates) {
      walkStrings(ownBody(state), `$.${name}`, (value, path) => {
        for (const reference of variableReferencesIn(value)) {
          if (!assignedVariables.has(reference)) undeclared.push(`${path} references $${reference}`);
        }
      });
    }

    expect(undeclared).toEqual([]);
  });
});

describe('stage-issue definition: error handling', () => {
  it('has a Retry on every Task except the known gaps', () => {
    const missing = allStates
      .filter(({ state }) => state.Type === 'Task' && !Array.isArray(state.Retry))
      .map(({ name }) => name)
      .sort();

    expect(missing).toEqual([...TASKS_WITHOUT_RETRY].sort());
  });

  it('gives every Retry a non-empty ErrorEquals', () => {
    const malformed = [];

    for (const { name, state } of allStates) {
      for (const [index, retry] of (state.Retry ?? []).entries()) {
        if (!Array.isArray(retry.ErrorEquals) || retry.ErrorEquals.length === 0) {
          malformed.push(`${name} Retry[${index}]`);
        }
      }
    }

    expect(malformed).toEqual([]);
  });

  it('has a Catch on every top-level Task and Parallel', () => {
    const missing = allStates
      .filter(({ state, scope }) => scope === 'top level' && CATCHABLE_TYPES.includes(state.Type))
      .filter(({ state }) => !Array.isArray(state.Catch) || state.Catch.length === 0)
      .map(({ name }) => name)
      .sort();

    expect(missing).toEqual([]);
  });

  it('routes every catcher exactly where the expected topology says', () => {
    const actual = {};

    for (const { name, state, scope } of allStates) {
      if (scope !== 'top level' || !CATCHABLE_TYPES.includes(state.Type)) continue;
      actual[name] = describeCatchers(state);
    }

    expect(actual).toEqual(EXPECTED_CATCH_ROUTES);
  });

  it('leaves states inside Parallel branches uncaught, so their errors surface to the Parallel', () => {
    const caught = allStates
      .filter(({ state, scope }) => scope !== 'top level' && Array.isArray(state.Catch))
      .map(({ name, scope }) => `${scope}: ${name}`)
      .sort();

    expect(caught).toEqual([]);
  });

  it('gives every Catch a non-empty ErrorEquals and a target', () => {
    const malformed = [];

    for (const { name, state } of allStates) {
      for (const [index, catcher] of (state.Catch ?? []).entries()) {
        if (!Array.isArray(catcher.ErrorEquals) || catcher.ErrorEquals.length === 0) {
          malformed.push(`${name} Catch[${index}] has no ErrorEquals`);
        }
        if (!catcher.Next) malformed.push(`${name} Catch[${index}] has no Next`);
      }
    }

    expect(malformed).toEqual([]);
  });

  // A `States.ALL` catcher matches everything, so anything listed after it is
  // unreachable - including, if the order were ever flipped, the conditional-check
  // catchers the local-send handshake depends on.
  it('never places a catcher after a States.ALL catcher', () => {
    const shadowed = [];

    for (const { name, state } of allStates) {
      const catchers = state.Catch ?? [];
      const catchAll = catchers.findIndex((catcher) => (catcher.ErrorEquals ?? []).includes('States.ALL'));
      if (catchAll !== -1 && catchAll !== catchers.length - 1) {
        shadowed.push(`${name} Catch[${catchAll}] shadows ${catchers.length - catchAll - 1} later catcher(s)`);
      }
    }

    expect(shadowed).toEqual([]);
  });

  // `Update Issue Record - Failure` writes `$.error` onto the issue record, so
  // every route into it has to have put an error there. Catchers do it through
  // `ResultPath: "$.error"`; anything reaching it by a plain transition has to
  // synthesize one, or the write throws inside the failure handler.
  it('supplies $.error on every route into the failure write', () => {
    const catcherSources = allStates
      .filter(({ state }) => (state.Catch ?? []).some((catcher) => catcher.Next === FAILURE_WRITE))
      .map(({ name }) => name);

    const plainSources = allStates
      .filter(({ name, state }) => {
        if (name === FAILURE_WRITE) return false;
        const plain = [state.Next, state.Default, ...(state.Choices ?? []).map((choice) => choice.Next)];
        return plain.includes(FAILURE_WRITE);
      })
      .map(({ name }) => name);

    const catchersLandingElsewhere = allStates.flatMap(({ name, state }) =>
      (state.Catch ?? [])
        .filter((catcher) => catcher.Next === FAILURE_WRITE && catcher.ResultPath !== '$.error')
        .map((catcher) => `${name} -> ${FAILURE_WRITE} with ResultPath ${JSON.stringify(catcher.ResultPath)}`)
    );

    expect(catchersLandingElsewhere).toEqual([]);
    expect(catcherSources.length).toBeGreaterThan(0);
    expect(plainSources.sort()).toEqual([...NON_CATCH_ENTRIES_TO_FAILURE_WRITE].sort());

    for (const name of NON_CATCH_ENTRIES_TO_FAILURE_WRITE) {
      const { state } = allStates.find((entry) => entry.name === name);
      expect(Object.keys(state.Parameters ?? state.Result ?? {})).toContain('error');
    }
  });

  // The point of routing failures to the record at all: it has to say what went
  // wrong without anyone opening the Step Functions console.
  it('persists the caught error cause on the issue record', () => {
    const { state } = allStates.find(({ name }) => name === FAILURE_WRITE);
    const { UpdateExpression, ExpressionAttributeValues } = state.Parameters;

    expect(UpdateExpression).toMatch(/#failureReason = :failureReason/);
    expect(ExpressionAttributeValues[':failureReason']).toEqual({
      'S.$': 'States.JsonToString($.error)'
    });
  });

  // `Notify of Success` formats `$social.copy` into the email body, and `Assign`
  // runs only when a state succeeds - so a `Generate Social Copy` failure has to
  // find a `social` already bound, or the notification dies alongside the social
  // copy it was meant to survive. Phase 3 moved that fallback off the catch edge
  // and onto the two states that fork on content type, which is what lets the
  // walk below hold for every route rather than just this one.
  //
  // With one notify state for every content type, `$social` has three possible
  // origins (generated, the markdown fork's fallback, the json/html fork's) and
  // a fourth path that forgot to bind it would only show up as a failed courtesy
  // email on an issue that had already sent.
  //
  // Walks every route from `StartAt` carrying "has an Assign declared `social`
  // yet", and asserts no reader of `$social` is reachable with that false.
  // Catch edges deliberately inherit the *pre-state* answer: a state's `Assign`
  // does not run when the state throws, which is exactly the trap the
  // `Social Copy Unavailable` placeholder exists to close.
  it('declares $social on every route into the states that read it', () => {
    const readsSocial = ({ state }) => {
      let found = false;
      walkDollarFields(ownBody(state), '$', (value) => {
        if (typeof value === 'string' && variableReferencesIn(value).includes('social')) found = true;
      });
      return found;
    };

    const readers = new Set(allStates.filter(readsSocial).map(({ name }) => name));
    expect(readers.size).toBeGreaterThan(0);

    const declaresSocial = (state) =>
      Object.keys(state.Assign ?? {}).some((key) => key.replace(/\.\$$/, '') === 'social');

    const undeclared = new Set();
    const visited = new Set();
    const queue = [[definition.StartAt, false]];

    while (queue.length > 0) {
      const [name, declared] = queue.pop();
      const key = `${name}:${declared}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const state = definition.States[name];
      if (readers.has(name) && !declared) {
        undeclared.add(name);
        continue;
      }

      const onward = declared || declaresSocial(state);
      for (const target of [state.Next, state.Default, ...(state.Choices ?? []).map((choice) => choice.Next)]) {
        if (target) queue.push([target, onward]);
      }
      for (const catcher of state.Catch ?? []) {
        if (catcher.Next) queue.push([catcher.Next, declared]);
      }
    }

    expect([...undeclared]).toEqual([]);
  });
});

// ===========================================================================
// The single content-type path, and the values that leave the execution and
// fire days later. Phase 3 of docs/stage-issue-simplification-plan.md merged
// two near-identical tails into one; these are the properties that merge had
// to preserve exactly.
// ===========================================================================
describe('stage-issue definition: one path per issue', () => {
  const tasksInvoking = (substitution) =>
    allStates
      .filter(({ state }) => state.Type === 'Task' && state.Parameters?.FunctionName === `\${${substitution}}`)
      .map(({ name }) => name);

  // The duplication Phase 3 removed was two of each of these. One of each is
  // the whole point: a second parse or publish state means the content-type
  // fork grew a tail again.
  it('parses and publishes in exactly one state each', () => {
    expect(tasksInvoking('ParseIssue')).toEqual(['Parse Issue']);
    expect(tasksInvoking('PublishIssue')).toEqual(['Publish']);
  });

  it('writes the published status in exactly one state', () => {
    const publishedWrites = allStates.filter(
      ({ state }) => state.Parameters?.ExpressionAttributeValues?.[':status']?.S === 'published'
    );

    expect(publishedWrites.map(({ name }) => name)).toEqual(['Update Issue Record - Success']);
  });

  // The local-send handshake, which the merge of the two success writes had to
  // carry over: publish hands off to send-email-v2 asynchronously, so the
  // fan-out may already have moved the issue to `sending` and be hours from
  // done. Without the condition this write would report the issue as fully
  // sent while most subscribers are still waiting; without the catcher the
  // rejected write would fail the execution instead.
  it('makes the published write conditional on the issue not being mid local-send', () => {
    const { state } = allStates.find(({ name }) => name === 'Update Issue Record - Success');

    expect(state.Parameters.ConditionExpression).toBe('#status <> :sending');
    expect(state.Parameters.ExpressionAttributeValues[':sending']).toEqual({ S: 'sending' });
    expect(state.Catch[0].ErrorEquals).toEqual(['DynamoDB.ConditionalCheckFailedException']);
  });

  // These two outlive the execution by days - the stats report fires at send
  // +5, the list cleanup at +3 - and both names are matched by IAM resource
  // patterns in template.yaml (`schedule/newsletter/ISSUE-STATS*` and
  // `schedule/newsletter/*-CLEAN-*`). A changed name format fails at
  // CreateSchedule; a changed date source mis-fires a job days later with
  // nothing watching. Pinned literally for both reasons.
  it('creates the two Scheduler entries with unchanged names and dates', () => {
    const scheduler = Object.fromEntries(
      allStates
        .filter(({ state }) => state.Resource === '${SchedulerCreateSchedule}')
        .map(({ name, state }) => [
          name,
          {
            name: state.Parameters['Name.$'],
            schedule: state.Parameters['ScheduleExpression.$'],
            group: state.Parameters.GroupName
          }
        ])
    );

    expect(scheduler).toEqual({
      'Schedule Issue Report': {
        name: "States.Format('ISSUE-STATS-{}', $$.Execution.Input.issueId)",
        schedule: "States.Format('at({})', $reportStatsDate)",
        group: 'newsletter'
      },
      'Schedule List Cleanup': {
        name: "States.Format('{}-CLEAN-{}', $$.Execution.Input.tenant.id, $$.Execution.Input.issueId)",
        schedule: "States.Format('at({})', $listCleanupDate)",
        group: 'newsletter'
      }
    });
  });

  // Both dates come off the parse step's own output and are never recomputed
  // in ASL, which is what makes the dispatcher's "hand the parser's values back
  // verbatim" contract (__tests__/parse-issue.test.mjs) the only thing that has
  // to hold for the two entries above to be right.
  it('assigns both scheduler dates from the parse result and nowhere else', () => {
    const assigners = allStates.filter(({ state }) =>
      Object.keys(state.Assign ?? {}).some((key) => /^(reportStatsDate|listCleanupDate)\.\$$/.test(key))
    );

    expect(assigners.map(({ name }) => name)).toEqual(['Parse Issue']);
    expect(assigners[0].state.Assign['reportStatsDate.$']).toBe('$.Payload.reportStatsDate');
    expect(assigners[0].state.Assign['listCleanupDate.$']).toBe('$.Payload.listCleanupDate');
  });

  // Link extraction and social copy are the two markdown-only steps, and the
  // whole reason a content-type branch still exists. Both Choices have to keep
  // treating an *absent* contentType as markdown: import-issue-from-github.mjs
  // never sets the field, and an unguarded comparison against a missing path is
  // a runtime error rather than a false rule.
  it('guards both content-type Choices against an absent contentType', () => {
    const contentTypeChoices = allStates.filter(
      ({ state }) =>
        state.Type === 'Choice' &&
        JSON.stringify(state.Choices).includes('$$.Execution.Input.contentType')
    );

    expect(contentTypeChoices.map(({ name }) => name).sort()).toEqual([
      'Route By Content Type',
      'Social Copy Applies?'
    ]);

    for (const { name, state } of contentTypeChoices) {
      for (const rule of state.Choices) {
        expect(`${name}: ${JSON.stringify(rule.And?.[0])}`).toBe(
          `${name}: ${JSON.stringify({ Variable: '$$.Execution.Input.contentType', IsPresent: true })}`
        );
      }
      // Default is the markdown side on both, so an unrecognized value is
      // parsed as markdown and gets the markdown extras - the same fallback
      // normalizeContentType makes in functions/parse-issue.mjs.
      expect([name, state.Default]).toEqual([name, name === 'Route By Content Type' ? 'Update Web Links' : 'Generate Social Copy']);
    }
  });
});

describe('stage-issue definition: substitutions', () => {
  const declared = readDeclaredSubstitutions(templateText, STATE_MACHINE_RESOURCE);

  const used = new Set();
  walkStrings(definition, '$', (value) => {
    for (const token of substitutionTokensIn(value)) used.add(token);
  });

  it('finds the DefinitionSubstitutions block in template.yaml', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('declares every substitution the definition uses', () => {
    const undeclared = [...used].filter((token) => !declared.includes(token)).sort();
    expect(undeclared).toEqual([]);
  });

  // The half that catches an orphan when a phase deletes the last state using a
  // substitution - an unused DefinitionSubstitutions entry usually means a
  // Lambda or role that no longer needs to exist either.
  it('uses every substitution template.yaml declares', () => {
    const orphaned = declared.filter((token) => !used.has(token)).sort();
    expect(orphaned).toEqual([]);
  });
});

describe('stage-issue definition: graph', () => {
  it('resolves every Next / Default / Catch target within its own scope', () => {
    const dangling = [];

    for (const scope of scopes) {
      const names = new Set(Object.keys(scope.states));
      if (!names.has(scope.startAt)) {
        dangling.push(`${scope.label}: StartAt "${scope.startAt}" is not a state in this scope`);
      }
      for (const [name, state] of Object.entries(scope.states)) {
        for (const target of transitionTargets(state)) {
          if (!names.has(target)) dangling.push(`${scope.label}: "${name}" -> "${target}"`);
        }
      }
    }

    expect(dangling).toEqual([]);
  });

  it('reaches every state from its scope\'s StartAt', () => {
    const unreachable = [];

    for (const scope of scopes) {
      const names = new Set(Object.keys(scope.states));
      const reached = new Set();
      const queue = [scope.startAt];
      while (queue.length > 0) {
        const name = queue.pop();
        if (!names.has(name) || reached.has(name)) continue;
        reached.add(name);
        queue.push(...transitionTargets(scope.states[name]));
      }
      unreachable.push(...[...names].filter((name) => !reached.has(name)));
    }

    expect(unreachable.sort()).toEqual([...KNOWN_UNREACHABLE_STATES].sort());
  });

  it('contains no preview states and no isPreview plumbing', () => {
    const present = PREVIEW_STATES.filter((name) => stateNames.includes(name)).sort();
    expect(present).toEqual([]);

    // The states are only half of it - a leftover `isPreview` reference would be
    // a branch condition or a Lambda payload field reading something no producer
    // is obliged to send. Matched over the raw text so keys count too, not just
    // string values.
    expect(readFileSync(definitionPath, 'utf8')).not.toMatch(/isPreview/i);
  });
});

describe('stage-issue definition: state counts', () => {
  it('matches the expected state counts', () => {
    const byType = {};
    for (const { state } of allStates) {
      byType[state.Type] = (byType[state.Type] ?? 0) + 1;
    }

    expect({
      topLevel: Object.keys(definition.States).length,
      total: allStates.length,
      ...byType
    }).toEqual(EXPECTED_STATE_COUNTS);
  });

  it('gives every state a unique name across the whole definition', () => {
    // ASL only requires uniqueness per scope, but duplicated names across
    // Parallel branches make the console history and every allow-list in this
    // file ambiguous.
    const duplicates = stateNames.filter((name, index) => stateNames.indexOf(name) !== index).sort();
    expect(duplicates).toEqual([]);
  });
});
