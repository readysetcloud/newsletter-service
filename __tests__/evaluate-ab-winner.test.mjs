import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let ddbSend;
let eventBridgeSend;
let publishIssueEvent;

const marshall = (obj) => {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = { S: value };
    } else if (typeof value === 'number') {
      result[key] = { N: String(value) };
    } else if (Array.isArray(value)) {
      result[key] = { L: value.map((v) => ({ S: v })) };
    } else if (value && typeof value === 'object') {
      result[key] = { M: marshall(value) };
    }
  }
  return result;
};

const unmarshall = (item) => {
  const result = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.S !== undefined) result[key] = value.S;
    else if (value.N !== undefined) result[key] = Number(value.N);
    else if (value.M !== undefined) result[key] = unmarshall(value.M);
    else if (value.L !== undefined) result[key] = value.L.map((v) => v.S);
    else result[key] = value;
  }
  return result;
};

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn().mockResolvedValue({});
    eventBridgeSend = jest.fn().mockResolvedValue({});
    publishIssueEvent = jest.fn().mockResolvedValue(undefined);

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params }))
    }));

    jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
      EventBridgeClient: jest.fn(() => ({ send: eventBridgeSend })),
      PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params }))
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({ marshall, unmarshall }));

    jest.unstable_mockModule('../functions/utils/event-publisher.mjs', () => ({
      publishIssueEvent,
      EVENT_TYPES: { ISSUE_AB_COMPLETED: 'ISSUE_AB_COMPLETED' }
    }));

    ({ handler } = await import('../functions/evaluate-ab-winner.mjs'));
  });
};

const abTestConfig = (overrides = {}) => ({
  dimension: 'subject',
  winMetric: 'openRate',
  confidence: 0.95,
  minSamplePerVariant: 100,
  status: 'testing',
  variants: [
    { variantId: 'a', subject: 'Control Subject A' },
    { variantId: 'b', subject: 'Challenger Subject B' }
  ],
  ...overrides
});

const baseEvent = {
  detail: {
    tenantId: 'tenant-1',
    issueNumber: 42,
    referenceNumber: 'tenant-1_42',
    sendPayload: {
      html: '<p>hi</p>',
      to: { list: 'main-list' },
      tenantId: 'tenant-1',
      referenceNumber: 'tenant-1_42',
      replacements: { emailAddress: '__EMAIL__' }
    }
  }
};

// Wires the DDB mock: GetItem(newsletter) -> GetItem(stats#v#a) -> GetItem(stats#v#b) -> UpdateItem
const wireDdb = ({ abTest, aStats, bStats }) => {
  ddbSend.mockImplementation(async (cmd) => {
    if (cmd.__type === 'GetItem') {
      const sk = unmarshall(cmd.Key).sk;
      if (sk === 'newsletter') {
        return abTest === null ? { Item: null } : { Item: marshall({ abTest: JSON.stringify(abTest) }) };
      }
      if (sk === 'stats#v#a') {
        return aStats === null ? { Item: null } : { Item: marshall({ ...aStats }) };
      }
      if (sk === 'stats#v#b') {
        return bStats === null ? { Item: null } : { Item: marshall({ ...bStats }) };
      }
    }
    return {};
  });
};

const getSentEmail = () => {
  const call = eventBridgeSend.mock.calls.find(([cmd]) => cmd.__type === 'PutEvents');
  if (!call) return null;
  const entry = call[0].Entries[0];
  return { detailType: entry.DetailType, detail: JSON.parse(entry.Detail) };
};

const getUpdateAbTest = () => {
  // The finalize write carries the serialized abTest under ":v"; the claim write
  // does not, so skip it.
  const call = ddbSend.mock.calls.find(([cmd]) => {
    if (cmd.__type !== 'UpdateItem') return false;
    const values = unmarshall(cmd.ExpressionAttributeValues);
    return values[':v'] !== undefined;
  });
  expect(call).toBeDefined();
  const values = unmarshall(call[0].ExpressionAttributeValues);
  return JSON.parse(values[':v']);
};

describe('evaluate-ab-winner', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  it('significant winner b: persists status sent + winnerVariantId b, sends variant b subject', async () => {
    wireDdb({
      abTest: abTestConfig(),
      // Large, clearly separated open rates with plenty of samples => significant.
      aStats: { opens: 200, clicks: 10, deliveries: 1000 },
      bStats: { opens: 400, clicks: 20, deliveries: 1000 }
    });

    const result = await handler(baseEvent);
    expect(result).toBe(true);

    const persisted = getUpdateAbTest();
    expect(persisted.status).toBe('sent');
    expect(persisted.winnerVariantId).toBe('b');
    expect(persisted.evaluation).toBeDefined();
    expect(persisted.evaluation.significant).toBe(true);

    const sent = getSentEmail();
    expect(sent).not.toBeNull();
    expect(sent.detailType).toBe('Send Email v2');
    expect(sent.detail.subject).toBe('Challenger Subject B');
    expect(sent.detail.abTest).toBeUndefined();
    expect(sent.detail.variants).toBeUndefined();
    expect(sent.detail.html).toBe('<p>hi</p>');

    expect(publishIssueEvent).toHaveBeenCalledTimes(1);
    const [, , eventType, data] = publishIssueEvent.mock.calls[0];
    expect(eventType).toBe('ISSUE_AB_COMPLETED');
    expect(data.winnerVariantId).toBe('b');
    expect(data.status).toBe('sent');
    expect(data.issueId).toBe('tenant-1#42');
  });

  it('inconclusive: persists status inconclusive, sends control variant a subject', async () => {
    wireDdb({
      abTest: abTestConfig(),
      // Identical rates and below min sample => inconclusive.
      aStats: { opens: 5, clicks: 1, deliveries: 10 },
      bStats: { opens: 5, clicks: 1, deliveries: 10 }
    });

    const result = await handler(baseEvent);
    expect(result).toBe(true);

    const persisted = getUpdateAbTest();
    expect(persisted.status).toBe('inconclusive');
    expect(persisted.winnerVariantId).toBe('a');

    const sent = getSentEmail();
    expect(sent).not.toBeNull();
    expect(sent.detail.subject).toBe('Control Subject A');

    const [, , eventType, data] = publishIssueEvent.mock.calls[0];
    expect(eventType).toBe('ISSUE_AB_COMPLETED');
    expect(data.status).toBe('inconclusive');
    expect(data.winnerVariantId).toBe('a');
  });

  it('claim race: a lost compare-and-swap skips the send and finalize', async () => {
    // GetItem(newsletter) returns a non-final test, but the claim UpdateItem
    // loses the CAS (another invocation already claimed/finalized).
    ddbSend.mockImplementation(async (cmd) => {
      if (cmd.__type === 'GetItem') {
        const sk = unmarshall(cmd.Key).sk;
        if (sk === 'newsletter') {
          return { Item: marshall({ abTest: JSON.stringify(abTestConfig()) }) };
        }
        return { Item: null };
      }
      if (cmd.__type === 'UpdateItem') {
        const err = new Error('The conditional request failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      return {};
    });

    const result = await handler(baseEvent);
    expect(result).toBe(true);

    // No winner send, no finalize write, no completion event.
    expect(getSentEmail()).toBeNull();
    const finalizeCall = ddbSend.mock.calls.find(([cmd]) => {
      if (cmd.__type !== 'UpdateItem') return false;
      return unmarshall(cmd.ExpressionAttributeValues)[':v'] !== undefined;
    });
    expect(finalizeCall).toBeUndefined();
    expect(publishIssueEvent).not.toHaveBeenCalled();
  });

  it('releases the claim and rethrows when the winner send fails', async () => {
    const updateCalls = [];
    ddbSend.mockImplementation(async (cmd) => {
      if (cmd.__type === 'GetItem') {
        const sk = unmarshall(cmd.Key).sk;
        if (sk === 'newsletter') {
          return { Item: marshall({ abTest: JSON.stringify(abTestConfig()) }) };
        }
        if (sk === 'stats#v#a') return { Item: marshall({ opens: 200, clicks: 10, deliveries: 1000 }) };
        if (sk === 'stats#v#b') return { Item: marshall({ opens: 400, clicks: 20, deliveries: 1000 }) };
        return { Item: null };
      }
      if (cmd.__type === 'UpdateItem') {
        updateCalls.push(unmarshall(cmd.ExpressionAttributeValues));
      }
      return {};
    });
    // The winner Send Email v2 publish fails.
    eventBridgeSend.mockRejectedValueOnce(new Error('EventBridge unavailable'));

    const result = await handler(baseEvent);
    // Handler swallows the error (returns false) after rolling back the claim.
    expect(result).toBe(false);

    // Claim was acquired (evaluating, has the :pending CAS operand) and then
    // released back to a claimable state (no :pending operand); no finalize
    // (":v") write happened because the send failed first.
    const claimWrite = updateCalls.find((v) => v[':claim'] === 'evaluating' && v[':pending'] !== undefined);
    const releaseWrite = updateCalls.find((v) => v[':claim'] === 'evaluating' && v[':pending'] === undefined && v[':testing'] === 'testing');
    expect(claimWrite).toBeDefined();
    expect(releaseWrite).toBeDefined();
    expect(updateCalls.find((v) => v[':v'] !== undefined)).toBeUndefined();
  });

  it('send-time: keeps base subject, records winning send time, applies winning time', async () => {
    const winnerSendAt = new Date(Date.now() + 3600 * 1000).toISOString();
    wireDdb({
      abTest: abTestConfig({
        dimension: 'sendTime',
        variants: [
          { variantId: 'a', sendAt: new Date(Date.now() + 1800 * 1000).toISOString() },
          { variantId: 'b', sendAt: winnerSendAt }
        ]
      }),
      // b's send time clearly outperforms a.
      aStats: { opens: 200, clicks: 10, deliveries: 1000 },
      bStats: { opens: 400, clicks: 20, deliveries: 1000 }
    });

    const event = {
      detail: {
        ...baseEvent.detail,
        sendPayload: { ...baseEvent.detail.sendPayload, subject: 'Original subject' }
      }
    };

    const result = await handler(event);
    expect(result).toBe(true);

    const persisted = getUpdateAbTest();
    expect(persisted.status).toBe('sent');
    expect(persisted.winnerVariantId).toBe('b');
    expect(persisted.evaluation.winningSendAt).toBe(winnerSendAt);

    const sent = getSentEmail();
    // Send-time winner keeps the shared subject (no per-variant subject) ...
    expect(sent.detail.subject).toBe('Original subject');
    // ... and targets the winning send time (still in the future here).
    expect(sent.detail.sendAt).toBe(winnerSendAt);
  });

  it('guard: status already sent => no Send Email v2 and no DDB write', async () => {
    wireDdb({
      abTest: abTestConfig({ status: 'sent' }),
      aStats: { opens: 200, clicks: 10, deliveries: 1000 },
      bStats: { opens: 400, clicks: 20, deliveries: 1000 }
    });

    const result = await handler(baseEvent);
    expect(result).toBe(true);

    expect(getSentEmail()).toBeNull();
    const writeCall = ddbSend.mock.calls.find(([cmd]) => cmd.__type === 'UpdateItem');
    expect(writeCall).toBeUndefined();
    expect(publishIssueEvent).not.toHaveBeenCalled();
  });
});
