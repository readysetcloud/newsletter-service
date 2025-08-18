import clipboard from 'clipboardy';
import { config } from 'dotenv';
config();

import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand
} from '@aws-sdk/client-cognito-identity-provider';

const client = new CognitoIdentityProviderClient({ profile: process.env.PROFILE });

async function signIn() {
  const command = new AdminInitiateAuthCommand({
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    ClientId: process.env.COGNITO_CLIENT_ID,
    AuthParameters: {
      USERNAME: process.env.COGNITO_USERNAME,
      PASSWORD: process.env.COGNITO_PASSWORD
    }
  });

  try {
    const response = await client.send(command);

    let token;
    if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      console.log('New password required — responding to challenge...');

      const challengeCommand = new AdminRespondToAuthChallengeCommand({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        ClientId: process.env.COGNITO_CLIENT_ID,
        ChallengeResponses: {
          USERNAME: process.env.COGNITO_USERNAME,
          NEW_PASSWORD: process.env.COGNITO_NEW_PASSWORD,
          "userAttributes.given_name": process.env.GIVEN_NAME,
          "userAttributes.family_name": process.env.FAMILY_NAME
        },

        Session: response.Session
      });

      const challengeResponse = await client.send(challengeCommand);
      console.log('Password updated successfully!');
      token = challengeResponse.AuthenticationResult.AccessToken;
      // console.log(`Bearer ${challengeResponse.AuthenticationResult.IdToken}`);
      // console.log(`Bearer ${challengeResponse.AuthenticationResult.RefreshToken}`);
    } else {
      console.log('Login successful!');
      token = response.AuthenticationResult.AccessToken;
      // console.log(`Bearer ${response.AuthenticationResult.IdToken}`);
      // console.log(`Bearer ${response.AuthenticationResult.RefreshToken}`);
    }
    if(token){
      token = `Bearer ${token}`;
      clipboard.writeSync(token);
      console.log(token);
    } else {
      console.error('Unable to generate token');
    }

  } catch (err) {
    console.error('Login failed:', err.message);
    console.error(err);
  }
}

signIn();
