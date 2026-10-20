import { jest, beforeEach, test, expect } from '@jest/globals';
const invoke = jest.fn();
const modelConstructor = jest.fn();
jest.unstable_mockModule('@strands-agents/sdk', () => ({
  Agent: jest.fn(() => ({ invoke })),
  BedrockModel: modelConstructor
}));
const { decideSubscriber } = await import('../utils/screening-decider.mjs');
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SCREENING_MODEL_ID;
  invoke.mockResolvedValue({ structuredOutput: { action: 'watch', confidence: 0.7 } });
});
test('uses pay-per-use Nova Micro and bounded structured output', async () => {
  const evidence = { reasons: ['fastSubmission'], domainStatus: 'valid' };
  expect(await decideSubscriber(evidence)).toEqual({ action: 'watch', confidence: 0.7, model: 'us.amazon.nova-micro-v1:0' });
  expect(modelConstructor).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'us.amazon.nova-micro-v1:0', maxTokens: 400, stream: false }));
  expect(invoke.mock.calls[0][0]).toBe(JSON.stringify(evidence));
  expect(invoke.mock.calls[0][1]).toMatchObject({ limits: { turns: 3, totalTokens: 2500 } });
});
test('supports a configured Bedrock model', async () => {
  process.env.SCREENING_MODEL_ID = 'other-model';
  expect((await decideSubscriber({})).model).toBe('other-model');
});
test.each([undefined, { action: 'delete', confidence: 1 }, { action: 'reject', confidence: 2 }])('rejects malformed model output: %j', async output => {
  invoke.mockResolvedValue({ structuredOutput: output });
  await expect(decideSubscriber({})).rejects.toThrow();
});
test('propagates model errors for the screening policy fallback', async () => {
  invoke.mockRejectedValue(new Error('unavailable'));
  await expect(decideSubscriber({})).rejects.toThrow('unavailable');
});
