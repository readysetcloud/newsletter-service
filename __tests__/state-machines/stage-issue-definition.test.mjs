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
// `topLevel` is the 25 states §1 of the plan tracks; `total` includes the 14
// states living inside the two Parallel states' branches.
const EXPECTED_STATE_COUNTS = {
  topLevel: 25,
  total: 39,
  Choice: 7,
  Fail: 1,
  Parallel: 3,
  Pass: 2,
  Succeed: 2,
  Task: 23,
  Wait: 1
};

// States that no transition can reach, per scope. MUST BE EMPTY and must stay
// empty - a state nothing points at is either a bug or leftovers.
//
// Note for whoever lands Phase 2: the four dead preview states are NOT in here
// and never will be. They are graph-reachable (`Send email preview?` and
// `Send JSON Preview?` route to them when `$$.Execution.Input.isPreview` is
// true) and merely semantically dead, because no producer sets isPreview. The
// plan's claim that a reachability check "alone would have flagged the 4 dead
// preview states" does not hold. They are tracked in DEAD_PREVIEW_STATES below
// instead.
const KNOWN_UNREACHABLE_STATES = [];

// The dead preview path Phase 2 deletes. Asserted to still exist so the list
// cannot go stale. Once Phase 2 removes these states, empty this constant and
// adjust EXPECTED_STATE_COUNTS: topLevel -2 (Send JSON Preview?, Publish JSON
// Preview), total -4, Choice -2, Task -2. KNOWN_SINGLE_DOLLAR_EXECUTION_STATES
// also empties, since deleting `Send Preview` takes D1 with it.
const DEAD_PREVIEW_STATES = [
  'Publish JSON Preview',
  'Send JSON Preview?',
  'Send Preview',
  'Send email preview?'
];

// Task states with no `Retry`, i.e. one throttle or transient service error
// away from failing the execution. Phase 1 adds Retry (and Catch) to every
// Task; this list must shrink to empty then.
const TASKS_WITHOUT_RETRY = [
  'Get Existing Issue',
  'Mark Issue In Progress',
  'Mark JSON Issue Published',
  'Notify of JSON Success',
  'Notify of Success',
  'Save Issue Record',
  'Schedule Issue Report',
  'Schedule JSON Issue Report',
  'Schedule JSON List Cleanup',
  'Schedule List Cleanup',
  'Trigger Site Rebuild',
  'Update Issue Metadata',
  'Update Issue Record - Failure',
  'Update Issue Record - Success',
  'Update JSON Issue Metadata'
];

// D1: states still carrying a single-dollar `$.Execution...` path. `$.Execution`
// resolves against state data, not the context object, so it throws an
// unretryable States.Runtime error the moment the state is entered. Phase 1
// fixes this; empty this constant then. Any NEW occurrence fails immediately.
const KNOWN_SINGLE_DOLLAR_EXECUTION_STATES = ['Send Preview'];

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
  it('uses no single-dollar $.Execution paths outside the known-broken states', () => {
    const offenders = new Map();

    for (const { name, state } of allStates) {
      walkStrings(ownBody(state), `$.${name}`, (value, path) => {
        if (/^\$\.Execution/.test(value)) {
          offenders.set(name, [...(offenders.get(name) ?? []), `${path} = ${value}`]);
        }
      });
    }

    // Compared by state name, with the offending paths surfaced in the message
    // so a failure says where to look.
    expect({
      states: [...offenders.keys()].sort(),
      paths: [...offenders.values()].flat().sort()
    }).toEqual({
      states: [...KNOWN_SINGLE_DOLLAR_EXECUTION_STATES].sort(),
      paths: ['$.Send Preview.Parameters.Payload.tenantId.$ = $.Execution.Input.tenant.id']
    });
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

  it('still contains the dead preview states the allow-list claims', () => {
    const present = DEAD_PREVIEW_STATES.filter((name) => stateNames.includes(name)).sort();
    expect(present).toEqual([...DEAD_PREVIEW_STATES].sort());
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
