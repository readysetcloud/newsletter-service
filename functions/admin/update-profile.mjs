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

    // Validate and extract personal profile data
    const profileData = validateAndExtractProfileData(body);

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

    if (error.message.startsWith('Validation error:')) {
      return formatResponse(400, error.message);
    }

    if (error.name === 'UserNotFoundException') {
      return formatResponse(404, 'User not found');
    }

    return formatResponse(500, 'Failed to update profile');
  }
};

const validateAndExtractProfileData = (body) => {
  const { firstName, lastName, jobTitle, phoneNumber, timezone, locale, links } = body;

  const hasData = firstName || lastName || jobTitle || phoneNumber || timezone || locale || links;

  if (!hasData) {
    throw new Error('Validation error: At least one profile field must be provided');
  }

  const profileData = {};

  if (firstName !== undefined) {
    if (typeof firstName !== 'string' || firstName.length > 50) {
      throw new Error('Validation error: firstName must be a string with max 50 characters');
    }
    profileData.firstName = firstName.trim();
  }

  if (lastName !== undefined) {
    if (typeof lastName !== 'string' || lastName.length > 50) {
      throw new Error('Validation error: lastName must be a string with max 50 characters');
    }
    profileData.lastName = lastName.trim();
  }

  if (jobTitle !== undefined) {
    if (typeof jobTitle !== 'string' || jobTitle.length > 100) {
      throw new Error('Validation error: jobTitle must be a string with max 100 characters');
    }
    profileData.jobTitle = jobTitle.trim();
  }

  if (phoneNumber !== undefined) {
    if (typeof phoneNumber !== 'string' || phoneNumber.length > 20) {
      throw new Error('Validation error: phoneNumber must be a string with max 20 characters');
    }
    if (!/^[\d\s\-\(\)\+]+$/.test(phoneNumber)) {
      throw new Error('Validation error: phoneNumber contains invalid characters');
    }
    profileData.phoneNumber = phoneNumber.trim();
  }

  if (timezone !== undefined) {
    if (typeof timezone !== 'string' || timezone.length > 50) {
      throw new Error('Validation error: timezone must be a string with max 50 characters');
    }
    profileData.timezone = timezone.trim();
  }

  if (locale !== undefined) {
    if (typeof locale !== 'string' || locale.length > 10) {
      throw new Error('Validation error: locale must be a string with max 10 characters');
    }
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      throw new Error('Validation error: locale must be in format "en" or "en-US"');
    }
    profileData.locale = locale;
  }

  if (links !== undefined) {
    if (!Array.isArray(links)) {
      throw new Error('Validation error: links must be an array');
    }
    if (links.length > 10) {
      throw new Error('Validation error: links array cannot have more than 10 items');
    }
    for (const link of links) {
      if (!link || typeof link !== 'object') {
        throw new Error('Validation error: each link must be an object');
      }
      if (!link.name || typeof link.name !== 'string' || link.name.length > 100) {
        throw new Error('Validation error: each link must have a name (string, max 100 characters)');
      }
      if (!link.url || typeof link.url !== 'string' || link.url.length > 500) {
        throw new Error('Validation error: each link must have a url (string, max 500 characters)');
      }
      // Basic URL validation
      if (!/^https?:\/\/.+/.test(link.url)) {
        throw new Error('Validation error: each link url must be a valid HTTP/HTTPS URL');
      }
    }
    profileData.links = links.map(link => ({
      name: link.name.trim(),
      url: link.url.trim()
    }));
  }

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

  if (profileData.jobTitle) {
    userAttributes.push({ Name: 'custom:job_title', Value: profileData.jobTitle });
  }

  if (profileData.phoneNumber) {
    userAttributes.push({ Name: 'phone_number', Value: profileData.phoneNumber });
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
    jobTitle: profileData.jobTitle || null,
    phoneNumber: profileData.phoneNumber || null,
    timezone: profileData.timezone || null,
    locale: profileData.locale || null,
    links: profileData.links || null,
    updatedAt
  };
};
