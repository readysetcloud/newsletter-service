import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

/**
 * Tier-based quota limits for templates and snippets
 */
const TIER_LIMITS = {
  'free-tier': {
    templates: 1,
    snippets: 2
  },
  'creator-tier': {
    templates: 5,
    snippets: 10
  },
  'pro-tier': {
    templates: 100,
    snippets: 100
  }
};

/**
 * Quota management utility for enforcing tier-based limits
 */
class QuotaManager {
  /**
   * Get quota limits for a user tier
   * @param {string} userTier - User tier (free-tier, creator-tier, pro-tier)
   * @returns {Object} Quota limits
   */
  getTierLimits(userTier) {
    return TIER_LIMITS[userTier] || TIER_LIMITS['free-tier'];
  }

  /**
   * Get current usage counts for a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Current usage counts
   */
  async getCurrentUsage(tenantId) {
    try {
      const [templatesResult, snippetsResult] = await Promise.all([
        ddb.send(new QueryCommand({
          TableName: process.env.TEMPLATES_TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(GSI1SK, :templatePrefix)',
          ExpressionAttributeValues: marshall({
            ':tenantId': tenantId,
            ':templatePrefix': 'template',
            ':isActive': true
          }),
          FilterExpression: 'isActive = :isActive',
          Select: 'COUNT'
        })),
        ddb.send(new QueryCommand({
          TableName: process.env.TEMPLATES_TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(GSI1SK, :snippetPrefix)',
          ExpressionAttributeValues: marshall({
            ':tenantId': tenantId,
            ':snippetPrefix': 'snippet',
            ':isActive': true
          }),
          FilterExpression: 'isActive = :isActive',
          Select: 'COUNT'
        }))
      ]);

      return {
        templates: templatesResult.Count || 0,
        snippets: snippetsResult.Count || 0
      };
    } catch (error) {
      console.error('Error getting current usage:', error);
      throw new Error(`Failed to get current usage: ${error.message}`);
    }
  }

  /**
   * Check if a user can create a resource
   * @param {string} tenantId - Tenant ID
   * @param {string} userTier - User tier
   * @param {string} type - Resource type ('template' or 'snippet')
   * @returns {Promise<Object>} Quota check result
   */
  async canCreate(tenantId, userTier, type) {
    const limits = this.getTierLimits(userTier);
    const usage = await this.getCurrentUsage(tenantId);
    const current = usage[type + 's'] || 0;
    const limit = limits[type + 's'] || 0;

    return {
      allowed: current < limit,
      current,
      limit,
      remaining: Math.max(0, limit - current),
      type,
      tier: userTier
    };
  }

  /**
   * Get comprehensive quota status for a tenant
   * @param {string} tenantId - Tenant ID
   * @param {string} userTier - User tier
   * @returns {Promise<Object>} Complete quota status
   */
  async getQuotaStatus(tenantId, userTier) {
    try {
      const limits = this.getTierLimits(userTier);
      const usage = await this.getCurrentUsage(tenantId);

      return {
        tier: userTier,
        templates: {
          current: usage.templates,
          limit: limits.templates,
          remaining: Math.max(0, limits.templates - usage.templates),
          percentage: Math.round((usage.templates / limits.templates) * 100),
          canCreate: usage.templates < limits.templates
        },
        snippets: {
          current: usage.snippets,
          limit: limits.snippets,
          remaining: Math.max(0, limits.snippets - usage.snippets),
          percentage: Math.round((usage.snippets / limits.snippets) * 100),
          canCreate: usage.snippets < limits.snippets
        },
        overall: {
          withinLimits: usage.templates <= limits.templates && usage.snippets <= limits.snippets,
          nearLimit: (usage.templates / limits.templates) > 0.8 || (usage.snippets / limits.snippets) > 0.8
        }
      };
    } catch (error) {
      console.error('Error getting quota status:', error);
      throw error;
    }
  }

  /**
   * Validate quota before creation and throw error if exceeded
   * @param {string} tenantId - Tenant ID
   * @param {string} userTier - User tier
   * @param {string} type - Resource type ('template' or 'snippet')
   * @throws {Error} If quota is exceeded
   */
  async enforceQuota(tenantId, userTier, type) {
    const quotaCheck = await this.canCreate(tenantId, userTier, type);

    if (!quotaCheck.allowed) {
      const error = new Error(
        `${type.charAt(0).toUpperCase() + type.slice(1)} limit exceeded. ` +
        `You have reached your ${quotaCheck.tier} limit of ${quotaCheck.limit} ${type}s.`
      );
      error.code = 'QUOTA_EXCEEDED';
      error.quotaInfo = quotaCheck;
      throw error;
    }

    return quotaCheck;
  }



  /**
   * Format quota error for API response
   * @param {Error} error - Quota error
   * @returns {Object} Formatted error response
   */
  formatQuotaError(error) {
    if (error.code === 'QUOTA_EXCEEDED') {
      return {
        error: 'Quota exceeded',
        message: error.message,
        code: 'QUOTA_EXCEEDED',
        quota: error.quotaInfo,
        upgradeRequired: true
      };
    }

    return {
      error: 'Internal error',
      message: error.message,
      code: 'INTERNAL_ERROR'
    };
  }
}

// Export singleton instance
export const quotaManager = new QuotaManager();

// Export class for testing
export { QuotaManager, TIER_LIMITS };
