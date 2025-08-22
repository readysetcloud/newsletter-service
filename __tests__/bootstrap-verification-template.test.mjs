// __tests__/bootstrap-verification-template.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let sesInstance;
let CreateCustomVerificationEmailTemplateCommand;
let UpdateCustomVerificationEmailTemplateCommand;
let GetCustomVerificationEmailTemplateCommand;
let mockFetch;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // SES client mock
    sesInstance = { send: jest.fn() };

    // SES SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => sesInstance),
      CreateCustomVerificationEmailTemplateCommand: jest.fn((params) => ({ __type: 'CreateCustomVerificationEmailTemplate', ...params })),
      UpdateCustomVerificationEmailTemplateCommand: jest.fn((params) => ({ __type: 'UpdateCustomVerificationEmailTemplate', ...params })),
      GetCustomVerificationEmailTemplateCommand: jest.fn((params) => ({ __type: 'GetCustomVerificationEmailTemplate', ...params })),
    }));

    // Mock global fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Import after mocks
    ({ handler } = await import('../functions/senders/bootstrap-verification-template.mjs'));
    ({
      CreateCustomVerificationEmailTemplateCommand,
      UpdateCustomVerificationEmailTemplateCommand,
      GetCustomVerificationEmailTemplateCommand
    } = await import('@aws-sdk/client-sesv2'));
  });

  return {
    handler,
    sesInstance,
    CreateCustomVerificationEmailTemplateCommand,
    UpdateCustomVerificationEmailTemplateCommand,
    GetCustomVerificationEmailTemplateCommand,
    mockFetch
  };
}

describe('bootstrap-verification-template handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.SES_VERIFY_TEMPLATE_NAME = 'test-template';
    process.env.SYSTEM_FROM_EMAIL = 'noreply@example.com';
    process.env.VERIFY_SUCCESS_URL = 'https://example.com/success';
    process.env.VERIFY_FAILURE_URL = 'https://example.com/failure';
    await loadIsolated();
  });

  test('creates new template when it does not exist', async () => {
    // Mock template does not exist
    sesInstance.send
      .mockRejectedValueOnce(Object.assign(new Error('Template not found'), { name: 'NotFoundException' }))
      .mockResolvedValueOnce({}); // Create template success

    mockFetch.mockResolvedValue({ status: 200 });

    const event = {
      RequestType: 'Create',
      ResponseURL: 'https://cloudformation-response-url.com',
      StackId: 'test-stack-id',
      RequestId: 'test-request-id',
      LogicalResourceId: 'test-resource-id'
    };

    const context = {
      logStreamName: 'test-log-stream'
    };

    await handler(event, context);

    // Verify GetCustomVerificationEmailTemplate was called first
    expect(sesInstance.send).toHaveBeenCalledTimes(2);

    const getCall = sesInstance.send.mock.calls[0][0];
    expect(getCall.__type).toBe('GetCustomVerificationEmailTemplate');
    expect(getCall.TemplateName).toBe('test-template');

    // Verify CreateCustomVerificationEmailTemplate was called
    const createCall = sesInstance.send.mock.calls[1][0];
    expect(createCall.__type).toBe('CreateCustomVerificationEmailTemplate');
    expect(createCall.TemplateName).toBe('test-template');
    expect(createCall.FromEmailAddress).toBe('noreply@example.com');
    expect(createCall.TemplateSubject).toBe('Verify your sender email address');
    expect(createCall.SuccessRedirectionURL).toBe('https://example.com/success');
    expect(createCall.FailureRedirectionURL).toBe('https://example.com/failure');
    expect(createCall.TemplateContent).toContain('{{EmailAddress}}');
    expect(createCall.TemplateContent).toContain('{{VerificationLink}}');

    // Verify success response was sent
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudformation-response-url.com',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"Status":"SUCCESS"')
      })
    );
  });

  test('updates existing template when it exists', async () => {
    // Mock template exists
    sesInstance.send
      .mockResolvedValueOnce({}) // Get template success
      .mockResolvedValueOnce({}); // Update template success

    mockFetch.mockResolvedValue({ status: 200 });

    const event = {
      RequestType: 'Update',
      ResponseURL: 'https://cloudformation-response-url.com',
      StackId: 'test-stack-id',
      RequestId: 'test-request-id',
      LogicalResourceId: 'test-resource-id'
    };

    const context = {
      logStreamName: 'test-log-stream'
    };

    await handler(event, context);

    // Verify UpdateCustomVerificationEmailTemplate was called
    expect(sesInstance.send).toHaveBeenCalledTimes(2);

    const updateCall = sesInstance.send.mock.calls[1][0];
    expect(updateCall.__type).toBe('UpdateCustomVerificationEmailTemplate');
    expect(updateCall.TemplateName).toBe('test-template');
    expect(updateCall.FromEmailAddress).toBe('noreply@example.com');

    // Verify success response was sent
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudformation-response-url.com',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"Status":"SUCCESS"')
      })
    );
  });

  test('handles delete event gracefully', async () => {
    mockFetch.mockResolvedValue({ status: 200 });

    const event = {
      RequestType: 'Delete',
      ResponseURL: 'https://cloudformation-response-url.com',
      StackId: 'test-stack-id',
      RequestId: 'test-request-id',
      LogicalResourceId: 'test-resource-id',
      PhysicalResourceId: 'test-physical-id'
    };

    const context = {
      logStreamName: 'test-log-stream'
    };

    await handler(event, context);

    // Should not call SES for delete
    expect(sesInstance.send).not.toHaveBeenCalled();

    // Verify success response was sent
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudformation-response-url.com',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"Status":"SUCCESS"')
      })
    );
  });

  test('handles missing environment variables', async () => {
    delete process.env.SES_VERIFY_TEMPLATE_NAME;

    mockFetch.mockResolvedValue({ status: 200 });

    const event = {
      RequestType: 'Create',
      ResponseURL: 'https://cloudformation-response-url.com',
      StackId: 'test-stack-id',
      RequestId: 'test-request-id',
      LogicalResourceId: 'test-resource-id'
    };

    const context = {
      logStreamName: 'test-log-stream'
    };

    await handler(event, context);

    // Should not call SES
    expect(sesInstance.send).not.toHaveBeenCalled();

    // Verify failure response was sent
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudformation-response-url.com',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"Status":"FAILED"')
      })
    );
  });

  test('handles SES errors', async () => {
    // Mock SES error
    sesInstance.send.mockRejectedValue(new Error('SES service error'));

    mockFetch.mockResolvedValue({ status: 200 });

    const event = {
      RequestType: 'Create',
      ResponseURL: 'https://cloudformation-response-url.com',
      StackId: 'test-stack-id',
      RequestId: 'test-request-id',
      LogicalResourceId: 'test-resource-id'
    };

    const context = {
      logStreamName: 'test-log-stream'
    };

    await handler(event, context);

    // Verify failure response was sent
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudformation-response-url.com',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"Status":"FAILED"')
      })
    );
  });

  test('generates valid HTML template content', async () => {
    // Mock template does not exist
    sesInstance.send
      .mockRejectedValueOnce(Object.assign(new Error('Template not found'), { name: 'NotFoundException' }))
      .mockResolvedValueOnce({});

    mockFetch.mockResolvedValue({ status: 200 });

    const event = {
      RequestType: 'Create',
      ResponseURL: 'https://cloudformation-response-url.com',
      StackId: 'test-stack-id',
      RequestId: 'test-request-id',
      LogicalResourceId: 'test-resource-id'
    };

    const context = {
      logStreamName: 'test-log-stream'
    };

    await handler(event, context);

    const createCall = sesInstance.send.mock.calls[1][0];
    const templateContent = createCall.TemplateContent;

    // Verify template contains required elements
    expect(templateContent).toContain('<!DOCTYPE html');
    expect(templateContent).toContain('{{EmailAddress}}');
    expect(templateContent).toContain('{{VerificationLink}}');
    expect(templateContent).toContain('Verify Your Sender Email');
    expect(templateContent).toContain('Newsletter Service');
    expect(templateContent).toContain('verification-button');
  });
});
