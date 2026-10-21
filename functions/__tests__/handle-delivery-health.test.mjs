import { jest, test, expect, beforeEach } from '@jest/globals';
const record = jest.fn();
jest.unstable_mockModule('../utils/delivery-health.mjs', () => ({ recordDeliveryOutcome: record }));
const { handler } = await import('../subscribers/handle-delivery-health.mjs');
const event = () => ({ detail: { eventType: 'Bounce', mail: {
  messageId: 'ses-message', timestamp: '2026-10-19T12:00:00.000Z',
  tags: { tenantId: ['tenant_with_underscores'] }, destination: ['success@example.com', 'bad@example.com']
}, bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'Bad@Example.com' }] } } });
beforeEach(() => { jest.clearAllMocks(); record.mockResolvedValue({}); });
test('welcome bounces use the marketing tenant tag without an issue reference', async () => {
  await handler(event());
  expect(record).toHaveBeenCalledWith('tenant_with_underscores', 'bad@example.com', expect.objectContaining({ kind: 'permanent', id: 'ses-message' }));
  expect(record).toHaveBeenCalledTimes(1);
});
test('only bouncedRecipients are affected, including all addresses in the event', async () => {
  const input = event();
  input.detail.bounce.bouncedRecipients.push({ emailAddress: 'other@example.com' });
  await handler(input);
  expect(record.mock.calls.map(call => call[1])).toEqual(['bad@example.com', 'other@example.com']);
});
test('legacy issue references preserve underscore-containing tenant IDs', async () => {
  const input = event(); input.detail.mail.tags = { referenceNumber: ['my_tenant_238'] };
  await handler(input);
  expect(record.mock.calls[0][0]).toBe('my_tenant');
});
test('administrative mail and message rejections cannot remove subscribers', async () => {
  const input = event(); input.detail.mail.tags = {};
  await handler(input);
  input.detail.mail.tags = { tenantId: ['tenant'] }; input.detail.eventType = 'Reject';
  await handler(input);
  expect(record).not.toHaveBeenCalled();
});
test('delivery records reset outcomes using send time, not callback arrival time', async () => {
  const input = event(); input.detail.eventType = 'Delivery'; input.detail.delivery = { recipients: ['success@example.com'] };
  await handler(input);
  expect(record).toHaveBeenCalledWith('tenant_with_underscores', 'success@example.com', expect.objectContaining({ kind: 'delivery', sentAt: input.detail.mail.timestamp }));
});
test('processing failures throw for platform retry and dead lettering', async () => {
  record.mockRejectedValue(new Error('write unavailable'));
  await expect(handler(event())).rejects.toThrow('write unavailable');
});
test('a malformed recipient list is retried, never replaced with unaffected destinations', async () => {
  const input = event(); delete input.detail.bounce.bouncedRecipients;
  await expect(handler(input)).rejects.toThrow('affected recipients');
  expect(record).not.toHaveBeenCalled();
});
