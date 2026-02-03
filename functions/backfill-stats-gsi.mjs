import { DynamoDBClient, ScanCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

const padIssueNumber = (issueNumber) => {
  return String(issueNumber).padStart(5, '0');
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

            if (issueRecord.title) {
              updateExpression += ', subject = :subject';
              expressionValues[':subject'] = issueRecord.title;
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
