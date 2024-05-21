import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import zlib from 'zlib';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  const payload = Buffer.from(event.awslogs.data, 'base64');
  let data = zlib.gunzipSync(payload);

  data = JSON.parse(data.toString());
  let lastTimestamp = new Date().getTime();

  const result = await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: 'redirect',
      sk: 'lastRun'
    }),
    UpdateExpression: 'SET #time = :time',
    ExpressionAttributeNames: {
      '#time': 'time'
    },
    ExpressionAttributeValues: marshall({
      ':time': lastTimestamp
    }),
    ReturnValues: 'UPDATED_OLD'
  }));

  if (result.Attributes?.time) {
    lastTimestamp = Number(result.Attributes.time.N);
  }

  const events = data.logEvents.filter(le => le.timestamp > lastTimestamp);
  const links = [];
  for (const logEvent of events) {
    let message = logEvent.message.split(' ')[1];
    message = JSON.parse(message);
    const index = links.findIndex(l => l.key == message.key);
    if (index > -1) {
      links[index].count += 1;
    } else {
      links.push({
        key: message.key,
        count: 1
      });
    }
  }

  for (const link of links) {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: link.key,
        sk: 'link'
      }),
      UpdateExpression: 'ADD #count :count',
      ExpressionAttributeNames: {
        "#count": "count"
      },
      ExpressionAttributeValues: marshall({
        ":count": link.count
      })
    }));
  }

  return {
    statusCode: 200
  };
};
