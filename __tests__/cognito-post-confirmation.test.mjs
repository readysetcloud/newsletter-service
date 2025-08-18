// cognito-post-confirmation.test.mjs
import { jest } from '@jest/globals';

// One shared mock for the AWS client's send()
const mockSend = jest.fn();

// Mock EventBridge client + command
jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
}));

// Import AFTER mocks
const { handler } = await import('../functions/auth/cognito-post-confirmation.mjs');

describe('Cognito Post Confirmation Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes a PutEvents entry to EventBridge and returns the event', async () => {
    const event = {
      triggerSource: 'PostConfirmation_ConfirmSignUp',
      userPoolId: 'us-east-1_abc',
      userName: 'user-123',
      request: {
        userAttributes: {
          email: 'test@example.com',
          given_name: 'John',
          family_name: 'Doe'
        }
      }
    };

    mockSend.mockResolvedValueOnce({ // minimal success stub
      FailedEntryCount: 0,
      Entries: [{ EventId: 'evt-1' }]
    });

    const result = await handler(event);

    // Assert PutEvents was called with expected payload
    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArg = mockSend.mock.calls[0][0]; // the PutEventsCommand instance (we returned an object)
    expect(callArg.__type).toBe('PutEvents');
    expect(callArg.Entries).toHaveLength(1);

    const entry = callArg.Entries[0];
    expect(entry.Source).toBe('newsletter-service');
    expect(entry.DetailType).toBe('Add User to Group');

    // Detail payload checks
    const detail = JSON.parse(entry.Detail);
    expect(detail).toEqual({
      userPoolId: 'us-east-1_abc',
      username: 'user-123',
      userAttributes: {
        email: 'test@example.com',
        given_name: 'John',
        family_name: 'Doe'
      },
      groupName: 'free-tier'
    });

    // Handler returns original event on success
    expect(result).toBe(event);
  });

  it('bubbles EventBridge failures (throws)', async () => {
    const event = {
      userPoolId: 'us-east-1_abc',
      userName: 'user-123',
      request: { userAttributes: { email: 'x@y.com' } }
    };

    mockSend.mockRejectedValueOnce(new Error('EventBridge down'));

    await expect(handler(event)).rejects.toThrow('EventBridge down');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('still sends even with minimal/missing attributes (and returns the event)', async () => {
    const event = {
      userPoolId: 'us-east-1_abc',
      userName: 'user-123',
      request: { userAttributes: {} } // minimal shape
    };

    mockSend.mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-2' }] });

    const result = await handler(event);
    expect(result).toBe(event);

    const entry = mockSend.mock.calls[0][0].Entries[0];
    const detail = JSON.parse(entry.Detail);

    // Still carries the required scaffolding
    expect(detail).toMatchObject({
      userPoolId: 'us-east-1_abc',
      username: 'user-123',
      groupName: 'free-tier'
    });
    // userAttributes is an empty object here, which is OK
    expect(detail.userAttributes).toEqual({});
  });
});
