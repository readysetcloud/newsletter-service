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

  describe('html master (pre-rendered, bring-your-own-renderer)', () => {
    it('sends the master verbatim and never renders a template', async () => {
      const master = '<html><body>MY PRE-RENDERED NEWSLETTER __EMAIL_HASH__</body></html>';
      const result = await handler({
        data: { metadata: { number: 42 }, __master: master },
        subject: 'Subject',
        tenantId: 'tenant-1',
        templateId: 'tmpl-should-be-ignored',
        isPreview: true,
        email: 'preview@example.com',
        sendAtDate: 'now'
      });

      expect(result).toEqual({ success: true });
      // Master is sent as-is, not run through any template...
      expect(getSentHtml()).toBe(master);
      // ...and no template/snippet reads happen, even though a templateId was supplied.
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

  describe('missing partial referenced inside a snippet body', () => {
    it('registers the nested missing partial as empty and still succeeds', async () => {
      // Top-level template references the `header` snippet, whose body in turn
      // references a partial that does not exist. The scan must cover snippet
      // bodies (not just the template) so the send does not throw.
      const templateContent = 'A{{> header }}B';

      ddbSend.mockImplementation(async (cmd) => {
        if (cmd.__type === 'GetItem' && cmd.Key.sk.S === 'template#tmpl-3') {
          return { Item: marshall({ pk: 'tenant-1', sk: 'template#tmpl-3', content: templateContent }) };
        }
        if (cmd.__type === 'Query') {
          return { Items: [marshall({ name: 'header', content: 'H[{{> missingFooter }}]' })] };
        }
        return {};
      });

      const result = await handler({
        data: sampleData,
        subject: 'Subject',
        tenantId: 'tenant-1',
        templateId: 'tmpl-3',
        isPreview: true,
        email: 'preview@example.com',
        sendAtDate: 'now'
      });

      expect(result).toEqual({ success: true });
      expect(getSentHtml()).toBe('AH[]B');
    });
  });

  describe('no-escape rendering (parity with preview)', () => {
    it('renders HTML fields raw in both template and snippet output', async () => {
      // The preview renderer registers handlebars::no_escape; the send must match
      // so authored HTML is not escaped (and previews equal delivered emails).
      const templateContent = 'T:{{html}}|{{> raw }}';

      ddbSend.mockImplementation(async (cmd) => {
        if (cmd.__type === 'GetItem' && cmd.Key.sk.S === 'template#tmpl-4') {
          return { Item: marshall({ pk: 'tenant-1', sk: 'template#tmpl-4', content: templateContent }) };
        }
        if (cmd.__type === 'Query') {
          return { Items: [marshall({ name: 'raw', content: 'S:{{html}}' })] };
        }
        return {};
      });

      const result = await handler({
        data: { ...sampleData, html: '<p>hi & bye</p>' },
        subject: 'Subject',
        tenantId: 'tenant-1',
        templateId: 'tmpl-4',
        isPreview: true,
        email: 'preview@example.com',
        sendAtDate: 'now'
      });

      expect(result).toEqual({ success: true });
      expect(getSentHtml()).toBe('T:<p>hi & bye</p>|S:<p>hi & bye</p>');
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

  describe('send config (contentAssembly)', () => {
    const getSentDetail = () => {
      const call = eventBridgeSend.mock.calls.find(([cmd]) => cmd.__type === 'PutEvents');
      expect(call).toBeDefined();
      return JSON.parse(call[0].Entries[0].Detail);
    };

    // Reads of the issue record (sk 'newsletter') return the given attributes;
    // every other DynamoDB call resolves empty.
    const mockIssueRecord = (attributes) => {
      ddbSend.mockImplementation(async (cmd) => {
        if (cmd.__type === 'GetItem' && cmd.Key?.sk?.S === 'newsletter') {
          return { Item: marshall(attributes) };
        }
        return {};
      });
    };

    const publishEvent = {
      data: sampleData,
      subject: 'Subject',
      tenantId: 'tenant-1',
      sendAtDate: 'now'
    };

    it('passes contentAssembly on the send event when enabled on the issue record', async () => {
      mockIssueRecord({ contentAssembly: JSON.stringify({ enabled: true }) });

      const result = await handler(publishEvent);

      expect(result).toEqual({ success: true });
      const detail = getSentDetail();
      expect(detail.contentAssembly).toEqual({ enabled: true });
      expect(detail.abTest).toBeUndefined();
      // The config read projects both send configs in one call.
      const configReads = ddbSend.mock.calls.filter(
        ([cmd]) => cmd.__type === 'GetItem' && cmd.ProjectionExpression === 'abTest, localSend, contentAssembly'
      );
      expect(configReads).toHaveLength(1);
    });

    it('omits contentAssembly when the issue record has none (or it is disabled)', async () => {
      mockIssueRecord({ contentAssembly: JSON.stringify({ enabled: false }) });

      await handler(publishEvent);

      expect(getSentDetail().contentAssembly).toBeUndefined();
    });

    it('passes localSend on the send event when enabled on the issue record', async () => {
      // Regression: a merge once dropped localSend from the serialized event
      // detail while the handler still computed it, silently turning every
      // local send into a single absolute-time send.
      mockIssueRecord({
        localSend: JSON.stringify({ enabled: true, defaultTimeZone: 'America/New_York', mode: 'timezone' })
      });

      await handler(publishEvent);

      expect(getSentDetail().localSend).toEqual({
        enabled: true,
        defaultTimeZone: 'America/New_York',
        mode: 'timezone'
      });
    });

    it('drops localSend (with a warning) when an A/B test is active', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockIssueRecord({
        localSend: JSON.stringify({ enabled: true, defaultTimeZone: 'America/New_York' }),
        abTest: JSON.stringify({
          dimension: 'subject',
          variants: [
            { variantId: 'a', subject: 'A' },
            { variantId: 'b', subject: 'B' }
          ]
        })
      });

      await handler(publishEvent);

      const detail = getSentDetail();
      expect(detail.abTest).toBeDefined();
      expect(detail.localSend).toBeUndefined();
      warnSpy.mockRestore();
    });

    it('carries localSend and contentAssembly together when both are enabled', async () => {
      mockIssueRecord({
        localSend: JSON.stringify({ enabled: true, defaultTimeZone: 'America/New_York', mode: 'peak-hour' }),
        contentAssembly: JSON.stringify({ enabled: true })
      });

      await handler(publishEvent);

      const detail = getSentDetail();
      expect(detail.localSend).toMatchObject({ enabled: true, mode: 'peak-hour' });
      expect(detail.contentAssembly).toEqual({ enabled: true });
    });

    it('warns and disables assembly when an A/B test is active', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockIssueRecord({
        contentAssembly: JSON.stringify({ enabled: true }),
        abTest: JSON.stringify({
          dimension: 'subject',
          variants: [
            { variantId: 'a', subject: 'A' },
            { variantId: 'b', subject: 'B' }
          ]
        })
      });

      await handler(publishEvent);

      const detail = getSentDetail();
      expect(detail.abTest).toBeDefined();
      expect(detail.contentAssembly).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[ASSEMBLY]'));
      warnSpy.mockRestore();
    });

    it('fails open (no contentAssembly on the event) when the config read throws', async () => {
      ddbSend.mockImplementation(async (cmd) => {
        if (cmd.__type === 'GetItem' && cmd.Key?.sk?.S === 'newsletter') {
          throw new Error('DynamoDB unavailable');
        }
        return {};
      });

      const result = await handler(publishEvent);

      expect(result).toEqual({ success: true });
      expect(getSentDetail().contentAssembly).toBeUndefined();
    });
  });
});
