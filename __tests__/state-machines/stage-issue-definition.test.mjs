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
// Newlines are normalized because the template is read as *text*: the resource
// scan below matches whole lines exactly, and a Windows checkout (git's
// core.autocrlf) leaves a trailing \r on every one of them, which fails every
// such match and takes the whole suite down before a single test runs.
const templateText = readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n');

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
//
// Phase 4 added one Pass. Link extraction became a shared step, so the markdown
// fork no longer has a Task of its own to hang its `Assign` on and needs a Pass
// (`Markdown Extras`) mirroring `No Markdown Extras`. The `Task` count is
// unchanged: `Update Web Links` became `Extract Links` and moved, it did not
// multiply.
//
// Removing the GitHub ingress (PR #358) took three states with it: the
// `Content Supplied By Producer?` Choice and the two Tasks only it reached,
// `Claim With Supplied Content` and `Save Issue Record`. Every re-processable
// status now routes to `Mark Issue In Progress`, so the definition has one
// claim path instead of two and `DynamodbPutItem` is no longer substituted
// into it at all.
// `Trigger Site Rebuild` took one more Task with it. The site it rebuilt is
// domain-specific and no longer served by this stack, so the event had no
// consumer left.
//
// Phase 6 took the last two: `Is Scheduled In The Future?` and
// `Wait For Future Date`, which is why there is no `Wait` line below at all and
// this definition owns no timer. They were kept as Phase 5's rollback - point the
// API back at `StartExecution` with a `futureDate` and the execution waits
// again - and Phase 6 is what made that rollback incoherent rather than merely
// unused. Waiting inside the execution puts every step *after* the send
// instant; the whole point of the publish lead time is to run the fan-out
// *before* it, so an eastward timezone group can still be scheduled for its own
// 9am. The two cannot both be true. The rollback that remains is
// `ISSUE_SEND_LEAD_TIME_MINUTES: 0`, which is a parameter, not a state.
//
// `Wait` has no entry at all rather than a zero: the counts are built from the
// types actually present, so a reintroduced `Wait` shows up here as an
// unexpected key.
const EXPECTED_STATE_COUNTS = {
  topLevel: 20,
  total: 24,
  Choice: 4,
  Fail: 1,
  Parallel: 1,
  Pass: 4,
  Succeed: 2,
  Task: 12
};

// States that no transition can reach, per scope. MUST BE EMPTY and must stay
// empty - a state nothing points at is either a bug or leftovers.
//
// It was already empty before Phase 2, which is worth recording because the
// plan expected otherwise: the four dead preview states were *graph*-reachable
// (`Send email preview?` and `Send JSON Preview?` routed to them whenever
// `$$.Execution.Input.isPreview` was true), so a reachability check could never
// have flagged them. PREVIEW_STATES below is what holds the line now.
const KNOWN_UNREACHABLE_STATES = [];

// The dead preview path Phase 2 deleted, asserted absent. Kept as a named
// constant rather than dropped entirely so a reintroduced preview branch fails
// a test instead of quietly re-adding a second publish path to the definition.
// The live preview mechanism is `send-test-email.mjs` invoking `publish-issue`
// with `isPreview: true` directly - that has never involved this state machine.
//
// One correction on the record, because the phase that deleted these states
// asserted the opposite and the assertion was wrong at the time. They were not
// dead when Phase 2 removed them: the legacy GitHub ingress still set the field
// (it read `IS_PREVIEW`, which template.yaml set to true for every
// non-production deploy), so in sandbox and stage a GitHub-imported issue took
// this path and got a single `[Preview]` email with no list send, no Scheduler
// entries and no `published` write. Phase 2's stated gate was PR #358 - the PR
// that deletes that ingress - and for the window between the two the gate was
// unmet, leaving non-production GitHub imports running the real publish path.
// That window is closed: #358 landed, and with it the ingress, its `IS_PREVIEW`
// variable, and the only producer that ever set `isPreview` on an execution.
// No producer reaches these states now, so their absence is genuinely dead code
// rather than a silent behavior change waiting to be noticed. Production was
// unaffected throughout (`IS_PREVIEW` was false there).
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
// Every task that runs AFTER the send event has been emitted now retries its
// transient service errors, which is the point: without a Retry, one throttle
// falls straight through to the Catch and the failure write relabels an issue
// that really did send. What is left here runs before the send, or is the
// failure write itself.
const TASKS_WITHOUT_RETRY = [
  'Get Existing Issue',
  'Mark Issue In Progress',
  'Notify of Success',
  'Update Issue Record - Failure'
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
  // The one catcher in the definition that does not touch the issue record.
  // Link extraction sits ahead of `Publish` and calls Bedrock, so every outcome
  // it can have - including States.Timeout - continues down the publish path.
  // Degraded personalization is acceptable; a missed issue is not. Pinned here
  // and again in the "cannot block or fail a send" test below.
  'Extract Links': ['States.ALL -> Parse Issue (error discarded)'],
  'Mark Issue In Progress': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  // Post-publish courtesy email: a failure here must not relabel an issue that
  // published fine, because `Has Issue Been Processed?` treats `failed` as
  // re-processable and a re-stage would send the issue twice.
  'Notify of Success': ['States.ALL -> Success ($.error)'],
  'Parse Issue': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  'Publish': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  'Schedule Tasks and Update': ['States.ALL -> Update Issue Record - Failure ($.error)'],
  // The failure writer cannot catch to itself, and there is nothing left to
  // record once recording is what failed.
  'Update Issue Record - Failure': [
    'DynamoDB.ConditionalCheckFailedException -> Fail (error discarded)',
    'States.ALL -> Fail (error discarded)'
  ],
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

// Phase 5: the execution input carries identifiers, and the issue body is read
// off the record when the execution starts. This list is now empty, and that is
// the point - it is the assertion that no state anywhere reads the issue body
// off `$$.Execution.Input`.
//
// It used to hold the three states on the producer-supplied side of the content
// fork, which existed because import-issue-from-github.mjs started executions
// carrying a file body that had to win over whatever the draft record held.
// PR #358 removed that producer, and with it the fork, `Claim With Supplied
// Content` and `Save Issue Record`. Kept as an empty constant rather than
// deleted so re-adding an input-content read fails here, with this paragraph
// attached, instead of quietly reintroducing a second answer to "what is this
// execution publishing".
const CONTENT_FROM_EXECUTION_INPUT = [];

// The states that bind the content variables. One, now that the record is the
// only source. Pinned because a second binder would mean a second answer to
// "what is this execution publishing".
const CONTENT_BINDERS = ['Mark Issue In Progress'];

// The GitHub-ingress states PR #358 removed, asserted absent. Named here for
// the same reason PREVIEW_STATES is: a reintroduced producer-content path
// should fail a test rather than quietly re-add a second claim path.
const REMOVED_GITHUB_INGRESS_STATES = [
  'Claim With Supplied Content',
  'Content Supplied By Producer?',
  'Save Issue Record'
];

// Phase 4's two states of interest, and the ceiling on what link classification
// is allowed to add to a send. The function's own Lambda timeout is 60s
// (template.yaml: UpdateLinksWithTrackingDataFunction), so the state's timeout
// has to sit just above it to be a backstop rather than a second, tighter limit -
// but it must stay bounded and small, because every second of it is a second the
// issue is late.
// The single state that claims an issue and binds its content, since the
// removal of the producer-supplied fork left only one way in.
const CLAIM_STATE = 'Mark Issue In Progress';

const LINK_EXTRACTION = 'Extract Links';
const PUBLISH = 'Publish';
const MAX_LINK_EXTRACTION_TIMEOUT_SECONDS = 90;

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

// The transitions a state takes when nothing goes wrong. Catch edges are
// excluded deliberately: several assertions below are about what the *happy*
// path is obliged to do, and a catcher is by definition the path where it didn't.
const plainTargets = (state) =>
  [state.Next, state.Default, ...(state.Choices ?? []).map((choice) => choice.Next)].filter(Boolean);

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

// Names of the states whose own body reads `$<variable>` in a path-valued field.
const statesReading = (variable) =>
  new Set(
    allStates
      .filter(({ state }) => {
        let found = false;
        walkDollarFields(ownBody(state), '$', (value) => {
          if (typeof value === 'string' && variableReferencesIn(value).includes(variable)) found = true;
        });
        return found;
      })
      .map(({ name }) => name)
  );

const declaresVariable = (state, variable) =>
  Object.keys(state.Assign ?? {}).some((key) => key.replace(/\.\$$/, '') === variable);

// Top-level states that read `$<variable>` on a route from `StartAt` where no
// `Assign` has bound it yet. Catch edges deliberately inherit the *pre-state*
// answer: a state's `Assign` does not run when the state throws, so a variable
// bound by the state that failed is not bound on its catch edge.
const routesReadingUnbound = (variable) => {
  const readers = statesReading(variable);
  const unbound = new Set();
  const visited = new Set();
  const queue = [[definition.StartAt, false]];

  while (queue.length > 0) {
    const [name, bound] = queue.pop();
    const key = `${name}:${bound}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const state = definition.States[name];
    if (readers.has(name) && !bound) {
      unbound.add(name);
      continue;
    }

    const onward = bound || declaresVariable(state, variable);
    for (const target of plainTargets(state)) queue.push([target, onward]);
    for (const catcher of state.Catch ?? []) {
      if (catcher.Next) queue.push([catcher.Next, bound]);
    }
  }

  return [...unbound];
};

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
  // yet", and asserts no reader of `$social` is reachable with that false. See
  // `routesReadingUnbound` for why catch edges are walked the way they are.
  it('declares $social on every route into the states that read it', () => {
    expect(statesReading('social').size).toBeGreaterThan(0);
    expect(routesReadingUnbound('social')).toEqual([]);
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

  // Social copy is the last markdown-only step, and the whole reason a
  // content-type branch still exists (Phase 4 made link extraction shared). Both
  // Choices have to keep
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
      expect([name, state.Default]).toEqual([name, name === 'Route By Content Type' ? 'Markdown Extras' : 'Generate Social Copy']);
    }
  });
});

// ===========================================================================
// Link extraction ahead of publish (Phase 4 of
// docs/stage-issue-simplification-plan.md). Two properties, pulling against each
// other, and the reason this phase gets its own block: extraction has to happen
// before the send for every content type, and it has to be unable to affect the
// send at all.
// ===========================================================================
describe('stage-issue definition: link extraction', () => {
  it('extracts links in exactly one state, on the shared path', () => {
    const extractors = allStates
      .filter(({ state }) => state.Parameters?.FunctionName === '${UpdateLinksWithTrackingData}')
      .map(({ name }) => name);

    expect(extractors).toEqual([LINK_EXTRACTION]);
    // Whatever the content type turns out to be, the function is told - it picks
    // its extractor off this field (markdown links vs `<a href>` anchors), and
    // before Phase 4 it only ever saw markdown content and only ever matched
    // markdown links, which is why json and html issues had no `link#` records.
    const { state } = allStates.find(({ name }) => name === LINK_EXTRACTION);
    expect(state.Parameters.Payload['contentType.$']).toBe('$contentType');
  });

  // D7 and D8 together: json and html used to skip extraction entirely, and
  // markdown ran it as a sibling of the publish branch, so classification raced
  // the send and topics were usually still unknown when the issue rendered.
  // Walked rather than asserted on one edge because "every route" is the claim -
  // a future content-type branch that bypasses extraction is exactly the
  // regression this catches.
  it('runs link extraction ahead of Publish on every route into it', () => {
    const unextracted = [];
    const visited = new Set();
    const queue = [[definition.StartAt, false, [definition.StartAt]]];

    while (queue.length > 0) {
      const [name, extracted, path] = queue.pop();
      const key = `${name}:${extracted}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (name === PUBLISH) {
        if (!extracted) unextracted.push(path.join(' -> '));
        continue;
      }

      const onward = extracted || name === LINK_EXTRACTION;
      for (const target of plainTargets(definition.States[name])) {
        queue.push([target, onward, [...path, target]]);
      }
    }

    expect(unextracted).toEqual([]);
  });

  // The other half, and the constraint the phase turns on: classification calls
  // Bedrock, so this is LLM latency on the critical path of a send. A bounded
  // timeout plus a catcher that continues to `Publish` is what keeps "degraded
  // personalization" from becoming "missed issue".
  it('cannot let link extraction delay or fail a send', () => {
    const { state } = allStates.find(({ name }) => name === LINK_EXTRACTION);

    expect(typeof state.TimeoutSeconds).toBe('number');
    expect(state.TimeoutSeconds).toBeLessThanOrEqual(MAX_LINK_EXTRACTION_TIMEOUT_SECONDS);

    // A retried timeout would multiply the ceiling by the attempt count, so the
    // Retry list stays limited to transient Lambda-service errors.
    const retried = (state.Retry ?? []).flatMap((retry) => retry.ErrorEquals ?? []);
    expect(retried).not.toContain('States.Timeout');
    expect(retried).not.toContain('States.ALL');
    expect(retried.length).toBeGreaterThan(0);

    // Every catcher has to land somewhere that still reaches `Publish`, and has
    // to get there without writing the issue off as failed on the way.
    expect(state.Catch.length).toBeGreaterThan(0);
    for (const catcher of state.Catch) {
      const seen = new Set();
      const touched = [];
      const queue = [catcher.Next];
      while (queue.length > 0) {
        const name = queue.pop();
        if (seen.has(name)) continue;
        seen.add(name);
        if (name === PUBLISH) continue; // the send is handed off here - stop
        touched.push(name);
        queue.push(...plainTargets(definition.States[name]));
      }

      expect([catcher.Next, seen.has(PUBLISH)]).toEqual([catcher.Next, true]);
      expect(touched).not.toContain(FAILURE_WRITE);
    }
  });
});

// ===========================================================================
// Identifiers in, content off the record (Phase 5 of
// docs/stage-issue-simplification-plan.md). The API now creates an
// `ISSUE-SEND-<tenant>-<issue>` Scheduler entry that starts this execution at
// the send instant, so the input can no longer carry the issue body: it would
// be whatever the record said when the issue was *scheduled*, days earlier.
// ===========================================================================
describe('stage-issue definition: identifiers, not content', () => {
  it('never reads the issue content out of the execution input', () => {
    // Boundary-matched, because `$$.Execution.Input.contentType` is a different
    // field and stays on the input on purpose (see 'Get Existing Issue').
    const readsInputContent = /^\$\$\.Execution\.Input\.content$/;
    const readers = allStates
      .filter(({ state }) => {
        let found = false;
        walkStrings(ownBody(state), '$', (value) => {
          if (readsInputContent.test(value)) found = true;
        });
        return found;
      })
      .map(({ name }) => name)
      .sort();

    expect(readers).toEqual([...CONTENT_FROM_EXECUTION_INPUT].sort());
  });

  // Two properties of the one read of the record, both load-bearing. Without
  // ConsistentRead an immediate publish can start before its own record is
  // visible, take the no-record path, and fail for want of a content field the
  // input no longer carries. Without the projection the whole record - a
  // pre-rendered HTML issue included - rides in the execution state for the rest
  // of the run, against the 256KB limit this phase is supposed to get out from
  // under.
  it('reads the record consistently, and reads only what the handshake needs', () => {
    const { state } = allStates.find(({ name }) => name === 'Get Existing Issue');

    expect(state.Parameters.ConsistentRead).toBe(true);
    expect(state.Parameters.ProjectionExpression).toBe('#status');
    expect(state.Parameters.ExpressionAttributeNames).toEqual({ '#status': 'status' });

    // The projection is only safe while `status` really is the only attribute
    // anything reads off the state-data copy of the record.
    const attributes = new Set();
    for (const { state: body } of allStates) {
      walkStrings(ownBody(body), '$', (value) => {
        const match = /\$\.existingNewsletter\.Item\.([A-Za-z0-9_]+)/.exec(value);
        if (match) attributes.add(match[1]);
      });
    }

    expect([...attributes]).toEqual(['status']);
  });

  // The record read is the write that claims the issue: ALL_NEW hands the whole
  // item back, so the content published is the content as of the status flip
  // rather than a copy captured at schedule time (D4).
  it('reads the content off the record it just claimed', () => {
    const { state } = allStates.find(({ name }) => name === 'Mark Issue In Progress');

    expect(state.Parameters.ReturnValues).toBe('ALL_NEW');
    expect(state.Assign).toEqual({
      'content.$': '$.Attributes.content.S',
      'callerSubject.$': '$.Attributes.subject.S'
    });
    // Writing the input's content back over the record is what made an edit
    // after scheduling publish stale content.
    expect(state.Parameters.UpdateExpression).not.toMatch(/:content/);
  });

  it('binds the content variables in the one claim state', () => {
    for (const variable of ['content', 'callerSubject']) {
      const binders = allStates
        .filter(({ state }) => declaresVariable(state, variable))
        .map(({ name }) => name)
        .sort();

      expect([variable, binders]).toEqual([variable, [...CONTENT_BINDERS].sort()]);
      expect([variable, routesReadingUnbound(variable)]).toEqual([variable, []]);
    }
  });

  // `scheduled` is a sendable status now: the record stays there for the whole
  // wait instead of claiming `in progress` for days (D5), so the handshake has
  // to let it through or a scheduled issue would read as already processed and
  // succeed without sending.
  it('treats a scheduled record as still to be sent', () => {
    const { state } = allStates.find(({ name }) => name === 'Has Issue Been Processed?');
    const sendable = state.Choices.filter((choice) => choice.Next === CLAIM_STATE);

    const statuses = JSON.stringify(sendable);
    expect(statuses).toContain('"StringEquals":"draft"');
    expect(statuses).toContain('"StringEquals":"scheduled"');
    expect(state.Default).toBe('Success - Duplicate Request');
  });

  // A re-staged `failed` issue must NOT go anywhere that reads
  // `$$.Execution.Input.content`, which the API has never sent since Phase 5,
  // and whose absence raises States.Runtime - neither retriable nor catchable,
  // so `States.ALL` does not save it. Re-staging a failed API issue used to kill
  // the execution outright and leave the record at `failed` with nothing
  // recorded. Its record exists and holds the content, so it claims like a draft.
  it('re-stages a failed issue from its record, not from the execution input', () => {
    const { state } = allStates.find(({ name }) => name === 'Has Issue Been Processed?');
    const failedEdge = state.Choices.find((choice) =>
      JSON.stringify(choice).includes('"StringEquals":"failed"')
    );

    expect(failedEdge?.Next).toBe(CLAIM_STATE);
  });

  // The definition used to fork on which producer started the execution, because
  // the GitHub ingress carried a file body that had to win over the draft record
  // while the API sent identifiers only. PR #358 removed that producer, so there
  // is one way in and one source of content. Asserted as absence, so restoring a
  // producer-content path is a deliberate act that updates this test rather than
  // a quiet second answer to "what is this execution publishing".
  it('has no producer-supplied content path left', () => {
    const present = allStates
      .map(({ name }) => name)
      .filter((name) => REMOVED_GITHUB_INGRESS_STATES.includes(name));

    expect(present).toEqual([]);

    // Every re-processable status routes to the one claim state.
    const { state } = allStates.find(({ name }) => name === 'Has Issue Been Processed?');
    expect(state.Choices.map((choice) => choice.Next)).toEqual(
      state.Choices.map(() => CLAIM_STATE)
    );
    expect(state.Default).toBe('Success - Duplicate Request');
  });

  // The API cannot record the ARN of an execution it did not start, and
  // `get_workflow_state_for` in issues.rs reads it to report where the workflow
  // is. The entry write records it itself instead.
  it('records its own execution ARN on the issue record', () => {
    const { state: marked } = allStates.find(({ name }) => name === CLAIM_STATE);

    expect(marked.Parameters.UpdateExpression).toMatch(/executionArn = :executionArn/);
    expect(marked.Parameters.ExpressionAttributeValues[':executionArn']).toEqual({
      'S.$': '$$.Execution.Id'
    });
  });

  // The definition owns no timer. Waiting is EventBridge Scheduler's job now -
  // the `ISSUE-SEND-*` entry starts the execution at (send instant - lead time)
  // - and that is not a stylistic preference: a `Wait` inside the execution puts
  // every subsequent step after the send instant, which is exactly what stops
  // the local-send fan-out from scheduling a timezone group east of the base
  // zone for its own local morning (D9). Reintroducing one would silently undo
  // the lead time for whatever path reached it.
  it('does not wait inside the execution', () => {
    expect(allStates.filter(({ state }) => state.Type === 'Wait')).toEqual([]);
    expect(definition.States['Is Scheduled In The Future?']).toBeUndefined();
    expect(definition.States['Wait For Future Date']).toBeUndefined();
  });

  // The other half of removing the Wait, and the reason the lead time is safe
  // to raise: an execution that starts early has to be *told* when the issue
  // sends. Both parsers fall back to "now" without it (markdown reads its
  // frontmatter date, json has no date of its own), and "now" makes an early
  // execution publish early instead of scheduling.
  //
  // It is the whole input object rather than `$$.Execution.Input.sendAt`, and
  // that distinction is the test. An `ISSUE-SEND-*` Scheduler entry carries the
  // execution input baked into it when the issue was scheduled and starts it
  // against whatever definition is live when it fires, so an entry predating
  // `sendAt` would meet a `.$` path to a field it does not have - States.Runtime,
  // unretryable and uncatchable, a missed send with nothing written to the
  // record. A path to the object always resolves; parse-issue.mjs reads the
  // field off it and treats absent as "now".
  it('hands the whole execution input to the parse step', () => {
    const { state: parse } = allStates.find(({ name }) => name === 'Parse Issue');

    expect(parse.Parameters.Payload['executionInput.$']).toBe('$$.Execution.Input');
  });

  // The same rule, stated as a ban so it covers states this file does not know
  // about yet. Every field named here is one the API has always emitted; a new
  // one is only safe to read this way once every outstanding Scheduler entry
  // carries it, which is never true in the deploy that introduces it.
  it('reads no execution-input field that a pending Scheduler entry may lack', () => {
    const ALWAYS_PRESENT = ['fileName', 'issueId', 'tenant', 'templateId', 'contentType'];
    const reads = [];

    walkStrings(definition, '$', (value) => {
      const match = /^\$\$\.Execution\.Input\.([A-Za-z0-9_]+)/.exec(value);
      if (match && !ALWAYS_PRESENT.includes(match[1])) reads.push(value);
    });

    expect(reads).toEqual([]);
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

// ===========================================================================
// Scheduler names against template.yaml's IAM. The definition's two
// `CreateSchedule` calls are the only actions in it whose permission is scoped
// by a *name pattern* rather than a resource ARN, which makes the name format
// and the policy a matched pair kept in two files. Getting it wrong fails at
// CreateSchedule with AccessDenied - and it fails the two jobs that run three
// and five days after the send, where nothing is watching.
// ===========================================================================
const SCHEDULE_NAME_IAM_PATTERNS = {
  'Schedule Issue Report': 'schedule/newsletter/ISSUE-STATS*',
  'Schedule List Cleanup': 'schedule/newsletter/*-CLEAN-*'
};

describe('stage-issue definition: Scheduler names and IAM', () => {
  // `States.Format('{}-CLEAN-{}', ...)` with a stand-in for every argument, so
  // the glob below is matched against a name the definition really produces
  // rather than against a literal copied out of the policy.
  const exampleName = (expression) => {
    const literal = /^States\.Format\('([^']+)'/.exec(expression);
    return literal ? literal[1].replace(/\{\}/g, 'X') : null;
  };

  const globToRegExp = (glob) =>
    new RegExp(`^${glob.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

  it('produces a name matched by the IAM pattern that allows it', () => {
    const checked = [];

    for (const { name, state } of allStates) {
      if (state.Resource !== '${SchedulerCreateSchedule}') continue;

      const pattern = SCHEDULE_NAME_IAM_PATTERNS[name];
      expect([name, typeof pattern]).toEqual([name, 'string']);

      // The policy has to actually contain it - this is the half that catches a
      // pattern edited in template.yaml alone.
      expect([name, templateText.includes(pattern)]).toEqual([name, true]);

      const example = exampleName(state.Parameters['Name.$']);
      expect([name, example]).not.toEqual([name, null]);
      expect([name, example, globToRegExp(pattern.split('/').pop()).test(example)]).toEqual([
        name,
        example,
        true
      ]);
      checked.push(name);
    }

    expect(checked.sort()).toEqual(Object.keys(SCHEDULE_NAME_IAM_PATTERNS).sort());
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

describe('stage-issue definition: no status write may lie about a send', () => {
  // The regression this exists to prevent, in full, because it is subtle and it
  // shipped once already:
  //
  // `Publish` hands off to send-email-v2 asynchronously. For a local-send issue
  // the fan-out then moves the record to `sending` and owns the transition to
  // `published`, which it makes conditionally (`from: ['sending']` in
  // functions/utils/send-progress.mjs). So any state that runs after `Publish`
  // and writes `status` unconditionally can overwrite `sending` - and once it
  // does, the fan-out's conditional write never matches again. The issue is
  // stranded, the API reports "This issue was not sent" while deliveries run for
  // hours, and because `Has Issue Been Processed?` treats `failed` as sendable,
  // re-staging it sends the issue a second time.
  //
  // Phase 1 introduced exactly this by giving the post-publish states a Catch
  // that routed to an unconditional failure write. Nothing else in this file
  // would have caught it: the Catch coverage test asserts the edge EXISTS.

  /** States reachable from `Publish` by any transition, excluding Publish itself. */
  const reachableAfterPublish = () => {
    const byName = new Map(allStates.map(({ name, state }) => [name, state]));
    const seen = new Set();
    const queue = [...transitionTargets(byName.get(PUBLISH))];

    while (queue.length > 0) {
      const name = queue.shift();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const state = byName.get(name);
      if (!state) continue;
      queue.push(...transitionTargets(state));
      // A Parallel's branches run as part of reaching it.
      for (const key of NESTED_KEYS) {
        for (const branch of state[key] ?? []) {
          queue.push(branch.StartAt, ...Object.keys(branch.States ?? {}));
        }
      }
    }
    return seen;
  };

  /** Tasks that SET the newsletter record's status attribute. */
  const statusWriters = () =>
    allStates.filter(({ state }) => {
      const update = state.Parameters?.UpdateExpression;
      const names = state.Parameters?.ExpressionAttributeNames ?? {};
      if (typeof update !== 'string') return false;
      return /SET .*#status\b/.test(update) && names['#status'] === 'status';
    });

  it('guards every status write that can run after the send event', () => {
    const afterPublish = reachableAfterPublish();

    const unguarded = statusWriters()
      .filter(({ name }) => afterPublish.has(name))
      .filter(({ state }) => {
        const condition = state.Parameters?.ConditionExpression ?? '';
        return !/#status\s*<>\s*:sending/.test(condition);
      })
      .map(({ name }) => name);

    expect(unguarded).toEqual([]);
  });

  it('leaves the guard refusable rather than fatal', () => {
    // A refused condition must be caught, or the guard turns a recoverable
    // mislabelling into a hard execution failure with nothing recorded.
    for (const { name, state } of statusWriters()) {
      const condition = state.Parameters?.ConditionExpression ?? '';
      if (!/#status\s*<>\s*:sending/.test(condition)) continue;

      const catchers = describeCatchers(state);
      expect(catchers[0]).toMatch(/^DynamoDB\.ConditionalCheckFailedException/);
      expect(name).toBeTruthy();
    }
  });

  it('never retries a refused condition', () => {
    // ConditionalCheckFailedException is an answer, not a fault. Retrying it
    // delays the pipeline and, on the success write, delays the local-send
    // handoff by the whole backoff window.
    for (const { state } of statusWriters()) {
      for (const retrier of state.Retry ?? []) {
        expect(retrier.ErrorEquals).not.toContain('DynamoDB.ConditionalCheckFailedException');
        expect(retrier.ErrorEquals).not.toContain('States.ALL');
      }
    }
  });
});
