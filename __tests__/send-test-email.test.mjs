import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let parseMarkdown;
let publishIssue;

const loadIsolated = async () => {
  parseMarkdown = jest.fn().mockResolvedValue({
    subject: 'Issue #999',
    data: { metadata: { number: 999, title: 'Issue #999' } }
  });
  publishIssue = jest.fn().mockResolvedValue({ success: true });

  jest.unstable_mockModule('../functions/parse-md-to-json.mjs', () => ({ handler: parseMarkdown }));
  jest.unstable_mockModule('../functions/publish-issue.mjs', () => ({ handler: publishIssue }));

  ({ handler } = await import('../functions/send-test-email.mjs'));
};

const validEvent = {
  tenantId: 'tenant-1',
  email: 'me@example.com',
  templateId: 'tmpl-1',
  content: '---\ntitle: A Test\ndate: 2026-06-26\n---\n### A Section\nbody'
};

describe('send-test-email', () => {
  beforeEach(async () => {
    jest.resetModules();
    await loadIsolated();
  });

  it('renders through the real parse -> publish pipeline and reports the preview', async () => {
    const result = await handler(validEvent);

    expect(parseMarkdown).toHaveBeenCalledWith({
      content: validEvent.content,
      issueId: 999,
      tenantId: 'tenant-1'
    });
    expect(publishIssue).toHaveBeenCalledWith(expect.objectContaining({
      isPreview: true,
      email: 'me@example.com',
      tenantId: 'tenant-1',
      templateId: 'tmpl-1'
    }));
    expect(result).toEqual({
      sent: true,
      to: 'me@example.com',
      subject: '[Preview] Issue #999',
      issueId: 999
    });
  });

  describe('required inputs', () => {
    it.each([
      ['tenantId', { ...validEvent, tenantId: undefined }],
      ['email', { ...validEvent, email: undefined }],
      ['templateId', { ...validEvent, templateId: undefined }],
      ['content', { ...validEvent, content: undefined }]
    ])('rejects an event with no %s', async (field, event) => {
      await expect(handler(event)).rejects.toThrow(`${field} is required`);
      expect(publishIssue).not.toHaveBeenCalled();
    });

    // There is no default template left to render against, so a preview with no
    // templateId would fail inside publish-issue — which reports failure as a
    // return value, not a throw. Refusing here says why.
    it('names templateId rather than failing inside the publish', async () => {
      await expect(handler({ ...validEvent, templateId: '' })).rejects.toThrow('templateId is required');
    });
  });

  // The harness used to accept a `fileName` and fetch that path out of the
  // tenant's GitHub content repo — the last caller needing a per-tenant GitHub
  // credential. An event still carrying one has no content, and is refused
  // rather than silently sending an empty issue.
  it('no longer fetches content from a repo path', async () => {
    const { content, ...withoutContent } = validEvent;

    await expect(
      handler({ ...withoutContent, fileName: 'content/newsletter/123.md', branchName: 'main' })
    ).rejects.toThrow('content is required');
    expect(parseMarkdown).not.toHaveBeenCalled();
    expect(publishIssue).not.toHaveBeenCalled();
  });

  // publish-issue returns `{ success: false }` rather than throwing, because the
  // state machine reads it as a Choice. Before this check the harness logged
  // "Sent preview" and returned `sent: true` for an email nobody received.
  it('throws when the publish reports failure instead of claiming it sent', async () => {
    publishIssue.mockResolvedValue({ success: false });

    await expect(handler(validEvent)).rejects.toThrow(/Failed to publish test email/);
  });

  it('throws when the publish returns nothing at all', async () => {
    publishIssue.mockResolvedValue(undefined);

    await expect(handler(validEvent)).rejects.toThrow(/Failed to publish test email/);
  });
});
