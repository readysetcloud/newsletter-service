import { CognitoIdentityProviderClient, GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient();

/**
 * Extracts user context from Cognito JWT token
 * @param {Object} event - API Gateway event with authorization context
 * @returns {Object} User context with tenant information
 */
export const getUserContext = async (event) => {
  try {
    // Extract user info from Cognito authorizer context
    const claims = event.requestContext?.authorizer?.claims;

    if (!claims) {
      throw new Error('No authorization claims found');
    }

    const userId = claims.sub;
    const email = claims.email;
    const tenantId = claims['custom:tenant_id'];
    const role = claims['custom:role'] || 'user';

    // If tenant_id is not in claims, we might need to look it up
    if (!tenantId) {
      throw new Error('User does not have a tenant assigned');
    }

    return {
      userId,
      email,
      tenantId,
      role,
      isAdmin: role === 'admin',
      isTenantAdmin: role === 'tenant_admin'
    };
  } catch (error) {
    console.error('Error extracting user context:', error);
    throw new Error('Invalid authorization context');
  }
};

/**
 * Middleware to validate tenant access
 * @param {Object} userContext - User context from getUserContext
 * @param {string} requestedTenantId - Tenant ID from request path
 * @returns {boolean} Whether user has access to the tenant
 */
export const validateTenantAccess = (userContext, requestedTenantId) => {
  // Super admin can access any tenant
  if (userContext.isAdmin) {
    return true;
  }

  // Regular users can only access their own tenant
  return userContext.tenantId === requestedTenantId;
};

/**
 * Helper to format authorization error responses
 */
export const formatAuthError = (message = 'Unauthorized') => {
  return {
    statusCode: 403,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.ORIGIN || '*'
    },
    body: JSON.stringify({ message })
  };
};
