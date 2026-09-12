import { jest } from '@jest/globals';

/**
 * The decision table of the pre-deploy template gate.
 *
 * This is the part that has already gone wrong once in production: the gate
 * treated `in progress` as proof that a send was running, nine dead records
 * said `in progress` forever, and every deploy from 2026-08-27 to 2026-09-11
 * was refused. The rule that replaced it — ask the execution named on the
 * record — is only safe if each branch does what it claims, so each branch has
 * a test.
 *
 * Blocking is the important direction. A gate that wrongly blocks costs a
 * release; a gate that wrongly clears mails a newsletter with no template.
 */

let describeExecution;
let listExecutions;
let ddbSend;
let subject;

const EXECUTION_ARN =
  'arn:aws:states:us-east-1:123456789012:execution:StageIssueStateMachine-abc:run-1';

/** An error shaped the way the AWS SDK reports a missing execution. */
const executionDoesNotExist = () => {
  const err = new Error("Execution Does Not Exist: 'run-1'");
  err.name = 'ExecutionDoesNotExist';
  return err;
};

const STATE_MACHINE_ARN =
  'arn:aws:states:us-east-1:123456789012:stateMachine:StageIssueStateMachine-abc';

const originalArgv = process.argv;

/**
 * Imports the gate with a chosen command line.
 *
 * `args` is read at module scope, so the flags have to be in place before the
 * import. argv[1] is a path this file is not, which keeps the module from
 * deciding it was run and scanning a table on the way in.
 */
const load = async ({ stateMachine = true } = {}) => {
  process.argv = [
    'node',
    '/not/this/file.mjs',
    '--table', 'test-table',
    ...(stateMachine ? ['--state-machine', STATE_MACHINE_ARN] : [])
  ];

  await jest.isolateModulesAsync(async () => {
    describeExecution = jest.fn();
    listExecutions = jest.fn().mockResolvedValue({ executions: [] });
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-sfn', () => ({
      SFNClient: jest.fn(() => ({
        send: (command) =>
          command.__type === 'ListExecutions'
            ? listExecutions(command)
            : describeExecution(command)
      })),
      ListExecutionsCommand: jest.fn((params) => ({ __type: 'ListExecutions', ...params })),
      DescribeExecutionCommand: jest.fn((params) => ({ __type: 'DescribeExecution', ...params }))
    }));

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      ScanCommand: jest.fn((params) => ({ __type: 'Scan', ...params })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params }))
    }));

    subject = await import('../scripts/check-issues-missing-template.mjs');
  });
};

beforeEach(async () => {
  jest.resetModules();
  await load();
});

afterEach(() => {
  process.argv = originalArgv;
});

describe('executionRunning', () => {
  it.each([
    ['SUCCEEDED', false],
    ['FAILED', false],
    ['TIMED_OUT', false],
    ['ABORTED', false],
    ['RUNNING', true]
  ])('reads %s as running=%s', async (status, expected) => {
    describeExecution.mockResolvedValue({ status });

    expect(await subject.executionRunning(EXECUTION_ARN)).toBe(expected);
  });

  it('counts a status it has never heard of as still running', async () => {
    // PENDING_REDRIVE exists today and more may follow. Guessing "finished"
    // about an unknown status is the guess that mails an untemplated issue.
    describeExecution.mockResolvedValue({ status: 'PENDING_REDRIVE' });

    expect(await subject.executionRunning(EXECUTION_ARN)).toBe(true);
  });

  it('treats an execution that does not exist as finished, not unknown', async () => {
    // A RUNNING execution can always be described, so this is a definite "no"
    // rather than an absence of information: the run aged out of the 90-day
    // history, or the ARN was never real.
    describeExecution.mockRejectedValue(executionDoesNotExist());

    expect(await subject.executionRunning(EXECUTION_ARN)).toBe(false);
  });

  it('returns unknown when Step Functions cannot be reached at all', async () => {
    // A throttle or a missing permission says nothing about the send, so it
    // must not be read as "finished".
    describeExecution.mockRejectedValue(Object.assign(new Error('Rate exceeded'), {
      name: 'ThrottlingException'
    }));

    expect(await subject.executionRunning(EXECUTION_ARN)).toBeNull();
  });
});

describe('sendVerdict', () => {
  const issue = (over = {}) => ({ pk: 'readysetcloud#232', ...over });

  it('blocks while the execution named on the record is running', async () => {
    describeExecution.mockResolvedValue({ status: 'RUNNING' });

    const verdict = await subject.sendVerdict(issue({ executionArn: EXECUTION_ARN }));

    expect(verdict.live).toBe(true);
    expect(verdict.evidence).toMatch(/still running/);
  });

  it('asks about the exact ARN on the record, not about the state machine', async () => {
    // The whole point of the rewrite: correlation per record, so an execution
    // that starts after any list snapshot cannot be mistaken for absent.
    describeExecution.mockResolvedValue({ status: 'RUNNING' });

    await subject.sendVerdict(issue({ executionArn: EXECUTION_ARN }));

    expect(describeExecution).toHaveBeenCalledTimes(1);
    expect(describeExecution.mock.calls[0][0]).toMatchObject({ executionArn: EXECUTION_ARN });
    expect(listExecutions).not.toHaveBeenCalled();
  });

  it('calls a finished execution stale', async () => {
    describeExecution.mockResolvedValue({ status: 'FAILED' });

    const verdict = await subject.sendVerdict(issue({ executionArn: EXECUTION_ARN }));

    expect(verdict.live).toBe(false);
    expect(verdict.evidence).toMatch(/has finished/);
  });

  it('blocks when the named execution cannot be described', async () => {
    describeExecution.mockRejectedValue(Object.assign(new Error('denied'), {
      name: 'AccessDeniedException'
    }));

    const verdict = await subject.sendVerdict(issue({ executionArn: EXECUTION_ARN }));

    expect(verdict.live).toBeNull();
    expect(verdict.evidence).toMatch(/could not be described/);
  });

  it('ignores an ARN that is only whitespace', async () => {
    const verdict = await subject.sendVerdict(issue({ executionArn: '   ' }));

    expect(describeExecution).not.toHaveBeenCalled();
    expect(verdict.evidence).toMatch(/no executionArn/);
  });

  describe('records with no executionArn, which predate the field', () => {
    it('is stale when no running execution names it', async () => {
      const verdict = await subject.sendVerdict(issue());

      expect(verdict.live).toBe(false);
      expect(verdict.evidence).toMatch(/no running execution names this issue/);
    });

    it('blocks when a running execution does name it', async () => {
      // The fallback can only ever add a block, never clear one.
      listExecutions.mockResolvedValue({
        executions: [{ executionArn: EXECUTION_ARN }]
      });
      describeExecution.mockResolvedValue({
        input: JSON.stringify({ issueId: 232, tenant: { id: 'readysetcloud' } })
      });

      const verdict = await subject.sendVerdict(issue());

      expect(verdict.live).toBe(true);
      expect(verdict.evidence).toMatch(/a running execution names this issue/);
    });

    it('blocks when running executions cannot be listed', async () => {
      listExecutions.mockRejectedValue(new Error('Rate exceeded'));

      const verdict = await subject.sendVerdict(issue());

      expect(verdict.live).toBeNull();
    });

    it('blocks when no state machine was given to ask about', async () => {
      // Nothing to correlate against, so the gate keeps its conservative
      // default rather than assuming the record is dead.
      await load({ stateMachine: false });

      const verdict = await subject.sendVerdict(issue());

      expect(verdict.live).toBeNull();
      expect(verdict.evidence).toMatch(/could not be listed/);
    });

    it('blocks when a running execution does not say which issue it is for', async () => {
      // An execution this cannot read is one it cannot clear anything against.
      listExecutions.mockResolvedValue({
        executions: [{ executionArn: EXECUTION_ARN }]
      });
      describeExecution.mockResolvedValue({ input: JSON.stringify({ nothing: true }) });

      const verdict = await subject.sendVerdict(issue());

      expect(verdict.live).toBeNull();
    });
  });
});

describe('classify', () => {
  it('passes an html issue with no template, because it needs none', async () => {
    expect(await subject.classify({ pk: 't#1', contentType: 'html' })).toBeNull();
  });

  it('faults a markdown issue with no template', async () => {
    const problem = await subject.classify({ pk: 'readysetcloud#1', contentType: 'markdown' });

    expect(problem).toMatchObject({ tenantId: 'readysetcloud', reason: 'no templateId' });
  });

  it('faults an issue naming a template that is gone', async () => {
    ddbSend.mockResolvedValue({});

    const problem = await subject.classify({ pk: 'readysetcloud#1', templateId: 'deleted' });

    expect(problem.reason).toMatch(/'deleted' no longer exists/);
  });

  it('passes an issue naming a template that is there', async () => {
    ddbSend.mockResolvedValue({ Item: { pk: { S: 'readysetcloud' } } });

    expect(await subject.classify({ pk: 'readysetcloud#1', templateId: 'weekly' })).toBeNull();
  });

  it('reads the tenant from everything before the last # in the key', async () => {
    // Legacy rows put a file path where an issue number belongs.
    const problem = await subject.classify({
      pk: 'readysetcloud#content/newsletter/2024-08-20_Issue-125.md'
    });

    expect(problem.tenantId).toBe('readysetcloud');
  });
});
