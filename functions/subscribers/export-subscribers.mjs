import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getTenant, sendWithRetry } from "../utils/helpers.mjs";

const ddb = new DynamoDBClient();
const s3 = new S3Client();

export const handler = async (event) => {
  try {
    const tenantId = event.tenant;
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return { message: 'Tenant not found' };
    }

    const emailAddresses = [];
    let exclusiveStartKey;

    do {
      const queryParams = {
        TableName: process.env.SUBSCRIBERS_TABLE_NAME,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: marshall({
          ':tenantId': tenantId
        })
      };

      if (exclusiveStartKey) {
        queryParams.ExclusiveStartKey = exclusiveStartKey;
      }

      const response = await sendWithRetry(() => ddb.send(new QueryCommand(queryParams)));

      if (response.Items?.length) {
        emailAddresses.push(...response.Items.map(item => unmarshall(item).email));
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const report = {
      total: emailAddresses.length,
      addresses: emailAddresses
    };

    const key = `reports/${tenantId}-${new Date().toISOString()}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.BUCKET,
      Key: key,
      Body: JSON.stringify(report),
      ContentType: "application/json"
    }));

    return { key };
  } catch (err) {
    console.error(err);
    return false;
  }
};
