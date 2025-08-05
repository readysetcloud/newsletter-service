import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserAttributesCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event) => {
  try {
    // Only admins can manage users
    const userContext = await getUserContext(event);
    if (!userContext.isAdmin) {
      return formatAuthError('Admin access required');
    }

    const { action } = event.pathParameters;
    const body = JSON.parse(event.body || '{}');

    switch (action) {
      case 'create':
        return await createUser(body);
      case 'update':
        return await updateUser(body);
      case 'get':
        return await getUser(body.email);
      default:
        return formatResponse(400, 'Invalid action');
    }
  } catch (err) {
    console.error('User management error:', err);
    return formatResponse(500, 'Failed to manage user');
  }
};

const createUser = async ({ email, tenantId, role = 'user', temporaryPassword }) => {
  try {
    // Create user in Cognito
    const createUserCommand = new AdminCreateUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenant_id', Value: tenantId },
        { Name: 'custom:role', Value: role }
      ],
      TemporaryPassword: temporaryPassword,
      MessageAction: 'SEND' // Send welcome email
    });

    const result = await cognito.send(createUserCommand);

    return formatResponse(201, {
      message: 'User created successfully',
      user: {
        email,
        tenantId,
        role,
        status: 'FORCE_CHANGE_PASSWORD'
      }
    });
  } catch (error) {
    if (error.name === 'UsernameExistsException') {
      return formatResponse(409, 'User already exists');
    }
    throw error;
  }
};

const updateUser = async ({ email, tenantId, role }) => {
  try {
    const updateCommand = new AdminUpdateUserAttributesCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: email,
      UserAttributes: [
        ...(tenantId && [{ Name: 'custom:tenant_id', Value: tenantId }]),
        ...(role && [{ Name: 'custom:role', Value: role }])
      ].filter(Boolean)
    });

    await cognito.send(updateCommand);

    return formatResponse(200, {
      message: 'User updated successfully',
      user: { email, tenantId, role }
    });
  } catch (error) {
    if (error.name === 'UserNotFoundException') {
      return formatResponse(404, 'User not found');
    }
    throw error;
  }
};

const getUser = async (email) => {
  try {
    const getUserCommand = new AdminGetUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: email
    });

    const result = await cognito.send(getUserCommand);

    const attributes = result.UserAttributes.reduce((acc, attr) => {
      acc[attr.Name] = attr.Value;
      return acc;
    }, {});

    return formatResponse(200, {
      user: {
        email: attributes.email,
        tenantId: attributes['custom:tenant_id'],
        role: attributes['custom:role'],
        status: result.UserStatus,
        enabled: result.Enabled,
        created: result.UserCreateDate,
        lastModified: result.UserLastModifiedDate
      }
    });
  } catch (error) {
    if (error.name === 'UserNotFoundException') {
      return formatResponse(404, 'User not found');
    }
    throw error;
  }
};
