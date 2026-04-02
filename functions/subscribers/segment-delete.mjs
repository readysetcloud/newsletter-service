import { DynamoDBClient, QueryCommand, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { sendWithRetry } from "../utils/helpers.mjs";

const ddb = new DynamoDBClient();
const TABLE_NAME = process.env.SUBSCRIBERS_TABLE_NAME;
const BATCH_SIZE = 25;

export const handler = async (event) => {
  const { tenantId, segmentId } = event;
  console.log(`Deleting segment members for segment ${segmentId} in tenant ${tenantId}`);

  try {
    let exclusiveStartKey;
    let totalDeleted = 0;

    do {
      const queryParams = {
        TableName: TABLE_NAME,
        KeyConditionExpression: "tenantId = :tenantId AND begins_with(email, :skPrefix)",
        ExpressionAttributeValues: marshall({
          ":tenantId": tenantId,
          ":skPrefix": `SEGMENT#${segmentId}#MEMBER#`
        })
      };

      if (exclusiveStartKey) {
        queryParams.ExclusiveStartKey = exclusiveStartKey;
      }

      const response = await sendWithRetry(() => ddb.send(new QueryCommand(queryParams)), "QuerySegmentMembers");

      if (response.Items?.length) {
        const items = response.Items.map((item) => unmarshall(item));

        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE);
          const deleteRequests = batch.map((item) => ({
            DeleteRequest: {
              Key: marshall({ tenantId: item.tenantId, email: item.email })
            }
          }));

          await sendWithRetry(() => ddb.send(new BatchWriteItemCommand({
            RequestItems: {
              [TABLE_NAME]: deleteRequests
            }
          })), "BatchDeleteSegmentMembers");

          totalDeleted += batch.length;
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    console.log(`Deleted ${totalDeleted} member records for segment ${segmentId}`);
    return { deleted: totalDeleted };
  } catch (err) {
    console.error(`Failed to delete segment members for segment ${segmentId}:`, err);
    throw err;
  }
};
