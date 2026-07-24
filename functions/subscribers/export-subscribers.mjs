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
    const subscribers = [];
    let exclusiveStartKey;

    do {
      const queryParams = {
        TableName: process.env.SUBSCRIBERS_TABLE_NAME,
        KeyConditionExpression: 'tenantId = :tenantId',
        // The segments feature overloads this table's `email` sort key with
        // SEGMENT#/SEGMENT_NAME#/SEGMENT_JOB#/member rows under the same tenant
        // partition; those must never be exported as subscribers.
        FilterExpression: 'NOT begins_with(email, :segPrefix)',
        ExpressionAttributeValues: marshall({
          ':tenantId': tenantId,
          ':segPrefix': 'SEGMENT'
        })
      };

      if (exclusiveStartKey) {
        queryParams.ExclusiveStartKey = exclusiveStartKey;
      }

      const response = await sendWithRetry(() => ddb.send(new QueryCommand(queryParams)));

      if (response.Items?.length) {
        for (const item of response.Items) {
          const record = unmarshall(item);
          emailAddresses.push(record.email);
          subscribers.push({
            email: record.email,
            lastEngagedIssue: record.lastEngagedIssue ?? null,
            engagementCount: record.engagementCount ?? null
          });
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const report = {
      total: emailAddresses.length,
      addresses: emailAddresses,
      subscribers
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
