import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { renderTemplate, validateTemplate } from './utils/template-engine.mjs';
import { verifyJWT } from '../auth/jwt-verifier.mjs';
import { validateApiKey } from '../auth/validate-api-key.mjs';

const ddb = new DynamoDBClient();
const s3 = new S3Client();
const eventBridge = new EventBridgeClient();

/**
 * Preview a template with test data and optionally send test email
 * Supports both Cognito JWT and API key authentication
 */
export const handler = async (event) => {
  try {
    const { pathParameters, body, headers } = event;
    const { templateId } = pathParameters;

    if (!templateId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Template ID is required' })
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

    const { testData = {}, sendTestEmail = false, testEmailAddress } = requestData;

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

    // Get template from DynamoDB
    const templateResult = await ddb.send(new GetItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${templateId}`,
        SK: 'template'
      })
    }));

    if (!templateResult.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Template not found' })
      };
    }

    const template = unmarshall(templateResult.Item);

    // Get template content from S3
    let templateContent;
    try {
      const s3Result = await s3.send(new GetObjectCommand({
        Bucket: process.env.TEMPLATES_BUCKET_NAME,
        Key: template.s3Key,
        VersionId: template.s3VersionId
      }));
      templateContent = await s3Result.Body.transformToString();
    } catch (error) {
      console.error('Error fetching template from S3:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to fetch template content' })
      };
    }

    // Validate template syntax
    const validation = validateTemplate(templateContent);
    if (!validation.isValid) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Template validation failed',
          details: validation.errors
        })
      };
    }

    // Render template with test data
    let renderedHtml;
    try {
      renderedHtml = await renderTemplate(templateContent, testData, tenantId);
    } catch (error) {
      console.error('Template rendering error:', error);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Template rendering failed',
          details: error.message
        })
      };
    }

    const response = {
      templateId,
      templateName: template.name,
      renderedHtml,
      testData,
      validation: {
        isValid: true,
        snippetsUsed: template.snippets || []
      }
    };

    // Send test email if requested
    if (sendTestEmail) {
      if (!testEmailAddress) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Test email address is required when sendTestEmail is true' })
        };
      }

      try {
        // Send email via EventBridge to existing email service
        await eventBridge.send(new PutEventsCommand({
          Entries: [{
            Source: 'template-service',
            DetailType: 'Send Email v2',
            Detail: JSON.stringify({
              tenantId,
              subject: `Template Preview: ${template.name}`,
              html: renderedHtml,
              to: { email: testEmailAddress },
              referenceNumber: `template-preview-${templateId}-${Date.now()}`
            })
          }]
        }));

        response.testEmailSent = true;
        response.testEmailAddress = testEmailAddress;
      } catch (error) {
        console.error('Error sending test email:', error);
        response.testEmailError = 'Failed to send test email';
      }
    }

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
    console.error('Preview template error:', error);
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
