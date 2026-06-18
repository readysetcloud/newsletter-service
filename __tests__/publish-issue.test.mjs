import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let ddbSend;
let eventBridgeSend;
let getTenant;
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
    getTenant = jest.fn().mockResolvedValue({ pk: 'tenant-1', list: 'main-list', subscribers: 100 });
    publishIssueEvent = jest.fn().mockResolvedValue(undefined);

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params }))
    }));

    jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
      EventBridgeClient: jest.fn(() => ({ send: eventBridgeSend })),
      PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params }))
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({ marshall, unmarshall }));

    // Stub the static default template so default-path rendering is deterministic.
    jest.unstable_mockModule('../templates/newsletter.hbs', () => ({
      default: 'DEFAULT-TEMPLATE {{metadata.title}} #{{metadata.number}}'
    }));

    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({ getTenant }));

    jest.unstable_mockModule('../functions/utils/event-publisher.mjs', () => ({
      publishIssueEvent,
      EVENT_TYPES: { ISSUE_PUBLISHED: 'ISSUE_PUBLISHED' }
    }));

    ({ handler } = await import('../functions/publish-issue.mjs'));
  });
};

const sampleData = {
  metadata: { number: 42, title: 'Test Issue' },
  content: { sections: [] }
};

const getSentHtml = () => {
  const call = eventBridgeSend.mock.calls.find(([cmd]) => cmd.__type === 'PutEvents');
  expect(call).toBeDefined();
  const detail = JSON.parse(call[0].Entries[0].Detail);
  return detail.html;
};

describe('publish-issue', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  describe('default fallback (no templateId)', () => {
    it('uses the static newsletter template and never reads template/snippets from DynamoDB', async () => {
      const result = await handler({
        data: sampleData,
        subject: 'Subject',
        tenantId: 'tenant-1',
        isPreview: true,
        email: 'preview@example.com',
        sendAtDate: 'now'
      });

      expect(result).toEqual({ success: true });
      // mocked hbs renders the static (mocked) template -> non-empty HTML produced
      expect(getSentHtml()).toBeTruthy();
      // No GetItem/Query for template loading should have occurred
      const templateReads = ddbSend.mock.calls.filter(
        ([cmd]) => cmd.__type === 'GetItem' || cmd.__type === 'Query'
      );
      expect(templateReads).toHaveLength(0);
    });
  });

  describe('render with template (templateId present)', () => {
    it('loads the template and snippets from DynamoDB and renders the content', async () => {
      const templateContent = 'Hello {{metadata.title}} #{{metadata.number}} {{> footer }}';

      ddbSend.mockImplementation(async (cmd) => {
        if (cmd.__type === 'GetItem' && cmd.Key.sk.S === 'template#tmpl-1') {
          return { Item: marshall({ pk: 'tenant-1', sk: 'template#tmpl-1', content: templateContent }) };
        }
        if (cmd.__type === 'Query') {
          return { Items: [marshall({ name: 'footer', content: 'BYE-FOOTER' })] };
        }
        return {};
      });

      const result = await handler({
        data: sampleData,
        subject: 'Subject',
        tenantId: 'tenant-1',
        templateId: 'tmpl-1',
        isPreview: true,
        email: 'preview@example.com',
        sendAtDate: 'now'
      });

      expect(result).toEqual({ success: true });
      const html = getSentHtml();
      expect(html).toContain('Hello Test Issue #42');
      expect(html).toContain('BYE-FOOTER');

      // Confirm it queried for snippets via GSI1 with the tenant-scoped key
      const queryCall = ddbSend.mock.calls.find(([cmd]) => cmd.__type === 'Query');
      expect(queryCall[0].IndexName).toBe('GSI1');
    });
  });

  describe('missing snippet renders empty', () => {
    it('still succeeds and renders the missing partial as an empty string', async () => {
      const templateContent = 'Start[{{> missingSnippet }}]End';

      ddbSend.mockImplementation(async (cmd) => {
        if (cmd.__type === 'GetItem' && cmd.Key.sk.S === 'template#tmpl-2') {
          return { Item: marshall({ pk: 'tenant-1', sk: 'template#tmpl-2', content: templateContent }) };
        }
        if (cmd.__type === 'Query') {
          return { Items: [] };
        }
        return {};
      });

      const result = await handler({
        data: sampleData,
        subject: 'Subject',
        tenantId: 'tenant-1',
        templateId: 'tmpl-2',
        isPreview: true,
        email: 'preview@example.com',
        sendAtDate: 'now'
      });

      expect(result).toEqual({ success: true });
      expect(getSentHtml()).toBe('Start[]End');
    });
  });

  describe('template not found', () => {
    it('falls back to the default template when the templateId does not exist', async () => {
      ddbSend.mockImplementation(async (cmd) => {
        if (cmd.__type === 'GetItem') {
          return {}; // no Item
        }
        return {};
      });

      const result = await handler({
        data: sampleData,
        subject: 'Subject',
        tenantId: 'tenant-1',
        templateId: 'does-not-exist',
        isPreview: true,
        email: 'preview@example.com',
        sendAtDate: 'now'
      });

      expect(result).toEqual({ success: true });
      expect(getSentHtml()).toBeTruthy();
    });
  });
});
