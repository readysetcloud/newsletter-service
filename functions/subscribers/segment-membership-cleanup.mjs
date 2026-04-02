import { DynamoDBClient, QueryCommand, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { sendWithRetry } from "../utils/helpers.mjs";

const ddb = new DynamoDBClient();
const TABLE_NAME = process.env.SUBSCRIBERS_TABLE_NAME;
const GSI_NAME = "SegmentMemberIndex";

export const handler = async (event) => {
  console.log("Processing DynamoDB stream event for segment membership cleanup");

  for (const record of event.Records) {
    if (record.eventName !== "REMOVE") {
      continue;
    }

    const oldImage = record.dynamodb?.OldImage;
    if (!oldImage) {
      continue;
    }

    const oldRecord = unmarshall(oldImage);
    const sortKey = oldRecord.email;

    // Only process subscriber deletions, not segment record deletions
    if (typeof sortKey === "string" && sortKey.startsWith("SEGMENT")) {
      continue;
    }

    const tenantId = oldRecord.tenantId;
    const email = sortKey;

    console.log(`Subscriber deleted: ${email} in tenant ${tenantId}. Cleaning up segment memberships.`);

    try {
      await cleanupMemberships(tenantId, email);
    } catch (err) {
      console.error(`Failed to cleanup memberships for ${email} in tenant ${tenantId}:`, err);
      throw err;
    }
  }
};

async function cleanupMemberships(tenantId, email) {
  // Query the GSI to find all segment membership records for this subscriber
  let exclusiveStartKey;
  const membershipRecords = [];

  do {
    const queryParams = {
      TableName: TABLE_NAME,
      IndexName: GSI_NAME,
      KeyConditionExpression: "memberEmail = :email AND tenantId = :tenantId",
      ExpressionAttributeValues: marshall({
        ":email": email,
        ":tenantId": tenantId
      })
    };

    if (exclusiveStartKey) {
      queryParams.ExclusiveStartKey = exclusiveStartKey;
    }

    const response = await sendWithRetry(() => ddb.send(new QueryCommand(queryParams)), "QuerySegmentMemberIndex");

    if (response.Items?.length) {
      for (const item of response.Items) {
        membershipRecords.push(unmarshall(item));
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  if (membershipRecords.length === 0) {
    console.log(`No segment memberships found for ${email}`);
    return;
  }

  console.log(`Found ${membershipRecords.length} segment memberships for ${email}`);

  // Extract segmentIds from the membership sort keys and delete each record
  const affectedSegments = new Map();

  for (const record of membershipRecords) {
    // Sort key format: SEGMENT#<segmentId>#MEMBER#<email>
    const sk = record.email;
    const segmentIdMatch = sk.match(/^SEGMENT#([^#]+)#MEMBER#/);
    if (!segmentIdMatch) {
      console.warn(`Unexpected sort key format: ${sk}`);
      continue;
    }

    const segmentId = segmentIdMatch[1];

    // Delete the membership record
    await sendWithRetry(() => ddb.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ tenantId, email: sk })
    })), "DeleteMembershipRecord");

    // Track affected segments for memberCount decrement
    affectedSegments.set(segmentId, (affectedSegments.get(segmentId) || 0) + 1);
  }

  // Decrement memberCount on each affected segment with floor-at-zero protection
  for (const [segmentId, count] of affectedSegments) {
    await decrementMemberCount(tenantId, segmentId, count);
  }
}

async function decrementMemberCount(tenantId, segmentId, count) {
  try {
    await sendWithRetry(() => ddb.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ tenantId, email: `SEGMENT#${segmentId}` }),
      UpdateExpression: "SET memberCount = if_not_exists(memberCount, :zero) - :count",
      ConditionExpression: "if_not_exists(memberCount, :zero) >= :count",
      ExpressionAttributeValues: marshall({
        ":count": count,
        ":zero": 0
      })
    })), "DecrementMemberCount");
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      // Floor at zero — the count would go negative, so set to 0
      console.log(`MemberCount would go below zero for segment ${segmentId}, setting to 0`);
      await sendWithRetry(() => ddb.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ tenantId, email: `SEGMENT#${segmentId}` }),
        UpdateExpression: "SET memberCount = :zero",
        ExpressionAttributeValues: marshall({ ":zero": 0 })
      })), "SetMemberCountZero");
    } else {
      throw err;
    }
  }
}
