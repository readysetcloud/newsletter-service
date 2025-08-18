import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import fetch from 'node-fetch';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function getAuthToken(username, password, clientId) {
  const command = new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  });

  const response = await client.send(command);
  return response.AuthenticationResult.AccessToken;
}

async function testApiWithToken(apiUrl, token) {
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    console.log('API Response:', data);
    return data;
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

// Example usage
async function main() {
  try {
    const token = await getAuthToken(
      process.env.COGNITO_USERNAME,
      process.env.COGNITO_PASSWORD,
      process.env.COGNITO_CLIENT_ID
    );

    console.log('Generated token:', token);

    // Test with your API
    const apiUrl = process.env.API_URL || 'https://your-api-gateway-url.com/dev/some-endpoint';
    await testApiWithToken(apiUrl, token);

  } catch (error) {
    console.error('Script failed:', error);
  }
}

main();
