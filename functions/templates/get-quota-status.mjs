import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { quotaManager } from './utils/quota-manager.mjs';

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId, userTier } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Get comprehensive quota status
    const quotaStatus = await quotaManager.getQuotaStatus(tenantId, userTier || 'free-tier');

    // Get upgrade suggestions if needed
    const upgradeSuggestions = await quotaManager.getUpgradeSuggestions(tenantId, userTier || 'free-tier');

    const response = {
      ...quotaStatus,
      upgrades: upgradeSuggestions
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('Get quota status error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to get quota status');
  }
};
