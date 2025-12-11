import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { downloadTemplate } from './utils/s3-storage.mjs';
import Handlebars from 'handlebars';

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    const snippetId = event.pathParameters?.snippetId;
    if (!snippetId) {
      return formatResponse(400, 'Snippet ID is required');
    }

    const body = JSON.parse(event.body || '{}');
    const { parameters = {} } = body;

    // Get snippet content
    const snippet = await downloadTemplate(tenantId, snippetId, `snippets/${tenantId}/${snippetId}.hbs`);

    // Render snippet with parameters
    const template = Handlebars.compile(snippet.content);
    const renderedHtml = template(parameters);

    return formatResponse(200, {
      snippetId,
      renderedHtml,
      parameters
    });

  } catch (error) {
    console.error('Preview snippet error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.message === 'Template not found') {
      return formatResponse(404, 'Snippet not found');
    }

    return formatResponse(500, 'Failed to preview snippet');
  }
};
