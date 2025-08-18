import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event) => {
  try {
    // Get user context from Lambda authorizer
    const userContext = getUserContext(event);
    const { email } = userContext;

    // Parse request body
    const body = JSON.parse(event.body || '{}');

    const profileData = extractProfileData(body);
    if(!Object.keys(profileData).length){
      return formatResponse(400, 'At least one field must be provided for an update');
    }

    // Update personal information in Cognito
    const updatedProfile = await updatePersonalInfo(email, profileData);

    return formatResponse(200, {
      message: 'Profile updated successfully',
      profile: updatedProfile
    });

  } catch (error) {
    console.error('Update profile error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }



    if (error.name === 'UserNotFoundException') {
      return formatResponse(404, 'User not found');
    }

    return formatResponse(500, 'Failed to update profile');
  }
};

const extractProfileData = (body) => {
  const { firstName, lastName, timezone, locale, links } = body;
  const profileData = {};

  if (firstName !== undefined) profileData.firstName = firstName;
  if (lastName !== undefined) profileData.lastName = lastName;
  if (timezone !== undefined) profileData.timezone = timezone;
  if (locale !== undefined) profileData.locale = locale;
  if (links !== undefined) profileData.links = links;

  return profileData;
};

const updatePersonalInfo = async (email, profileData) => {
  const userAttributes = [];
  if (profileData.firstName) {
    userAttributes.push({ Name: 'given_name', Value: profileData.firstName });
  }

  if (profileData.lastName) {
    userAttributes.push({ Name: 'family_name', Value: profileData.lastName });
  }

  if (profileData.timezone) {
    userAttributes.push({ Name: 'zoneinfo', Value: profileData.timezone });
  }

  if (profileData.locale) {
    userAttributes.push({ Name: 'locale', Value: profileData.locale });
  }

  if (profileData.links) {
    userAttributes.push({ Name: 'custom:profile_links', Value: JSON.stringify(profileData.links) });
  }

  const updatedAt = new Date().toISOString();
  userAttributes.push({
    Name: 'custom:profile_updated_at',
    Value: updatedAt
  });
  await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: process.env.USER_POOL_ID,
    Username: email,
    UserAttributes: userAttributes
  }));
  return {
    firstName: profileData.firstName || null,
    lastName: profileData.lastName || null,
    timezone: profileData.timezone || null,
    locale: profileData.locale || null,
    links: profileData.links || null,
    updatedAt
  };
};
