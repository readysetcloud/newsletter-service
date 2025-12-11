import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

export const validateTemplateName = async (tenantId, name, excludeTemplateId = null) => {
  // Validate name format
  if (!name || typeof name !== 'string') {
    return {
      isValid: false,
      error: 'Template name is required',
      code: 'MISSING_NAME'
    };
  }

  const trimmedName = name.trim();

  if (trimmedName.length < 1) {
    return {
      isValid: false,
      error: 'Template name cannot be empty',
      code: 'EMPTY_NAME'
    };
  }

  if (trimmedName.length > 100) {
    return {
      isValid: false,
      error: 'Template name must be 100 characters or less',
      code: 'NAME_TOO_LONG'
    };
  }

  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (invalidChars.test(trimmedName)) {
    return {
      isValid: false,
      error: 'Template name contains invalid characters',
      code: 'INVALID_CHARACTERS'
    };
  }

  try {
    const queryParams = {
      TableName: process.env.TEMPLATES_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tenantId',
      FilterExpression: '#name = :name AND SK = :sk AND isActive = :active',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':name': trimmedName,
        ':sk': 'template',
        ':active': true
      }),
      Limit: 1
    };

    // Exclude current template if updating
    if (excludeTemplateId) {
      queryParams.FilterExpression += ' AND id <> :currentId';
      queryParams.ExpressionAttributeValues = marshall({
        ':tenantId': tenantId,
        ':name': trimmedName,
        ':sk': 'template',
        ':active': true,
        ':currentId': excludeTemplateId
      });
    }

    const result = await ddb.send(new QueryCommand(queryParams));

    if (result.Items && result.Items.length > 0) {
      return {
        isValid: false,
        error: `A template with the name "${trimmedName}" already exists`,
        code: 'NAME_EXISTS',
        suggestions: generateNameSuggestions(trimmedName)
      };
    }

    return {
      isValid: true,
      normalizedName: trimmedName
    };

  } catch (error) {
    console.error('Error validating template name:', error);
    return {
      isValid: false,
      error: 'Failed to validate template name',
      code: 'VALIDATION_ERROR'
    };
  }
};

/**
 * Generates alternative name suggestions when a conflict occurs
 */
export const generateNameSuggestions = (baseName, count = 5) => {
  const suggestions = [];

  // Try numbered variations
  for (let i = 2; i <= count + 1; i++) {
    suggestions.push(`${baseName} (${i})`);
  }

  // Try with current date
  const today = new Date().toISOString().split('T')[0];
  suggestions.push(`${baseName} - ${today}`);

  // Try with timestamp
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  suggestions.push(`${baseName} - ${timestamp}`);

  return suggestions.slice(0, count);
};

/**
 * Checks if a template name is available
 */
export const isTemplateNameAvailable = async (tenantId, name, excludeTemplateId = null) => {
  const validation = await validateTemplateName(tenantId, name, excludeTemplateId);
  return validation.isValid;
};

/**
 * Finds the next available name with a numeric suffix
 */
export const findAvailableName = async (tenantId, baseName, excludeTemplateId = null) => {
  // First try the base name
  if (await isTemplateNameAvailable(tenantId, baseName, excludeTemplateId)) {
    return baseName;
  }

  // Try numbered variations
  for (let i = 2; i <= 100; i++) {
    const candidateName = `${baseName} (${i})`;
    if (await isTemplateNameAvailable(tenantId, candidateName, excludeTemplateId)) {
      return candidateName;
    }
  }

  // Fallback with timestamp
  const timestamp = Date.now();
  return `${baseName} (${timestamp})`;
};
