import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { VALID_TOPICS, AUTO_SEGMENT_THRESHOLD, getTopicDisplayName } from './topic-taxonomy.mjs';

const ddb = new DynamoDBClient();

/**
 * Round a number to 1 decimal place.
 * @param {number} value
 * @returns {number}
 */
function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Compute the audience interest composition for a tenant, derived from
 * subscriber `interestScores`. Used to give sponsors hard numbers on how
 * the audience's interests break down by topic.
 *
 * Paginates through the tenant's full subscriber partition, skipping
 * segment infrastructure rows (email begins with "SEGMENT" — covers
 * SEGMENT#, SEGMENT_NAME#, SEGMENT_JOB#, and SEGMENT#...#MEMBER# rows).
 *
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<{totalSubscribers: number, topics: Array<{topic: string, displayName: string, confirmed: number, confirmedPct: number, engaged: number, engagedPct: number}>}>}
 */
export async function computeInterestComposition(tenantId) {
  const topicCounts = new Map();
  for (const topic of VALID_TOPICS) {
    topicCounts.set(topic, { confirmed: 0, engaged: 0 });
  }

  let totalSubscribers = 0;
  let lastEvaluatedKey;

  do {
    const queryParams = {
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: marshall({ ':tenantId': tenantId }),
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    };

    const response = await ddb.send(new QueryCommand(queryParams));

    for (const rawItem of response.Items || []) {
      const subscriber = unmarshall(rawItem);

      // Skip segment infrastructure rows sharing the subscriber partition.
      if (typeof subscriber.email === 'string' && subscriber.email.startsWith('SEGMENT')) {
        continue;
      }

      totalSubscribers += 1;

      const interestScores = subscriber.interestScores || {};
      for (const [topic, data] of Object.entries(interestScores)) {
        if (!VALID_TOPICS.has(topic)) continue;
        const score = typeof data?.score === 'number' ? data.score : 0;
        if (score <= 0) continue;

        const counts = topicCounts.get(topic);
        counts.engaged += 1;
        if (score >= AUTO_SEGMENT_THRESHOLD) {
          counts.confirmed += 1;
        }
      }
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  const topics = Array.from(topicCounts.entries())
    .filter(([, counts]) => counts.engaged > 0)
    .map(([topic, counts]) => ({
      topic,
      displayName: getTopicDisplayName(topic),
      confirmed: counts.confirmed,
      confirmedPct: totalSubscribers > 0 ? round1((counts.confirmed / totalSubscribers) * 100) : 0,
      engaged: counts.engaged,
      engagedPct: totalSubscribers > 0 ? round1((counts.engaged / totalSubscribers) * 100) : 0
    }))
    .sort((a, b) => b.confirmed - a.confirmed || b.engaged - a.engaged);

  return { totalSubscribers, topics };
}

/**
 * Build human-readable lines summarizing the top interest-composition topics,
 * suitable for feeding into LLM prompts (sponsor narrative, outreach emails).
 * Returns an empty array when there's no usable data.
 * @param {{totalSubscribers: number, topics: Array<{displayName: string, confirmed: number, confirmedPct: number}>}|null|undefined} composition
 * @param {number} limit - Max number of topics to include (top N by confirmed share)
 * @returns {string[]}
 */
export function buildInterestCompositionLines(composition, limit = 5) {
  if (!composition || !Array.isArray(composition.topics) || composition.topics.length === 0) {
    return [];
  }
  return composition.topics
    .slice(0, limit)
    .map(t => `- ${t.displayName}: ${t.confirmedPct}% of the audience (${t.confirmed} of ${composition.totalSubscribers} subscribers) has demonstrated confirmed interest`);
}
