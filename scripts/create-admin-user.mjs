#!/usr/bin/env node

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient();

async function createAdminUser() {
  const userPoolId = process.env.USER_POOL_ID;
  const email = process.env.ADMIN_EMAIL;
  const tenantId = process.env.TENANT_ID || 'readysetcloud';
  const temporaryPassword = process.env.TEMP_PASSWORD || 'TempPass123!';

  if (!userPoolId || !email) {
    console.error('Missing required environment variables:');
    console.error('USER_POOL_ID - Your Cognito User Pool ID');
    console.error('ADMIN_EMAIL - Email address for the admin user');
    console.error('TENANT_ID - Tenant ID (optional, defaults to "readysetcloud")');
    console.error('TEMP_PASSWORD - Temporary password (optional, defaults to "TempPass123!")');
    process.exit(1);
  }

  try {
    console.log(`Creating admin user: ${email}`);
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`User Pool ID: ${userPoolId}`);

    const command = new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenant_id', Value: tenantId },
        { Name: 'custom:role', Value: 'admin' }
      ],
      TemporaryPassword: temporaryPassword,
      MessageAction: 'SEND'
    });

    const result = await cognito.send(command);

    console.log('✅ Admin user created successfully!');
    console.log(`📧 Welcome email sent to: ${email}`);
    console.log(`🔑 Temporary password: ${temporaryPassword}`);
    console.log('🔄 User will be prompted to change password on first login');
    console.log(`👤 User Status: ${result.User.UserStatus}`);

  } catch (error) {
    if (error.name === 'UsernameExistsException') {
      console.error('❌ User already exists');
    } else {
      console.error('❌ Error creating user:', error.message);
    }
    process.exit(1);
  }
}

createAdminUser();
