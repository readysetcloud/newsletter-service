import { DynamoDBClient, QueryCommand, BatchGetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { sendWithRetry } from "../utils/helpers.mjs";

const ddb = new DynamoDBClient();
const s3 = new S3Client();
const TABLE_NAME = process.env.SUBSCRIBERS_TABLE_NAME;
const BUCKET = process.env.BUCKET;
const BATCH_GET_SIZE = 100;

export const handler = async (event) => {
  const { tenantId, segmentId, jobId } = event;
  console.log(`Exporting segment ${segmentId} for tenant ${tenantId}, job ${jobId}`);

  try {
    const members = await queryAllSegmentMembers(tenantId, segmentId);
    const report = await buildExportReport(tenantId, members);

    const timestamp = new Date().toISOString();
    const s3Key = `reports/segment-export-${tenantId}-${segmentId}-${timestamp}.json`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: JSON.stringify(report),
      ContentType: "application/json"
    }));

    await updateJobStatus(tenantId, jobId, "completed", { s3Key });

    console.log(`Export completed for segment ${segmentId}, key: ${s3Key}`);
    return { s3Key };
  } catch (err) {
    console.error(`Export failed for segment ${segmentId}:`, err);

    try {
      await updateJobStatus(tenantId, jobId, "failed", { error: err.message });
    } catch (updateErr) {
      console.error("Failed to update job status to failed:", updateErr);
    }

    throw err;
  }
};

async function queryAllSegmentMembers(tenantId, segmentId) {
  const members = [];
  let exclusiveStartKey;

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
      for (const item of response.Items) {
        const record = unmarshall(item);
        members.push(record);
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return members;
}

async function buildExportReport(tenantId, members) {
  const report = [];

  for (let i = 0; i < members.length; i += BATCH_GET_SIZE) {
    const batch = members.slice(i, i + BATCH_GET_SIZE);
    const keys = batch.map((m) => marshall({
      tenantId,
      email: m.subscriberEmail
    }));

    const response = await sendWithRetry(() => ddb.send(new BatchGetItemCommand({
      RequestItems: {
        [TABLE_NAME]: { Keys: keys }
      }
    })), "BatchGetSubscribers");

    const subscriberMap = {};
    if (response.Responses?.[TABLE_NAME]) {
      for (const item of response.Responses[TABLE_NAME]) {
        const record = unmarshall(item);
        subscriberMap[record.email] = record;
      }
    }

    for (const member of batch) {
      const subscriber = subscriberMap[member.subscriberEmail];
      report.push({
        email: member.subscriberEmail,
        lastEngagedIssue: subscriber?.lastEngagedIssue ?? null,
        engagementCount: subscriber?.engagementCount ?? null
      });
    }
  }

  return report;
}

async function updateJobStatus(tenantId, jobId, status, extra = {}) {
  const updateExprParts = ["#status = :status"];
  const exprAttrNames = { "#status": "status" };
  const exprAttrValues = { ":status": status };

  if (extra.s3Key) {
    updateExprParts.push("s3Key = :s3Key");
    exprAttrValues[":s3Key"] = extra.s3Key;
  }

  if (extra.error) {
    updateExprParts.push("#error = :error");
    exprAttrNames["#error"] = "error";
    exprAttrValues[":error"] = extra.error;
  }

  await sendWithRetry(() => ddb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ tenantId, email: `SEGMENT_JOB#${jobId}` }),
    UpdateExpression: `SET ${updateExprParts.join(", ")}`,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: marshall(exprAttrValues)
  })), "UpdateJobStatus");
}
