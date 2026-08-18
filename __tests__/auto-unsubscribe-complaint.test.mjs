import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let unsubscribeUser;
let getTenant;
let getMostRecentPublishedIssue;
let incrementIssueCounter;
let eventBridgeSend;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    unsubscribeUser = jest.fn();
    getTenant = jest.fn().mockResolvedValue({ pk: 'tenant-1', createdBy: 'admin@example.com' });
    getMostRecentPublishedIssue = jest.fn().mockResolvedValue({ pk: 'tenant-1#5', issueNumber: 5 });
    incrementIssueCounter = jest.fn();
    eventBridgeSend = jest.fn().mockResolvedValue({});

    jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
      EventBridgeClient: jest.fn(() => ({ send: eventBridgeSend })),
      PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
    }));

    jest.unstable_mockModule('../functions/utils/subscriber.mjs', () => ({ unsubscribeUser }));
    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({ getTenant }));
    jest.unstable_mockModule('../functions/utils/issue-attribution.mjs', () => ({
      getMostRecentPublishedIssue,
      incrementIssueCounter,
    }));

    ({ handler } = await import('../functions/subscribers/auto-unsubscribe-complaint.mjs'));
  });
}

const complaint = (tags) => ({
  detail: {
    complaint: { complainedRecipients: [{ emailAddress: 'angry@example.com' }] },
    mail: { tags }
  }
});

describe('auto-unsubscribe-complaint', () => {
  beforeEach(async () => {
    jest.resetModules();
    await loadIsolated();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('resolves the tenant from the referenceNumber tag on issue mail', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

    await handler(complaint({ referenceNumber: ['tenant-1_42'] }));

    expect(unsubscribeUser).toHaveBeenCalledWith(
      'tenant-1', 'angry@example.com', 'complaint', expect.any(Object)
    );
  });

  // Welcome mail carries no issue reference, so a "report spam" on one used to
  // resolve to no tenant and be dropped — leaving the complainant subscribed.
  test('resolves the tenant from the tenantId tag when there is no issue', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

    await handler(complaint({ tenantId: ['tenant-1'] }));

    expect(unsubscribeUser).toHaveBeenCalledWith(
      'tenant-1', 'angry@example.com', 'complaint', expect.any(Object)
    );
  });

  test('prefers the tenantId tag when both are present', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

    await handler(complaint({ tenantId: ['tenant-1'], referenceNumber: ['other-tenant_9'] }));

    expect(unsubscribeUser).toHaveBeenCalledWith(
      'tenant-1', 'angry@example.com', 'complaint', expect.any(Object)
    );
  });

  // This is an async invocation: returning normally counts as success and
  // Lambda never retries, so a transient outage would leave someone who hit
  // "report spam" subscribed with nothing to re-drive it.
  test('throws when the removal failed so the platform retries', async () => {
    unsubscribeUser.mockResolvedValue({ success: false, actuallyRemoved: false });

    await expect(handler(complaint({ tenantId: ['tenant-1'] }))).rejects.toThrow(/Failed to auto-unsubscribe/);
    // The operator still hears about it before the throw.
    expect(eventBridgeSend).toHaveBeenCalled();
  });

  test('does nothing when no tenant can be resolved', async () => {
    await handler(complaint({}));

    expect(unsubscribeUser).not.toHaveBeenCalled();
  });
});
