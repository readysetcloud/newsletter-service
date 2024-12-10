import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
const ddb = new DynamoDBClient();

export const handler = async (state) => {
  const keyCounts = {};
  let newestTimestamp = null;

  for (const result of state.results) {
    const message = result.find(r => r.Field == '@message');
    if (!message) continue;

    const keyMatch = message.Value.match(/"key":"(.*?)"/);
    if (keyMatch) {
      const key = keyMatch[1];
      keyCounts[key] = (keyCounts[key] || 0) + 1;
    }

    const timestamp = result.find(r => r.Field == '@timestamp');
    const currentTimestamp = new Date(timestamp.Value);
    if (!newestTimestamp || currentTimestamp > newestTimestamp) {
      newestTimestamp = currentTimestamp;
    }
  }

  if(Object.keys(keyCounts).length > 0) {
    await updateKeyCounts(keyCounts);
  }

  return {
    newestTimestamp: newestTimestamp.toISOString()
  };
};

const updateKeyCounts = async (keyCounts) => {
  for (const key in keyCounts) {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: key,
        sk: 'link'
      }),
      UpdateExpression: 'ADD #count :count',
      ExpressionAttributeNames: {
        "#count": "count"
      },
      ExpressionAttributeValues: marshall({
        ":count": keyCounts[key]
      })
    }));
  }
};
