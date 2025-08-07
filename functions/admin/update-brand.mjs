import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminGetUserCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { marshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';

const cognito = new CognitoIdentityProviderClient();
const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  try {
    // Get user context from Lambda authorizer
    const userContext = getUserContext(event);
    const { userId, email, tenantId } = userContext;

    // Parse request body
    const body = JSON.parse(event.body || '{}');

    // Validate and extract brand data
    const brandData = validateAndExtractBrandData(body);

    // Check if this is the first time brand is being saved
    const isFirstTimeBrandSave = await checkIfFirstTimeBrandSave(email);

    // Update brand information in Cognito
    const updatedBrand = await updateBrandInfo(email, brandData);

    // If this is the first time, finalize the tenant and trigger workflows
    if (isFirstTimeBrandSave) {
      await finalizeTenant(tenantId, userId, brandData);
      await triggerTenantFinalizationWorkflows(tenantId, userId, brandData);
    }

    return formatResponse(200, {
      message: isFirstTimeBrandSave
        ? 'Brand details saved and tenant finalized successfully'
        : 'Brand details updated successfully',
      brand: updatedBrand,
      tenantFinalized: isFirstTimeBrandSave
    });

  } catch (error) {
    console.error('Update brand error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.message.startsWith('Validation error:')) {
      return formatResponse(400, error.message);
    }

    if (error.name === 'UserNotFoundException') {
      return formatResponse(404, 'User not found');
    }

    return formatResponse(500, 'Failed to update brand details');
  }
};

const validateAndExtractBrandData = (body) => {
  const { brandName, website, industry, brandDescription, brandLogo, tags } = body;

  const hasData = brandName || website || industry || brandDescription || brandLogo || tags;

  if (!hasData) {
    throw new Error('Validation error: At least one brand field must be provided');
  }

  const brandData = {};

  if (brandName !== undefined) {
    if (typeof brandName !== 'string' || brandName.length > 100) {
      throw new Error('Validation error: brandName must be a string with max 100 characters');
    }
    brandData.brandName = brandName.trim();
  }

  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      throw new Error('Validation error: tags must be an array');
    }
    if (tags.length > 10) {
      throw new Error('Validation error: tags array cannot have more than 10 items');
    }
    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.length > 50) {
        throw new Error('Validation error: each tag must be a string with max 50 characters');
      }
    }
    brandData.tags = tags.map(tag => tag.trim()).filter(tag => tag.length > 0);
  }

  if (website !== undefined) {
    if (typeof website !== 'string' || website.length > 200) {
      throw new Error('Validation error: website must be a string with max 200 characters');
    }
    // Basic URL validation
    if (website && !/^https?:\/\/.+/.test(website)) {
      throw new Error('Validation error: website must be a valid HTTP/HTTPS URL');
    }
    brandData.website = website.trim();
  }

  if (industry !== undefined) {
    if (typeof industry !== 'string' || industry.length > 100) {
      throw new Error('Validation error: industry must be a string with max 100 characters');
    }
    brandData.industry = industry.trim();
  }

  if (brandDescription !== undefined) {
    if (typeof brandDescription !== 'string' || brandDescription.length > 500) {
      throw new Error('Validation error: brandDescription must be a string with max 500 characters');
    }
    brandData.brandDescription = brandDescription.trim();
  }

  if (brandLogo !== undefined) {
    if (typeof brandLogo !== 'string' || brandLogo.length > 500) {
      throw new Error('Validation error: brandLogo must be a string with max 500 characters');
    }
    // Basic URL validation for logo
    if (brandLogo && !/^https?:\/\/.+/.test(brandLogo)) {
      throw new Error('Validation error: brandLogo must be a valid HTTP/HTTPS URL');
    }
    brandData.brandLogo = brandLogo.trim();
  }

  return brandData;
};

const updateBrandInfo = async (email, brandData) => {
  const userAttributes = [];
  if (brandData.brandName) {
    userAttributes.push({ Name: 'custom:brand_name', Value: brandData.brandName });
  }

  if (brandData.tags) {
    userAttributes.push({ Name: 'custom:brand_tags', Value: JSON.stringify(brandData.tags) });
  }

  if (brandData.website) {
    userAttributes.push({ Name: 'website', Value: brandData.website });
  }

  if (brandData.industry) {
    userAttributes.push({ Name: 'custom:industry', Value: brandData.industry });
  }

  if (brandData.brandDescription) {
    userAttributes.push({ Name: 'custom:brand_description', Value: brandData.brandDescription });
  }

  if (brandData.brandLogo) {
    userAttributes.push({ Name: 'custom:brand_logo', Value: brandData.brandLogo });
  }

  const updatedAt = new Date().toISOString();
  userAttributes.push({
    Name: 'custom:brand_updated_at',
    Value: updatedAt
  });

  await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: process.env.USER_POOL_ID,
    Username: email,
    UserAttributes: userAttributes
  }));
  return {
    brandName: brandData.brandName || null,
    website: brandData.website || null,
    industry: brandData.industry || null,
    brandDescription: brandData.brandDescription || null,
    brandLogo: brandData.brandLogo || null,
    tags: brandData.tags || null,
    updatedAt
  };
};

const checkIfFirstTimeBrandSave = async (email) => {
  try {
    const getUserCommand = new AdminGetUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: email
    });

    const userResult = await cognito.send(getUserCommand);

    const brandUpdatedAtAttr = userResult.UserAttributes.find(
      attr => attr.Name === 'custom:brand_updated_at'
    );

    return !brandUpdatedAtAttr;
  } catch (error) {
    console.error('Error checking first time brand save:', error);
    return false;
  }
};

const finalizeTenant = async (tenantId, userId, brandData) => {
  const now = new Date().toISOString();
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    }),
    UpdateExpression: 'SET #status = :status, #finalizedAt = :finalizedAt, #finalizedBy = :finalizedBy, #brandName = :brandName',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#finalizedAt': 'finalizedAt',
      '#finalizedBy': 'finalizedBy',
      '#brandName': 'brandName'
    },
    ExpressionAttributeValues: marshall({
      ':status': 'active',
      ':finalizedAt': now,
      ':finalizedBy': userId,
      ':brandName': brandData.brandName || 'Unknown Brand'
    }),
    ConditionExpression: 'attribute_not_exists(#finalizedAt)'
  }));

  console.log(`Tenant ${tenantId} finalized by user ${userId} at ${now}`);
};

const triggerTenantFinalizationWorkflows = async (tenantId, userId, brandData) => {
  const eventDetail = {
    tenantId,
    userId,
    brandData: {
      brandName: brandData.brandName,
      website: brandData.website,
      industry: brandData.industry,
      brandDescription: brandData.brandDescription,
      brandLogo: brandData.brandLogo,
      tags: brandData.tags
    },
    finalizedAt: new Date().toISOString(),
    subdomain: tenantId
  };

  await eventBridge.send(new PutEventsCommand({
    Entries: [
      {
        Source: 'newsletter.tenant',
        DetailType: 'Tenant Finalized',
        Detail: JSON.stringify(eventDetail)
      }
    ]
  }));

  console.log(`Tenant finalization event emitted for tenant ${tenantId}`);
};
