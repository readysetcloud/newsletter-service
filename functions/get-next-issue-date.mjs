import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

export const handler = async (state) => {
  const date = getNextMonday();
  const data = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: date,
      sk: 'sponsor-calendar'
    })
  }));

  if (data.Item) {
    const item = unmarshall(data.Item);
    return {
      slot: {
        date: item.date,
        sponsor: item.sponsor
      }
    };
  }
};

const getNextMonday = () => {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;

  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilNextMonday);

  const yyyy = nextMonday.getFullYear();
  const mm = String(nextMonday.getMonth() + 1).padStart(2, '0');
  const dd = String(nextMonday.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
};
