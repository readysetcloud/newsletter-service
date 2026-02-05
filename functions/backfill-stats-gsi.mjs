import { DynamoDBClient, ScanCommand, UpdateItemCommand, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

const padIssueNumber = (issueNumber) => {
  return String(issueNumber).padStart(5, '0');
};

const LEGACY_NEWSLETTER_PATH_MARKER = '#content/newsletter/';
const LEGACY_NEWSLETTER_FILENAME_MARKER = '-issue-';

const normalizeTimestamp = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseLegacyDate = (rawDate) => {
  if (!rawDate) return null;
  const iso = new Date(`${rawDate}T14:00:00.000Z`);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
};

const parseLegacyNewsletterInfo = (pk, fallbackTimestamp) => {
  const [tenantId, rest] = pk.split('#');
  if (!tenantId || !rest) return null;

  const pathFormat = rest.match(/content\/newsletter\/(\d{4}-\d{2}-\d{2})_issue-(\d+)\.md$/i);
  const fileFormat = rest.match(/^(\d{4}-\d{2}-\d{2})-issue-(\d+)\.md$/i);

  const issueNumberRaw = pathFormat?.[2] || fileFormat?.[2];
  const issueDateRaw = pathFormat?.[1] || fileFormat?.[1];
  if (!issueNumberRaw) return null;

  const issueNumber = Number(issueNumberRaw);
  if (!Number.isFinite(issueNumber)) return null;

  const fallbackIso = normalizeTimestamp(fallbackTimestamp);
  const createdAt = fallbackIso
    || parseLegacyDate(issueDateRaw)
    || new Date().toISOString();

  return {
    tenantId,
    issueNumber,
    createdAt,
    title: `Issue ${issueNumber}`
  };
};

const isLegacyNewsletterPk = (pk) => {
  if (!pk || !pk.includes('#')) return false;
  if (pk.includes(LEGACY_NEWSLETTER_PATH_MARKER)) return true;
  if (pk.includes(LEGACY_NEWSLETTER_FILENAME_MARKER) && pk.toLowerCase().endsWith('.md')) return true;
  return false;
};

const mapLegacyStatus = (status) => {
  if (!status) return 'published';
  const normalized = String(status).toLowerCase();
  if (normalized === 'succeeded' || normalized === 'sent') return 'published';
  if (['draft', 'scheduled', 'published', 'failed'].includes(normalized)) return normalized;
  return 'published';
};

export const handler = async (event) => {
  const { lastEvaluatedKey: initialLastEvaluatedKey, maxPages } = event;
  const tableName = process.env.TABLE_NAME;
  const maxPagesSafe = Number.isFinite(Number(maxPages)) ? Number(maxPages) : Infinity;

  try {
    let processedCount = 0;
    let errorCount = 0;
    const errors = [];
    let lastEvaluatedKey = initialLastEvaluatedKey;
    let pagesProcessed = 0;
    let hasMore = false;

    // Phase 1: backfill stats GSI for legacy stats records
    do {
      const scanResult = await ddb.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: 'sk = :sk AND attribute_not_exists(GSI1PK)',
        ExpressionAttributeValues: marshall({
          ':sk': 'stats'
        }),
        Limit: 100,
        ExclusiveStartKey: lastEvaluatedKey
      }));

      for (const item of scanResult.Items || []) {
        try {
          const record = unmarshall(item);
          const pkParts = record.pk.split('#');

          if (pkParts.length !== 2) {
            throw new Error(`Invalid pk format: ${record.pk}`);
          }

          const [tenantId, issueNumber] = pkParts;
          const issueNum = parseInt(issueNumber);

          if (isNaN(issueNum)) {
            throw new Error(`Invalid issue number: ${issueNumber}`);
          }

          const analyticsResult = await ddb.send(new GetItemCommand({
            TableName: tableName,
            Key: marshall({
              pk: record.pk,
              sk: 'analytics'
            })
          }));

          const issueResult = await ddb.send(new GetItemCommand({
            TableName: tableName,
            Key: marshall({
              pk: record.pk,
              sk: 'newsletter'
            })
          }));

          console.log('Looking for analytics record:', { pk: record.pk, sk: 'analytics', found: !!analyticsResult.Item });
          console.log('Looking for issue record:', { pk: record.pk, sk: 'newsletter', found: !!issueResult.Item });

          let updateExpression = 'SET GSI1PK = :gsi1pk, GSI1SK = :gsi1sk';
          const expressionValues = {
            ':gsi1pk': `${tenantId}#issue`,
            ':gsi1sk': padIssueNumber(issueNum)
          };

          if (issueResult.Item) {
            const issueRecord = unmarshall(issueResult.Item);

            if (issueRecord.publishedAt) {
              updateExpression += ', publishedAt = :publishedAt';
              expressionValues[':publishedAt'] = issueRecord.publishedAt;
            }

            if (issueRecord.subject || issueRecord.title) {
              updateExpression += ', subject = :subject';
              expressionValues[':subject'] = issueRecord.subject || issueRecord.title;
            }
          }

          if (analyticsResult.Item) {
            const analyticsRecord = unmarshall(analyticsResult.Item);
            console.log('Analytics record found:', { pk: record.pk, hasData: !!analyticsRecord.insights });

            if (analyticsRecord.insights) {
              updateExpression += ', insights = :insights, statsPhase = :phase, consolidatedAt = :timestamp';
              expressionValues[':insights'] = analyticsRecord.insights;
              expressionValues[':phase'] = 'consolidated';
              expressionValues[':timestamp'] = analyticsRecord.GSI1SK || new Date().toISOString();

              await ddb.send(new UpdateItemCommand({
                TableName: tableName,
                Key: marshall({
                  pk: record.pk,
                  sk: 'analytics'
                }),
                UpdateExpression: 'SET #ttl = :ttl',
                ExpressionAttributeNames: {
                  '#ttl': 'ttl'
                },
                ExpressionAttributeValues: marshall({
                  ':ttl': Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
                })
              }));

              console.log('Set TTL on analytics record:', { pk: record.pk });
            }
          } else {
            console.log('No analytics record found for:', { pk: record.pk });
          }

          await ddb.send(new UpdateItemCommand({
            TableName: tableName,
            Key: marshall({
              pk: record.pk,
              sk: 'stats'
            }),
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: marshall(expressionValues)
          }));

          processedCount++;
        } catch (err) {
          errorCount++;
          errors.push({
            pk: unmarshall(item).pk,
            error: err.message
          });
          console.error('Error processing record:', {
            pk: unmarshall(item).pk,
            error: err.message
          });
        }
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey;
      hasMore = !!lastEvaluatedKey;
      pagesProcessed++;
    } while (lastEvaluatedKey && pagesProcessed < maxPagesSafe);

    // Phase 2: backfill newsletter items (GSI and legacy pk migration)
    lastEvaluatedKey = initialLastEvaluatedKey;
    pagesProcessed = 0;
    do {
      const scanResult = await ddb.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: 'sk = :sk AND (attribute_not_exists(GSI1PK) OR contains(pk, :legacyPathMarker) OR contains(pk, :legacyFilenameMarker))',
        ExpressionAttributeValues: marshall({
          ':sk': 'newsletter',
          ':legacyPathMarker': LEGACY_NEWSLETTER_PATH_MARKER,
          ':legacyFilenameMarker': LEGACY_NEWSLETTER_FILENAME_MARKER
        }),
        Limit: 100,
        ExclusiveStartKey: lastEvaluatedKey
      }));

      for (const item of scanResult.Items || []) {
        try {
          const record = unmarshall(item);
          const pk = record.pk;

          if (!pk) {
            throw new Error('Missing pk on newsletter item');
          }

          if (isLegacyNewsletterPk(pk)) {
            const legacyInfo = parseLegacyNewsletterInfo(pk, record.GSI1SK || record.createdAt);
            if (!legacyInfo) {
              throw new Error(`Unable to parse legacy pk: ${pk}`);
            }

            const newPk = `${legacyInfo.tenantId}#${legacyInfo.issueNumber}`;
            const existing = await ddb.send(new GetItemCommand({
              TableName: tableName,
              Key: marshall({
                pk: newPk,
                sk: 'newsletter'
              })
            }));

            if (!existing.Item) {
              const status = mapLegacyStatus(record.status);
              const publishedAt = status === 'published' ? legacyInfo.createdAt : undefined;
              const updatedAt = record.updatedAt ? normalizeTimestamp(record.updatedAt) : legacyInfo.createdAt;

              const itemToPut = {
                pk: newPk,
                sk: 'newsletter',
                GSI1PK: `${legacyInfo.tenantId}#newsletter`,
                GSI1SK: legacyInfo.createdAt,
                issueNumber: legacyInfo.issueNumber,
                subject: record.subject || record.title || legacyInfo.title,
                status,
                content: record.content || '',
                createdAt: legacyInfo.createdAt,
                updatedAt: updatedAt || legacyInfo.createdAt,
                ...(publishedAt && { publishedAt }),
                metadata: JSON.stringify({
                  legacyPk: pk,
                  legacySingleSendId: record.singleSendId
                })
              };

              await ddb.send(new PutItemCommand({
                TableName: tableName,
                Item: marshall(itemToPut)
              }));
            }
          } else {
            const tenantId = pk.split('#')[0];
            const createdAt = normalizeTimestamp(record.createdAt)
              || normalizeTimestamp(record.publishedAt)
              || normalizeTimestamp(record.updatedAt)
              || new Date().toISOString();

            await ddb.send(new UpdateItemCommand({
              TableName: tableName,
              Key: marshall({
                pk,
                sk: 'newsletter'
              }),
              UpdateExpression: 'SET GSI1PK = :gsi1pk, GSI1SK = :gsi1sk',
              ExpressionAttributeValues: marshall({
                ':gsi1pk': `${tenantId}#newsletter`,
                ':gsi1sk': createdAt
              })
            }));
          }

          processedCount++;
        } catch (err) {
          errorCount++;
          errors.push({
            pk: unmarshall(item).pk,
            error: err.message
          });
          console.error('Error processing newsletter record:', {
            pk: unmarshall(item).pk,
            error: err.message
          });
        }
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey;
      hasMore = !!lastEvaluatedKey;
      pagesProcessed++;
    } while (lastEvaluatedKey && pagesProcessed < maxPagesSafe);

    return {
      statusCode: 200,
      body: JSON.stringify({
        processedCount,
        errorCount,
        errors: errors.slice(0, 10),
        hasMore,
        lastEvaluatedKey
      })
    };
  } catch (err) {
    console.error('Handler error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Backfill failed',
        error: err.message
      })
    };
  }
};
