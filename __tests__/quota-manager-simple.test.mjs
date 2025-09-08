import { TIER_LIMITS } from '../functions/templates/utils/quota-manager.mjs';

describe('QuotaManager - Basic Tests', () => {
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
});
