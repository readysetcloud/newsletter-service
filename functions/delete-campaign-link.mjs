import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  DeleteKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import { formatResponse, formatEmptyResponse } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();
const kvs = new CloudFrontKeyValueStoreClient();

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

export const handler = async (event) => {
  const code = event.pathParameters?.code;
  if (!code || !CODE_PATTERN.test(code)) {
    return formatResponse(400, 'code must be 6 alphanumeric characters');
  }

  await deleteKvsKey(code);

  await ddb.send(new DeleteItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: `CAMPAIGN_LINK_CODE#${code}`,
      sk: `CAMPAIGN_LINK_CODE#${code}`,
    }),
  }));

  return formatEmptyResponse();
};

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
