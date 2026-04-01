import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { hashEmail } from './utils/hash-email.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  const { tenantId, issueNumber, publishedAt } = event;

  if (!tenantId || !issueNumber || !publishedAt) {
    console.error('Missing required parameters:', { tenantId, issueNumber, publishedAt });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing required parameters: tenantId, issueNumber, publishedAt' })
    };
  }

  try {
    const pk = `${tenantId}#${issueNumber}`;
    const sk = 'stats';

    try {
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({ pk, sk }),
        UpdateExpression: 'SET statsPhase = :aggregating',
        ConditionExpression: 'attribute_not_exists(statsPhase) OR (statsPhase <> :consolidated AND statsPhase <> :aggregating)',
        ExpressionAttributeValues: marshall({
          ':aggregating': 'aggregating',
          ':consolidated': 'consolidated'
        })
      }));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`Aggregation already in progress or completed for ${pk}`);
        return {
          success: false,
          message: 'Aggregation already in progress or completed',
          issueNumber
        };
      }
      throw err;
    }

    const events = await queryAllEventsParallel(ddb, tenantId, issueNumber);

    console.log(`Aggregating analytics for ${pk}: ${events.clicks.length} clicks, ${events.opens.length} opens, ${events.bounces.length} bounces, ${events.complaints.length} complaints`);

    const analytics = {
      links: calculateLinkPerformance(events.clicks),
      clickDecay: calculateClickDecay(events.clicks, publishedAt),
      openDecay: calculateOpenDecay(events.opens, publishedAt),
      geoDistribution: calculateGeoDistribution(events.clicks, events.opens),
      deviceBreakdown: calculateDeviceBreakdown(events.opens),
      timingMetrics: calculateTimingMetrics(events.opens, events.clicks),
      engagementType: await calculateEngagementType(events.clicks, ddb, tenantId),
      trafficSource: calculateTrafficSource(events.clicks),
      bounceReasons: calculateBounceReasons(events.bounces),
      complaintDetails: formatComplaintDetails(events.complaints)
    };

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk }),
      UpdateExpression: 'SET analytics = :analytics, statsPhase = :phase, consolidatedAt = :now, aggregationVersion = :version',
      ExpressionAttributeValues: marshall({
        ':analytics': analytics,
        ':phase': 'consolidated',
        ':now': new Date().toISOString(),
        ':version': '1.0'
      })
    }));

    console.log(`Successfully consolidated analytics for ${pk}`);

    return {
      success: true,
      issueNumber,
      eventCounts: {
        clicks: events.clicks.length,
        opens: events.opens.length,
        bounces: events.bounces.length,
        complaints: events.complaints.length
      }
    };
  } catch (err) {
    console.error('Aggregation error:', err);

    try {
      const pk = `${tenantId}#${issueNumber}`;
      const sk = 'stats';
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({ pk, sk }),
        UpdateExpression: 'REMOVE statsPhase'
      }));
      console.log(`Reset statsPhase for ${pk} after error`);
    } catch (resetErr) {
      console.error('Failed to reset statsPhase:', resetErr);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Aggregation failed', error: err.message })
    };
  }
};

export async function queryEventsByType(ddb, tenantId, issueNumber, eventType) {
  const pk = `${tenantId}#${issueNumber}`;
  const events = [];
  let lastEvaluatedKey = null;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :eventType)',
      ProjectionExpression: 'sk, eventType, #ts, subscriberEmailHash, linkUrl, linkPosition, trafficSource, device, country, timeToClick, timeToOpen, bounceType, bounceReason, complaintType',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      },
      ExpressionAttributeValues: marshall({
        ':pk': pk,
        ':eventType': `${eventType}#`
      }),
      ExclusiveStartKey: lastEvaluatedKey
    }));

    if (result.Items) {
      events.push(...result.Items.map(item => unmarshall(item)));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return events;
}

export async function queryAllEventsParallel(ddb, tenantId, issueNumber) {
  const [clicks, opens, bounces, complaints] = await Promise.all([
    queryEventsByType(ddb, tenantId, issueNumber, 'click'),
    queryEventsByType(ddb, tenantId, issueNumber, 'open'),
    queryEventsByType(ddb, tenantId, issueNumber, 'bounce'),
    queryEventsByType(ddb, tenantId, issueNumber, 'complaint')
  ]);

  return { clicks, opens, bounces, complaints };
}

export function calculateLinkPerformance(clicks) {
  const linkMap = new Map();

  for (const click of clicks) {
    const key = click.linkUrl;
    if (!linkMap.has(key)) {
      linkMap.set(key, {
        url: click.linkUrl,
        clicks: 0,
        positions: [],
        countries: new Map()
      });
    }
    const linkData = linkMap.get(key);
    linkData.clicks++;

    if (click.linkPosition != null && !linkData.positions.includes(click.linkPosition)) {
      linkData.positions.push(click.linkPosition);
    }

    const country = click.country || 'unknown';
    if (!linkData.countries.has(country)) {
      linkData.countries.set(country, { clicks: 0, users: new Set() });
    }
    const countryData = linkData.countries.get(country);
    countryData.clicks++;
    if (click.subscriberEmailHash && click.subscriberEmailHash !== 'unknown') {
      countryData.users.add(click.subscriberEmailHash);
    }
  }

  const totalClicks = clicks.length;
  const links = Array.from(linkMap.values())
    .map(link => ({
      url: link.url,
      clicks: link.clicks,
      percentOfTotal: totalClicks > 0 ? (link.clicks / totalClicks) * 100 : 0,
      position: link.positions.length > 0 ? Math.min(...link.positions) : 0,
      geoDistribution: Array.from(link.countries.entries())
        .map(([country, data]) => ({
          country,
          clicks: data.clicks,
          uniqueUsers: data.users.size
        }))
        .sort((a, b) => b.clicks - a.clicks)
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);

  return links;
}

export function calculateClickDecay(clicks, publishedAt) {
  const publishTime = new Date(publishedAt).getTime();
  const hourlyClicks = new Map();

  for (const click of clicks) {
    const clickTime = new Date(click.timestamp).getTime();
    const hoursSincePublish = Math.floor((clickTime - publishTime) / (1000 * 60 * 60));

    if (hoursSincePublish >= 0 && hoursSincePublish < 168) {
      hourlyClicks.set(hoursSincePublish, (hourlyClicks.get(hoursSincePublish) || 0) + 1);
    }
  }

  const hours = Array.from(hourlyClicks.keys());
  const maxHour = hours.length > 0 ? Math.min(Math.max(...hours), 167) : 0;
  const decay = [];
  let cumulative = 0;

  for (let hour = 0; hour <= maxHour; hour++) {
    const clicks = hourlyClicks.get(hour) || 0;
    cumulative += clicks;
    decay.push({ hour, clicks, cumulativeClicks: cumulative });
  }

  return decay;
}

export function calculateOpenDecay(opens, publishedAt) {
  const publishTime = new Date(publishedAt).getTime();
  const hourlyOpens = new Map();

  for (const open of opens) {
    const openTime = new Date(open.timestamp).getTime();
    const hoursSincePublish = Math.floor((openTime - publishTime) / (1000 * 60 * 60));

    if (hoursSincePublish >= 0 && hoursSincePublish < 168) {
      hourlyOpens.set(hoursSincePublish, (hourlyOpens.get(hoursSincePublish) || 0) + 1);
    }
  }

  const hours = Array.from(hourlyOpens.keys());
  const maxHour = hours.length > 0 ? Math.min(Math.max(...hours), 167) : 0;
  const decay = [];
  let cumulative = 0;

  for (let hour = 0; hour <= maxHour; hour++) {
    const opens = hourlyOpens.get(hour) || 0;
    cumulative += opens;
    decay.push({ hour, opens, cumulativeOpens: cumulative });
  }

  return decay;
}

export function calculateGeoDistribution(clicks, opens) {
  const geoMap = new Map();

  for (const click of clicks) {
    const country = click.country || 'unknown';
    if (!geoMap.has(country)) {
      geoMap.set(country, {
        country,
        clicks: 0,
        opens: 0,
        uniqueClickUsers: new Set(),
        uniqueOpenUsers: new Set()
      });
    }
    const countryData = geoMap.get(country);
    countryData.clicks++;
    if (click.subscriberEmailHash && click.subscriberEmailHash !== 'unknown') {
      countryData.uniqueClickUsers.add(click.subscriberEmailHash);
    }
  }

  for (const open of opens) {
    const country = open.country || 'unknown';
    if (!geoMap.has(country)) {
      geoMap.set(country, {
        country,
        clicks: 0,
        opens: 0,
        uniqueClickUsers: new Set(),
        uniqueOpenUsers: new Set()
      });
    }
    const countryData = geoMap.get(country);
    countryData.opens++;
    if (open.subscriberEmailHash && open.subscriberEmailHash !== 'unknown') {
      countryData.uniqueOpenUsers.add(open.subscriberEmailHash);
    }
  }

  return Array.from(geoMap.values())
    .map(data => ({
      country: data.country,
      clicks: data.clicks,
      opens: data.opens,
      uniqueClickUsers: data.uniqueClickUsers.size,
      uniqueOpenUsers: data.uniqueOpenUsers.size
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);
}

export function calculateDeviceBreakdown(opens) {
  const breakdown = { desktop: 0, mobile: 0, tablet: 0 };

  for (const open of opens) {
    const device = open.device || 'unknown';
    if (device in breakdown) {
      breakdown[device]++;
    }
  }

  return breakdown;
}

export function calculateTimingMetrics(opens, clicks) {
  const openTimes = opens.map(o => o.timeToOpen).filter(t => t != null).sort((a, b) => a - b);
  const clickTimes = clicks.map(c => c.timeToClick).filter(t => t != null).sort((a, b) => a - b);

  return {
    medianTimeToOpen: calculateMedian(openTimes),
    p95TimeToOpen: calculatePercentile(openTimes, 95),
    medianTimeToClick: calculateMedian(clickTimes),
    p95TimeToClick: calculatePercentile(clickTimes, 95)
  };
}

function calculateMedian(sortedArray) {
  if (sortedArray.length === 0) return 0;
  const mid = Math.floor(sortedArray.length / 2);
  return sortedArray.length % 2 === 0
    ? (sortedArray[mid - 1] + sortedArray[mid]) / 2
    : sortedArray[mid];
}

function calculatePercentile(sortedArray, percentile) {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * Classifies unique clickers as "new" (engagementCount === 1) or
 * "returning" (engagementCount > 1) by reading subscriber records
 * from the SubscribersTable and matching via email hash.
 * Falls back to "new" if subscriber has no engagement fields.
 *
 * @param {Array} clicks - Click events for the issue
 * @param {DynamoDBClient} ddb - DynamoDB client
 * @param {string} tenantId - Tenant ID for subscriber lookups
 * @returns {Promise<{ newClickers: number, returningClickers: number }>}
 */
export async function calculateEngagementType(clicks, ddb, tenantId) {
  // Collect unique subscriber hashes from clicks
  const uniqueHashes = new Set();
  for (const click of clicks) {
    const subscriberHash = click.subscriberEmailHash;
    if (subscriberHash && subscriberHash !== 'unknown') {
      uniqueHashes.add(subscriberHash);
    }
  }

  if (uniqueHashes.size === 0) {
    return { newClickers: 0, returningClickers: 0 };
  }

  // Build hash → engagementCount map by querying all subscribers for the tenant
  // and hashing their emails to match against click event hashes.
  // This is necessary because click events store subscriberEmailHash (SHA-256)
  // but SubscribersTable is keyed by raw email — the hash is one-way.
  const hashToEngagement = await buildHashToEngagementMap(ddb, tenantId, uniqueHashes);

  let newClickers = 0;
  let returningClickers = 0;

  for (const hash of uniqueHashes) {
    const engagementCount = hashToEngagement.get(hash);
    if (engagementCount != null && engagementCount > 1) {
      returningClickers++;
    } else {
      // engagementCount === 1 or missing → "new"
      newClickers++;
    }
  }

  return { newClickers, returningClickers };
}

/**
 * Queries all subscribers for a tenant and builds a map from email hash
 * to engagementCount. Only includes hashes that appear in the targetHashes set
 * to keep memory usage bounded.
 *
 * @param {DynamoDBClient} ddb - DynamoDB client
 * @param {string} tenantId - Tenant partition key
 * @param {Set<string>} targetHashes - Set of subscriber email hashes to look up
 * @returns {Promise<Map<string, number>>} Map of emailHash → engagementCount
 */
async function buildHashToEngagementMap(ddb, tenantId, targetHashes) {
  const hashToEngagement = new Map();
  let exclusiveStartKey = null;

  do {
    const params = {
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      ProjectionExpression: 'email, engagementCount',
      ExpressionAttributeValues: marshall({ ':tenantId': tenantId })
    };

    if (exclusiveStartKey) {
      params.ExclusiveStartKey = exclusiveStartKey;
    }

    const result = await ddb.send(new QueryCommand(params));

    if (result.Items) {
      for (const item of result.Items) {
        const subscriber = unmarshall(item);
        const emailHash = hashEmail(subscriber.email);
        if (targetHashes.has(emailHash)) {
          hashToEngagement.set(emailHash, subscriber.engagementCount ?? null);
        }
        // Early exit if we've found all target hashes
        if (hashToEngagement.size === targetHashes.size) {
          return hashToEngagement;
        }
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return hashToEngagement;
}

export function calculateTrafficSource(clicks) {
  const clickSource = { email: 0, web: 0 };

  for (const click of clicks) {
    const source = click.trafficSource || 'web';
    if (source === 'email') clickSource.email++;
    else if (source === 'web') clickSource.web++;
  }

  return {
    clicks: clickSource
  };
}

export function calculateBounceReasons(bounces) {
  const reasons = { permanent: 0, temporary: 0, suppressed: 0 };

  for (const bounce of bounces) {
    const type = bounce.bounceType || 'temporary';
    if (type in reasons) {
      reasons[type]++;
    }
  }

  return reasons;
}

export function formatComplaintDetails(complaints) {
  return complaints
    .slice(0, 100)
    .map(c => ({
      email: c.subscriberEmailHash,
      timestamp: c.timestamp,
      complaintType: c.complaintType || 'spam'
    }));
}
