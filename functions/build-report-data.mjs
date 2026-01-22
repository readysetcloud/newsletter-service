import { DynamoDBClient, PutItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient();
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const pct = (num, den) => den > 0 ? Number(((n(num) / n(den)) * 100).toFixed(2)) : 0;

const normalizeISOTimestamp = (timestamp) => {
  if (!timestamp) return new Date().toISOString();

  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date().toISOString();
    }
    return date.toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const isValidTimestamp = (timestamp) => {
  if (!timestamp) return false;
  try {
    const date = new Date(timestamp);
    return !isNaN(date.getTime());
  } catch {
    return false;
  }
};

const queryOpensRecords = async (issueId) => {
  const opens = [];
  let lastEvaluatedKey;

  do {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: marshall({
        ':pk': issueId,
        ':sk': 'opens#'
      }),
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    if (response.Items) {
      opens.push(...response.Items.map(item => unmarshall(item)));
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return opens;
};

const queryLinkClickRecords = async (issueId) => {
  const clicks = [];
  let lastEvaluatedKey;

  do {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: marshall({
        ':pk': issueId,
        ':sk': 'link#'
      }),
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    if (response.Items) {
      clicks.push(...response.Items.map(item => unmarshall(item)));
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return clicks;
};

const aggregateClickGeography = (clickRecords) => {
  let totalClicks = 0;
  const geoBreakdown = {};

  clickRecords.forEach(record => {
    const clicksTotal = record.clicks_total || 0;
    totalClicks += clicksTotal;

    if (record.byDay && typeof record.byDay === 'object') {
      Object.entries(record.byDay).forEach(([day, count]) => {
        if (!geoBreakdown[day]) {
          geoBreakdown[day] = 0;
        }
        geoBreakdown[day] += count;
      });
    }
  });

  return {
    totalClicks,
    geoBreakdown
  };
};

const parseUserAgent = (userAgent) => {
  if (!userAgent) return { device: 'Unknown', client: 'Unknown' };

  const ua = userAgent.toLowerCase();
  let device = 'Desktop';
  let client = 'Unknown';

  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
    device = 'Mobile';
  } else if (ua.includes('tablet')) {
    device = 'Tablet';
  }

  if (ua.includes('gmail')) {
    client = 'Gmail';
  } else if (ua.includes('outlook') || ua.includes('microsoft')) {
    client = 'Outlook';
  } else if (ua.includes('apple mail') || ua.includes('mail.app')) {
    client = 'Apple Mail';
  } else if (ua.includes('yahoo')) {
    client = 'Yahoo Mail';
  } else if (ua.includes('thunderbird')) {
    client = 'Thunderbird';
  } else if (ua.includes('chrome')) {
    client = 'Chrome';
  } else if (ua.includes('firefox')) {
    client = 'Firefox';
  } else if (ua.includes('safari')) {
    client = 'Safari';
  } else if (ua.includes('edge')) {
    client = 'Edge';
  }

  return { device, client };
};

const consolidateOpensData = (opensRecords, sentDate) => {
  if (!opensRecords.length || !isValidTimestamp(sentDate)) {
    return {
      uniqueOpens: 0,
      avgTimeToOpen: 0,
      engagementVelocity: { '0-1h': 0, '1-6h': 0, '6-24h': 0, '24h+': 0 },
      timeToOpenBuckets: { '0-15m': 0, '15-30m': 0, '30-60m': 0, '1-3h': 0, '3-6h': 0, '6-12h': 0, '12-24h': 0, '24h+': 0 },
      deviceBreakdown: {},
      clientBreakdown: {}
    };
  }

  const validOpensRecords = opensRecords.filter(record => isValidTimestamp(record.createdAt));

  if (!validOpensRecords.length) {
    return {
      uniqueOpens: 0,
      avgTimeToOpen: 0,
      engagementVelocity: { '0-1h': 0, '1-6h': 0, '6-24h': 0, '24h+': 0 },
      timeToOpenBuckets: { '0-15m': 0, '15-30m': 0, '30-60m': 0, '1-3h': 0, '3-6h': 0, '6-12h': 0, '12-24h': 0, '24h+': 0 },
      deviceBreakdown: {},
      clientBreakdown: {}
    };
  }

  const sentTime = new Date(sentDate).getTime();
  let totalTimeToOpen = 0;
  let countedOpens = 0;
  const velocity = { '0-1h': 0, '1-6h': 0, '6-24h': 0, '24h+': 0 };
  const timeToOpenBuckets = { '0-15m': 0, '15-30m': 0, '30-60m': 0, '1-3h': 0, '3-6h': 0, '6-12h': 0, '12-24h': 0, '24h+': 0 };
  const deviceBreakdown = {};
  const clientBreakdown = {};

  validOpensRecords.forEach(record => {
    const openTime = new Date(record.createdAt).getTime();
    const timeDiff = openTime - sentTime;

    if (timeDiff < 0) return;

    countedOpens++;
    const timeToOpenHours = timeDiff / (1000 * 60 * 60);
    const timeToOpenMinutes = timeDiff / (1000 * 60);
    totalTimeToOpen += timeDiff / 1000;

    if (timeToOpenHours <= 1) {
      velocity['0-1h']++;
    } else if (timeToOpenHours <= 6) {
      velocity['1-6h']++;
    } else if (timeToOpenHours <= 24) {
      velocity['6-24h']++;
    } else {
      velocity['24h+']++;
    }

    if (timeToOpenMinutes <= 15) {
      timeToOpenBuckets['0-15m']++;
    } else if (timeToOpenMinutes <= 30) {
      timeToOpenBuckets['15-30m']++;
    } else if (timeToOpenMinutes <= 60) {
      timeToOpenBuckets['30-60m']++;
    } else if (timeToOpenHours <= 3) {
      timeToOpenBuckets['1-3h']++;
    } else if (timeToOpenHours <= 6) {
      timeToOpenBuckets['3-6h']++;
    } else if (timeToOpenHours <= 12) {
      timeToOpenBuckets['6-12h']++;
    } else if (timeToOpenHours <= 24) {
      timeToOpenBuckets['12-24h']++;
    } else {
      timeToOpenBuckets['24h+']++;
    }

    const { device, client } = parseUserAgent(record.userAgent);
    deviceBreakdown[device] = (deviceBreakdown[device] || 0) + 1;
    clientBreakdown[client] = (clientBreakdown[client] || 0) + 1;
  });

  const uniqueOpens = countedOpens;
  const avgTimeToOpen = countedOpens > 0 ? Math.round(totalTimeToOpen / countedOpens) : 0;

  return { uniqueOpens, avgTimeToOpen, engagementVelocity: velocity, timeToOpenBuckets, deviceBreakdown, clientBreakdown };
};

const updateStatsWithConsolidatedData = async (issueId, consolidatedData) => {
  const updateExpression = [
    'SET uniqueOpens = :uniqueOpens',
    'avgTimeToOpen = :avgTimeToOpen',
    'engagementVelocity = :velocity',
    'timeToOpenBuckets = :timeToOpenBuckets',
    'deviceBreakdown = :deviceBreakdown',
    'clientBreakdown = :clientBreakdown',
    'consolidatedAt = :timestamp'
  ].join(', ');

  const expressionAttributeValues = {
    ':uniqueOpens': consolidatedData.uniqueOpens,
    ':avgTimeToOpen': consolidatedData.avgTimeToOpen,
    ':velocity': consolidatedData.engagementVelocity,
    ':timeToOpenBuckets': consolidatedData.timeToOpenBuckets || {},
    ':deviceBreakdown': consolidatedData.deviceBreakdown || {},
    ':clientBreakdown': consolidatedData.clientBreakdown || {},
    ':timestamp': new Date().toISOString()
  };

  if (consolidatedData.clickGeography) {
    expressionAttributeValues[':clickGeography'] = consolidatedData.clickGeography;
  }

  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: issueId,
      sk: 'stats'
    }),
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: marshall(expressionAttributeValues)
  }));
};

const queryPreviousIssueAnalytics = async (currentIssueId, currentSentDate) => {
  const tenantId = currentIssueId.split('#')[0];

  try {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK < :currentDate',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': `${tenantId}#analytics`,
        ':currentDate': currentSentDate
      }),
      ScanIndexForward: false,
      Limit: 1
    }));

    if (response.Items && response.Items.length > 0) {
      return unmarshall(response.Items[0]);
    }

    return null;
  } catch (error) {
    console.error('Error querying previous issue analytics:', error);
    return null;
  }
};

const queryHistoricalAnalytics = async (currentIssueId, currentSentDate) => {
  const tenantId = currentIssueId.split('#')[0];

  try {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK < :currentDate',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': `${tenantId}#analytics`,
        ':currentDate': currentSentDate
      }),
      ScanIndexForward: false,
      Limit: 4
    }));

    if (response.Items && response.Items.length > 0) {
      return response.Items.map(item => unmarshall(item));
    }

    return [];
  } catch (error) {
    console.error('Error querying historical analytics:', error);
    return [];
  }
};

const avg = (values) => {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + n(val), 0);
  return Number((sum / values.length).toFixed(2));
};

const calculateBenchmarks = (historicalIssues) => {
  if (!historicalIssues || historicalIssues.length === 0) {
    return {
      openRateAvg3: 0,
      ctrAvg3: 0,
      bounceRateAvg3: 0,
      growthRateAvg3: 0,
      bounceRateTarget: 2,
      steadyStateGrowth: 0
    };
  }

  const openRates = historicalIssues
    .map(issue => issue.data?.currentMetrics?.openRate)
    .filter(val => val !== null && val !== undefined);

  const ctrs = historicalIssues
    .map(issue => issue.data?.currentMetrics?.clickThroughRate)
    .filter(val => val !== null && val !== undefined);

  const bounceRates = historicalIssues
    .map(issue => issue.data?.currentMetrics?.bounceRate)
    .filter(val => val !== null && val !== undefined);

  const growthRates = historicalIssues
    .map(issue => issue.data?.currentMetrics?.growthRate)
    .filter(val => val !== null && val !== undefined);

  return {
    openRateAvg3: avg(openRates),
    ctrAvg3: avg(ctrs),
    bounceRateAvg3: avg(bounceRates),
    growthRateAvg3: avg(growthRates),
    bounceRateTarget: 2,
    steadyStateGrowth: 0
  };
};

const calculateHealthScore = (metrics, benchmarksSafe) => {
  let score = 0;

  const openRateBenchmark = benchmarksSafe.openRateAvg3 || 0;
  const ctrBenchmark = benchmarksSafe.ctrAvg3 || 0;

  if (openRateBenchmark > 0) {
    if (metrics.openRate >= openRateBenchmark * 1.1) {
      score += 30;
    } else if (metrics.openRate >= openRateBenchmark * 0.9) {
      score += 20;
    } else {
      score += 10;
    }
  } else {
    score += 20;
  }

  if (ctrBenchmark > 0) {
    if (metrics.clickThroughRate >= ctrBenchmark * 1.1) {
      score += 30;
    } else if (metrics.clickThroughRate >= ctrBenchmark * 0.9) {
      score += 20;
    } else {
      score += 10;
    }
  } else {
    score += 20;
  }

  if (metrics.bounceRate < 1) {
    score += 20;
  } else if (metrics.bounceRate < 2) {
    score += 10;
  }

  if (metrics.growthRate > 1) {
    score += 20;
  } else if (metrics.growthRate >= 0) {
    score += 10;
  }

  const status = score >= 80 ? 'Great' : score >= 60 ? 'OK' : 'Needs Attention';
  const color = score >= 80 ? '#28a745' : score >= 60 ? '#f0ad4e' : '#dc3545';

  const summary = generateHealthSummary(metrics, benchmarksSafe);
  const bullets = generateHealthBullets(metrics, benchmarksSafe);

  return {
    score,
    status,
    color,
    summary,
    bullets
  };
};

const generateHealthSummary = (metrics, benchmarksSafe) => {
  const parts = [];

  const openRateBenchmark = benchmarksSafe.openRateAvg3 || 0;
  const ctrBenchmark = benchmarksSafe.ctrAvg3 || 0;

  if (openRateBenchmark > 0) {
    if (metrics.openRate >= openRateBenchmark * 1.1) {
      parts.push('Opens up');
    } else if (metrics.openRate < openRateBenchmark * 0.9) {
      parts.push('Opens down');
    } else {
      parts.push('Opens steady');
    }
  } else {
    parts.push('Opens tracked');
  }

  if (ctrBenchmark > 0) {
    if (metrics.clickThroughRate >= ctrBenchmark * 1.1) {
      parts.push('clicks up');
    } else if (metrics.clickThroughRate < ctrBenchmark * 0.9) {
      parts.push('clicks down');
    } else {
      parts.push('clicks steady');
    }
  } else {
    parts.push('clicks tracked');
  }

  if (metrics.bounceRate >= 2) {
    parts.push('list health needs attention');
  } else if (metrics.bounceRate >= 1) {
    parts.push('list health OK');
  } else {
    parts.push('list health good');
  }

  return parts.join(', ');
};

const generateHealthBullets = (metrics, benchmarksSafe) => {
  const bullets = [];

  const openRateBenchmark = benchmarksSafe.openRateAvg3 || 0;
  const ctrBenchmark = benchmarksSafe.ctrAvg3 || 0;

  if (openRateBenchmark > 0) {
    const openRateDelta = metrics.openRate - openRateBenchmark;
    const openRatePctChange = Number(((openRateDelta / openRateBenchmark) * 100).toFixed(1));

    if (metrics.openRate >= openRateBenchmark * 1.1) {
      bullets.push(`✓ Open rate ${Math.abs(openRatePctChange)}% above 3-week average`);
    } else if (metrics.openRate < openRateBenchmark * 0.9) {
      bullets.push(`⚠ Open rate ${Math.abs(openRatePctChange)}% below 3-week average`);
    } else {
      bullets.push(`→ Open rate maintaining steady performance`);
    }
  }

  if (ctrBenchmark > 0) {
    const ctrDelta = metrics.clickThroughRate - ctrBenchmark;
    const ctrPctChange = Number(((ctrDelta / ctrBenchmark) * 100).toFixed(1));

    if (metrics.clickThroughRate >= ctrBenchmark * 1.1) {
      bullets.push(`✓ Click rate ${Math.abs(ctrPctChange)}% above 3-week average`);
    } else if (metrics.clickThroughRate < ctrBenchmark * 0.9) {
      bullets.push(`⚠ Click rate ${Math.abs(ctrPctChange)}% below 3-week average`);
    } else {
      bullets.push(`→ Click rate maintaining steady performance`);
    }
  }

  if (metrics.bounceRate >= 2) {
    bullets.push(`⚠ Bounce rate at ${n(metrics.bounceRate).toFixed(2)}% - investigate deliverability`);
  } else if (metrics.bounceRate >= 1) {
    bullets.push(`→ Bounce rate at ${n(metrics.bounceRate).toFixed(2)}% - monitor closely`);
  } else {
    bullets.push(`✓ Bounce rate healthy at ${n(metrics.bounceRate).toFixed(2)}%`);
  }

  if (metrics.growthRate > 1) {
    bullets.push(`✓ List growing at ${n(metrics.growthRate).toFixed(2)}%`);
  } else if (metrics.growthRate < 0) {
    bullets.push(`⚠ List shrinking at ${Math.abs(n(metrics.growthRate)).toFixed(2)}%`);
  }

  return bullets.slice(0, 3);
};

const extractHistoricalMetrics = (historicalIssues) => {
  if (!historicalIssues || historicalIssues.length === 0) {
    return [];
  }

  return historicalIssues.map(issue => {
    const metrics = issue.data?.currentMetrics || {};
    const issueName = issue.pk ? issue.pk.split('#')[1]?.split('_')[1]?.split('.')[0]?.replace('-', ' ') : 'Unknown';
    const issueDate = issue.GSI1SK ? new Date(issue.GSI1SK).toISOString().split('T')[0] : 'Unknown';

    return {
      issueName: issueName || 'Unknown',
      date: issueDate,
      openRate: n(metrics.openRate),
      ctr: n(metrics.clickThroughRate),
      ctor: n(metrics.clickToOpenRate),
      clicks: n(metrics.clicks),
      subscribers: n(metrics.subscribers),
      bounceRate: n(metrics.bounceRate)
    };
  });
};

const calculateRolling3Avg = (historicalMetrics) => {
  if (!historicalMetrics || historicalMetrics.length === 0) {
    return {
      openRate: 0,
      ctr: 0,
      ctor: 0,
      clicks: 0,
      subscribers: 0,
      bounceRate: 0
    };
  }

  const last3 = historicalMetrics.slice(0, Math.min(3, historicalMetrics.length));

  return {
    openRate: avg(last3.map(m => m.openRate)),
    ctr: avg(last3.map(m => m.ctr)),
    ctor: avg(last3.map(m => m.ctor)),
    clicks: Math.round(avg(last3.map(m => m.clicks))),
    subscribers: Math.round(avg(last3.map(m => m.subscribers))),
    bounceRate: avg(last3.map(m => m.bounceRate))
  };
};

const identifyBestInLast4 = (historicalMetrics) => {
  if (!historicalMetrics || historicalMetrics.length === 0) {
    return {
      openRate: { value: 0, issueName: 'N/A' },
      ctr: { value: 0, issueName: 'N/A' },
      ctor: { value: 0, issueName: 'N/A' },
      clicks: { value: 0, issueName: 'N/A' },
      subscribers: { value: 0, issueName: 'N/A' }
    };
  }

  const bestOpenRate = historicalMetrics.reduce((best, current) =>
    current.openRate > best.openRate ? current : best
  );

  const bestCtr = historicalMetrics.reduce((best, current) =>
    current.ctr > best.ctr ? current : best
  );

  const bestCtor = historicalMetrics.reduce((best, current) =>
    current.ctor > best.ctor ? current : best
  );

  const bestClicks = historicalMetrics.reduce((best, current) =>
    current.clicks > best.clicks ? current : best
  );

  const bestSubscribers = historicalMetrics.reduce((best, current) =>
    current.subscribers > best.subscribers ? current : best
  );

  return {
    openRate: { value: bestOpenRate.openRate, issueName: bestOpenRate.issueName },
    ctr: { value: bestCtr.ctr, issueName: bestCtr.issueName },
    ctor: { value: bestCtor.ctor, issueName: bestCtor.issueName },
    clicks: { value: bestClicks.clicks, issueName: bestClicks.issueName },
    subscribers: { value: bestSubscribers.subscribers, issueName: bestSubscribers.issueName }
  };
};

const structureTrendsData = (historicalIssues) => {
  if (!historicalIssues || historicalIssues.length === 0) {
    return {
      lastIssues: [],
      rolling3Avg: {
        openRate: 0,
        ctr: 0,
        ctor: 0,
        clicks: 0,
        subscribers: 0,
        bounceRate: 0
      },
      bestInLast4: {
        openRate: { value: 0, issueName: 'N/A' },
        ctr: { value: 0, issueName: 'N/A' },
        ctor: { value: 0, issueName: 'N/A' },
        clicks: { value: 0, issueName: 'N/A' },
        subscribers: { value: 0, issueName: 'N/A' }
      }
    };
  }

  const historicalMetrics = extractHistoricalMetrics(historicalIssues);
  const rolling3Avg = calculateRolling3Avg(historicalMetrics);
  const bestInLast4 = identifyBestInLast4(historicalMetrics);

  return {
    lastIssues: historicalMetrics,
    rolling3Avg,
    bestInLast4
  };
};

const analyzeContentPerformance = (links, totalClicks) => {
  if (!links || links.length === 0 || totalClicks === 0) {
    return {
      topLinkPct: 0,
      top3Pct: 0,
      longTailPct: 0,
      concentration: 'No clicks',
      linksTop: []
    };
  }

  const sortedLinks = [...links].sort((a, b) => n(b.count) - n(a.count));
  const topLink = sortedLinks[0];
  const top3 = sortedLinks.slice(0, 3);

  const topLinkPct = pct(topLink.count, totalClicks);
  const top3Pct = pct(
    top3.reduce((sum, l) => sum + n(l.count), 0),
    totalClicks
  );
  const longTailPct = Number((100 - top3Pct).toFixed(2));

  const concentration = topLinkPct >= 50 ? 'Highly concentrated' :
                       topLinkPct >= 30 ? 'Moderately concentrated' :
                       'Broad distribution';

  return {
    topLinkPct,
    top3Pct,
    longTailPct,
    concentration,
    linksTop: top3.map((l, index) => ({
      link: l.link,
      count: n(l.count),
      pct: pct(l.count, totalClicks),
      rank: index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'
    }))
  };
};

const classifyListHealth = (metrics) => {
  const deliverabilityRate = pct(metrics.delivered, metrics.sends);
  const cleanedPct = pct(metrics.cleaned, metrics.subscribers);

  let bounceRateStatus = 'Normal';
  if (metrics.bounceRate > 2) {
    bounceRateStatus = 'High';
  } else if (metrics.bounceRate > 1) {
    bounceRateStatus = 'Elevated';
  }

  let healthSummary = '';
  if (bounceRateStatus === 'High') {
    healthSummary = 'High bounce rate requires immediate attention';
  } else if (deliverabilityRate < 95) {
    healthSummary = 'Deliverability below optimal threshold';
  } else if (cleanedPct > 2) {
    healthSummary = 'Significant list cleaning occurred';
  } else {
    healthSummary = 'List health is good';
  }

  const color = bounceRateStatus === 'High' ? '#dc3545' :
                bounceRateStatus === 'Elevated' ? '#f0ad4e' : '#28a745';

  return {
    deliverabilityRate,
    cleanedPct,
    bounceRateStatus,
    healthSummary,
    color
  };
};

const calculateEngagementQuality = (metrics, velocity) => {
  const clicksPerOpener = metrics.uniqueOpens > 0
    ? Number((metrics.clicks / metrics.uniqueOpens).toFixed(2))
    : 0;

  const clicksPerSubscriber = metrics.subscribers > 0
    ? Number((metrics.clicks / metrics.subscribers).toFixed(2))
    : 0;

  const opensFirst1h = velocity['0-1h'] || 0;
  const opensFirst6h = (velocity['0-1h'] || 0) + (velocity['1-6h'] || 0);

  const opensFirst1hPct = pct(opensFirst1h, metrics.uniqueOpens);
  const opensFirst6hPct = pct(opensFirst6h, metrics.uniqueOpens);

  return {
    clicksPerOpener,
    clicksPerSubscriber,
    opensFirst1hPct,
    opensFirst6hPct
  };
};

export const handler = async (state) => {
  let consolidatedData = null;
  let previousIssueAnalytics = null;
  let historicalIssues = [];
  let benchmarks = null;

  try {
    if (state.subscribers == null || state.priorSubscribers == null || !state.stats) {
      throw new Error('Missing required state data');
    }

    const normalizedSentDate = normalizeISOTimestamp(state.sentDate);

    const subscribers = n(state.subscribers);
    const priorSubscribers = n(state.priorSubscribers);

    const safeGrowthRate = priorSubscribers > 0
      ? Number((((subscribers - priorSubscribers) / priorSubscribers) * 100).toFixed(2))
      : (subscribers > 0 ? 100 : 0);

    const stats = unmarshall(state.stats);

    const deliveries = n(stats.deliveries);
    const totalOpens = n(stats.opens);
    const reopens = n(stats.reopens);
    const bounces = n(stats.bounces);
    const unsubscribes = n(stats.unsubscribes);
    const sends = n(stats.sends);
    const cleaned = n(stats.cleaned);

    const bounceRate = pct(bounces, sends);

    try {
      const opensRecords = await queryOpensRecords(state.issue);
      consolidatedData = consolidateOpensData(opensRecords, normalizedSentDate);

      const clickRecords = await queryLinkClickRecords(state.issue);
      const clickGeography = aggregateClickGeography(clickRecords);
      consolidatedData.clickGeography = clickGeography;

      await updateStatsWithConsolidatedData(state.issue, consolidatedData);
    } catch (consolidationError) {
      console.error('Consolidation failed, using fallback:', consolidationError);
      consolidatedData = {
        uniqueOpens: totalOpens,
        avgTimeToOpen: 0,
        engagementVelocity: { '0-1h': 0, '1-6h': 0, '6-24h': 0, '24h+': 0 },
        timeToOpenBuckets: { '0-15m': 0, '15-30m': 0, '30-60m': 0, '1-3h': 0, '3-6h': 0, '6-12h': 0, '12-24h': 0, '24h+': 0 },
        deviceBreakdown: {},
        clientBreakdown: {}
      };
    }

    previousIssueAnalytics = await queryPreviousIssueAnalytics(state.issue, normalizedSentDate);
    historicalIssues = await queryHistoricalAnalytics(state.issue, normalizedSentDate);
    benchmarks = calculateBenchmarks(historicalIssues);

    const benchmarksSafe = benchmarks ?? {
      openRateAvg3: 0,
      ctrAvg3: 0,
      bounceRateAvg3: 0,
      growthRateAvg3: 0,
      bounceRateTarget: 2,
      steadyStateGrowth: 0
    };

    const uniqueOpens = consolidatedData.uniqueOpens;

    const links = Array.isArray(state.links) ? state.links : [];
    const totalClicks = links.reduce((sum, l) => sum + n(l.count), 0);

    const openRate = pct(uniqueOpens, deliveries);
    const clickThroughRate = pct(totalClicks, deliveries);
    const clickToOpenRate = pct(totalClicks, uniqueOpens);

    const topPerformingLink = links.length
      ? links.reduce((prev, cur) => n(prev.count) > n(cur.count) ? prev : cur)
      : { link: 'N/A', count: 0 };

    const netGrowth = subscribers - priorSubscribers;
    const newSubscribers = Math.max(0, netGrowth + unsubscribes + cleaned);
    const openToClickRatio = openRate > 0 ? Number(((clickThroughRate / openRate) * 100).toFixed(2)) : 0;

    const calculateDelta = (current, previous) => {
      if (previous === null || previous === undefined) return null;
      return Number((current - previous).toFixed(2));
    };

    const wowDeltas = previousIssueAnalytics ? {
      openRateWoW: calculateDelta(openRate, previousIssueAnalytics.data?.currentMetrics?.openRate || 0),
      ctrWoW: calculateDelta(clickThroughRate, previousIssueAnalytics.data?.currentMetrics?.clickThroughRate || 0),
      subscribersWoW: calculateDelta(subscribers, previousIssueAnalytics.data?.currentMetrics?.subscribers || 0),
      clicksWoW: calculateDelta(totalClicks, previousIssueAnalytics.data?.currentMetrics?.clicks || 0)
    } : {
      openRateWoW: null,
      ctrWoW: null,
      subscribersWoW: null,
      clicksWoW: null
    };

    const contentPerformance = analyzeContentPerformance(links, totalClicks);

    const listHealth = classifyListHealth({
      delivered: deliveries,
      sends,
      cleaned,
      subscribers,
      bounceRate
    });

    const engagementQuality = calculateEngagementQuality(
      {
        uniqueOpens,
        clicks: totalClicks,
        subscribers
      },
      consolidatedData.engagementVelocity
    );

    const trends = structureTrendsData(historicalIssues);

    const insightData = {
      currentMetrics: {
        openRate,
        clickThroughRate,
        clickToOpenRate,
        bounceRate,
        growthRate: safeGrowthRate,
        subscribers,
        delivered: deliveries,
        uniqueOpens,
        reopens,
        avgTimeToOpen: consolidatedData.avgTimeToOpen,
        clicks: totalClicks,
        bounces,
        unsubscribes,
        cleaned,
        sends
      },
      previousMetrics: previousIssueAnalytics ? {
        openRate: previousIssueAnalytics.data?.currentMetrics?.openRate || 0,
        clickThroughRate: previousIssueAnalytics.data?.currentMetrics?.clickThroughRate || 0,
        subscribers: previousIssueAnalytics.data?.currentMetrics?.subscribers || 0,
        clicks: previousIssueAnalytics.data?.currentMetrics?.clicks || 0
      } : null,
      wowDeltas,
      benchmarks: benchmarksSafe,
      healthScore: calculateHealthScore(
        {
          openRate,
          clickThroughRate,
          bounceRate,
          growthRate: safeGrowthRate
        },
        benchmarksSafe
      ),
      contentPerformance,
      listHealth,
      engagementQuality,
      trends,
      content: {
        subjectLine: state.subjectLine || 'N/A',
        linkCount: links.length,
        topPerformingLink,
        links
      },
      engagement: {
        openToClickRatio,
        subscriberEngagement: subscribers > 0
          ? Number((((uniqueOpens + totalClicks) / subscribers) * 100).toFixed(2))
          : 0,
        newSubscribers,
        netGrowth,
        velocity: consolidatedData.engagementVelocity,
        timeToOpenBuckets: consolidatedData.timeToOpenBuckets || {},
        deviceBreakdown: consolidatedData.deviceBreakdown || {},
        clientBreakdown: consolidatedData.clientBreakdown || {}
      },
      clickGeography: consolidatedData.clickGeography || { totalClicks: 0, geoBreakdown: {} }
    };

    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: state.issue,
        sk: 'analytics',
        GSI1PK: `${state.issue.split('#')[0]}#analytics`,
        GSI1SK: normalizedSentDate,
        data: insightData
      })
    }));

    const name = state.issue
      ? (state.issue.split('_')[1]?.split('.')[0]?.replace('-', ' ') || 'Unknown')
      : 'Unknown';

    return {
      subject: `📊 Newsletter Issue ${name} Performance Report`,
      insightData
    };
  } catch (error) {
    console.error('Error processing newsletter stats:', error);
    throw error;
  }
};
