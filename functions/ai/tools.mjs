import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { z } from 'zod';

const logger = new Logger({ serviceName: 'tools' });
const ddb = new DynamoDBClient();

export const socialPostTool = {
  isMultiTenant: true,
  name: 'createSocialMediaPost',
  description: 'Creates a social media post for a given topic and audience.',
  schema: z.object({
    copy: z.string().min(100).max(1500).describe('Copy to include in the social media post'),
    platform: z.string().min(2).max(20).describe('Social media platform (e.g., LinkedIn, Facebook)'),
    issueId: z.string().min(1).describe('Identifier for the related newsletter issue')
  }),
  handler: async (context, { copy, platform, issueId }) => {
    try {
      const { tenantId } = context;
      await ddb.send(new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall({
          pk: `${tenantId}#${issueId}`,
          sk: `SOCIAL#${platform.toLowerCase()}`,
          platform,
          copy,
          ttl: Math.floor(Date.now() / 1000) + (3 * 24 * 60 * 60)
        })
      }));
      return { success: true };
    } catch (err) {
      logger.error('Error saving social post', {
        error: err.message,
        stack: err.stack,
        query
      });
      return {
        success: false,
        error: err.message
      };
    }
  }
};

export const createInsightsTool = {
  isMultiTenant: true,
  name: 'createInsights',
  description: 'Saves actionable insights for an issue',
  schema: z.object({
    issueId: z.string().describe('Identifier of the related newsletter issue'),
    insights: z.array(z.string()).min(1).max(5).describe('List of actionable insights')
  }),
  handler: async (context, { issueId, insights }) => {
    const { tenantId } = context;
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: `${tenantId}#${issueId}`,
          sk: 'analytics'
        }),
        UpdateExpression: 'SET #insights = :insights',
        ExpressionAttributeNames: {
          '#insights': 'insights'
        },
        ExpressionAttributeValues: marshall({
          ':insights': insights
        })
      }));

      return { success: true };
    } catch (err) {
      logger.error('Error saving insights to newsletter record', {
        error: err.message,
        issueId,
        tenantId
      });
      return { success: false, error: err.message };
    }
  }
};
