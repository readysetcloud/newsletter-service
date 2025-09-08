

/**
 * Extracts user context from Lambda authorizer context
 * @param {Object} event - API Gateway event with authorization context
 * @returns {Object} User context with tenant information
 */
export const getUserContext = (event) => {
  try {
    const authContext = event.requestContext?.authorizer;

    if (!authContext) {
      throw new Error('No authorization context found');
    }

    const userId = authContext.userId;
    const email = authContext.email === 'null' ? null : authContext.email;
    const username = authContext.username === 'null' ? null : authContext.username;
    const tenantId = authContext.tenantId || null;
    const role = authContext.role || 'user';
    const isAdmin = authContext.isAdmin === 'true';
    const isTenantAdmin = authContext.isTenantAdmin === 'true';
    const userTier = authContext.userTier || 'free-tier';

    if (!userId || !email) {
      throw new Error('Missing required user information in authorization context');
    }

    return {
      userId,
      email,
      username,
      tenantId,
      role,
      isAdmin,
      isTenantAdmin,
      userTier
    };
  } catch (error) {
    console.error('Error extracting user context:', error);
    throw new Error('Invalid authorization context');
  }
};

/**
 * Middleware to validate tenant access (for public API endpoints)
 * Use this for public API endpoints where tenant comes from path parameters.
 * For dashboard API endpoints, tenantId is already validated by the authorizer.
 * @param {Object} userContext - User context from getUserContext
 * @param {string} requestedTenantId - Tenant ID from request path
 * @returns {boolean} Whether user has access to the tenant
 */
export const validateTenantAccess = (userContext, requestedTenantId) => {
  // Super admin can access any tenant
  if (userContext.isAdmin) {
    return true;
  }

  // Users without a tenant can't access tenant-specific resources
  if (!userContext.tenantId) {
    return false;
  }

  // Regular users can only access their own tenant
  return userContext.tenantId === requestedTenantId;
};

/**
 * Helper to format authentication errors consistently
 * @param {string} message - Error message
 * @returns {Object} Formatted error response
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
