import { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, UpdateItemCommand, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatEmptyResponse, formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';
import { publishBrandEvent, EVENT_TYPES } from '../utils/event-publisher.mjs';

const cognito = new CognitoIdentityProviderClient();
const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { userId, email, tenantId } = userContext;

    const body = JSON.parse(event.body || '{}');
    const hasBrandAlready = tenantId !== undefined && tenantId != null;
    const brandData = extractBrandData(body);

    // If this is first time and brandId is provided, we need to create the tenant record
    let finalTenantId = tenantId;
    const isFirstTimeBrandSave = !hasBrandAlready && brandData.hasOwnProperty('brandId');

    if (isFirstTimeBrandSave) {
      const isBrandIdAvailable = await checkBrandIdAvailability(brandData.brandId);
      if (!isBrandIdAvailable) {
        throw new Error(`Brand ID '${brandData.brandId}' is already taken`);
      }
      finalTenantId = brandData.brandId;
      await createTenantWithBrandData(finalTenantId, userId, brandData);
      await setUserTenantId(email, finalTenantId);
      await triggerTenantFinalizationWorkflows(finalTenantId, userId);
    } else {
      await updateBrandInfo(finalTenantId, brandData);
    }

    // Publish brand updated event after successful update
    await publishBrandEvent(
      finalTenantId,
      userId,
      EVENT_TYPES.BRAND_UPDATED,
      {
        brandId: finalTenantId,
        brandName: brandData.brandName,
        website: brandData.website,
        industry: brandData.industry,
        brandDescription: brandData.brandDescription,
        brandLogo: brandData.brandLogo,
        tags: brandData.tags,
        isFirstTime: isFirstTimeBrandSave,
        updatedAt: new Date().toISOString(),
        updatedFields: Object.keys(brandData)
      }
    );

    return formatEmptyResponse(204);

  } catch (error) {
    console.error('Update brand error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.message.includes('is already taken')) {
      return formatResponse(409, error.message);
    }

    if (error.name === 'UserNotFoundException') {
      return formatResponse(404, 'User not found');
    }

    return formatResponse(500, 'Failed to update brand details');
  }
};

const extractBrandData = (body) => {
  const { brandId, brandName, website, industry, brandDescription, brandLogo, tags } = body;
  const brandData = {};

  if (brandId !== undefined) brandData.brandId = brandId;
  if (brandName !== undefined) brandData.brandName = brandName;
  if (website !== undefined) brandData.website = website;
  if (industry !== undefined) brandData.industry = industry;
  if (brandDescription !== undefined) brandData.brandDescription = brandDescription;
  if (brandLogo !== undefined) brandData.brandLogo = brandLogo;
  if (tags !== undefined) brandData.tags = tags;

  return brandData;
};

const updateBrandInfo = async (tenantId, brandData) => {
  const updatedAt = new Date().toISOString();
  const fieldsToUpdate = ['brandName', 'website', 'industry', 'brandDescription', 'tags', 'brandLogo'];
  const updateData = { updatedAt };

  fieldsToUpdate.forEach(field => {
    if (brandData.hasOwnProperty(field)) {
      if (field === 'brandName') {
        updateData.name = brandData[field];
      } else {
        updateData[field] = brandData[field];
      }
    }
  });

  const { updateExpression, expressionAttributeNames, expressionAttributeValues } = buildUpdateExpression(updateData);

  if (updateExpression) {
    console.log('updating', updateExpression, tenantId);
    const updateResult = await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'tenant'
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ReturnValues: 'ALL_OLD'
    }));

    if (brandData.hasOwnProperty('brandLogo') && updateResult.Attributes) {
      const oldAttributes = unmarshall(updateResult.Attributes);
      const oldBrandLogo = oldAttributes.brandLogo;

      if (oldBrandLogo && oldBrandLogo !== brandData.brandLogo) {
        try {
          await triggerS3Cleanup(oldBrandLogo);
        } catch (error) {
          console.error('Failed to trigger S3 cleanup event:', error);
        };
      }
    }
  }
};

const checkBrandIdAvailability = async (brandId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: brandId,
        sk: 'tenant'
      })
    }));

    return !result.Item;
  } catch (error) {
    console.error('Error checking brand ID availability:', error);
    return false;
  }
};

const createTenantWithBrandData = async (tenantId, userId, brandData) => {
  const now = new Date().toISOString();

  const tenantItem = {
    pk: tenantId,
    sk: 'tenant',
    name: brandData.brandName || 'Unknown',
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    subscribers: 0,
    GSI1PK: 'tenant',
    GSI1SK: tenantId
  };

  if (brandData.website) tenantItem.website = brandData.website;
  if (brandData.industry) tenantItem.industry = brandData.industry;
  if (brandData.brandDescription) tenantItem.brandDescription = brandData.brandDescription;
  if (brandData.brandLogo) tenantItem.brandLogo = brandData.brandLogo;
  if (brandData.tags) tenantItem.tags = brandData.tags;

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall(tenantItem),
    ConditionExpression: 'attribute_not_exists(pk)'
  }));

  console.log(`Tenant ${tenantId} created with brand data by user ${userId} at ${now}`);
};

const setUserTenantId = async (email, tenantId) => {
  await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: process.env.USER_POOL_ID,
    Username: email,
    UserAttributes: [
      {
        Name: 'custom:tenant_id',
        Value: tenantId
      }
    ]
  }));

  console.log(`User ${email} tenant ID set to ${tenantId}`);
};

const triggerTenantFinalizationWorkflows = async (tenantId, userId) => {
  await eventBridge.send(new PutEventsCommand({
    Entries: [
      {
        Source: 'newsletter.tenant',
        DetailType: 'Tenant Finalized',
        Detail: JSON.stringify({ tenantId, userId })
      }
    ]
  }));

  console.log(`Tenant finalization event emitted for tenant ${tenantId}`);
};

const triggerS3Cleanup = async (logoUrl) => {
  try {
    const url = new URL(logoUrl);
    const key = url.pathname.substring(1);

    if (!key.startsWith('brand-logos/')) {
      console.warn('Skipping cleanup trigger for non-brand-logo file:', key);
      return;
    }

    console.log(`Triggering async S3 cleanup for: ${key}`);

    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'newsletter-service',
        DetailType: 'S3 Asset Cleanup',
        Detail: JSON.stringify({
          action: 'delete',
          assetType: 'brand-logo',
          s3Url: logoUrl,
          s3Key: key,
          bucketName: process.env.HOSTING_BUCKET_NAME,
          triggeredBy: 'brand-update',
          timestamp: new Date().toISOString()
        })
      }]
    }));

    console.log(`S3 cleanup event published for: ${key}`);
  } catch (error) {
    console.error('Failed to trigger S3 cleanup event:', error);
    console.error('Logo URL was:', logoUrl);
    throw error;
  }
};

const buildUpdateExpression = (data) => {
  const setExpressions = [];
  const removeExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  Object.entries(data).forEach(([key, value]) => {
    const attributeName = `#${key}`;
    const attributeValue = `:${key}`;

    expressionAttributeNames[attributeName] = key;

    if (value === null || value === undefined) {
      removeExpressions.push(attributeName);
    } else if (typeof value === 'string' && value.trim() === '') {
      removeExpressions.push(attributeName);
    } else if (Array.isArray(value) && value.length === 0) {
      removeExpressions.push(attributeName);
    } else {
      setExpressions.push(`${attributeName} = ${attributeValue}`);
      expressionAttributeValues[attributeValue] = value;
    }
  });

  const expressions = [];
  if (setExpressions.length > 0) {
    expressions.push(`SET ${setExpressions.join(', ')}`);
  }
  if (removeExpressions.length > 0) {
    expressions.push(`REMOVE ${removeExpressions.join(', ')}`);
  }

  return {
    updateExpression: expressions.length > 0 ? expressions.join(' ') : null,
    expressionAttributeNames,
    expressionAttributeValues
  };
};
