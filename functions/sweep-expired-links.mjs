import { DynamoDBClient, QueryCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import '@aws-sdk/signature-v4a';
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  DeleteKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';

const ddb = new DynamoDBClient();
const kvs = new CloudFrontKeyValueStoreClient();

const QUERY_LIMIT = 100;

export const handler = async () => {
  const nowIso = new Date().toISOString();
  let deleted = 0;
  let kvsMissing = 0;
  let failed = 0;
  let lastEvaluatedKey;

  let etag = await refreshEtag();

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK < :now',
      ExpressionAttributeValues: marshall({
        ':pk': 'CAMPAIGN_LINK_CODE_EXPIRY',
        ':now': nowIso,
      }),
      Limit: QUERY_LIMIT,
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of result.Items || []) {
      const row = unmarshall(item);
      const code = row.code;
      if (!code) continue;

      try {
        etag = await deleteKvsKey(code, etag);
        await deletePartition(`CAMPAIGN_LINK_CODE#${code}`);
        deleted++;
      } catch (err) {
        if (err.name === 'ResourceNotFoundException' || err.$metadata?.httpStatusCode === 404) {
          await deletePartition(`CAMPAIGN_LINK_CODE#${code}`);
          kvsMissing++;
        } else {
          failed++;
          console.error('Failed to delete expired code', { code, error: err.message, name: err.name });
        }
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('Sweep complete', { deleted, kvsMissing, failed });
  return { deleted, kvsMissing, failed };
};

async function refreshEtag() {
  const describe = await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: process.env.KVS_ARN }));
  return describe.ETag;
}

async function deleteKvsKey(code, currentEtag) {
  try {
    const result = await kvs.send(new DeleteKeyCommand({
      KvsARN: process.env.KVS_ARN,
      Key: code,
      IfMatch: currentEtag,
    }));
    return result.ETag || currentEtag;
  } catch (err) {
    if (err.name === 'PreconditionFailedException' || err.name === 'InvalidArgumentException') {
      const fresh = await refreshEtag();
      const retry = await kvs.send(new DeleteKeyCommand({
        KvsARN: process.env.KVS_ARN,
        Key: code,
        IfMatch: fresh,
      }));
      return retry.ETag || fresh;
    }
    throw err;
  }
}

async function deletePartition(pk) {
  let lastEvaluatedKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'pk' },
      ExpressionAttributeValues: marshall({ ':pk': pk }),
      ProjectionExpression: '#pk, sk',
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const items = result.Items || [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25).map((it) => {
        const row = unmarshall(it);
        return { DeleteRequest: { Key: marshall({ pk: row.pk, sk: row.sk }) } };
      });
      if (batch.length === 0) continue;
      await ddb.send(new BatchWriteItemCommand({
        RequestItems: { [process.env.TABLE_NAME]: batch },
      }));
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}
