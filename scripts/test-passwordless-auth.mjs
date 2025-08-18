import { CognitoIdentityProviderClient, InitiateAuthCommand, RespondToAuthChallengeCommand } from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Test passwordless authentication flow
 * This demonstrates how to initiate passwordless auth with Cognito
 */
async function testPasswordlessAuth(username, clientId) {
  try {
    console.log('🔐 Testing passwordless authentication for:', username);

    // Step 1: Initiate custom auth flow (passwordless)
    const initiateCommand = new InitiateAuthCommand({
      AuthFlow: 'CUSTOM_AUTH',
      ClientId: clientId,
      AuthParameters: {
        USERNAME: username,
      },
    });

    console.log('📧 Initiating passwordless auth...');
    const initiateResponse = await client.send(initiateCommand);

    if (initiateResponse.ChallengeName === 'CUSTOM_CHALLENGE') {
      console.log('✅ Custom challenge initiated successfully');
      console.log('Challenge Parameters:', initiateResponse.ChallengeParameters);

      // In a real implementation, you would:
      // 1. Send a magic link or OTP to the user's email
      // 2. User clicks the link or enters the OTP
      // 3. Respond to the challenge with the verification code

      console.log('📱 Next steps:');
      console.log('1. User will receive a verification code via email');
      console.log('2. Use RespondToAuthChallengeCommand with the code');

      return {
        session: initiateResponse.Session,
        challengeName: initiateResponse.ChallengeName,
        challengeParameters: initiateResponse.ChallengeParameters
      };
    }

    return initiateResponse;
  } catch (error) {
    console.error('❌ Passwordless auth test failed:', error.message);
    throw error;
  }
}

/**
 * Complete the passwordless authentication with verification code
 */
async function completePasswordlessAuth(session, verificationCode, clientId) {
  try {
    const respondCommand = new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: 'CUSTOM_CHALLENGE',
      Session: session,
      ChallengeResponses: {
        ANSWER: verificationCode,
      },
    });

    const response = await client.send(respondCommand);

    if (response.AuthenticationResult) {
      console.log('🎉 Passwordless authentication successful!');
      return {
        accessToken: response.AuthenticationResult.AccessToken,
        idToken: response.AuthenticationResult.IdToken,
        refreshToken: response.AuthenticationResult.RefreshToken,
      };
    }

    return response;
  } catch (error) {
    console.error('❌ Failed to complete passwordless auth:', error.message);
    throw error;
  }
}

/**
 * Test the hosted UI URL for passwordless authentication
 */
function generateHostedUIUrl(userPoolDomain, clientId, redirectUri) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'email openid profile',
    redirect_uri: redirectUri,
  });

  const hostedUIUrl = `https://${userPoolDomain}/login?${params.toString()}`;

  console.log('🌐 Hosted UI URL for passwordless authentication:');
  console.log(hostedUIUrl);
  console.log('\n📝 Users can use this URL to sign in with:');
  console.log('- Email + Password (traditional)');
  console.log('- Passwordless options (if configured)');
  console.log('- MFA options');

  return hostedUIUrl;
}

// Example usage
async function main() {
  const username = process.env.COGNITO_USERNAME || 'user@example.com';
  const clientId = process.env.COGNITO_CLIENT_ID;
  const userPoolDomain = process.env.COGNITO_DOMAIN;
  const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3000';

  if (!clientId) {
    console.error('❌ Please set COGNITO_CLIENT_ID environment variable');
    return;
  }

  try {
    // Test passwordless auth initiation
    const authResult = await testPasswordlessAuth(username, clientId);
    console.log('\n🔄 Auth session created:', authResult.session ? 'Yes' : 'No');

    // Generate hosted UI URL
    if (userPoolDomain) {
      console.log('\n' + '='.repeat(50));
      generateHostedUIUrl(userPoolDomain, clientId, redirectUri);
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎯 Next Steps:');
    console.log('1. Deploy your updated CloudFormation template');
    console.log('2. Configure custom auth triggers for passwordless flow');
    console.log('3. Test with the hosted UI URL above');
    console.log('4. Implement magic link or OTP verification');

  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { testPasswordlessAuth, completePasswordlessAuth, generateHostedUIUrl };
