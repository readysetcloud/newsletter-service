import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    // Get user context from Lambda authorizer
    const userContext = getUserContext(event);

    // Get brand ID from query paers
    const brandId = event.queryStringParameters?.brandId;

    if (!brandId) {
      return formatResponse(400, { message: 'brandId parameter is required' });
    }

    // Validate brand ID format
    const validationResult = validateBrandId(brandId);
    if (!validationResult.isValid) {
      return formatResponse(200, {
        available: false,
        brandId,
        error: validationResult.error,
        suggestions: generateSuggestions(brandId)
      });
    }

    // Check if brand ID is available in DynamoDB
    const isAvailable = await checkBrandIdAvailability(brandId);

    const response = {
      available: isAvailable,
      brandId
    };

    // If not available, provide suggestions
    if (!isAvailable) {
      response.suggestions = generateSuggestions(brandId);
    }

    return formatResponse(200, response);

  } catch (error) {
    console.error('Check brand ID error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, { message: 'Failed to check brand ID availability' });
  }
};

const validateBrandId = (brandId) => {
  // Check length
  if (!brandId || brandId.length < 3 || brandId.length > 50) {
    return {
      isValid: false,
      error: 'Brand ID must be between 3 and 50 characters'
    };
  }

  // Check format: only lowercase letters
  if (!/^[a-z]+$/.test(brandId)) {
    return {
      isValid: false,
      error: 'Brand ID can only contain lowercase letters'
    };
  }

  // Check for reserved words
  const reservedWords = [
    'admin', 'api', 'www', 'mail', 'email', 'support', 'help', 'blog',
    'news', 'app', 'mobile', 'web', 'ftp', 'cdn', 'assets', 'static',
    'dev', 'test', 'staging', 'prod', 'production', 'beta', 'alpha',
    'dashboard', 'console', 'panel', 'login', 'signup', 'register',
    'auth', 'oauth', 'sso', 'security', 'privacy', 'terms', 'legal'
  ];

  if (reservedWords.includes(brandId.toLowerCase())) {
    return {
      isValid: false,
      error: 'This brand ID is reserved and cannot be used'
    };
  }

  return { isValid: true };
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

    // If item exists, brand ID is not available
    return !result.Item;
  } catch (error) {
    console.error('Error checking brand ID in DynamoDB:', error);
    // In case of error, assume not available for safety
    return false;
  }
};

const generateSuggestions = (baseBrandId) => {
  const suggestions = [];

  // Clean the base brand ID (keep only letters)
  const cleanBase = baseBrandId.replace(/[^a-z]/g, '').substring(0, 45);

  // Add letter suffixes
  const suffixes = ['co', 'inc', 'corp', 'ltd', 'llc'];
  suffixes.forEach(suffix => {
    const suggestion = `${cleanBase}${suffix}`;
    if (suggestion.length <= 50) {
      suggestions.push(suggestion);
    }
  });

  // Add single letter suffixes
  for (let i = 0; i < 5; i++) {
    const letter = String.fromCharCode(97 + i); // a, b, c, d, e
    const suggestion = `${cleanBase}${letter}`;
    if (suggestion.length <= 50) {
      suggestions.push(suggestion);
    }
  }

  // Return first 5 suggestions
  return suggestions.slice(0, 5);
};
