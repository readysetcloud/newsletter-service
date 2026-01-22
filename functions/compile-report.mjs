import Handlebars from 'handlebars';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import analyticsReportTemplate from '../templates/analytics-report.hbs';

const eventbridge = new EventBridgeClient();
const template = Handlebars.compile(analyticsReportTemplate);

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

Handlebars.registerHelper('eq', (a, b) => a === b);

const formatDelta = (value) => {
  if (value === null || value === undefined) return null;
  return {
    value: Number(value.toFixed(2)),
    sign: value >= 0 ? '+' : '',
    arrow: value >= 0 ? '▲' : '▼',
    color: value >= 0 ? '#28a745' : '#dc3545'
  };
};

const prepareVisualData = (current, benchmark) => {
  const currentVal = current ?? 0;
  const benchmarkVal = benchmark ?? 0;
  const delta = Number((currentVal - benchmarkVal).toFixed(2));
  const deltaAbs = Math.abs(delta);

  return {
    value: Number(currentVal.toFixed(2)),
    benchmark: Number(benchmarkVal.toFixed(2)),
    delta,
    deltaAbs,
    deltaSign: delta >= 0 ? '+' : '',
    arrow: delta >= 0 ? '▲' : '▼',
    color: delta >= 0 ? '#28a745' : '#dc3545',
    barWidth: Math.min(100, Math.max(2, Number(currentVal.toFixed(2)))),
    benchmarkBarWidth: Math.min(100, Math.max(2, Number(benchmarkVal.toFixed(2))))
  };
};

const prepareEngagementVelocityRows = (velocity, uniqueOpens) => {
  const pct = (num, den) => den > 0 ? Number(((Number(num) / Number(den)) * 100).toFixed(2)) : 0;
  const periods = [
    { label: '0-1 hour', key: '0-1h', color: '#4a90e2' },
    { label: '1-6 hours', key: '1-6h', color: '#5cb85c' },
    { label: '6-24 hours', key: '6-24h', color: '#f0ad4e' },
    { label: '24+ hours', key: '24h+', color: '#d9534f' }
  ];

  return periods.map(period => {
    const value = velocity[period.key] || 0;
    const percentage = pct(value, uniqueOpens);
    return {
      label: period.label,
      value,
      percentage: Number(percentage.toFixed(1)),
      barWidth: Math.min(100, Math.max(2, percentage)),
      color: period.color
    };
  });
};

const prepareTimeToOpenRows = (buckets, uniqueOpens) => {
  const pct = (num, den) => den > 0 ? Number(((Number(num) / Number(den)) * 100).toFixed(2)) : 0;
  const ranges = [
    { label: '0-15 minutes', key: '0-15m' },
    { label: '15-30 minutes', key: '15-30m' },
    { label: '30-60 minutes', key: '30-60m' },
    { label: '1-3 hours', key: '1-3h' },
    { label: '3-6 hours', key: '3-6h' },
    { label: '6-12 hours', key: '6-12h' },
    { label: '12-24 hours', key: '12-24h' },
    { label: '24+ hours', key: '24h+' }
  ];

  return ranges.map(range => {
    const value = buckets[range.key] || 0;
    const percentage = pct(value, uniqueOpens);
    return {
      label: range.label,
      value,
      percentage: Number(percentage.toFixed(1))
    };
  });
};

const prepareDeviceClientRows = (breakdown, uniqueOpens) => {
  const pct = (num, den) => den > 0 ? Number(((Number(num) / Number(den)) * 100).toFixed(2)) : 0;
  return Object.entries(breakdown).map(([name, value]) => ({
    name,
    value,
    percentage: Number(pct(value, uniqueOpens).toFixed(1))
  }));
};

const prepareTrendsRows = (historicalMetrics, bestInLast4) => {
  return historicalMetrics.map(metric => ({
    issueName: metric.issueName,
    date: metric.date,
    openRate: {
      value: Number(Number(metric.openRate).toFixed(2)),
      isBest: metric.openRate === bestInLast4.openRate.value
    },
    ctr: {
      value: Number(Number(metric.ctr).toFixed(2)),
      isBest: metric.ctr === bestInLast4.ctr.value
    },
    clicks: {
      value: metric.clicks,
      isBest: metric.clicks === bestInLast4.clicks.value
    },
    subscribers: {
      value: metric.subscribers,
      isBest: metric.subscribers === bestInLast4.subscribers.value
    }
  }));
};

const prepareLinksWithPercentages = (links, totalClicks) => {
  const pct = (num, den) => den > 0 ? (Number(num) / Number(den)) * 100 : 0;
  return links.map(link => ({
    link: link.link,
    count: Number(link.count),
    percentage: pct(link.count, totalClicks).toFixed(1)
  }));
};

export const handler = async (event) => {
  try {
    const { insightData, insights, subject, tenantId, recipientEmail, issueId } = event;

    const issueName = issueId || 'N/A';
    const uniqueOpens = insightData.currentMetrics.uniqueOpens;
    const totalClicks = insightData.currentMetrics.clicks;

    const formattedWowDeltas = {
      openRateWoW: insightData.wowDeltas.openRateWoW !== null ? formatDelta(insightData.wowDeltas.openRateWoW) : null,
      ctrWoW: insightData.wowDeltas.ctrWoW !== null ? formatDelta(insightData.wowDeltas.ctrWoW) : null,
      subscribersWoW: insightData.wowDeltas.subscribersWoW !== null ? formatDelta(insightData.wowDeltas.subscribersWoW) : null,
      clicksWoW: insightData.wowDeltas.clicksWoW !== null ? formatDelta(insightData.wowDeltas.clicksWoW) : null
    };

    const velocityRows = prepareEngagementVelocityRows(insightData.engagement.velocity, uniqueOpens);
    const timeToOpenRows = prepareTimeToOpenRows(insightData.engagement.timeToOpenBuckets, uniqueOpens);
    const deviceRows = prepareDeviceClientRows(insightData.engagement.deviceBreakdown, uniqueOpens);
    const clientRows = prepareDeviceClientRows(insightData.engagement.clientBreakdown, uniqueOpens);
    const trendsRows = prepareTrendsRows(
      insightData.trends.lastIssues,
      insightData.trends.bestInLast4
    );
    const allLinksWithPct = insightData.content.links && insightData.content.links.length > 0
      ? prepareLinksWithPercentages(insightData.content.links, totalClicks)
      : [];

    const visualData = {
      openRate: prepareVisualData(insightData.currentMetrics.openRate, insightData.benchmarks.openRateAvg3 || 0),
      ctr: prepareVisualData(insightData.currentMetrics.clickThroughRate, insightData.benchmarks.ctrAvg3 || 0),
      bounceRate: {
        ...prepareVisualData(insightData.currentMetrics.bounceRate, insightData.benchmarks.bounceRateAvg3 || 0),
        color: insightData.currentMetrics.bounceRate >= insightData.benchmarks.bounceRateTarget ? '#dc3545' : '#28a745'
      },
      growthRate: prepareVisualData(insightData.currentMetrics.growthRate, insightData.benchmarks.growthRateAvg3 || 0)
    };

    const bounceRateStatus = {
      isAboveTarget: visualData.bounceRate.value >= insightData.benchmarks.bounceRateTarget,
      text: visualData.bounceRate.value >= insightData.benchmarks.bounceRateTarget ? '⚠ Above target' : '✓ Below target'
    };

    const deliverabilityStatus = {
      isExcellent: insightData.listHealth.deliverabilityRate >= 95,
      text: insightData.listHealth.deliverabilityRate >= 95 ? '✓ Excellent' : '⚠ Below Optimal'
    };

    const cleanedStatus = {
      isSignificant: insightData.listHealth.cleanedPct > 2,
      text: insightData.listHealth.cleanedPct > 2 ? '⚠ Significant' : '✓ Normal'
    };

    const contentConcentrationInterpretations = {
      topLinkInterpretation: insightData.contentPerformance.topLinkPct >= 50 ? 'Single link dominates' :
                             insightData.contentPerformance.topLinkPct >= 30 ? 'Strong primary interest' : 'Diverse engagement',
      top3Interpretation: insightData.contentPerformance.top3Pct >= 80 ? 'Focused content' : 'Broad appeal',
      longTailInterpretation: insightData.contentPerformance.longTailPct >= 30 ? 'High variety interest' : 'Low variety interest'
    };

    const hasDeviceData = Object.keys(insightData.engagement.deviceBreakdown || {}).length > 0;
    const hasClientData = Object.keys(insightData.engagement.clientBreakdown || {}).length > 0;
    const hasMoreThan3Links = insightData.content.linkCount > 3;

    const templateData = {
      issueName,
      currentMetrics: {
        ...insightData.currentMetrics,
        growthRateColor: insightData.currentMetrics.growthRate >= 0 ? '#28a745' : '#dc3545'
      },
      previousMetrics: insightData.previousMetrics || { openRate: 0, clickThroughRate: 0, subscribers: 0, clicks: 0 },
      wowDeltas: formattedWowDeltas,
      benchmarks: insightData.benchmarks,
      healthScore: insightData.healthScore,
      contentPerformance: {
        ...insightData.contentPerformance,
        interpretations: contentConcentrationInterpretations
      },
      listHealth: {
        ...insightData.listHealth,
        deliverabilityStatus,
        cleanedStatus
      },
      engagementQuality: insightData.engagementQuality,
      trends: {
        ...insightData.trends,
        rows: trendsRows,
        hasData: trendsRows.length > 0
      },
      visual: {
        ...visualData,
        bounceRateStatus
      },
      engagement: {
        velocityRows,
        timeToOpenRows,
        deviceRows,
        clientRows,
        hasDeviceData,
        hasClientData,
        newSubscribers: insightData.engagement.newSubscribers,
        netGrowth: insightData.engagement.netGrowth,
        netGrowthColor: insightData.engagement.netGrowth >= 0 ? '#28a745' : '#dc3545',
        netGrowthSign: insightData.engagement.netGrowth >= 0 ? '+' : ''
      },
      content: {
        subjectLine: insightData.content.subjectLine || 'N/A',
        hasSubjectLine: !!insightData.content.subjectLine,
        links: allLinksWithPct,
        hasLinks: allLinksWithPct.length > 0,
        hasMoreThan3Links,
        topPerformingLink: insightData.content.topPerformingLink
      },
      generatedDate: new Date().toLocaleDateString(),
      insights: insights && insights.length > 0 ? insights : null
    };

    const html = template(templateData);

    await eventbridge.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'newsletter-service',
          DetailType: 'Send Email v2',
          Detail: JSON.stringify({
            subject,
            to: { email: recipientEmail },
            html,
            tenantId
          })
        }
      ]
    }));

    return {
      success: true,
      subject
    };
  } catch (error) {
    console.error('Error compiling and sending report:', error);
    throw error;
  }
};
