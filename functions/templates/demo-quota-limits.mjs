import { formatResponse } from '../utils/helpers.mjs';
import { TIER_LIMITS } from './utils/quota-manager.mjs';

/**
 * Demo function to show tier-based quota limits
 * This is for demonstration purposes only
 */
export const handler = async (event) => {
  try {
    const response = {
      message: 'Template Builder Tier-Based Quota Limits',
      tiers: {
        'free-tier': {
          displayName: 'Free',
          limits: TIER_LIMITS['free-tier'],
          description: 'Perfect for getting started with basic newsletter templates',
          features: [
            '1 custom template',
            '2 reusable snippets',
            'Basic template editor',
            'Email preview'
          ]
        },
        'creator-tier': {
          displayName: 'Creator',
          limits: TIER_LIMITS['creator-tier'],
          description: 'Ideal for content creators who need more flexibility',
          features: [
            '5 custom templates',
            '10 reusable snippets',
            'Visual template builder',
            'Advanced snippet parameters',
            'Template versioning',
            'Performance analytics'
          ]
        },
        'pro-tier': {
          displayName: 'Pro',
          limits: TIER_LIMITS['pro-tier'],
          description: 'For professional newsletters with unlimited creativity',
          features: [
            '100 custom templates',
            '100 reusable snippets',
            'Advanced visual builder',
            'Custom CSS support',
            'A/B testing',
            'Priority support',
            'White-label options'
          ]
        }
      },
      quotaEnforcement: {
        description: 'Quotas are enforced at creation time',
        behavior: {
          withinLimit: 'Creation allowed',
          atLimit: 'Creation blocked with upgrade suggestion',
          overLimit: 'Existing items remain functional, new creation blocked'
        },
        upgradeFlow: {
          step1: 'User hits quota limit',
          step2: 'System shows upgrade suggestion',
          step3: 'User upgrades plan',
          step4: 'Quota limits automatically updated',
          step5: 'User can create more templates/snippets'
        }
      },
      examples: {
        freeUser: {
          scenario: 'Free tier user tries to create 2nd template',
          result: 'Blocked with message: "Template limit exceeded. You have reached your free-tier limit of 1 templates. Consider upgrading your plan to create more templates."',
          suggestion: 'Upgrade to Creator tier for 5 templates'
        },
        creatorUser: {
          scenario: 'Creator tier user has 5 templates and 8 snippets',
          result: 'Can create 2 more snippets, but no more templates',
          suggestion: 'Upgrade to Pro tier for 100 templates and 100 snippets'
        },
        proUser: {
          scenario: 'Pro tier user with 50 templates and 30 snippets',
          result: 'Can create 50 more templates and 70 more snippets',
          suggestion: 'No upgrade needed'
        }
      }
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('Demo quota limits error:', error);
    return formatResponse(500, 'Failed to get quota information');
  }
};
