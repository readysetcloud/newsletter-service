import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { templateCache } from './template-cache.mjs';

const s3 = new S3Client();

/**
 * Upload template content to S3 with versioning
 * @param {string} key - S3 object key
 * @param {string} content - Template content
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Upload result with versionId
 */
export const uploadTemplate = async (key, content, metadata = {}) => {
  try {
    const result = await s3.send(new PutObjectCommand({
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Key: key,
      Body: content,
      ContentType: 'text/plain',
      Metadata: {
        ...metadata,
        uploadedAt: new Date().toISOString()
      }
    }));

    return {
      success: true,
      versionId: result.VersionId,
      etag: result.ETag
    };
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error(`Failed to upload template: ${error.message}`);
  }
};

/**
 * Download template content from S3 with caching
 * @param {string} tenantId - Tenant ID for caching
 * @param {string} templateId - Template ID for caching
 * @param {string} key - S3 object key
 * @param {string} versionId - Optional version ID
 * @returns {Promise<Object>} Template content and metadata
 */
export const downloadTemplate = async (tenantId, templateId, key, versionId = null) => {
  try {
    // Try cache first if we have version ID
    if (versionId && tenantId && templateId) {
      const cachedContent = await templateCache.getCachedTemplateContent(tenantId, templateId, versionId);
      if (cachedContent) {
        return {
          content: cachedContent,
          metadata: {},
          versionId,
          lastModified: new Date(),
          contentLength: cachedContent.length,
          fromCache: true
        };
      }
    }

    const params = {
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Key: key
    };

    if (versionId) {
      params.VersionId = versionId;
    }

    const result = await s3.send(new GetObjectCommand(params));
    const content = await result.Body.transformToString();

    // Cache the content if we have the required IDs
    if (tenantId && templateId && result.VersionId) {
      await templateCache.cacheTemplateContent(tenantId, templateId, result.VersionId, content);
    }

    return {
      content,
      metadata: result.Metadata || {},
      versionId: result.VersionId,
      lastModified: result.LastModified,
      contentLength: result.ContentLength,
      fromCache: false
    };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      throw new Error('Template not found');
    }
    console.error('S3 download error:', error);
    throw new Error(`Failed to download template: ${error.message}`);
  }
};

/**
 * Delete template from S3 (marks for deletion, doesn't permanently delete due to versioning)
 * @param {string} key - S3 object key
 * @returns {Promise<Object>} Deletion result
 */
export const deleteTemplate = async (key) => {
  try {
    const result = await s3.send(new DeleteObjectCommand({
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Key: key
    }));

    return {
      success: true,
      versionId: result.VersionId
    };
  } catch (error) {
    console.error('S3 delete error:', error);
    throw new Error(`Failed to delete template: ${error.message}`);
  }
};

/**
 * Get version history for a template
 * @param {string} key - S3 object key
 * @returns {Promise<Array>} Array of version information
 */
export const getVersionHistory = async (key) => {
  try {
    const result = await s3.send(new ListObjectVersionsCommand({
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Prefix: key
    }));

    const versions = result.Versions || [];
    return versions
      .filter(version => version.Key === key)
      .map(version => ({
        versionId: version.VersionId,
        lastModified: version.LastModified,
        size: version.Size,
        isLatest: version.IsLatest
      }))
      .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  } catch (error) {
    console.error('S3 version history error:', error);
    throw new Error(`Failed to get version history: ${error.message}`);
  }
};

/**
 * Generate S3 key for template
 * @param {string} tenantId - Tenant ID
 * @param {string} templateId - Template ID
 * @returns {string} S3 key
 */
export const generateTemplateKey = (tenantId, templateId) => {
  return `templates/${tenantId}/${templateId}.hbs`;
};

/**
 * Generate S3 key for snippet
 * @param {string} tenantId - Tenant ID
 * @param {string} snippetId - Snippet ID
 * @returns {string} S3 key
 */
export const generateSnippetKey = (tenantId, snippetId) => {
  return `snippets/${tenantId}/${snippetId}.hbs`;
};
