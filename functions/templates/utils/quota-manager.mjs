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
      // Query for templates
      const templatesResult = await ddb.send(new QueryCommand({
        TableName: process.env.TEMPLATES_TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(SK, :templatePrefix)',
        ExpressionAttributeValues: marshall({
          ':tenantId': tenantId,
          ':templatePrefix': 'template'
        }),
        FilterExpression: 'isActive = :isActive',
        ExpressionAttributeValues: marshall({
          ':tenantId': tenantId,
          ':templatePrefix': 'template',
          ':isActive': true
        }),
        Select: 'COUNT'
      }));

      // Query for snippets
      const snippetsResult = await ddb.send(new QueryCommand({
        TableName: process.env.TEMPLATES_TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(SK, :snippetPrefix)',
        ExpressionAttributeValues: marshall({
          ':tenantId': tenantId,
          ':snippetPrefix': 'snippet'
        }),
        FilterExpression: 'isActive = :isActive',
        ExpressionAttributeValues: marshall({
          ':tenantId': tenantId,
          ':snippetPrefix': 'snippet',
          ':isActive': true
        }),
        Select: 'COUNT'
      }));

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
   * Check if a user can create a new template
   * @param {string} tenantId - Tenant ID
   * @param {string} userTier - User tier
   * @returns {Promise<Object>} Quota check result
   */
  async canCreateTemplate(tenantId, userTier) {
    try {
      const limits = this.getTierLimits(userTier);
      const usage = await this.getCurrentUsage(tenantId);

      const canCreate = usage.templates < limits.templates;

      return {
        allowed: canCreate,
        current: usage.templates,
        limit: limits.templates,
        remaining: Math.max(0, limits.templates - usage.templates),
        type: 'template',
        tier: userTier
      };
    } catch (error) {
      console.error('Error checking template quota:', error);
      throw error;
    }
  }

  /**
   * Check if a user can create a new snippet
   * @param {string} tenantId - Tenant ID
   * @param {string} userTier - User tier
   * @returns {Promise<Object>} Quota check result
   */
  async canCreateSnippet(tenantId, userTier) {
    try {
      const limits = this.getTierLimits(userTier);
      const usage = await this.getCurrentUsage(tenantId);

      const canCreate = usage.snippets < limits.snippets;

      return {
        allowed: canCreate,
        current: usage.snippets,
        limit: limits.snippets,
        remaining: Math.max(0, limits.snippets - usage.snippets),
        type: 'snippet',
        tier: userTier
      };
    } catch (error) {
      console.error('Error checking snippet quota:', error);
      throw error;
    }
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
    let quotaCheck;

    if (type === 'template') {
      quotaCheck = await this.canCreateTemplate(tenantId, userTier);
    } else if (type === 'snippet') {
      quotaCheck = await this.canCreateSnippet(tenantId, userTier);
    } else {
      throw new Error(`Invalid resource type: ${type}`);
    }

    if (!quotaCheck.allowed) {
      const error = new Error(
        `${type.charAt(0).toUpperCase() + type.slice(1)} limit exceeded. ` +
        `You have reached your ${quotaCheck.tier} limit of ${quotaCheck.limit} ${type}s. ` +
        `Consider upgrading your plan to create more ${type}s.`
      );
      error.code = 'QUOTA_EXCEEDED';
      error.quotaInfo = quotaCheck;
      throw error;
    }

    return quotaCheck;
  }

  /**
   * Get upgrade suggestions based on current usage
   * @param {string} tenantId - Tenant ID
   * @param {string} currentTier - Current user tier
   * @returns {Promise<Object>} Upgrade suggestions
   */
  async getUpgradeSuggestions(tenantId, currentTier) {
    try {
      const usage = await this.getCurrentUsage(tenantId);
      const currentLimits = this.getTierLimits(currentTier);

      const suggestions = [];

      // Check if user needs more templates
      if (usage.templates >= currentLimits.templates) {
        if (currentTier === 'free-tier') {
          suggestions.push({
            reason: 'template_limit',
            currentLimit: currentLimits.templates,
            suggestedTier: 'creator-tier',
            newLimit: TIER_LIMITS['creator-tier'].templates,
            benefit: `Increase template limit from ${currentLimits.templates} to ${TIER_LIMITS['creator-tier'].templates}`
          });
        } else if (currentTier === 'creator-tier') {
          suggestions.push({
            reason: 'template_limit',
            currentLimit: currentLimits.templates,
            suggestedTier: 'pro-tier',
            newLimit: TIER_LIMITS['pro-tier'].templates,
            benefit: `Increase template limit from ${currentLimits.templates} to ${TIER_LIMITS['pro-tier'].templates}`
          });
        }
      }

      // Check if user needs more snippets
      if (usage.snippets >= currentLimits.snippets) {
        if (currentTier === 'free-tier') {
          suggestions.push({
            reason: 'snippet_limit',
            currentLimit: currentLimits.snippets,
            suggestedTier: 'creator-tier',
            newLimit: TIER_LIMITS['creator-tier'].snippets,
            benefit: `Increase snippet limit from ${currentLimits.snippets} to ${TIER_LIMITS['creator-tier'].snippets}`
          });
        } else if (currentTier === 'creator-tier') {
          suggestions.push({
            reason: 'snippet_limit',
            currentLimit: currentLimits.snippets,
            suggestedTier: 'pro-tier',
            newLimit: TIER_LIMITS['pro-tier'].snippets,
            benefit: `Increase snippet limit from ${currentLimits.snippets} to ${TIER_LIMITS['pro-tier'].snippets}`
          });
        }
      }

      // Remove duplicate suggestions (if both template and snippet limits suggest same tier)
      const uniqueSuggestions = suggestions.reduce((acc, suggestion) => {
        const existing = acc.find(s => s.suggestedTier === suggestion.suggestedTier);
        if (!existing) {
          acc.push(suggestion);
        } else {
          // Combine benefits
          existing.benefit += ` and ${suggestion.benefit.toLowerCase()}`;
          existing.reason = 'multiple_limits';
        }
        return acc;
      }, []);

      return {
        currentTier,
        usage,
        currentLimits,
        suggestions: uniqueSuggestions,
        hasUpgradeOptions: uniqueSuggestions.length > 0
      };
    } catch (error) {
      console.error('Error getting upgrade suggestions:', error);
      throw error;
    }
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
