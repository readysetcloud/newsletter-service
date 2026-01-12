import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
const ddb = new DynamoDBClient();

const socialMedia = ['https://twitter.com', 'https://x.com', 'https://linkedin.com', 'https://github.com', 'https://bsky.app/profile', 'https://www.twitter.com', 'https://www.x.com', 'https://www.linkedin.com', 'https://www.github.com', 'https://www.bsky.app/profile'];
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

export const handler = async (state) => {
  try {
    const items = [];
    let lastEvaluatedKey;
    do {
      const response = await ddb.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: '#pk = :campaign AND begins_with(#sk, :linkPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk'
        },
        ExpressionAttributeValues: marshall({
          ':campaign': state.campaign,
          ':linkPrefix': 'link#'
        }),
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {})
      }));
      if (response.Items?.length) {
        items.push(...response.Items);
      }
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    if (!items.length) {
      const totalClicks = 0;
      await updateNewsletterStats(state.campaign, totalClicks);
      if (state.returnList) {
        return {
          links: [],
        };
      }
      return {
        post: null,
        person: null
      };
    }

    const links = items.map(i => {
      const item = unmarshall(i);
      const count = n(item.clicks_total ?? item.count);
      return {
        link: item.url || item.link,
        count
      };
    }).filter(l => l.link);
    const totalClicks = links.reduce((sum, link) => sum + n(link.count), 0);
    await updateNewsletterStats(state.campaign, totalClicks);
    links.sort((a, b) => {
      return n(b.count) - n(a.count);
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

const updateNewsletterStats = async (campaign, totalClicks) => {
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: campaign,
      sk: 'stats'
    }),
    UpdateExpression: 'SET #total = :total',
    ExpressionAttributeNames: {
      '#total': 'clicks_total'
    },
    ExpressionAttributeValues: marshall({
      ':total': totalClicks
    })
  }));
};
