import { DynamoDBClient, QueryCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { getOctokit } from "./utils/helpers.mjs";

const ddb = new DynamoDBClient();
let octokit;

export const handler = async (event) => {
  try {
    if (!octokit) {
      octokit = await getOctokit();
    }

    const dataTypes = getDataTypes();
    await Promise.all(dataTypes.map(async dt => await syncFile(dt)));
  } catch (err) {
    console.error(err);
  }
};

const syncFile = async (dataType) => {
  console.log(`syncing ${dataType.fileName}`);
  const repoData = await getRepoData(dataType.fileName, dataType.dataPath);
  const dbData = await getDbData(dataType.fileName);

  const newItems = getNewOrUpdatedItems(dataType, repoData, dbData);
  const removedItems = dbData.filter(d => !repoData.find(r => r[dataType.pkProperty] === d.pk));

  console.log(`file: ${dataType.fileName}, new items: ${newItems.length}`);
  for (const newItem of newItems) {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: newItem[dataType.pkProperty],
        sk: dataType.sk,
        GSI1PK: dataType.fileName,
        GSI1SK: newItem[dataType.pkProperty],
        ...newItem
      })
    }));
  };

  console.log(`file: ${dataType.fileName}, removed items: ${removedItems.length}`);
  for (const removedItem of removedItems) {
    await ddb.send(new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: removedItem.pk,
        sk: 'data'
      })
    }));
  }
  console.log(`synced ${dataType.fileName}`);
};

const getRepoData = async (fileName, dataPath) => {
  const content = await octokit.request('GET /repos/{owner}/{repo}/contents/data/{path}', {
    owner: process.env.OWNER,
    repo: process.env.REPO,
    path: fileName
  });

  const buffer = Buffer.from(content.data.content, 'base64');
  const data = buffer.toString('utf8');
  const repoData = JSON.parse(data);
  if (dataPath) {
    return repoData[dataPath];
  } else {
    return repoData;
  }
};

const getDbData = async (fileName) => {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: '#GSI1PK = :fileName',
    ExpressionAttributeNames: {
      '#GSI1PK': 'GSI1PK'
    },
    ExpressionAttributeValues: marshall({
      ':fileName': fileName
    })
  }));

  if (Items?.length) {
    return Items.map(i => unmarshall(i));
  }

  return [];
};

const getNewOrUpdatedItems = (dataType, repoData, dbData) => {
  let newOrUpdatedItems = [];
  for (const repoItem of repoData) {
    const dbItem = dbData.find(d => d.pk === repoItem[dataType.pkProperty]);
    if (!dbItem) {
      newOrUpdatedItems.push(repoItem);
    } else {
      const areEqual = areObjectsEqual(repoItem, dbItem);
      if (!areEqual) {
        newOrUpdatedItems.push(repoItem);
      }
    }
  }

  return newOrUpdatedItems;
};

const areObjectsEqual = (obj1, obj2) => {
  for (let key in obj1) {
    if (obj2.hasOwnProperty(key)) {
      if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
        // If both properties are objects, recursively check their properties
        if (!areObjectsEqual(obj1[key], obj2[key])) {
          return false;
        }
      } else if (obj1[key] !== obj2[key]) {
        return false;
      }
    } else {
      return false;
    }
  }

  return true;
};

const getDataTypes = () => {
  return [
    {
      fileName: 'authors.json',
      pkProperty: 'name',
      sk: 'author'
    },
    {
      fileName: 'sponsors.json',
      pkProperty: 'name',
      sk: 'sponsor',
      dataPath: 'sponsors'
    },
    {
      fileName: 'sponsor-calendar.json',
      pkProperty: 'date',
      sk: 'sponsor-calendar'
    }
  ];
};
