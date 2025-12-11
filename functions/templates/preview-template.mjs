import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { downloadTemplate } from './utils/s3-storage.mjs';
import { renderTemplate, validateTemplate } from './utils/template-engine.mjs';
import { validateEmailCompatibility, renderForEmailClient, getEmailClientPreviews } from './utils/email-renderer.mjs';

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    const templateId = event.pathParameters?.templateId;
    if (!templateId) {
      return formatResponse(400, 'Template ID is required');
    }

    const body = JSON.parse(event.body || '{}');
    const { testData = {}, emailCompatible = false, clientId = null } = body;

    // Get template content
    const template = await downloadTemplate(tenantId, templateId, `templates/${tenantId}/${templateId}.hbs`);

    // Render template with test data
    const renderOptions = { emailCompatible };
    const renderedHtml = renderTemplate(template.content, testData, renderOptions);

    // Validate email compatibility if requested
    let emailWarnings = [];
    if (emailCompatible) {
      emailWarnings = validateEmailCompatibility(renderedHtml);
    }

    // Render for specific email client if requested
    let clientSpecificHtml = renderedHtml;
    if (clientId) {
      const clients = getEmailClientPreviews();
      const client = clients.find(c => c.id === clientId);
      if (client) {
        clientSpecificHtml = renderForEmailClient(renderedHtml, client);
      }
    }

    return formatResponse(200, {
      templateId,
      renderedHtml: clientSpecificHtml,
      testData,
      emailWarnings,
      emailCompatible,
      clientId
    });

  } catch (error) {
    console.error('Preview template error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.message === 'Template not found') {
      return formatResponse(404, 'Template not found');
    }

    return formatResponse(500, 'Failed to preview template');
  }
};
