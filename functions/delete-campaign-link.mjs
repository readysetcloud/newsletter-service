import { DynamoDBClient, QueryCommand, BatchWriteItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import '@aws-sdk/signature-v4a';
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  DeleteKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import { formatResponse, formatEmptyResponse, getTenantId, isOwnedByTenant } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();
const kvs = new CloudFrontKeyValueStoreClient();

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

export const handler = async (event) => {
  const tenantId = getTenantId(event);
  if (!tenantId) {
    return formatResponse(401, 'Unauthorized');
  }

  const code = event.pathParameters?.code;
  if (!code || !CODE_PATTERN.test(code)) {
    return formatResponse(400, 'code must be 6 alphanumeric characters');
  }

  const pk = `CAMPAIGN_LINK_CODE#${code}`;
  const metadata = await getMetadata(pk);
  // A link owned by another tenant is reported as 404 (existence hidden). A
  // missing link is treated as already-deleted (idempotent 204).
  if (metadata && !isOwnedByTenant(metadata, tenantId)) {
    return formatResponse(404, `Code ${code} not found`);
  }

  await deleteKvsKey(code);
  await deletePartition(pk);

  return formatEmptyResponse();
};

async function getMetadata(pk) {
  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk, sk: 'METADATA' }),
  }));
  return result.Item ? unmarshall(result.Item) : null;
}

async function deleteKvsKey(code) {
  const describe = await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: process.env.KVS_ARN }));
  try {
    await kvs.send(new DeleteKeyCommand({
      KvsARN: process.env.KVS_ARN,
      Key: code,
      IfMatch: describe.ETag,
    }));
  } catch (err) {
    if (err.name === 'ResourceNotFoundException' || err.$metadata?.httpStatusCode === 404) {
      return;
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
