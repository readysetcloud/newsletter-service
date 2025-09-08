import Handlebars from 'handlebars';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { templateCache } from './template-cache.mjs';
import { performanceMonitor } from './performance-monitor.mjs';

const s3 = new S3Client();
const ddb = new DynamoDBClient();

/**
 * Compile and render a handlebars template with snippet support
 * @param {string} templateContent - The handlebars template content
 * @param {Object} data - Data to render the template with
 * @param {string} tenantId - Tenant ID for snippet resolution
 * @returns {Promise<string>} Rendered HTML content
 */
export const renderTemplate = async (templateContent, data, tenantId) => {
  const timerId = performanceMonitor.startTimer('template_render', { tenantId });

  try {
    // Register snippet partials
    const snippetTimerId = performanceMonitor.startTimer('register_snippets', { tenantId });
    await registerSnippets(tenantId);
    performanceMonitor.endTimer(snippetTimerId);

    // Compile and render template
    const compileTimerId = performanceMonitor.startTimer('template_compile', {
      tenantId,
      templateSize: templateContent.length
    });
    const template = Handlebars.compile(templateContent);
    performanceMonitor.endTimer(compileTimerId);

    const renderTimerId = performanceMonitor.startTimer('template_execute', { tenantId });
    const result = template(data);
    performanceMonitor.endTimer(renderTimerId);

    // Log overall rendering performance
    const snippetCount = (templateContent.match(/\{\{>/g) || []).length;
    performanceMonitor.logRenderingMetric(
      'unknown', // templateId not available here
      templateContent.length,
      snippetCount,
      Date.now() - performanceMonitor.metrics.get(timerId)?.startTime || 0,
      { tenantId }
    );

    performanceMonitor.endTimer(timerId, { success: true });
    return result;
  } catch (error) {
    performanceMonitor.endTimer(timerId, { success: false, error: error.message });
    console.error('Template rendering error:', error);
    throw new Error(`Template rendering failed: ${error.message}`);
  }
};

/**
 * Render a single snippet with parameters
 * @param {string} snippetContent - The snippet handlebars content
 * @param {Object} parameters - Parameters to render the snippet with
 * @returns {string} Rendered HTML content
 */
export const renderSnippet = (snippetContent, parameters = {}) => {
  try {
    const template = Handlebars.compile(snippetContent);
    return template(parameters);
  } catch (error) {
    console.error('Snippet rendering error:', error);
    throw new Error(`Snippet rendering failed: ${error.message}`);
  }
};

/**
 * Validate handlebars template syntax with comprehensive error checking
 * @param {string} templateContent - The template content to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result with isValid and errors
 */
export const validateTemplate = (templateContent, options = {}) => {
  const errors = [];
  const warnings = [];

  // Basic validation
  if (!templateContent || typeof templateContent !== 'string') {
    return {
      isValid: false,
      errors: [{
        message: 'Template content is required and must be a string',
        line: null,
        column: null,
        type: 'validation',
        severity: 'error',
        code: 'TEMPLATE_CONTENT_REQUIRED'
      }],
      warnings: []
    };
  }

  // Check for empty content
  if (templateContent.trim().length === 0) {
    return {
      isValid: false,
      errors: [{
        message: 'Template content cannot be empty',
        line: 1,
        column: 1,
        type: 'validation',
        severity: 'error',
        code: 'TEMPLATE_CONTENT_EMPTY'
      }],
      warnings: []
    };
  }

  // Check template size limits
  if (templateContent.length > 1000000) { // 1MB limit
    errors.push({
      message: 'Template content exceeds maximum size limit (1MB)',
      line: null,
      column: null,
      type: 'validation',
      severity: 'error',
      code: 'TEMPLATE_SIZE_EXCEEDED'
    });
  }

  // Validate handlebars syntax
  try {
    const template = Handlebars.compile(templateContent);

    // Test compilation with empty data to catch runtime errors
    try {
      template({});
    } catch (runtimeError) {
      errors.push({
        message: `Template runtime error: ${runtimeError.message}`,
        line: extractLineNumber(runtimeError.message),
        column: extractColumnNumber(runtimeError.message),
        type: 'runtime',
        severity: 'error',
        code: 'TEMPLATE_RUNTIME_ERROR'
      });
    }
  } catch (syntaxError) {
    errors.push({
      message: syntaxError.message,
      line: extractLineNumber(syntaxError.message),
      column: extractColumnNumber(syntaxError.message),
      type: 'syntax',
      severity: 'error',
      code: 'TEMPLATE_SYNTAX_ERROR'
    });
  }

  // Validate snippet references
  const snippetValidation = validateSnippetReferences(templateContent);
  errors.push(...snippetValidation.errors);
  warnings.push(...snippetValidation.warnings);

  // Check for potential security issues
  const securityValidation = validateTemplateSecurity(templateContent);
  errors.push(...securityValidation.errors);
  warnings.push(...securityValidation.warnings);

  // Check for best practices
  if (options.checkBestPractices !== false) {
    const bestPracticesValidation = validateTemplateBestPractices(templateContent);
    warnings.push(...bestPracticesValidation.warnings);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Register all snippets for a tenant as Handlebars partials with caching
 * @param {string} tenantId - Tenant ID
 */
const registerSnippets = async (tenantId) => {
  try {
    const snippets = await getSnippetsForTenant(tenantId);

    for (const snippet of snippets) {
      const content = await getSnippetContent(tenantId, snippet.id, snippet.s3Key, snippet.s3VersionId);
      Handlebars.registerPartial(snippet.name, content);
    }
  } catch (error) {
    console.error('Error registering snippets:', error);
    // Don't throw - allow template rendering to continue without snippets
  }
};

/**
 * Get all snippets for a tenant from DynamoDB
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Array>} Array of snippet metadata
 */
const getSnippetsForTenant = async (tenantId) => {
  const result = await ddb.send(new QueryCommand({
    TableName: process.env.TEMPLATES_TABLE_NAME,
    KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(SK, :snippetPrefix)',
    ExpressionAttributeValues: marshall({
      ':tenantId': tenantId,
      ':snippetPrefix': 'snippet'
    }),
    IndexName: 'GSI1'
  }));

  return result.Items ? result.Items.map(item => unmarshall(item)) : [];
};

/**
 * Get snippet content from S3 with caching and performance monitoring
 * @param {string} tenantId - Tenant ID for caching
 * @param {string} snippetId - Snippet ID
 * @param {string} s3Key - S3 object key
 * @param {string} versionId - S3 version ID
 * @returns {Promise<string>} Snippet content
 */
const getSnippetContent = async (tenantId, snippetId, s3Key, versionId) => {
  const timerId = performanceMonitor.startTimer('get_snippet_content', {
    tenantId,
    snippetId,
    s3Key
  });

  try {
    // Try cache first
    const cachedContent = await templateCache.getCachedSnippetContent(tenantId, snippetId, versionId);
    if (cachedContent) {
      performanceMonitor.logCacheMetric('snippet_content', true, { snippetId, tenantId });
      performanceMonitor.endTimer(timerId, { success: true, fromCache: true });
      return cachedContent;
    }

    performanceMonitor.logCacheMetric('snippet_content', false, { snippetId, tenantId });

    // Fetch from S3
    const s3TimerId = performanceMonitor.startTimer('s3_get_snippet', { s3Key });
    const result = await s3.send(new GetObjectCommand({
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Key: s3Key,
      ...(versionId && { VersionId: versionId })
    }));

    const content = await result.Body.transformToString();
    const s3Duration = performanceMonitor.endTimer(s3TimerId, { success: true }).duration;

    // Log S3 performance
    performanceMonitor.logS3Metric(
      process.env.TEMPLATES_BUCKET_NAME,
      'GetObject',
      s3Key,
      content.length,
      s3Duration,
      false,
      { snippetId, tenantId }
    );

    // Cache the content
    await templateCache.cacheSnippetContent(tenantId, snippetId, versionId, content);

    performanceMonitor.endTimer(timerId, { success: true, fromCache: false });
    return content;
  } catch (error) {
    performanceMonitor.endTimer(timerId, { success: false, error: error.message });
    throw error;
  }
};

/**
 * Extract line number from Handlebars error message
 * @param {string} errorMessage - Error message
 * @returns {number|null} Line number or null if not found
 */
const extractLineNumber = (errorMessage) => {
  const lineMatch = errorMessage.match(/line (\d+)/i) || errorMessage.match(/at line (\d+)/i);
  return lineMatch ? parseInt(lineMatch[1]) : null;
};

/**
 * Extract column number from Handlebars error message
 * @param {string} errorMessage - Error message
 * @returns {number|null} Column number or null if not found
 */
const extractColumnNumber = (errorMessage) => {
  const columnMatch = errorMessage.match(/column (\d+)/i) || errorMessage.match(/at column (\d+)/i);
  return columnMatch ? parseInt(columnMatch[1]) : null;
};

/**
 * Validate snippet references in template content
 * @param {string} templateContent - Template content
 * @returns {Object} Validation result with errors and warnings
 */
const validateSnippetReferences = (templateContent) => {
  const errors = [];
  const warnings = [];

  // Find all snippet references
  const snippetRegex = /\{\{>\s*([a-zA-Z0-9_-]+)([^}]*)\}\}/g;
  const lines = templateContent.split('\n');
  let match;

  while ((match = snippetRegex.exec(templateContent)) !== null) {
    const snippetName = match[1].trim();
    const parameters = match[2];
    const position = match.index;

    // Find line number
    let lineNumber = 1;
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1; // +1 for newline
      if (charCount > position) {
        lineNumber = i + 1;
        break;
      }
    }

    // Validate snippet name format
    if (!/^[a-zA-Z0-9_-]+$/.test(snippetName)) {
      errors.push({
        message: `Invalid snippet name "${snippetName}". Snippet names can only contain letters, numbers, hyphens, and underscores.`,
        line: lineNumber,
        column: match.index - (charCount - lines[lineNumber - 1].length - 1),
        type: 'validation',
        severity: 'error',
        code: 'INVALID_SNIPPET_NAME'
      });
    }

    // Check for reserved snippet names
    const reservedNames = ['if', 'unless', 'each', 'with', 'lookup', 'log'];
    if (reservedNames.includes(snippetName.toLowerCase())) {
      errors.push({
        message: `"${snippetName}" is a reserved Handlebars helper name and cannot be used as a snippet name.`,
        line: lineNumber,
        column: match.index - (charCount - lines[lineNumber - 1].length - 1),
        type: 'validation',
        severity: 'error',
        code: 'RESERVED_SNIPPET_NAME'
      });
    }

    // Warn about potentially missing snippets (this is a soft warning since snippets might exist)
    if (snippetName.length > 50) {
      warnings.push({
        message: `Snippet name "${snippetName}" is very long. Consider using a shorter name for better readability.`,
        line: lineNumber,
        column: match.index - (charCount - lines[lineNumber - 1].length - 1),
        type: 'best-practice',
        severity: 'warning',
        code: 'LONG_SNIPPET_NAME'
      });
    }
  }

  return { errors, warnings };
};

/**
 * Validate template for potential security issues
 * @param {string} templateContent - Template content
 * @returns {Object} Validation result with errors and warnings
 */
const validateTemplateSecurity = (templateContent) => {
  const errors = [];
  const warnings = [];

  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    {
      pattern: /\{\{\{[^}]*<script[^}]*\}\}\}/gi,
      message: 'Potential XSS vulnerability: Unescaped script tags detected',
      code: 'POTENTIAL_XSS_SCRIPT'
    },
    {
      pattern: /\{\{\{[^}]*javascript:[^}]*\}\}\}/gi,
      message: 'Potential XSS vulnerability: JavaScript URLs detected',
      code: 'POTENTIAL_XSS_JAVASCRIPT_URL'
    },
    {
      pattern: /\{\{\{[^}]*on\w+\s*=[^}]*\}\}\}/gi,
      message: 'Potential XSS vulnerability: Event handlers detected',
      code: 'POTENTIAL_XSS_EVENT_HANDLER'
    }
  ];

  dangerousPatterns.forEach(({ pattern, message, code }) => {
    let match;
    while ((match = pattern.exec(templateContent)) !== null) {
      const lineNumber = templateContent.substring(0, match.index).split('\n').length;
      warnings.push({
        message,
        line: lineNumber,
        column: match.index - templateContent.lastIndexOf('\n', match.index - 1) - 1,
        type: 'security',
        severity: 'warning',
        code
      });
    }
  });

  // Check for excessive nesting
  const maxNestingLevel = 10;
  const nestingLevel = checkNestingLevel(templateContent);
  if (nestingLevel > maxNestingLevel) {
    warnings.push({
      message: `Template has deep nesting (${nestingLevel} levels). Consider simplifying for better performance and readability.`,
      line: null,
      column: null,
      type: 'performance',
      severity: 'warning',
      code: 'DEEP_NESTING'
    });
  }

  return { errors, warnings };
};

/**
 * Validate template best practices
 * @param {string} templateContent - Template content
 * @returns {Object} Validation result with warnings
 */
const validateTemplateBestPractices = (templateContent) => {
  const warnings = [];

  // Check for missing alt attributes in images
  const imgRegex = /<img[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(templateContent)) !== null) {
    if (!imgMatch[0].includes('alt=')) {
      const lineNumber = templateContent.substring(0, imgMatch.index).split('\n').length;
      warnings.push({
        message: 'Image missing alt attribute for accessibility',
        line: lineNumber,
        column: imgMatch.index - templateContent.lastIndexOf('\n', imgMatch.index - 1) - 1,
        type: 'accessibility',
        severity: 'warning',
        code: 'MISSING_ALT_ATTRIBUTE'
      });
    }
  }

  // Check for inline styles (recommend CSS classes instead)
  const inlineStyleRegex = /style\s*=\s*["'][^"']*["']/gi;
  let styleMatch;
  while ((styleMatch = inlineStyleRegex.exec(templateContent)) !== null) {
    const lineNumber = templateContent.substring(0, styleMatch.index).split('\n').length;
    warnings.push({
      message: 'Consider using CSS classes instead of inline styles for better maintainability',
      line: lineNumber,
      column: styleMatch.index - templateContent.lastIndexOf('\n', styleMatch.index - 1) - 1,
      type: 'best-practice',
      severity: 'warning',
      code: 'INLINE_STYLES'
    });
  }

  // Check for very long lines
  const lines = templateContent.split('\n');
  lines.forEach((line, index) => {
    if (line.length > 120) {
      warnings.push({
        message: `Line is very long (${line.length} characters). Consider breaking it up for better readability.`,
        line: index + 1,
        column: 120,
        type: 'best-practice',
        severity: 'warning',
        code: 'LONG_LINE'
      });
    }
  });

  return { warnings };
};

/**
 * Check nesting level in template
 * @param {string} templateContent - Template content
 * @returns {number} Maximum nesting level
 */
const checkNestingLevel = (templateContent) => {
  let maxLevel = 0;
  let currentLevel = 0;

  // Simple nesting check for handlebars blocks
  const blockRegex = /\{\{#[^}]+\}\}|\{\{\/[^}]+\}\}/g;
  let match;

  while ((match = blockRegex.exec(templateContent)) !== null) {
    if (match[0].startsWith('{{#')) {
      currentLevel++;
      maxLevel = Math.max(maxLevel, currentLevel);
    } else if (match[0].startsWith('{{/')) {
      currentLevel--;
    }
  }

  return maxLevel;
};

/**
 * Process template content to extract used snippets
 * @param {string} templateContent - Template content
 * @returns {Array<string>} Array of snippet names used in template
 */
export const extractUsedSnippets = (templateContent) => {
  const snippetRegex = /\{\{>\s*([a-zA-Z0-9_-]+)/g;
  const snippets = [];
  let match;

  while ((match = snippetRegex.exec(templateContent)) !== null) {
    const snippetName = match[1].trim();
    if (!snippets.includes(snippetName)) {
      snippets.push(snippetName);
    }
  }

  return snippets;
};

/**
 * Get snippet metadata and content by ID with caching
 * @param {string} tenantId - Tenant ID
 * @param {string} snippetId - Snippet ID
 * @returns {Promise<Object>} Snippet data with content
 */
export const getSnippetById = async (tenantId, snippetId) => {
  try {
    // Try to get cached metadata first
    const cachedMetadata = await templateCache.getCachedSnippetMetadata(tenantId, snippetId);
    let snippet;

    if (cachedMetadata) {
      snippet = cachedMetadata;
    } else {
      // Get snippet metadata from DynamoDB
      const result = await ddb.send(new QueryCommand({
        TableName: process.env.TEMPLATES_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: marshall({
          ':pk': `${tenantId}#${snippetId}`,
          ':sk': 'snippet'
        })
      }));

      if (!result.Items || result.Items.length === 0) {
        throw new Error(`Snippet ${snippetId} not found`);
      }

      snippet = unmarshall(result.Items[0]);

      // Cache the metadata
      await templateCache.cacheSnippetMetadata(tenantId, snippetId, snippet);
    }

    // Get content from S3 with caching
    const content = await getSnippetContent(tenantId, snippetId, snippet.s3Key, snippet.s3VersionId);

    return {
      ...snippet,
      content
    };
  } catch (error) {
    console.error('Error getting snippet by ID:', error);
    throw error;
  }
};

/**
 * Validate snippet syntax with comprehensive error checking
 * @param {string} snippetContent - The snippet content to validate
 * @param {Array} parameters - Expected parameters for the snippet
 * @param {Object} options - Validation options
 * @returns {Object} Validation result with isValid, errors, and warnings
 */
export const validateSnippet = (snippetContent, parameters = [], options = {}) => {
  const errors = [];
  const warnings = [];

  // Basic validation
  if (!snippetContent || typeof snippetContent !== 'string') {
    return {
      isValid: false,
      errors: [{
        message: 'Snippet content is required and must be a string',
        line: null,
        column: null,
        type: 'validation',
        severity: 'error',
        code: 'SNIPPET_CONTENT_REQUIRED'
      }],
      warnings: []
    };
  }

  // Check for empty content
  if (snippetContent.trim().length === 0) {
    return {
      isValid: false,
      errors: [{
        message: 'Snippet content cannot be empty',
        line: 1,
        column: 1,
        type: 'validation',
        severity: 'error',
        code: 'SNIPPET_CONTENT_EMPTY'
      }],
      warnings: []
    };
  }

  // Check snippet size limits
  if (snippetContent.length > 100000) { // 100KB limit for snippets
    errors.push({
      message: 'Snippet content exceeds maximum size limit (100KB)',
      line: null,
      column: null,
      type: 'validation',
      severity: 'error',
      code: 'SNIPPET_SIZE_EXCEEDED'
    });
  }

  // Validate handlebars syntax
  try {
    const template = Handlebars.compile(snippetContent);

    // Test compilation with parameter data
    if (parameters && parameters.length > 0) {
      const testData = {};
      parameters.forEach(param => {
        testData[param.name] = getDefaultValueForParameterType(param.type);
      });

      try {
        template(testData);
      } catch (runtimeError) {
        errors.push({
          message: `Snippet runtime error: ${runtimeError.message}`,
          line: extractLineNumber(runtimeError.message),
          column: extractColumnNumber(runtimeError.message),
          type: 'runtime',
          severity: 'error',
          code: 'SNIPPET_RUNTIME_ERROR'
        });
      }
    }
  } catch (syntaxError) {
    errors.push({
      message: syntaxError.message,
      line: extractLineNumber(syntaxError.message),
      column: extractColumnNumber(syntaxError.message),
      type: 'syntax',
      severity: 'error',
      code: 'SNIPPET_SYNTAX_ERROR'
    });
  }

  // Validate parameter usage
  if (parameters && parameters.length > 0) {
    const parameterValidation = validateSnippetParameters(snippetContent, parameters);
    errors.push(...parameterValidation.errors);
    warnings.push(...parameterValidation.warnings);
  }

  // Check for security issues
  const securityValidation = validateTemplateSecurity(snippetContent);
  errors.push(...securityValidation.errors);
  warnings.push(...securityValidation.warnings);

  // Check for best practices
  if (options.checkBestPractices !== false) {
    const bestPracticesValidation = validateSnippetBestPractices(snippetContent, parameters);
    warnings.push(...bestPracticesValidation.warnings);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Get default value for parameter type
 * @param {string} type - Parameter type
 * @returns {any} Default value
 */
const getDefaultValueForParameterType = (type) => {
  switch (type) {
    case 'string':
      return 'test';
    case 'number':
      return 42;
    case 'boolean':
      return true;
    default:
      return 'test';
  }
};

/**
 * Validate snippet parameter usage
 * @param {string} snippetContent - Snippet content
 * @param {Array} parameters - Expected parameters
 * @returns {Object} Validation result with errors and warnings
 */
const validateSnippetParameters = (snippetContent, parameters) => {
  const errors = [];
  const warnings = [];

  // Find all variable references in the snippet
  const variableRegex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const usedVariables = new Set();
  let match;

  while ((match = variableRegex.exec(snippetContent)) !== null) {
    const variableName = match[1];
    usedVariables.add(variableName);
  }

  // Check for required parameters that are not used
  parameters.forEach(param => {
    if (param.required && !usedVariables.has(param.name)) {
      warnings.push({
        message: `Required parameter "${param.name}" is defined but not used in the snippet`,
        line: null,
        column: null,
        type: 'validation',
        severity: 'warning',
        code: 'UNUSED_REQUIRED_PARAMETER'
      });
    }
  });

  // Check for used variables that are not defined as parameters
  const definedParameters = new Set(parameters.map(p => p.name));
  usedVariables.forEach(variable => {
    if (!definedParameters.has(variable)) {
      warnings.push({
        message: `Variable "${variable}" is used but not defined as a parameter`,
        line: null,
        column: null,
        type: 'validation',
        severity: 'warning',
        code: 'UNDEFINED_PARAMETER'
      });
    }
  });

  return { errors, warnings };
};

/**
 * Validate snippet best practices
 * @param {string} snippetContent - Snippet content
 * @param {Array} parameters - Snippet parameters
 * @returns {Object} Validation result with warnings
 */
const validateSnippetBestPractices = (snippetContent, parameters) => {
  const warnings = [];

  // Check for too many parameters
  if (parameters && parameters.length > 10) {
    warnings.push({
      message: `Snippet has many parameters (${parameters.length}). Consider breaking it into smaller snippets for better maintainability.`,
      line: null,
      column: null,
      type: 'best-practice',
      severity: 'warning',
      code: 'TOO_MANY_PARAMETERS'
    });
  }

  // Check for very complex snippets
  const complexity = calculateSnippetComplexity(snippetContent);
  if (complexity > 20) {
    warnings.push({
      message: `Snippet is complex (complexity score: ${complexity}). Consider simplifying or breaking into smaller snippets.`,
      line: null,
      column: null,
      type: 'best-practice',
      severity: 'warning',
      code: 'HIGH_COMPLEXITY'
    });
  }

  // Check for missing parameter descriptions
  if (parameters) {
    parameters.forEach(param => {
      if (!param.description || param.description.trim().length === 0) {
        warnings.push({
          message: `Parameter "${param.name}" is missing a description`,
          line: null,
          column: null,
          type: 'best-practice',
          severity: 'warning',
          code: 'MISSING_PARAMETER_DESCRIPTION'
        });
      }
    });
  }

  return { warnings };
};

/**
 * Calculate snippet complexity score
 * @param {string} snippetContent - Snippet content
 * @returns {number} Complexity score
 */
const calculateSnippetComplexity = (snippetContent) => {
  let complexity = 0;

  // Count handlebars blocks
  const blockRegex = /\{\{#[^}]+\}\}/g;
  complexity += (snippetContent.match(blockRegex) || []).length * 2;

  // Count conditionals
  const conditionalRegex = /\{\{#(if|unless)[^}]+\}\}/g;
  complexity += (snippetContent.match(conditionalRegex) || []).length * 3;

  // Count loops
  const loopRegex = /\{\{#each[^}]+\}\}/g;
  complexity += (snippetContent.match(loopRegex) || []).length * 4;

  // Count variables
  const variableRegex = /\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/g;
  complexity += (snippetContent.match(variableRegex) || []).length;

  return complexity;
};
