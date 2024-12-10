import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
const ddb = new DynamoDBClient();

const socialMedia = ['https://twitter.com', 'https://x.com', 'https://linkedin.com', 'https://github.com', 'https://bsky.app/profile'];

export const handler = async (state) => {
  try {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: '#GSI1PK = :campaign',
      ExpressionAttributeNames: {
        '#GSI1PK': 'GSI1PK'
      },
      ExpressionAttributeValues: marshall({
        ':campaign': state.campaign
      })
    }));

    if (!response.Items.length) return;

    const links = response.Items.map(i => unmarshall(i));
    links.sort((a, b) => {
      const countA = a.count ? parseInt(a.count) : -Infinity;
      const countB = b.count ? parseInt(b.count) : -Infinity;
      return countB - countA;
    });

    if (!state.returnList) {
      const topPerson = links.find(link => socialMedia.some(sm => link.link.startsWith(sm)));
      const topLink = links.find(link => !socialMedia.some(sm => link.link.startsWith(sm)));

      const seedDate = new Date(state.seedDate);
      const personDate = `${seedDate.toISOString().split('T')[0]}T16:30:00`;
      seedDate.setDate(seedDate.getDate() + 1);
      const linkDate = `${seedDate.toISOString().split('T')[0]}T19:00:00`;
      return {
        post: {
          link: topLink.link,
          date: linkDate
        },
        person: {
          link: topPerson.link,
          date: personDate
        }
      };
    } else {
      return {
        links: links.map(l => {
          return {
            link: l.link,
            count: l.count
          };
        })
      };
    }
  } catch (err) {
    console.error(err);
  }
};
