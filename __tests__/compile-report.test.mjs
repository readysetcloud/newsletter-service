import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let eventbridgeSend;
let PutEventsCommand;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    eventbridgeSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
      EventBridgeClient: jest.fn(() => ({ send: eventbridgeSend })),
      PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
    }));

    const mod = await import('../functions/compile-report.mjs');
    handler = mod.handler;
    ({ PutEventsCommand } = await import('@aws-sdk/client-eventbridge'));
  });
};

describe('compile-report', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.EVENT_BUS_NAME = 'test-bus';
    await loadIsolated();
  });

  describe('Template rendering', () => {
    it('should render template with WoW deltas and arrows', async () => {
      eventbridgeSend.mockResolvedValue({});

      const insightData = {
        currentMetrics: {
          uniqueOpens: 50,
          clicks: 25,
          openRate: 25.5,
          clickThroughRate: 12.3,
          bounceRate: 1.5,
          growthRate: 5.2
        },
        wowDeltas: {
          openRateWoW: 5.0,
          ctrWoW: -2.0,
          subscribersWoW: 10,
          clicksWoW: null
        },
        benchmarks: {
          bounceRateTarget: 2,
          openRateAvg3: 20.0,
          ctrAvg3: 10.0,
          bounceRateAvg3: 2.0,
          growthRateAvg3: 3.0
        },
        healthScore: { score: 85, status: 'Great' },
        contentPerformance: { topLinkPct: 40, top3Pct: 70, longTailPct: 30 },
        listHealth: { deliverabilityRate: 96, cleanedPct: 1 },
        engagementQuality: {},
        trends: { lastIssues: [], rolling3Avg: {}, bestInLast4: {} },
        visual: { bounceRate: { value: 1.5 } },
        engagement: {
          velocity: { '0-1h': 10, '1-6h': 5, '6-24h': 3, '24h+': 2 },
          timeToOpenBuckets: { '0-15m': 5, '15-30m': 3 },
          deviceBreakdown: { Mobile: 15, Desktop: 5 },
          clientBreakdown: { Gmail: 10, Outlook: 10 },
          newSubscribers: 5,
          netGrowth: 3
        },
        content: {
          subjectLine: 'Test Issue',
          linkCount: 2,
          topPerformingLink: { link: 'https://example.com', count: 20 },
          links: [
            { link: 'https://example.com', count: 20 },
            { link: 'https://example.org', count: 10 }
          ]
        }
      };

      const event = {
        insightData,
        insights: ['Insight 1', 'Insight 2'],
        subject: 'Test Report',
        tenantId: 'tenant1',
        recipientEmail: 'test@example.com'
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(eventbridgeSend).toHaveBeenCalled();

      const putEventsCall = eventbridgeSend.mock.calls[0][0];
      expect(putEventsCall.__type).toBe('PutEvents');

      const detail = JSON.parse(putEventsCall.Entries[0].Detail);
      expect(detail.html).toContain('▲');
      expect(detail.html).toContain('▼');
      expect(detail.html).toContain('+5.00');
      expect(detail.html).toContain('-2.00');
    });

    it('should prepare engagement velocity rows', async () => {
      eventbridgeSend.mockResolvedValue({});

      const insightData = {
        currentMetrics: {
          uniqueOpens: 100,
          clicks: 50,
          openRate: 30.0,
          clickThroughRate: 15.0,
          bounceRate: 1.8,
          growthRate: 4.5
        },
        wowDeltas: {},
        benchmarks: {
          bounceRateTarget: 2,
          openRateAvg3: 25.0,
          ctrAvg3: 12.0,
          bounceRateAvg3: 2.0,
          growthRateAvg3: 3.5
        },
        healthScore: { score: 85, status: 'Great' },
        contentPerformance: { topLinkPct: 40, top3Pct: 70, longTailPct: 30 },
        listHealth: { deliverabilityRate: 96, cleanedPct: 1 },
        engagementQuality: {},
        trends: { lastIssues: [], rolling3Avg: {}, bestInLast4: {} },
        visual: { bounceRate: { value: 1.5 } },
        engagement: {
          velocity: { '0-1h': 40, '1-6h': 30, '6-24h': 20, '24h+': 10 },
          timeToOpenBuckets: {},
          deviceBreakdown: {},
          clientBreakdown: {},
          newSubscribers: 5,
          netGrowth: 3
        },
        content: {
          subjectLine: 'Test',
          linkCount: 0,
          topPerformingLink: {},
          links: []
        }
      };

      const event = {
        insightData,
        insights: [],
        subject: 'Test Report',
        tenantId: 'tenant1',
        recipientEmail: 'test@example.com'
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      const detail = JSON.parse(eventbridgeSend.mock.calls[0][0].Entries[0].Detail);
      expect(detail.html).toContain('0-1 hour');
      expect(detail.html).toContain('40%');
      expect(detail.html).toContain('1-6 hours');
      expect(detail.html).toContain('30%');
    });

    it('should prepare links with percentages', async () => {
      eventbridgeSend.mockResolvedValue({});

      const insightData = {
        currentMetrics: {
          uniqueOpens: 50,
          clicks: 100,
          openRate: 28.0,
          clickThroughRate: 14.5,
          bounceRate: 1.2,
          growthRate: 6.0
        },
        wowDeltas: {},
        benchmarks: {
          bounceRateTarget: 2,
          openRateAvg3: 22.0,
          ctrAvg3: 11.0,
          bounceRateAvg3: 1.5,
          growthRateAvg3: 4.0
        },
        healthScore: { score: 85, status: 'Great' },
        contentPerformance: { topLinkPct: 60, top3Pct: 90, longTailPct: 10 },
        listHealth: { deliverabilityRate: 96, cleanedPct: 1 },
        engagementQuality: {},
        trends: { lastIssues: [], rolling3Avg: {}, bestInLast4: {} },
        visual: { bounceRate: { value: 1.5 } },
        engagement: {
          velocity: {},
          timeToOpenBuckets: {},
          deviceBreakdown: {},
          clientBreakdown: {},
          newSubscribers: 5,
          netGrowth: 3
        },
        content: {
          subjectLine: 'Test',
          linkCount: 4,
          topPerformingLink: { link: 'https://example.com', count: 60 },
          links: [
            { link: 'https://example.com', count: 60 },
            { link: 'https://example.org', count: 30 },
            { link: 'https://example.net', count: 10 }
          ]
        }
      };

      const event = {
        insightData,
        insights: [],
        subject: 'Test Report',
        tenantId: 'tenant1',
        recipientEmail: 'test@example.com'
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      const detail = JSON.parse(eventbridgeSend.mock.calls[0][0].Entries[0].Detail);
      expect(detail.html).toContain('60.0%');
      expect(detail.html).toContain('30.0%');
      expect(detail.html).toContain('10.0%');
    });

    it('should add status indicators for bounce rate and deliverability', async () => {
      eventbridgeSend.mockResolvedValue({});

      const insightData = {
        currentMetrics: {
          uniqueOpens: 50,
          clicks: 25,
          openRate: 26.0,
          clickThroughRate: 13.0,
          bounceRate: 2.5,
          growthRate: 3.5
        },
        wowDeltas: {},
        benchmarks: {
          bounceRateTarget: 2,
          openRateAvg3: 24.0,
          ctrAvg3: 12.5,
          bounceRateAvg3: 2.0,
          growthRateAvg3: 4.0
        },
        healthScore: { score: 85, status: 'Great' },
        contentPerformance: { topLinkPct: 40, top3Pct: 70, longTailPct: 30 },
        listHealth: { deliverabilityRate: 94, cleanedPct: 3 },
        engagementQuality: {},
        trends: { lastIssues: [], rolling3Avg: {}, bestInLast4: {} },
        visual: { bounceRate: { value: 2.5 } },
        engagement: {
          velocity: {},
          timeToOpenBuckets: {},
          deviceBreakdown: {},
          clientBreakdown: {},
          newSubscribers: 5,
          netGrowth: 3
        },
        content: {
          subjectLine: 'Test',
          linkCount: 0,
          topPerformingLink: {},
          links: []
        }
      };

      const event = {
        insightData,
        insights: [],
        subject: 'Test Report',
        tenantId: 'tenant1',
        recipientEmail: 'test@example.com'
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      const detail = JSON.parse(eventbridgeSend.mock.calls[0][0].Entries[0].Detail);
      expect(detail.html).toContain('⚠ Above target');
      expect(detail.html).toContain('⚠ Below Optimal');
    });

    it('should include insights in template when provided', async () => {
      eventbridgeSend.mockResolvedValue({});

      const insightData = {
        currentMetrics: {
          uniqueOpens: 50,
          clicks: 25,
          openRate: 27.0,
          clickThroughRate: 13.5,
          bounceRate: 1.5,
          growthRate: 5.0
        },
        wowDeltas: {},
        benchmarks: {
          bounceRateTarget: 2,
          openRateAvg3: 25.0,
          ctrAvg3: 13.0,
          bounceRateAvg3: 2.0,
          growthRateAvg3: 4.5
        },
        healthScore: { score: 85, status: 'Great' },
        contentPerformance: { topLinkPct: 40, top3Pct: 70, longTailPct: 30 },
        listHealth: { deliverabilityRate: 96, cleanedPct: 1 },
        engagementQuality: {},
        trends: { lastIssues: [], rolling3Avg: {}, bestInLast4: {} },
        visual: { bounceRate: { value: 1.5 } },
        engagement: {
          velocity: {},
          timeToOpenBuckets: {},
          deviceBreakdown: {},
          clientBreakdown: {},
          newSubscribers: 5,
          netGrowth: 3
        },
        content: {
          subjectLine: 'Test',
          linkCount: 0,
          topPerformingLink: {},
          links: []
        }
      };

      const event = {
        insightData,
        insights: ['Open rate improved by 15%', 'Click rate declined'],
        subject: 'Test Report',
        tenantId: 'tenant1',
        recipientEmail: 'test@example.com'
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      const detail = JSON.parse(eventbridgeSend.mock.calls[0][0].Entries[0].Detail);
      expect(detail.html).toContain('Open rate improved by 15%');
      expect(detail.html).toContain('Click rate declined');
    });
  });

  describe('EventBridge integration', () => {
    it('should send email event to EventBridge', async () => {
      eventbridgeSend.mockResolvedValue({});

      const insightData = {
        currentMetrics: {
          uniqueOpens: 50,
          clicks: 25,
          openRate: 28.0,
          clickThroughRate: 14.0,
          bounceRate: 1.5,
          growthRate: 5.5
        },
        wowDeltas: {},
        benchmarks: {
          bounceRateTarget: 2,
          openRateAvg3: 26.0,
          ctrAvg3: 13.0,
          bounceRateAvg3: 2.0,
          growthRateAvg3: 5.0
        },
        healthScore: { score: 85, status: 'Great' },
        contentPerformance: { topLinkPct: 40, top3Pct: 70, longTailPct: 30 },
        listHealth: { deliverabilityRate: 96, cleanedPct: 1 },
        engagementQuality: {},
        trends: { lastIssues: [], rolling3Avg: {}, bestInLast4: {} },
        visual: { bounceRate: { value: 1.5 } },
        engagement: {
          velocity: {},
          timeToOpenBuckets: {},
          deviceBreakdown: {},
          clientBreakdown: {},
          newSubscribers: 5,
          netGrowth: 3
        },
        content: {
          subjectLine: 'Test',
          linkCount: 0,
          topPerformingLink: {},
          links: []
        }
      };

      const event = {
        insightData,
        insights: [],
        subject: 'Performance Report',
        tenantId: 'tenant1',
        recipientEmail: 'user@example.com'
      };

      await handler(event);

      expect(eventbridgeSend).toHaveBeenCalledTimes(1);

      const putEventsCall = eventbridgeSend.mock.calls[0][0];
      expect(putEventsCall.__type).toBe('PutEvents');
      expect(putEventsCall.Entries).toHaveLength(1);
      expect(putEventsCall.Entries[0].Source).toBe('newsletter-service');
      expect(putEventsCall.Entries[0].DetailType).toBe('Send Email v2');

      const detail = JSON.parse(putEventsCall.Entries[0].Detail);
      expect(detail.subject).toBe('Performance Report');
      expect(detail.to.email).toBe('user@example.com');
      expect(detail.tenantId).toBe('tenant1');
      expect(detail.html).toBeDefined();
    });

    it('should handle EventBridge errors', async () => {
      eventbridgeSend.mockRejectedValue(new Error('EventBridge error'));

      const insightData = {
        currentMetrics: {
          uniqueOpens: 50,
          clicks: 25,
          openRate: 29.0,
          clickThroughRate: 14.5,
          bounceRate: 1.5,
          growthRate: 6.0
        },
        wowDeltas: {},
        benchmarks: {
          bounceRateTarget: 2,
          openRateAvg3: 27.0,
          ctrAvg3: 14.0,
          bounceRateAvg3: 2.0,
          growthRateAvg3: 5.5
        },
        healthScore: { score: 85, status: 'Great' },
        contentPerformance: { topLinkPct: 40, top3Pct: 70, longTailPct: 30 },
        listHealth: { deliverabilityRate: 96, cleanedPct: 1 },
        engagementQuality: {},
        trends: { lastIssues: [], rolling3Avg: {}, bestInLast4: {} },
        visual: { bounceRate: { value: 1.5 } },
        engagement: {
          velocity: {},
          timeToOpenBuckets: {},
          deviceBreakdown: {},
          clientBreakdown: {},
          newSubscribers: 5,
          netGrowth: 3
        },
        content: {
          subjectLine: 'Test',
          linkCount: 0,
          topPerformingLink: {},
          links: []
        }
      };

      const event = {
        insightData,
        insights: [],
        subject: 'Test Report',
        tenantId: 'tenant1',
        recipientEmail: 'test@example.com'
      };

      await expect(handler(event)).rejects.toThrow('EventBridge error');
    });
  });
});
