import sendgrid from '@sendgrid/client';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { handler } from '../functions/add-subscriber.mjs';

jest.mock('@sendgrid/client');
jest.mock('@aws-lambda-powertools/parameters/secrets');

describe('Lambda Handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.SECRET_ID = 'test-secret-id';
    process.env.LIST_ID = 'test-list-id';
  });

  test('should handle missing API key', async () => {
    const mockSecret = { openai: 'test-openai-key' };
    getSecret.mockResolvedValue(mockSecret);

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      })
    };

    const response = await handler(event);

    expect(response).toEqual({
      statusCode: 500,
      body: JSON.stringify({ message: 'Something went wrong' }),
      headers: { 'Access-Control-Allow-Origin': 'https://www.readysetcloud.io' }
    });
  });

  test('should add contact successfully', async () => {
    const mockSecret = { sendgrid: 'test-api-key', openai: 'test-openai-key' };
    getSecret.mockResolvedValue(mockSecret);
    sendgrid.request.mockResolvedValue({ statusCode: 200 });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      })
    };

    const response = await handler(event);

    expect(getSecret).toHaveBeenCalledWith(process.env.SECRET_ID, { transform: 'json' });
    expect(sendgrid.setApiKey).toHaveBeenCalledWith('test-api-key');
    expect(sendgrid.request).toHaveBeenCalledWith({
      url: `/v3/marketing/contacts`,
      method: 'PUT',
      body: {
        list_ids: [process.env.LIST_ID],
        contacts: [
          {
            email: 'test@example.com',
            first_name: 'John',
            last_name: 'Doe'
          }
        ]
      }
    });
    expect(response).toEqual({
      statusCode: 201,
      body: JSON.stringify({ message: 'Contact added' }),
      headers: { 'Access-Control-Allow-Origin': 'https://www.readysetcloud.io' }
    });
  });

  test('should handle errors gracefully', async () => {
    const mockSecret = { sendgrid: 'test-api-key' };
    getSecret.mockResolvedValue(mockSecret);
    sendgrid.request.mockRejectedValue(new Error('SendGrid Error'));

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      })
    };

    const response = await handler(event);

    expect(response).toEqual({
      statusCode: 500,
      body: JSON.stringify({ message: 'Something went wrong' }),
      headers: { 'Access-Control-Allow-Origin': 'https://www.readysetcloud.io' }
    });
  });
});
