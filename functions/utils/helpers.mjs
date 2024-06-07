import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { Octokit } from 'octokit';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

let octokit;
let tenants = {};
const ddb = new DynamoDBClient();

export const getOctokit = async (tenantId) => {
  if (!octokit) {
    let secrets;
    if (tenantId) {
      const tenant = await getTenant(tenantId);
      secrets = await getParameter(tenant.apiKeyParameter, { decrypt: true, transform: 'json' });
    } else {
      secrets = await getSecret(process.env.SECRET_ID, { transform: 'json' });
    }

    const auth = secrets.github;
    octokit = new Octokit({ auth });
  }

  return octokit;
};

export const getTenant = async (tenantId) => {
  if (tenants.tenantId) {
    return tenants.tenantId;
  } else {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'tenant'
      })
    }));

    if (!result.Item) {
      throw new Error(`Tenant '${tenantId}' not found`);
    }

    const data = unmarshall(result.Item);
    tenants.tenantId = data;
    return data;
  }
};
