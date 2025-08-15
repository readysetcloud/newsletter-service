import { CognitoIdentityProviderClient, AdminGetUserCommand, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';

const cognito = new CognitoIdentityProviderClient();
const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { userId, email: currentUserEmail, tenantId } = userContext;

    const requestedUsername = event.pathParameters?.username;
    const isOwnProfile = !requestedUsername;

    let targetEmail;
    if (isOwnProfile) {
      targetEmail = currentUserEmail;
    } else {
      targetEmail = await findUserEmailByUsername(requestedUsername);
      if (!targetEmail) {
        return formatResponse(404, 'User not found');
      }
    }

    const userResult = await cognito.send(new AdminGetUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: targetEmail
    }));

    const attributes = userResult.UserAttributes.reduce((acc, attr) => {
      acc[attr.Name] = attr.Value;
      return acc;
    }, {});

    const profile = isOwnProfile
      ? await buildOwnProfile(userId, attributes, userResult, tenantId)
      : await buildPublicProfile(attributes);

    return formatResponse(200, profile);

  } catch (error) {
    console.error('Get profile error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'UserNotFoundException') {
      return formatResponse(404, 'User not found');
    }

    return formatResponse(500, 'Failed to retrieve profile');
  }
};

const findUserEmailByUsername = async (username) => {
  try {
    const listUsersResult = await cognito.send(new ListUsersCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Filter: `username = "${username}"`,
      Limit: 1
    }));

    if (listUsersResult.Users && listUsersResult.Users.length > 0) {
      const user = listUsersResult.Users[0];
      const emailAttr = user.Attributes.find(attr => attr.Name === 'email');
      return emailAttr ? emailAttr.Value : null;
    }

    return null;
  } catch (error) {
    console.error('Error finding user by username:', error);
    return null;
  }
};

const buildOwnProfile = async (userId, attributes, userResult, tenantId) => {
  let brandData = {};
  if (tenantId) {
    try {
      const tenantResult = await ddb.send(new GetItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: tenantId,
          sk: 'tenant'
        })
      }));

      if (tenantResult.Item) {
        const tenant = unmarshall(tenantResult.Item);
        brandData = {
          brandId: tenantId,
          brandName: tenant.brandName || null,
          website: tenant.website || null,
          industry: tenant.industry || null,
          brandDescription: tenant.brandDescription || null,
          brandLogo: tenant.brandLogo || null,
          tags: tenant.tags || null,
          lastUpdated: tenant.updatedAt || null,
        };
      } else if (tenantId) {
        // User has tenantId but no tenant record exists
        brandData = { brandId: tenantId };
      }
    } catch (error) {
      console.error('Error fetching tenant data:', error);
      // Fallback to just the brandId if tenant fetch fails
      brandData = tenantId ? { brandId: tenantId } : {};
    }
  }

  return {
    userId,
    ...(attributes.email && { email: attributes.email }),
    brand: brandData,
    profile: {
      ...(attributes.given_name && { firstName: attributes.given_name }),
      ...(attributes.family_name && { lastName: attributes.family_name }),
      ...(parseLinksArray(attributes['custom:profile_links']) && { links: parseLinksArray(attributes['custom:profile_links']) }),
      ...(attributes['custom:profile_updated_at'] && { lastUpdated: attributes['custom:profile_updated_at'] }),
    },
    preferences: {
      ...(attributes.zoneinfo && { timezone: attributes.zoneinfo }),
      ...(attributes.locale && { locale: attributes.locale })
    },
    lastModified: userResult.UserLastModifiedDate,
  };
};


const buildPublicProfile = async (attributes) => {
  // Get brand data from DynamoDB if user has a tenantId
  let brandData = {};
  const tenantId = attributes['custom:tenant_id'];

  if (tenantId) {
    try {
      const tenantResult = await ddb.send(new GetItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: tenantId,
          sk: 'tenant'
        })
      }));

      if (tenantResult.Item) {
        const tenant = unmarshall(tenantResult.Item);
        brandData = {
          brandId: tenantId,
          brandName: tenant.brandName || null,
          website: tenant.website || null,
          industry: tenant.industry || null,
          brandDescription: tenant.brandDescription || null,
          brandLogo: tenant.brandLogo || null,
          tags: tenant.tags || null,
        };
      } else if (tenantId) {
        // User has tenantId but no tenant record exists
        brandData = { brandId: tenantId };
      }
    } catch (error) {
      console.error('Error fetching tenant data for public profile:', error);
      // Fallback to just the brandId if tenant fetch fails
      brandData = tenantId ? { brandId: tenantId } : {};
    }
  }

  return {
    brand: brandData,
    ...(attributes.given_name && { firstName: attributes.given_name }),
    ...(attributes.family_name && { lastName: attributes.family_name }),
    ...(parseLinksArray(attributes['custom:profile_links']) && { links: parseLinksArray(attributes['custom:profile_links']) })
  };
};


const parseTagsArray = (tagsString) => {
  if (!tagsString) return null;

  try {
    const tags = JSON.parse(tagsString);
    return Array.isArray(tags) ? tags : null;
  } catch (error) {
    console.warn('Failed to parse brand tags:', error);
    return null;
  }
};

const parseLinksArray = (linksString) => {
  if (!linksString) return null;

  try {
    const links = JSON.parse(linksString);
    return Array.isArray(links) ? links : null;
  } catch (error) {
    console.warn('Failed to parse profile links:', error);
    return null;
  }
};
