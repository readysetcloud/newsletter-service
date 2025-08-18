// auth/add-user-to-group.mjs
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event) => {
  const { userPoolId, username, groupName } = event.detail;

  try {
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: groupName
    }));

    console.log(`Added user ${username} to group ${groupName}`);
  } catch (error) {
    console.error(`Failed to add user to group:`, error);
    throw error;
  }
};
