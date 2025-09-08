import { QuotaManager, TIER_LIMITS } from '../functions/templates/utils/quota-manager.mjs';

describe('QuotaManager', () => {
  let quotaManager;
  const tenantId = 'test-tenant';

  beforeEach(() => {
    quotaManager = new QuotaManager();
  });

  describe('Tier Limits', () => {
    test('should have correct tier limits defined', () => {
      expect(TIER_LIMITS['free-tier']).toEqual({
        templates: 1,
        snippets: 2
      });

      expect(TIER_LIMITS['creator-tier']).toEqual({
        templates: 5,
        snippets: 10
      });

      expect(TIER_LIMITS['pro-tier']).toEqual({
        templates: 100,
        snippets: 100
      });
    });

    test('should get tier limits correctly', () => {
      expect(quotaManager.getTierLimits('free-tier')).toEqual({
        templates: 1,
        snippets:
});

      expect(quotaManager.getTierLimits('creator-tier')).toEqual({
        templates: 5,
        snippets: 10
      });

      expect(quotaManager.getTierLimits('pro-tier')).toEqual({
        templates: 100,
        snippets: 100
      });
    });

    test('should default to free tier for unknown tiers', () => {
      expect(quotaManager.getTierLimits('unknown-tier')).toEqual({
        templates: 1,
        snippets: 2
      });
    });
  });

  describe('Quota Validation', () => {
    test('should create quota check result structure', () => {
      const mockUsage = { templates: 0, snippets: 1 };

      // Mock getCurrentUsage
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      return quotaManager.canCreateTemplate(tenantId, 'free-tier').then(result => {
        expect(result).toHaveProperty('allowed');
        expect(result).toHaveProperty('current');
        expect(result).toHaveProperty('limit');
        expect(result).toHaveProperty('remaining');
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('tier');

        expect(result.type).toBe('template');
        expect(result.tier).toBe('free-tier');
        expect(result.allowed).toBe(true);
        expect(result.current).toBe(0);
        expect(result.limit).toBe(1);
        expect(result.remaining).toBe(1);
      });
    });

    test('should allow creation when under limit', () => {
      const mockUsage = { templates: 0, snippets: 1 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      return quotaManager.canCreateTemplate(tenantId, 'free-tier').then(result => {
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(1);
      });
    });

    test('should deny creation when at limit', () => {
      const mockUsage = { templates: 1, snippets: 2 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      return quotaManager.canCreateTemplate(tenantId, 'free-tier').then(result => {
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
      });
    });

    test('should handle different tiers correctly', () => {
      const mockUsage = { templates: 2, snippets: 5 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      // Creator tier should allow more templates
      return quotaManager.canCreateTemplate(tenantId, 'creator-tier').then(result => {
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(5);
        expect(result.remaining).toBe(3);
      });
    });
  });

  describe('Quota Enforcement', () => {
    test('should throw error when quota exceeded', async () => {
      const mockUsage = { templates: 1, snippets: 2 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      await expect(quotaManager.enforceQuota(tenantId, 'free-tier', 'template'))
        .rejects.toThrow('Template limit exceeded');
    });

    test('should not throw error when quota available', async () => {
      const mockUsage = { templates: 0, snippets: 1 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      await expect(quotaManager.enforceQuota(tenantId, 'free-tier', 'template'))
        .resolves.not.toThrow();
    });

    test('should throw error for invalid resource type', async () => {
      await expect(quotaManager.enforceQuota(tenantId, 'free-tier', 'invalid'))
        .rejects.toThrow('Invalid resource type: invalid');
    });
  });

  describe('Quota Status', () => {
    test('should return comprehensive quota status', () => {
      const mockUsage = { templates: 1, snippets: 1 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      return quotaManager.getQuotaStatus(tenantId, 'free-tier').then(status => {
        expect(status).toHaveProperty('tier', 'free-tier');
        expect(status).toHaveProperty('templates');
        expect(status).toHaveProperty('snippets');
        expect(status).toHaveProperty('overall');

        expect(status.templates).toEqual({
          current: 1,
          limit: 1,
          remaining: 0,
          percentage: 100,
          canCreate: false
        });

        expect(status.snippets).toEqual({
          current: 1,
          limit: 2,
          remaining: 1,
          percentage: 50,
          canCreate: true
        });

        expect(status.overall.withinLimits).toBe(true);
        expect(status.overall.nearLimit).toBe(true); // 100% usage on templates
      });
    });
  });

  describe('Upgrade Suggestions', () => {
    test('should suggest upgrade when at template limit', () => {
      const mockUsage = { templates: 1, snippets: 1 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      return quotaManager.getUpgradeSuggestions(tenantId, 'free-tier').then(suggestions => {
        expect(suggestions.hasUpgradeOptions).toBe(true);
        expect(suggestions.suggestions).toHaveLength(1);
        expect(suggestions.suggestions[0].suggestedTier).toBe('creator-tier');
        expect(suggestions.suggestions[0].reason).toBe('template_limit');
      });
    });

    test('should suggest upgrade when at snippet limit', () => {
      const mockUsage = { templates: 0, snippets: 2 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      return quotaManager.getUpgradeSuggestions(tenantId, 'free-tier').then(suggestions => {
        expect(suggestions.hasUpgradeOptions).toBe(true);
        expect(suggestions.suggestions).toHaveLength(1);
        expect(suggestions.suggestions[0].suggestedTier).toBe('creator-tier');
        expect(suggestions.suggestions[0].reason).toBe('snippet_limit');
      });
    });

    test('should combine suggestions when both limits reached', () => {
      const mockUsage = { templates: 1, snippets: 2 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      return quotaManager.getUpgradeSuggestions(tenantId, 'free-tier').then(suggestions => {
        expect(suggestions.hasUpgradeOptions).toBe(true);
        expect(suggestions.suggestions).toHaveLength(1);
        expect(suggestions.suggestions[0].suggestedTier).toBe('creator-tier');
        expect(suggestions.suggestions[0].reason).toBe('multiple_limits');
      });
    });

    test('should not suggest upgrade for pro tier', () => {
      const mockUsage = { templates: 100, snippets: 100 };
      quotaManager.getCurrentUsage = jest.fn().mockResolvedValue(mockUsage);

      return quotaManager.getUpgradeSuggestions(tenantId, 'pro-tier').then(suggestions => {
        expect(suggestions.hasUpgradeOptions).toBe(false);
        expect(suggestions.suggestions).toHaveLength(0);
      });
    });
  });

  describe('Error Formatting', () => {
    test('should format quota exceeded error', () => {
      const error = new Error('Template limit exceeded');
      error.code = 'QUOTA_EXCEEDED';
      error.quotaInfo = {
        allowed: false,
        current: 1,
        limit: 1,
        remaining: 0,
        type: 'template',
        tier: 'free-tier'
      };

      const formatted = quotaManager.formatQuotaError(error);

      expect(formatted).toEqual({
        error: 'Quota exceeded',
        message: 'Template limit exceeded',
        code: 'QUOTA_EXCEEDED',
        quota: error.quotaInfo,
        upgradeRequired: true
      });
    });

    test('should format generic error', () => {
      const error = new Error('Something went wrong');

      const formatted = quotaManager.formatQuotaError(error);

      expect(formatted).toEqual({
        error: 'Internal error',
        message: 'Something went wrong',
        code: 'INTERNAL_ERROR'
      });
    });
  });
});
