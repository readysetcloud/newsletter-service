import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

let handler;
let ddbSend;
let converse;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();
    converse = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    jest.unstable_mockModule('@aws-lambda-powertools/logger', () => ({
      Logger: jest.fn(() => ({
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn()
      }))
    }));

    jest.unstable_mockModule('../functions/utils/agents.mjs', () => ({
      converse: converse
    }));

    jest.unstable_mockModule('../functions/ai/tools.mjs', () => ({
      createInsightsTool: {
        name: 'createInsights',
        description: 'Create insights',
        schema: {}
      }
    }));

    const mod = await import('../functions/ai/generate-insights.mjs');
    handler = mod.handler;
  });
};

describe('generate-insights', () => {
  beforeEach(async () => {
    jest.resetModules();
    await loadIsolated();
    process.env.TABLE_NAME = 'test-table';
    process.env.MODEL_ID = 'test-model';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate insights with enhanced data structure', async () => {
    const mockInsightData = {
      currentMetrics: {
        openRate: 45.5,
        clickThroughRate: 3.2,
        bounceRate: 0.8,
        growthRate: 1.5
      },
      benchmarks: {
        openRateAvg3: 42.0,
        ctrAvg3: 3.0,
        bounceRateAvg3: 1.0,
        growthRateAvg3: 1.2
      },
      healthScore: {
        score: 85,
        status: 'Great',
        summary: 'Opens up, clicks steady, list health good'
      },
      contentPerformance: {
        topLinkPct: 45.2,
        top3Pct: 78.5,
        concentration: 'Moderately concentrated'
      },
      listHealth: {
        deliverabilityRate: 98.5,
        bounceRateStatus: 'Normal'
      },
      engagementQuality: {
        clicksPerOpener: 0.15,
        opensFirst1hPct: 35.2
      }
    };

    ddbSend.mockImplementation((cmd) => {
      if (cmd.__type === 'Query') {
        return Promise.resolve({
          Items: [
            {
              pk: { S: 'tenant1#issue1' },
              data: mockInsightData
            }
          ]
        });
      }
      if (cmd.__type === 'GetItem') {
        return Promise.resolve({
          Item: {
            pk: 'tenant1#issue1',
            sk: 'analytics',
            insights: ['Insight 1', 'Insight 2']
          }
        });
      }
    });

    converse.mockResolvedValue({ success: true });

    const state = {
      insightData: mockInsightData,
      tenantId: 'tenant1',
      issueId: 'issue1'
    };

    const result = await handler(state);

    expect(converse).toHaveBeenCalled();
    const converseCall = converse.mock.calls[0];
    const systemPrompt = converseCall[1];

    expect(systemPrompt).toContain('benchmarks');
    expect(systemPrompt).toContain('healthScore');
    expect(systemPrompt).toContain('contentPerformance');
    expect(systemPrompt).toContain('listHealth');
    expect(systemPrompt).toContain('engagementQuality');
    expect(systemPrompt).toContain('3-week rolling averages');
    expect(result.insights).toEqual(['Insight 1', 'Insight 2']);
  });

  it('should prioritize insights based on health score and benchmarks', async () => {
    const mockInsightDataWithConcerns = {
      currentMetrics: {
        openRate: 30.0,
        clickThroughRate: 1.5,
        bounceRate: 2.5,
        growthRate: -0.5
      },
      benchmarks: {
        openRateAvg3: 42.0,
        ctrAvg3: 3.0,
        bounceRateAvg3: 1.0,
        growthRateAvg3: 1.2
      },
      healthScore: {
        score: 45,
        status: 'Needs Attention',
        summary: 'Opens down significantly, clicks below average, bounce rate high'
      },
      contentPerformance: {
        topLinkPct: 75.0,
        top3Pct: 95.0,
        concentration: 'Highly concentrated'
      },
      listHealth: {
        deliverabilityRate: 92.0,
        bounceRateStatus: 'High'
      },
      engagementQuality: {
        clicksPerOpener: 0.08,
        opensFirst1hPct: 15.0
      }
    };

    ddbSend.mockImplementation((cmd) => {
      if (cmd.__type === 'Query') {
        return Promise.resolve({ Items: [] });
      }
      if (cmd.__type === 'GetItem') {
        return Promise.resolve({
          Item: {
            pk: 'tenant1#issue1',
            sk: 'analytics',
            insights: [
              'Open rate 28% below 3-week average - consider testing different subject lines',
              'Bounce rate at 2.5% (High status) - review list quality and implement cleaning',
              'Highly concentrated clicks (75% on top link) - diversify content to broaden engagement'
            ]
          }
        });
      }
    });

    converse.mockResolvedValue({ success: true });

    const state = {
      insightData: mockInsightDataWithConcerns,
      tenantId: 'tenant1',
      issueId: 'issue1'
    };

    const result = await handler(state);

    expect(converse).toHaveBeenCalled();
    const converseCall = converse.mock.calls[0];
    const userPrompt = converseCall[2];

    expect(userPrompt).toContain('"status": "Needs Attention"');
    expect(userPrompt).toContain('"bounceRateStatus": "High"');
    expect(userPrompt).toContain('"concentration": "Highly concentrated"');
    expect(result.insights).toContain('Open rate 28% below 3-week average - consider testing different subject lines');
    expect(result.insights).toContain('Bounce rate at 2.5% (High status) - review list quality and implement cleaning');
  });
});
