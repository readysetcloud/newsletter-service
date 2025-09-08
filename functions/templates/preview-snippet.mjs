import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import Handlebars from 'handlebars';
import { verifyJWT } from '../auth/jwt-verifier.mjs';
import { validateApiKey } from '../auth/validate-api-key.mjs';

const ddb = new DynamoDBClient();
const s3 = new S3Client();

/**
 * Validate snippet parameters against schema
 * @param {Object} parameters - Provided parameters
 * @param {Array} schema - Parameter schema from snippet definition
 * @returns {Object} Validation result
 */
const validateSnippetParameters = (parameters, schema) => {
  const errors = [];
  const validatedParams = {};

  for (const paramDef of schema) {
    const { name, type, required, defaultValue } = paramDef;
    const providedValue = parameters[name];

    if (required && (providedValue === undefined || providedValue === null)) {
      errors.push(`Required parameter '${name}' is missing`);
      continue;
    }

    let finalValue = providedValue !== undefined ? providedValue : defaultValue;

    // Type validation and conversion
    if (finalValue !== undefined && finalValue !== null) {
      switch (type) {
        case 'string':
          finalValue = String(finalValue);
          break;
        case 'number':
          const numValue = Number(finalValue);
          if (isNaN(numValue)) {
            errors.push(`Parameter '${name}' must be a valid number`);
            continue;
          }
          finalValue = numValue;
          break;
        case 'boolean':
          if (typeof finalValue === 'string') {
            finalValue = finalValue.toLowerCase() === 'true';
          } else {
            finalValue = Boolean(finalValue);
          }
          break;
        default:
          errors.push(`Unknown parameter type '${type}' for parameter '${name}'`);
          continue;
      }
    }

    validatedParams[name] = finalValue;
  }

  return {
    isValid: errors.length === 0,
    errors,
    validatedParams
  };
};

/**
 * Preview a snippet with provided parameters
 * Supports both Cognito JWT and API key authentication
 */
export const handler = async (event) => {
  try {
    const { pathParameters, body, headers } = event;
    const { snippetId } = pathParameters;

    if (!snippetId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Snippet ID is required' })
      };
    }

    // Parse request body
    let requestData;
    try {
      requestData = JSON.parse(body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    const { parameters = {} } = requestData;

    // Authenticate and get tenant context
    let tenantId, userId, authMethod;

    const authHeader = headers.Authorization || headers.authorization;
    const apiKeyHeader = headers['x-api-key'] || headers['X-API-Key'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Cognito JWT authentication
      const token = authHeader.substring(7);
      const jwtPayload = await verifyJWT(token);
      tenantId = jwtPayload['custom:tenantId'];
      userId = jwtPayload.sub;
      authMethod = 'cognito';
    } else if (apiKeyHeader) {
      // API key authentication
      const apiKeyValidation = await validateApiKey(apiKeyHeader);
      if (!apiKeyValidation) {
        return {
          statusCode: 401,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid API key' })
        };
      }
      tenantId = apiKeyValidation.tenantId;
      authMethod = 'apikey';
    } else {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Authentication required' })
      };
    }

    // Get snippet from DynamoDB
    const snippetResult = await ddb.send(new GetItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${snippetId}`,
        SK: 'snippet'
      })
    }));

    if (!snippetResult.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Snippet not found' })
      };
    }

    const snippet = unmarshall(snippetResult.Item);

    // Get snippet content from S3
    let snippetContent;
    try {
      const s3Result = await s3.send(new GetObjectCommand({
        Bucket: process.env.TEMPLATES_BUCKET_NAME,
        Key: snippet.s3Key,
        VersionId: snippet.s3VersionId
      }));
      snippetContent = await s3Result.Body.transformToString();
    } catch (error) {
      console.error('Error fetching snippet from S3:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to fetch snippet content' })
      };
    }

    // Validate parameters against snippet schema
    const parameterSchema = snippet.parameters || [];
    const paramValidation = validateSnippetParameters(parameters, parameterSchema);

    if (!paramValidation.isValid) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Parameter validation failed',
          details: paramValidation.errors
        })
      };
    }

    // Render snippet with validated parameters
    let renderedHtml;
    try {
      const template = Handlebars.compile(snippetContent);
      renderedHtml = template(paramValidation.validatedParams);
    } catch (error) {
      console.error('Snippet rendering error:', error);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Snippet rendering failed',
          details: error.message
        })
      };
    }

    const response = {
      snippetId,
      snippetName: snippet.name,
      renderedHtml,
      parameters: paramValidation.validatedParams,
      parameterSchema,
      validation: {
        isValid: true,
        parametersValidated: paramValidation.isValid
      }
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Preview snippet error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};
