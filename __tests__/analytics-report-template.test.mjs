import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';

describe('analytics-report template', () => {
  let template;

  beforeEach(() => {
    Handlebars.registerHelper('formatNumber', (num) => {
      if (num === null || num === undefined) return '0';
      const value = Number(num);
      if (!Number.isFinite(value)) return '0';
      return value.toFixed(2);
    });

    Handlebars.registerHelper('formatTimeToOpen', (seconds) => {
      if (!seconds || seconds === 0) return '0h 0m';
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    });

    Handlebars.registerHelper('calculatePercentage', (value, total) => {
      if (!total || total === 0) return '0.0';
      const percentage = (Number(value) / Number(total)) * 100;
      return percentage.toFixed(1);
    });

    Handlebars.registerHelper('gte', function(a, b) {
      return Number(a) >= Number(b);
    });

    Handlebars.registerHelper('gt', function(a, b) {
      return Number(a) > Number(b);
    });

    Handlebars.registerHelper('eq', function(a, b) {
      return a === b;
    });

    Handlebars.registerHelper('colorForDelta', function(value) {
      return Number(value) >= 0 ? '#28a745' : '#dc3545';
    });

    Handlebars.registerHelper('arrowForDelta', function(value) {
      return Number(value) >= 0 ? '▲' : '▼';
    });

    Handlebars.registerHelper('signForDelta', function(value) {
      return Number(value) >= 0 ? '+' : '';
    });

    Handlebars.registerHelper('or', function(...args) {
      const options = args[args.length - 1];
      return args.slice(0, -1).some(arg => {
        if (typeof arg === 'object' && arg !== null) {
          return Object.keys(arg).length > 0;
        }
        return Boolean(arg);
      });
    });

    const templateSource = readFileSync('./templates/analytics-report.hbs', 'utf8');
    template = Handlebars.compile(templateSource);
  });

  it('should render template with basic data', () => {
    const data = {
      issueName: 'Test Issue',
      currentMetrics: {
        openRate: 25.5,
        clickThroughRate: 3.2,
        clickToOpenRate: 12.5,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 995,
        uniqueOpens: 250,
        reopens: 25,
        avgTimeToOpen: 7200,
        clicks: 32,
        bounces: 5,
        unsubscribes: 2,
        cleaned: 1,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.5,
        ctrWoW: 0.7,
        subscribersWoW: 50,
        clicksWoW: 7
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 53,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test Newsletter',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Issue');
    expect(html).toContain('25.50%');
    expect(html).toContain('Unique Opens');
    expect(html).toContain('250.00');
  });

  it('should render engagement velocity table', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 3600,
        clicks: 30,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocityRows: [
          { label: '0-1 hour', value: 100, percentage: 40.0, barWidth: 40, color: '#4a90e2' },
          { label: '1-6 hours', value: 80, percentage: 32.0, barWidth: 32, color: '#5cb85c' },
          { label: '6-24 hours', value: 50, percentage: 20.0, barWidth: 20, color: '#f0ad4e' },
          { label: '24+ hours', value: 20, percentage: 8.0, barWidth: 8, color: '#d9534f' }
        ],
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('Engagement Velocity');
    expect(html).toContain('0-1 hour');
    expect(html).toContain('100.00');
  });

  it('should format time to open correctly', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('2h 0m');
  });

  it('should render health scoreboard when healthScore is provided', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      healthScore: {
        score: 85,
        status: 'Great',
        color: '#28a745',
        summary: 'Opens up, clicks steady, list health good',
        bullets: [
          '✓ Open rate 10% above 3-week average',
          '→ Click rate maintaining steady performance',
          '✓ Bounce rate healthy at 0.50%'
        ]
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('Great');
    expect(html).toContain('Opens up, clicks steady, list health good');
    expect(html).toContain('✓ Open rate 10% above 3-week average');
    expect(html).toContain('→ Click rate maintaining steady performance');
    expect(html).toContain('✓ Bounce rate healthy at 0.50%');
    expect(html).toContain('background-color:#28a745');
  });

  it('should not render health scoreboard when healthScore is not provided', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).not.toContain('Opens up, clicks steady');
    expect(html).not.toContain('Great');
    expect(html).not.toContain('Needs Attention');
  });

  it('should render list health section when listHealth is provided', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 995,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 5,
        bounceRate: 0.5,
        unsubscribes: 0,
        cleaned: 5,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      listHealth: {
        deliverabilityRate: 99.5,
        cleanedPct: 0.5,
        bounceRateStatus: 'Normal',
        healthSummary: 'List health is good',
        color: '#28a745'
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('List Health & Deliverability');
    expect(html).toContain('Deliverability Rate');
    expect(html).toContain('99.50%');
    expect(html).toContain('Bounce Rate');
    expect(html).toContain('0.50%');
    expect(html).toContain('Normal');
    expect(html).toContain('Cleaned Addresses');
    expect(html).toContain('5.00');
    expect(html).toContain('0.50%');
    expect(html).toContain('List health is good');
  });

  it('should render list health section with elevated bounce rate', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 985,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 15,
        bounceRate: 1.5,
        unsubscribes: 0,
        cleaned: 5,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      listHealth: {
        deliverabilityRate: 98.5,
        cleanedPct: 0.5,
        bounceRateStatus: 'Elevated',
        healthSummary: 'List health is good',
        color: '#f0ad4e'
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('List Health & Deliverability');
    expect(html).toContain('1.50%');
    expect(html).toContain('Elevated');
    expect(html).toContain('color:#f0ad4e');
  });

  it('should render list health section with high bounce rate', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 975,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 25,
        bounceRate: 2.5,
        unsubscribes: 0,
        cleaned: 5,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      listHealth: {
        deliverabilityRate: 97.5,
        cleanedPct: 0.5,
        bounceRateStatus: 'High',
        healthSummary: 'High bounce rate requires immediate attention',
        color: '#dc3545'
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('List Health & Deliverability');
    expect(html).toContain('2.50%');
    expect(html).toContain('High');
    expect(html).toContain('High bounce rate requires immediate attention');
    expect(html).toContain('color:#dc3545');
  });

  it('should not render list health section when listHealth is not provided', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).not.toContain('Deliverability Rate');
    expect(html).not.toContain('Bounce Rate');
    expect(html).not.toContain('Cleaned Addresses');
  });

  it('should render engagement quality section when engagementQuality is provided', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagementQuality: {
        clicksPerOpener: 0.12,
        clicksPerSubscriber: 0.03,
        opensFirst1hPct: 40.0,
        opensFirst6hPct: 72.0
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('Engagement Quality');
    expect(html).toContain('Clicks per Opener');
    expect(html).toContain('0.12');
    expect(html).toContain('Clicks per Subscriber');
    expect(html).toContain('0.03');
    expect(html).toContain('Opens in First Hour');
    expect(html).toContain('40.00%');
    expect(html).toContain('Opens in First 6 Hours');
    expect(html).toContain('72.00%');
  });

  it('should not render engagement quality section when engagementQuality is not provided', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 30,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test',
        links: null,
        topPerformingLink: { link: 'N/A', count: 0 }
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).not.toContain('Clicks per Opener');
    expect(html).not.toContain('Clicks per Subscriber');
  });

  it('should render enhanced content performance section with subject line', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 100,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Amazing Newsletter Content',
        hasSubjectLine: true,
        hasLinks: true,
        hasMoreThan3Links: false,
        links: [
          { link: 'https://example.com/article1', count: 50, percentage: 50.0 },
          { link: 'https://example.com/article2', count: 30, percentage: 30.0 },
          { link: 'https://example.com/article3', count: 20, percentage: 20.0 }
        ]
      },
      contentPerformance: {
        topLinkPct: 50.0,
        top3Pct: 100.0,
        longTailPct: 0.0,
        concentration: 'Highly concentrated',
        interpretations: {
          topLinkInterpretation: 'Single link dominates',
          top3Interpretation: 'Focused content',
          longTailInterpretation: 'Low variety interest'
        },
        linksTop: [
          { link: 'https://example.com/article1', count: 50, pct: 50.0 },
          { link: 'https://example.com/article2', count: 30, pct: 30.0 },
          { link: 'https://example.com/article3', count: 20, pct: 20.0 }
        ]
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('Content Performance');
    expect(html).toContain('SUBJECT LINE');
    expect(html).toContain('Amazing Newsletter Content');
  });

  it('should render click distribution summary with concentration level', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 100,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test Newsletter',
        hasSubjectLine: true,
        hasLinks: true,
        hasMoreThan3Links: false,
        links: [
          { link: 'https://example.com/article1', count: 50, percentage: 50.0 },
          { link: 'https://example.com/article2', count: 30, percentage: 30.0 },
          { link: 'https://example.com/article3', count: 20, percentage: 20.0 }
        ]
      },
      contentPerformance: {
        topLinkPct: 50.0,
        top3Pct: 100.0,
        longTailPct: 0.0,
        concentration: 'Highly concentrated',
        interpretations: {
          topLinkInterpretation: 'Single link dominates',
          top3Interpretation: 'Focused content',
          longTailInterpretation: 'Low variety interest'
        },
        linksTop: [
          { link: 'https://example.com/article1', count: 50, pct: 50.0 },
          { link: 'https://example.com/article2', count: 30, pct: 30.0 },
          { link: 'https://example.com/article3', count: 20, pct: 20.0 }
        ]
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('Click Distribution');
    expect(html).toContain('Concentration Level');
    expect(html).toContain('Highly concentrated');
    expect(html).toContain('Top Link Share');
    expect(html).toContain('50.00%');
    expect(html).toContain('Top 3 Links Share');
    expect(html).toContain('100.00%');
    expect(html).toContain('Long-Tail Clicks');
    expect(html).toContain('0.00%');
  });

  it('should render top 3 links table with individual percentages', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 100,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test Newsletter',
        hasSubjectLine: true,
        hasLinks: true,
        hasMoreThan3Links: false,
        links: [
          { link: 'https://example.com/article1', count: 50, percentage: 50.0 },
          { link: 'https://example.com/article2', count: 30, percentage: 30.0 },
          { link: 'https://example.com/article3', count: 20, percentage: 20.0 }
        ]
      },
      contentPerformance: {
        topLinkPct: 50.0,
        top3Pct: 100.0,
        longTailPct: 0.0,
        concentration: 'Highly concentrated',
        interpretations: {
          topLinkInterpretation: 'Single link dominates',
          top3Interpretation: 'Focused content',
          longTailInterpretation: 'Low variety interest'
        },
        linksTop: [
          { link: 'https://example.com/article1', count: 50, pct: 50.0 },
          { link: 'https://example.com/article2', count: 30, pct: 30.0 },
          { link: 'https://example.com/article3', count: 20, pct: 20.0 }
        ]
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('Link Performance');
    expect(html).toContain('https://example.com/article1');
    expect(html).toContain('https://example.com/article2');
    expect(html).toContain('https://example.com/article3');
    expect(html).toContain('50.00');
    expect(html).toContain('30.00');
    expect(html).toContain('20.00');
  });

  it('should render moderately concentrated content performance', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 100,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test Newsletter',
        hasSubjectLine: true,
        hasLinks: true,
        hasMoreThan3Links: false,
        links: [
          { link: 'https://example.com/article1', count: 40 },
          { link: 'https://example.com/article2', count: 30 },
          { link: 'https://example.com/article3', count: 20 },
          { link: 'https://example.com/article4', count: 10 }
        ]
      },
      contentPerformance: {
        topLinkPct: 40.0,
        top3Pct: 90.0,
        longTailPct: 10.0,
        concentration: 'Moderately concentrated',
        interpretations: {
          topLinkInterpretation: 'Strong primary interest',
          top3Interpretation: 'Focused content',
          longTailInterpretation: 'Low variety interest'
        },
        linksTop: [
          { link: 'https://example.com/article1', count: 40, pct: 40.0 },
          { link: 'https://example.com/article2', count: 30, pct: 30.0 },
          { link: 'https://example.com/article3', count: 20, pct: 20.0 }
        ]
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('Moderately concentrated');
    expect(html).toContain('40.00%');
    expect(html).toContain('90.00%');
    expect(html).toContain('10.00%');
    expect(html).toContain('Strong primary interest');
  });

  it('should render broad distribution content performance', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 100,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test Newsletter',
        hasSubjectLine: true,
        hasLinks: true,
        hasMoreThan3Links: false,
        links: [
          { link: 'https://example.com/article1', count: 20 },
          { link: 'https://example.com/article2', count: 18 },
          { link: 'https://example.com/article3', count: 17 },
          { link: 'https://example.com/article4', count: 15 },
          { link: 'https://example.com/article5', count: 15 },
          { link: 'https://example.com/article6', count: 15 }
        ]
      },
      contentPerformance: {
        topLinkPct: 20.0,
        top3Pct: 55.0,
        longTailPct: 45.0,
        concentration: 'Broad distribution',
        interpretations: {
          topLinkInterpretation: 'Diverse engagement',
          top3Interpretation: 'Broad appeal',
          longTailInterpretation: 'High variety interest'
        },
        linksTop: [
          { link: 'https://example.com/article1', count: 20, pct: 20.0 },
          { link: 'https://example.com/article2', count: 18, pct: 18.0 },
          { link: 'https://example.com/article3', count: 17, pct: 17.0 }
        ]
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('Broad distribution');
    expect(html).toContain('20.00%');
    expect(html).toContain('55.00%');
    expect(html).toContain('45.00%');
    expect(html).toContain('Diverse engagement');
    expect(html).toContain('High variety interest');
  });

  it('should render all links table when more than 3 links exist', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 100,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test Newsletter',
        hasSubjectLine: true,
        hasLinks: true,
        hasMoreThan3Links: true,
        links: [
          { link: 'https://example.com/article1', count: 40 },
          { link: 'https://example.com/article2', count: 30 },
          { link: 'https://example.com/article3', count: 20 },
          { link: 'https://example.com/article4', count: 10 }
        ]
      },
      contentPerformance: {
        topLinkPct: 40.0,
        top3Pct: 90.0,
        longTailPct: 10.0,
        concentration: 'Moderately concentrated',
        interpretations: {
          topLinkInterpretation: 'Strong primary interest',
          top3Interpretation: 'Focused content',
          longTailInterpretation: 'Low variety interest'
        },
        linksTop: [
          { link: 'https://example.com/article1', count: 40, pct: 40.0 },
          { link: 'https://example.com/article2', count: 30, pct: 30.0 },
          { link: 'https://example.com/article3', count: 20, pct: 20.0 }
        ]
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    expect(html).toContain('All Links');
    expect(html).toContain('https://example.com/article4');
  });

  it('should not render all links table when 3 or fewer links exist', () => {
    const data = {
      issueName: 'Test',
      currentMetrics: {
        openRate: 25.0,
        clickThroughRate: 3.0,
        clickToOpenRate: 12.0,
        growthRate: 5.0,
        subscribers: 1000,
        delivered: 1000,
        uniqueOpens: 250,
        reopens: 0,
        avgTimeToOpen: 7200,
        clicks: 100,
        bounces: 0,
        unsubscribes: 0,
        cleaned: 0,
        sends: 1000
      },
      previousMetrics: {
        openRate: 20.0,
        clickThroughRate: 2.5,
        subscribers: 950,
        clicks: 25
      },
      wowDeltas: {
        openRateWoW: 5.0,
        ctrWoW: 0.5,
        subscribersWoW: 50,
        clicksWoW: 5
      },
      engagement: {
        velocity: {
          '0-1h': 100,
          '1-6h': 80,
          '6-24h': 50,
          '24h+': 20
        },
        timeToOpenBuckets: {},
        deviceBreakdown: {},
        clientBreakdown: {},
        newSubscribers: 50,
        netGrowth: 50
      },
      content: {
        subjectLine: 'Test Newsletter',
        links: [
          { link: 'https://example.com/article1', count: 50 },
          { link: 'https://example.com/article2', count: 30 },
          { link: 'https://example.com/article3', count: 20 }
        ]
      },
      contentPerformance: {
        topLinkPct: 50.0,
        top3Pct: 100.0,
        longTailPct: 0.0,
        concentration: 'Highly concentrated',
        linksTop: [
          { link: 'https://example.com/article1', count: 50, pct: 50.0 },
          { link: 'https://example.com/article2', count: 30, pct: 30.0 },
          { link: 'https://example.com/article3', count: 20, pct: 20.0 }
        ]
      },
      generatedDate: 'January 21, 2026'
    };

    const html = template(data);

    // Check that the "All Links" heading (h4) is not rendered
    expect(html).not.toContain('<h4 style="margin:0 0 10px 0;font-size:14px;color:#666;">All Links</h4>');
  });
});
