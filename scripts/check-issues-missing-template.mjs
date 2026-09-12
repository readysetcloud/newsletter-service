/**
 * Pre-deploy check: find issues that can still reach a send but have no usable
 * template.
 *
 * The publish pipeline used to render against a static default template bundled
 * with the Lambda whenever an issue had no `templateId`, or named one that no
 * longer existed. That fallback is gone — those issues now fail the publish
 * instead of mailing a layout nobody chose.
 *
 * The API and scheduling guards refuse such an issue up front, but they cannot
 * speak for a send that is *already committed*: an issue scheduled before the
 * deploy has its Scheduler entry, or a running execution, and reaches the
 * publish step regardless of what the guards later say.
 *
 * The remedy depends on how far along the send is, and only one of the three is
 * a plain edit:
 *
 *   in progress  If an execution really is running, it froze `templateId` in
 *                its input, so the record no longer decides what publishes.
 *                Editing DynamoDB does nothing. Wait for the execution to
 *                finish before deploying, or stop it deliberately.
 *   scheduled    `check_update_allowed` refuses updates to a `scheduled` issue,
 *                so the template cannot be set in place: unschedule (status ->
 *                draft), set the template, schedule again.
 *   draft/failed A plain `PUT /issues/{id}` with a templateId.
 *
 * `in progress` is a claim the record makes, not a fact. A send that died
 * without writing a terminal status leaves the record saying `in progress`
 * forever, and such a record cannot publish anything — there is nothing left to
 * publish it. Blocking on those means blocking every deploy until someone
 * edits production data, which is what happened between 2026-08-27 and
 * 2026-09-11: nine dead records, seven of them legacy rows whose key holds a
 * file path where an issue number belongs, stopped four releases from shipping.
 *
 * So the claim gets checked against the execution named on the record itself.
 * `Mark Issue In Progress` sets `status` and `executionArn` in one conditional
 * `UpdateItem`, so a record cannot say `in progress` without carrying the ARN
 * of the run that said it — there is no window between the two writes for this
 * check to fall into. Each such record is re-read with `ConsistentRead` and its
 * own ARN described:
 *
 *   RUNNING             a real send is under way. Blocks.
 *   terminal            the run is over and the status was never written back.
 *                       Stale: report it, do not block a release for it.
 *   ExecutionDoesNotExist
 *                       a RUNNING execution can always be described, so this
 *                       means it is not running — it aged out of history, or
 *                       the ARN was never real. Stale.
 *   anything else       the check could not tell. Blocks.
 *
 * Deliberately not a snapshot of `ListExecutions` taken before the scan: an
 * execution starting after such a snapshot, then marking its issue
 * `in progress`, would be read as stale by the later scan and waved through.
 * `ListExecutions` is eventually consistent too, so absence from it is not
 * evidence a gate should trust. It survives only as the fallback for records
 * with no ARN at all, where it can add a block but never clear one.
 *
 * Records with no `executionArn` predate the field (added 2026-07-26, in
 * d229a7d) and so cannot belong to a run the current pipeline started. They are
 * reported as stale unless that fallback finds a live execution naming them.
 *
 * What none of this can do is see the future: an execution that starts after
 * the record is read is invisible to any point-in-time check, this one
 * included. The window is now one consistent read wide instead of one whole
 * table scan wide.
 *
 * Usage:
 *   node scripts/check-issues-missing-template.mjs --table TABLE_NAME \
 *     [--state-machine ARN] [--json]
 *
 * Options:
 *   --table          DynamoDB newsletter table name (required)
 *   --state-machine  Stage-issue state machine ARN. Only needed for records
 *                    with no executionArn; without it those block instead.
 *   --json           Emit machine-readable JSON instead of a report
 *
 * Read-only: it never writes. Exits 1 on anything already committed to a send,
 * so it can gate a deploy — which is how the production workflow runs it.
 */

import { pathToFileURL } from 'node:url';
import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SFNClient, ListExecutionsCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// The three tiers exist because the remedy differs completely between them,
// not just the urgency.
//
// `in progress` is the worst case and the only genuinely unrecoverable one —
// but only while the execution exists. A live run already carries `templateId`
// in its *input* (see `build_execution_input` in issues.rs, read by the
// definition as `$$.Execution.Input.templateId`), so the record is no longer
// what decides what publishes, and editing DynamoDB changes nothing. Once the
// execution is over the same record is inert, and `sendVerdict` below is what
// tells the two apart.
//
// `scheduled` is recoverable but not by an edit: `check_update_allowed` refuses
// any update to a `scheduled` issue, so the template cannot be set in place.
//
// `draft` and `failed` are the easy ones — a plain update works — and are
// reported only so the author is not surprised later.
const EXECUTING_STATUSES = new Set(['in progress']);
const SCHEDULED_STATUSES = new Set(['scheduled']);
const WARNING_STATUSES = new Set(['draft', 'failed']);

// Step Functions statuses that mean the run is over and nothing more will
// publish from it. Anything outside this set — RUNNING, PENDING_REDRIVE, or
// some status added after this was written — counts as still going.
const FINISHED_EXECUTION_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED']);

// html issues arrive pre-rendered and are sent verbatim, so they need no
// template. Everything else renders through one.
const NEEDS_TEMPLATE = (contentType) => (contentType ?? 'markdown') !== 'html';

function parseArgs(argv) {
  const args = { table: null, stateMachine: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--table' && argv[i + 1]) { args.table = argv[++i]; }
    else if (argv[i] === '--state-machine' && argv[i + 1]) { args.stateMachine = argv[++i]; }
    else if (argv[i] === '--json') { args.json = true; }
  }
  return args;
}

const args = parseArgs(process.argv);

/**
 * Whether this file was run, as opposed to imported by a test.
 *
 * The decision table below is the part of a deploy gate that must not regress,
 * and testing it means importing this module — which cannot then parse argv,
 * scan a table and call `process.exit` on the way in.
 */
const isEntryPoint =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const ddb = new DynamoDBClient();
const sfn = new SFNClient();

// Templates are read repeatedly across a tenant's issues; one GetItem each is
// plenty, and the cache keeps a 200-issue tenant from re-reading the same three.
const templateExistsCache = new Map();

async function templateExists(tenantId, templateId) {
  // NUL separates the two halves because it is the one character neither a
  // tenant id nor a template id can contain, so no pair of them can collide on
  // a key. Written as an escape rather than typed literally: a raw NUL in the
  // source makes git treat this whole file as binary and stop showing diffs
  // for it, which is a bad trade for a delimiter nobody ever reads.
  const key = `${tenantId}\u0000${templateId}`;
  if (templateExistsCache.has(key)) {
    return templateExistsCache.get(key);
  }

  const { Item } = await ddb.send(new GetItemCommand({
    TableName: args.table,
    Key: marshall({ pk: tenantId, sk: `template#${templateId}` })
  }));

  const exists = !!Item;
  templateExistsCache.set(key, exists);
  return exists;
}

/**
 * Whether the execution at `executionArn` is still going: `true`, `false`, or
 * `null` when this check could not find out.
 *
 * `ExecutionDoesNotExist` is a definite no rather than an unknown. A RUNNING
 * execution can always be described, so an ARN that cannot be found is not one
 * that is running — it has aged out of the 90-day history, or it was never a
 * real ARN. Every other failure is an unknown and reported as such, because a
 * throttle or a missing permission says nothing about the send.
 */
async function executionRunning(executionArn) {
  try {
    const { status } = await sfn.send(new DescribeExecutionCommand({ executionArn }));
    return !FINISHED_EXECUTION_STATUSES.has(status);
  } catch (err) {
    if (err.name === 'ExecutionDoesNotExist') {
      return false;
    }
    console.warn(`  ! Could not describe ${executionArn}: ${err.message}`);
    return null;
  }
}

/**
 * The issues some RUNNING execution names, as a Set of `<tenantId>#<issueId>`
 * keys — the shape an issue record uses for its pk, so membership is a direct
 * pk lookup.
 *
 * This is the weak signal, and it is used for one thing only: records with no
 * `executionArn`, which no ARN lookup can speak for. `ListExecutions` is
 * eventually consistent, so a miss here is not proof of anything — which is
 * why a hit can only ever *add* a block, never clear one.
 *
 * `build_execution_input` in issues.rs puts `tenant.id` and `issueId` in every
 * execution's input. ListExecutions does not return inputs, so each running
 * execution costs one DescribeExecution — fine, because a healthy account has
 * none and a busy one has a handful.
 *
 * Returns `null` when the answer is unknown (no ARN given, or Step Functions
 * could not be read), which the caller treats as "cannot clear these".
 */
async function liveIssueKeys(stateMachineArn) {
  if (!stateMachineArn) return null;

  const keys = new Set();
  let nextToken;

  try {
    do {
      const page = await sfn.send(new ListExecutionsCommand({
        stateMachineArn,
        statusFilter: 'RUNNING',
        nextToken
      }));

      for (const execution of page.executions ?? []) {
        const { input } = await sfn.send(new DescribeExecutionCommand({
          executionArn: execution.executionArn
        }));

        // An execution this cannot read is one it cannot clear anything
        // against, so the whole fallback becomes unknown rather than a set
        // that quietly omits it.
        let parsed;
        try {
          parsed = JSON.parse(input ?? '');
        } catch {
          console.warn(`  ! ${execution.executionArn} has unreadable input.`);
          return null;
        }

        const tenantId = parsed?.tenant?.id;
        const issueId = parsed?.issueId;
        if (tenantId == null || issueId == null) {
          console.warn(`  ! ${execution.executionArn} names no issue.`);
          return null;
        }

        keys.add(`${tenantId}#${issueId}`);
      }

      nextToken = page.nextToken;
    } while (nextToken);
  } catch (err) {
    console.warn(`  ! Could not read executions from ${stateMachineArn}: ${err.message}`);
    return null;
  }

  return keys;
}

// Resolved at most once, and only if some record turns out to have no ARN.
let fallbackKeys;
const liveKeysFallback = () => (fallbackKeys ??= liveIssueKeys(args.stateMachine));

/**
 * One issue, read so that what it says is current rather than whatever the scan
 * happened to see.
 *
 * The scan is eventually consistent, so its copy of a record can predate a
 * re-send that just marked the issue `in progress` again under a new ARN.
 * Describing the old ARN would then clear a send that is genuinely running.
 * The state machine's own handshake reads consistently for the mirror image of
 * this reason — see the Comment on `Get Issue` in stage-issue.asl.json.
 */
async function readIssue(pk) {
  const { Item } = await ddb.send(new GetItemCommand({
    TableName: args.table,
    Key: marshall({ pk, sk: 'newsletter' }),
    ConsistentRead: true
  }));

  return Item ? unmarshall(Item) : null;
}

/**
 * Whether an `in progress` record has a send behind it that is really running.
 *
 * Returns `{ live, evidence }` — `live` true blocks, false is stale, and `null`
 * means this could not be established, which also blocks.
 */
async function sendVerdict(issue) {
  const executionArn = issue.executionArn?.trim();

  if (!executionArn) {
    // Predates `executionArn` (added 2026-07-26), so no ARN lookup can speak
    // for it. The weak signal is all there is.
    const keys = await liveKeysFallback();

    if (keys === null) {
      return {
        live: null,
        evidence: 'no executionArn, and running executions could not be listed'
      };
    }

    return keys.has(issue.pk)
      ? { live: true, evidence: 'no executionArn, but a running execution names this issue' }
      : { live: false, evidence: 'no executionArn, and no running execution names this issue' };
  }

  const running = await executionRunning(executionArn);
  const name = executionArn.split(':').pop();

  if (running === null) {
    return { live: null, evidence: `execution ${name} could not be described` };
  }

  return running
    ? { live: true, evidence: `execution ${name} is still running` }
    : { live: false, evidence: `execution ${name} has finished` };
}

/**
 * An issue's pk is `<tenantId>#<issueNumber>`, and a tenant id may itself
 * contain no '#'. Splitting on the last one keeps this correct even if that
 * ever stops being true.
 */
function tenantIdFromPk(pk) {
  const lastHash = pk.lastIndexOf('#');
  return lastHash === -1 ? pk : pk.slice(0, lastHash);
}

async function classify(issue) {
  const tenantId = tenantIdFromPk(issue.pk);
  const contentType = issue.contentType ?? 'markdown';

  if (!NEEDS_TEMPLATE(contentType)) {
    return null;
  }

  if (!issue.templateId?.trim()) {
    return { tenantId, reason: 'no templateId' };
  }

  if (!await templateExists(tenantId, issue.templateId)) {
    return { tenantId, reason: `templateId '${issue.templateId}' no longer exists` };
  }

  return null;
}

const entryFor = (issue, problem) => ({
  tenantId: problem.tenantId,
  issueNumber: issue.issueNumber,
  subject: issue.subject,
  status: issue.status ?? 'unknown',
  contentType: issue.contentType ?? 'markdown',
  scheduledAt: issue.scheduledAt ?? null,
  reason: problem.reason
});

const describe = (entry) =>
  `  ${entry.tenantId} #${entry.issueNumber} [${entry.status}]` +
  `${entry.scheduledAt ? ` ${entry.scheduledAt}` : ''} — ${entry.reason}\n` +
  `    "${entry.subject}"` +
  `${entry.evidence ? `\n    ${entry.evidence}` : ''}`;

async function run() {
  const executing = [];
  const unverified = [];
  const stale = [];
  const scheduled = [];
  const warning = [];

  // `in progress` records are decided after the scan, from a consistent read
  // rather than from the scan's copy. Keys only: the record is re-read.
  const inProgress = [];

  let scanned = 0;
  let examined = 0;
  let lastKey;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: args.table,
      FilterExpression: 'sk = :sk',
      ExpressionAttributeValues: marshall({ ':sk': 'newsletter' }),
      ExclusiveStartKey: lastKey
    }));

    scanned += result.ScannedCount ?? 0;

    for (const raw of result.Items ?? []) {
      const issue = unmarshall(raw);
      const status = issue.status ?? 'unknown';

      if (EXECUTING_STATUSES.has(status)) {
        examined++;
        inProgress.push(issue.pk);
        continue;
      }

      const bucket = SCHEDULED_STATUSES.has(status) ? scheduled
        : WARNING_STATUSES.has(status) ? warning
          : null;

      if (!bucket) continue;

      examined++;
      const problem = await classify(issue);
      if (problem) bucket.push(entryFor(issue, problem));
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  for (const pk of inProgress) {
    const issue = await readIssue(pk);

    // Gone, or moved on between the scan and now. Either way it is no longer an
    // issue committed to a send without a template.
    if (!issue || !EXECUTING_STATUSES.has(issue.status ?? 'unknown')) continue;

    const problem = await classify(issue);
    if (!problem) continue;

    const { live, evidence } = await sendVerdict(issue);
    const entry = { ...entryFor(issue, problem), evidence };

    if (live === true) executing.push(entry);
    else if (live === null) unverified.push(entry);
    else stale.push(entry);
  }

  const blocking = executing.length + unverified.length + scheduled.length;

  if (args.json) {
    console.log(JSON.stringify({
      scanned,
      examined,
      executing,
      unverified,
      stale,
      scheduled,
      warning
    }, null, 2));
  } else {
    console.log(`Scanned ${scanned} items; examined ${examined} sendable issues.`);
    console.log(`Checked ${inProgress.length} "in progress" record(s) against their executions.\n`);

    if (blocking === 0) {
      console.log('Nothing committed to a send is missing a template. Safe to deploy.');
    }

    if (executing.length > 0) {
      console.log(`DO NOT DEPLOY — ${executing.length} issue(s) are mid-execution and cannot be repaired:`);
      for (const entry of executing) {
        console.log(describe(entry));
      }
      console.log(
        '\n  The execution froze templateId in its input, so the record no longer\n' +
        '  decides what publishes — editing DynamoDB will not change what these send.\n' +
        '  Wait for the execution to finish, or stop it deliberately, then re-run this.'
      );
    }

    if (unverified.length > 0) {
      console.log(`${executing.length > 0 ? '\n' : ''}BLOCKING — ${unverified.length} issue(s) could not be checked against their execution:`);
      for (const entry of unverified) {
        console.log(describe(entry));
      }
      console.log(
        '\n  These say "in progress" and this check could not find out whether that\n' +
        '  is still true, so it assumes it is. Usually a permissions or throttling\n' +
        '  problem reaching Step Functions rather than anything wrong with the issue.'
      );
    }

    if (scheduled.length > 0) {
      console.log(`${executing.length + unverified.length > 0 ? '\n' : ''}BLOCKING — ${scheduled.length} scheduled issue(s) will fail to publish:`);
      for (const entry of scheduled) {
        console.log(describe(entry));
      }
      console.log(
        '\n  A scheduled issue cannot be edited in place (the API refuses any update\n' +
        '  to one), so the fix is three steps: unschedule it (PUT /issues/{id} with\n' +
        '  status "draft"), set the templateId, then schedule it again.'
      );
    }

    if (stale.length > 0) {
      console.log(`\nSTALE — ${stale.length} issue(s) say "in progress" but their send is over:`);
      for (const entry of stale) {
        console.log(describe(entry));
      }
      console.log(
        '\n  A send died without writing a terminal status. These cannot publish\n' +
        '  anything, so they do not block the deploy — but they will keep showing\n' +
        '  up here until their status is moved off "in progress".'
      );
    }

    if (warning.length > 0) {
      console.log(`\nWARNING — ${warning.length} draft/failed issue(s) will be refused when someone tries to send them:`);
      for (const entry of warning) {
        console.log(describe(entry));
      }
      console.log('\n  These are not committed to a send, so a plain PUT /issues/{id} with a\n  templateId is enough. Not a deploy blocker.');
    }
  }

  process.exit(blocking > 0 ? 1 : 0);
}

export { executionRunning, sendVerdict, classify, run };

if (isEntryPoint) {
  if (!args.table) {
    console.error(
      'Usage: node scripts/check-issues-missing-template.mjs --table TABLE_NAME ' +
      '[--state-machine ARN] [--json]'
    );
    process.exit(1);
  }

  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
