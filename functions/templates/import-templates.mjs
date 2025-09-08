import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { uploadTemplate, generateTemplateKey } from './utils/s3-storage.mjs';
import { validateTemplate } from './utils/template-engine.mjs';
import JSZip from 'jszip';
import crypto from 'crypto';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId, userId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    const body = JSON.parse(event.body || '{}');
    const { data, format = 'json', conflictResolution = 'skip', preserveIds = false } = body;

    if (!data) {
      return formatResponse(400, 'Import data is required');
    }

    let importData;

    // Parse import data based on format
    if (format === 'zip') {
      try {
        const zipBuffer = Buffer.from(data, 'base64');
        const zip = new JSZip();
        const zipContents = await zip.loadAsync(zipBuffer);

        // Read metadata
        const metadataFile = zipContents.file('export-metadata.json');
        if (!metadataFile) {
          return formatResponse(400, 'Invalid export file: missing metadata');
        }

        const metadata = JSON.parse(await metadataFile.async('text'));

        importData = {
  exportedAt: metadata.exportedAt,
          templates: [],
          snippets: []
        };

        // Read templates
        const templatesFolder = zipContents.folder('templates');
        if (templatesFolder) {
          const templateFiles = templatesFolder.filter((relativePath, file) =>
            !file.dir && relativePath.endsWith('.json')
          );

          for (const templateFile of templateFiles) {
            const templateId = templateFile.name.replace('templates/', '').replace('.json', '');
            const templateData = JSON.parse(await templateFile.async('text'));

            // Get template content
            const contentFile = templatesFolder.file(`${templateId}.hbs`);
            if (contentFile) {
              templateData.content = await contentFile.async('text');
            }

            importData.templates.push(templateData);
          }
        }

        // Read snippets
        const snippetsFolder = zipContents.folder('snippets');
        if (snippetsFolder) {
          const snippetFiles = snippetsFolder.filter((relativePath, file) =>
            !file.dir && relativePath.endsWith('.json')
          );

          for (const snippetFile of snippetFiles) {
            const snippetId = snippetFile.name.replace('snippets/', '').replace('.json', '');
            const snippetData = JSON.parse(await snippetFile.async('text'));

            // Get snippet content
            const contentFile = snippetsFolder.file(`${snippetId}.hbs`);
            if (contentFile) {
              snippetData.content = await contentFile.async('text');
            }

            importData.snippets.push(snippetData);
          }
        }
      } catch (error) {
        return formatResponse(400, 'Invalid ZIP file format');
      }
    } else {
      // JSON format
      importData = data;
    }

    if (!importData.templates || !Array.isArray(importData.templates)) {
      return formatResponse(400, 'Invalid import data: templates array is required');
    }

    if (importData.templates.length > 100) {
      return formatResponse(400, 'Maximum 100 templates can be imported at once');
    }

    const results = {
      imported: {
        templates: [],
        snippets: []
      },
      skipped: {
        templates: [],
        snippets: []
      },
      errors: []
    };

    // Import snippets first (templates may depend on them)
    if (importData.snippets && Array.isArray(importData.snippets)) {
      for (const snippetData of importData.snippets) {
        try {
          await importSnippet(snippetData, tenantId, userId, conflictResolution, preserveIds, results);
        } catch (error) {
          results.errors.push({
            type: 'snippet',
            id: snippetData.id,
            name: snippetData.name,
            error: error.message
          });
        }
      }
    }

    // Import templates
    for (const templateData of importData.templates) {
      try {
        await importTemplate(templateData, tenantId, userId, conflictResolution, preserveIds, results);
      } catch (error) {
        results.errors.push({
          type: 'template',
          id: templateData.id,
          name: templateData.name,
          error: error.message
        });
      }
    }

    return formatResponse(200, {
      success: true,
      results,
      summary: {
        templatesImported: results.imported.templates.length,
        templatesSkipped: results.skipped.templates.length,
        snippetsImported: results.imported.snippets.length,
        snippetsSkipped: results.skipped.snippets.length,
        errors: results.errors.length
      }
    });

  } catch (error) {
    console.error('Import templates error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to import templates');
  }
};

async function importTemplate(templateData, tenantId, userId, conflictResolution, preserveIds, results) {
  // Validate required fields
  if (!templateData.name || !templateData.content) {
    throw new Error('Template name and content are required');
  }

  // Validate template syntax
  const validation = validateTemplate(templateData.content);
  if (!validation.isValid) {
    throw new Error(`Template validation failed: ${validation.errors.join(', ')}`);
  }

  const templateId = preserveIds && templateData.id ? templateData.id : crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Check if template already exists
  const existingTemplate = await checkTemplateExists(tenantId, templateId, templateData.name);

  if (existingTemplate) {
    if (conflictResolution === 'skip') {
      results.skipped.templates.push({
        id: templateId,
        name: templateData.name,
        reason: 'Template already exists'
      });
      return;
    } else if (conflictResolution === 'rename') {
      // Find a unique name
      let counter = 1;
      let newName = `${templateData.name} (${counter})`;
      while (await checkTemplateExists(tenantId, null, newName)) {
        counter++;
        newName = `${templateData.name} (${counter})`;
      }
      templateData.name = newName;
    }
    // For 'overwrite', we continue with the import
  }

  // Upload template content to S3
  const s3Key = generateTemplateKey(tenantId, templateId);
  const uploadResult = await uploadTemplate(s3Key, templateData.content, {
    templateId,
    tenantId,
    name: templateData.name,
    importedBy: userId || 'api-key'
  });

  // Create template record in DynamoDB
  const templateItem = {
    PK: `${tenantId}#${templateId}`,
    SK: 'template',
    GSI1PK: tenantId,
    GSI1SK: timestamp,

    // Template data
    id: templateId,
    tenantId,
    name: templateData.name,
    description: templateData.description || '',
    type: 'template',
    category: templateData.category || 'imported',
    tags: templateData.tags || ['imported'],
    snippets: templateData.snippets || [],
    isVisualMode: templateData.isVisualMode || false,
    visualConfig: templateData.visualConfig,

    // S3 reference
    s3Key,
    s3VersionId: uploadResult.versionId,

    // Metadata
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: userId,
    apiKeyId: null,
    isActive: true
  };

  await ddb.send(new PutItemCommand({
    TableName: process.env.TEMPLATES_TABLE_NAME,
    Item: marshall(templateItem),
    ConditionExpression: conflictResolution === 'overwrite' ? undefined : 'attribute_not_exists(PK)'
  }));

  results.imported.templates.push({
    id: templateId,
    name: templateData.name,
    originalId: templateData.id
  });
}

async function importSnippet(snippetData, tenantId, userId, conflictResolution, preserveIds, results) {
  // Validate required fields
  if (!snippetData.name || !snippetData.content) {
    throw new Error('Snippet name and content are required');
  }

  const snippetId = preserveIds && snippetData.id ? snippetData.id : crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Check if snippet already exists
  const existingSnippet = await checkSnippetExists(tenantId, snippetId, snippetData.name);

  if (existingSnippet) {
    if (conflictResolution === 'skip') {
      results.skipped.snippets.push({
        id: snippetId,
        name: snippetData.name,
        reason: 'Snippet already exists'
      });
      return;
    } else if (conflictResolution === 'rename') {
      // Find a unique name
      let counter = 1;
      let newName = `${snippetData.name} (${counter})`;
      while (await checkSnippetExists(tenantId, null, newName)) {
        counter++;
        newName = `${snippetData.name} (${counter})`;
      }
      snippetData.name = newName;
    }
    // For 'overwrite', we continue with the import
  }

  // Upload snippet content to S3
  const s3Key = `snippets/${tenantId}/${snippetId}.hbs`;
  const uploadResult = await uploadTemplate(s3Key, snippetData.content, {
    snippetId,
    tenantId,
    name: snippetData.name,
    importedBy: userId || 'api-key'
  });

  // Create snippet record in DynamoDB
  const snippetItem = {
    PK: `${tenantId}#${snippetId}`,
    SK: 'snippet',
    GSI1PK: tenantId,
    GSI1SK: timestamp,

    // Snippet data
    id: snippetId,
    tenantId,
    name: snippetData.name,
    description: snippetData.description || '',
    type: 'snippet',
    parameters: snippetData.parameters || [],

    // S3 reference
    s3Key,
    s3VersionId: uploadResult.versionId,

    // Metadata
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: userId,
    apiKeyId: null,
    isActive: true
  };

  await ddb.send(new PutItemCommand({
    TableName: process.env.TEMPLATES_TABLE_NAME,
    Item: marshall(snippetItem),
    ConditionExpression: conflictResolution === 'overwrite' ? undefined : 'attribute_not_exists(PK)'
  }));

  results.imported.snippets.push({
    id: snippetId,
    name: snippetData.name,
    originalId: snippetData.id
  });
}

async function checkTemplateExists(tenantId, templateId, templateName) {
  if (templateId) {
    // Check by ID
    const queryCommand = new QueryCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': `${tenantId}#${templateId}`,
        ':sk': 'template'
      })
    });

    const result = await ddb.send(queryCommand);
    return result.Items && result.Items.length > 0;
  } else if (templateName) {
    // Check by name
    const queryCommand = new QueryCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(SK, :templatePrefix)',
      FilterExpression: '#name = :name',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':templatePrefix': 'template',
        ':name': templateName
      })
    });

    const result = await ddb.send(queryCommand);
    return result.Items && result.Items.length > 0;
  }

  return false;
}

async function checkSnippetExists(tenantId, snippetId, snippetName) {
  if (snippetId) {
    // Check by ID
    const queryCommand = new QueryCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': `${tenantId}#${snippetId}`,
        ':sk': 'snippet'
      })
    });

    const result = await ddb.send(queryCommand);
    return result.Items && result.Items.length > 0;
  } else if (snippetName) {
    // Check by name
    const queryCommand = new QueryCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(SK, :snippetPrefix)',
      FilterExpression: '#name = :name',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':snippetPrefix': 'snippet',
        ':name': snippetName
      })
    });

    const result = await ddb.send(queryCommand);
    return result.Items && result.Items.length > 0;
  }

  return false;
}
