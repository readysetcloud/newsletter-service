import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { marshall, unmarsha'@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import JSZip from 'jszip';

const ddb = new DynamoDBClient();
const s3 = new S3Client();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    const body = JSON.parse(event.body || '{}');
    const { templateIds, includeSnippets = true, format = 'zip' } = body;

    if (!templateIds || !Array.isArray(templateIds) || templateIds.length === 0) {
      return formatResponse(400, 'Template IDs are required');
    }

    if (templateIds.length > 50) {
      return formatResponse(400, 'Maximum 50 templates can be exported at once');
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      tenantId,
      templates: [],
      snippets: []
    };

    // Get template metadata from DynamoDB
    const templatePromises = templateIds.map(async (templateId) => {
      const queryCommand = new QueryCommand({
        TableName: process.env.TEMPLATES_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: marshall({
          ':pk': `${tenantId}#${templateId}`,
          ':sk': 'template'
        })
      });

      const result = await ddb.send(queryCommand);
      if (result.Items && result.Items.length > 0) {
        return unmarshall(result.Items[0]);
      }
      return null;
    });

    const templateMetadata = (await Promise.all(templatePromises)).filter(Boolean);

    if (templateMetadata.length === 0) {
      return formatResponse(404, 'No templates found');
    }

    // Get template content from S3
    const templateContentPromises = templateMetadata.map(async (template) => {
      try {
        const getObjectCommand = new GetObjectCommand({
          Bucket: process.env.TEMPLATES_BUCKET_NAME,
          Key: template.s3Key,
          VersionId: template.s3VersionId
        });

        const result = await s3.send(getObjectCommand);
        const content = await result.Body.transformToString();

        return {
          ...template,
          content,
          // Remove sensitive fields
          tenantId: undefined,
          s3Key: undefined,
          s3VersionId: undefined,
          apiKeyId: undefined
        };
      } catch (error) {
        console.error(`Error getting content for template ${template.id}:`, error);
        return {
          ...template,
          content: '',
          error: 'Failed to load content'
        };
      }
    });

    exportData.templates = await Promise.all(templateContentPromises);

    // Get snippets if requested
    if (includeSnippets) {
      // Collect all unique snippet IDs used by templates
      const snippetIds = new Set();
      exportData.templates.forEach(template => {
        if (template.snippets) {
          template.snippets.forEach(snippetId => snippetIds.add(snippetId));
        }
      });

      if (snippetIds.size > 0) {
        const snippetPromises = Array.from(snippetIds).map(async (snippetId) => {
          try {
            const queryCommand = new QueryCommand({
              TableName: process.env.TEMPLATES_TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND SK = :sk',
              ExpressionAttributeValues: marshall({
                ':pk': `${tenantId}#${snippetId}`,
                ':sk': 'snippet'
              })
            });

            const result = await ddb.send(queryCommand);
            if (result.Items && result.Items.length > 0) {
              const snippet = unmarshall(result.Items[0]);

              // Get snippet content from S3
              const getObjectCommand = new GetObjectCommand({
                Bucket: process.env.TEMPLATES_BUCKET_NAME,
                Key: snippet.s3Key,
                VersionId: snippet.s3VersionId
              });

              const contentResult = await s3.send(getObjectCommand);
              const content = await contentResult.Body.transformToString();

              return {
                ...snippet,
                content,
                // Remove sensitive fields
                tenantId: undefined,
                s3Key: undefined,
                s3VersionId: undefined,
                apiKeyId: undefined
              };
            }
            return null;
          } catch (error) {
            console.error(`Error getting snippet ${snippetId}:`, error);
            return null;
          }
        });

        exportData.snippets = (await Promise.all(snippetPromises)).filter(Boolean);
      }
    }

    // Create export package based on format
    if (format === 'zip') {
      const zip = new JSZip();

      // Add metadata file
      zip.file('export-metadata.json', JSON.stringify({
        exportedAt: exportData.exportedAt,
        templateCount: exportData.templates.length,
        snippetCount: exportData.snippets.length,
        version: '1.0'
      }, null, 2));

      // Add templates
      const templatesFolder = zip.folder('templates');
      exportData.templates.forEach(template => {
        const templateData = {
          ...template,
          content: undefined // Content will be in separate file
        };
        templatesFolder.file(`${template.id}.json`, JSON.stringify(templateData, null, 2));
        templatesFolder.file(`${template.id}.hbs`, template.content || '');
      });

      // Add snippets
      if (exportData.snippets.length > 0) {
        const snippetsFolder = zip.folder('snippets');
        exportData.snippets.forEach(snippet => {
          const snippetData = {
            ...snippet,
            content: undefined // Content will be in separate file
          };
          snippetsFolder.file(`${snippet.id}.json`, JSON.stringify(snippetData, null, 2));
          snippetsFolder.file(`${snippet.id}.hbs`, snippet.content || '');
        });
      }

      // Generate ZIP file
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const base64Zip = zipBuffer.toString('base64');

      return formatResponse(200, {
        format: 'zip',
        filename: `templates-export-${new Date().toISOString().split('T')[0]}.zip`,
        data: base64Zip,
        size: zipBuffer.length,
        templateCount: exportData.templates.length,
        snippetCount: exportData.snippets.length
      });
    } else {
      // JSON format
      return formatResponse(200, {
        format: 'json',
        filename: `templates-export-${new Date().toISOString().split('T')[0]}.json`,
        data: exportData,
        templateCount: exportData.templates.length,
        snippetCount: exportData.snippets.length
      });
    }

  } catch (error) {
    console.error('Export templates error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to export templates');
  }
};
