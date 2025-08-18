import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from './get-user-context.mjs';
import { momentoClient } from '../utils/momento-client.mjs';

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { userId, tenantId } = userContext;

    if (!tenantId) {
      return formatResponse(400, 'No tenant ID available for token generation');
    }

    if (!momentoClient.isAvailable()) {
      return formatResponse(503, 'Momento service not available');
    }

    const momentoToken = await momentoClient.generateReadOnlyToken(tenantId, userId);
    const expirationTime = new Date(Date.now() + (60 * 60 * 1000));

    return formatResponse(200, {
      momentoToken,
      cacheName: momentoClient.getCacheName(),
      expiresAt: expirationTime.toISOString(),
      tenantId
    });

  } catch (error) {
    console.error('Refresh Momento token error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to refresh Momento token');
  }
};
