import React, { useMemo } from 'react';
import { ExclamationTriangleIcon, InformationCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface EmailWarning {
  type: 'compatibility' | 'accessibility';
  severity: 'error' | 'warning' | 'info';
  message: string;
  count: number;
  examples?: string[];
}

interface EmailClientPreview {
  name: string;
  id: string;
  viewport: { width: number; height: number };
  features: {
    supportsMediaQueries: boolean;
    supportsWebFonts: boolean;
    stripsStyleTags: boolean;
    supportsBackgroundImages: boolean;
  };
}

interface Component {
  id: string;
  type: 'heading' | 'text' | 'image' | 'button' | 'divider';
  properties: Record<string, any>;
}

interface EmailCompatibleRendererProps {
  components: Component[];
  showWarnings?: boolean;
  showClientPreviews?: boolean;
  className?: string;
}

// Email client configurations
const EMAIL_CLIENTS: EmailClientPreview[] = [
  {
    name: 'Gmail (Desktop)',
    id: 'gmail-desktop',
    viewport: { width: 600, height: 800 },
    features: {
      supportsMediaQueries: true,
      supportsWebFonts: true,
      stripsStyleTags: false,
      supportsBackgroundImages: true
    }
  },
  {
    name: 'Outlook 2016/2019',
    id: 'outlook-desktop',
    viewport: { width: 600, height: 800 },
    features: {
      supportsMediaQueries: false,
      supportsWebFonts: false,
      stripsStyleTags: true,
      supportsBackgroundImages: false
    }
  },
  {
    name: 'Apple Mail (iOS)',
    id: 'apple-mail-ios',
    viewport: { width: 320, height: 568 },
    features: {
      supportsMediaQueries: true,
      supportsWebFonts: true,
      stripsStyleTags: false,
      supportsBackgroundImages: true
    }
  }
];

// Email-safe component renderers
const renderEmailSafeComponent = (component: Component): string => {
  const { type, properties } = component;

  switch (type) {
    case 'button':
      return `
<table cellpadding="0" cellspacing="0" border="0" style="margin: 16px auto;">
  <tr>
    <td style="background-color: ${properties.color || '#007bff'}; border-radius: 4px; padding: 12px 24px; text-align: center;">
      <a href="${properties.url || '#'}" style="color: ${properties.textColor || '#ffffff'}; text-decoration: none; font-weight: bold; display: inline-block; font-family: Arial, sans-serif;">
        ${properties.text || 'Button'}
      </a>
    </td>
  </tr>
</table>`.trim();

    case 'image':
      return `
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td align="${properties.align || 'center'}">
      <img src="${properties.src || ''}" alt="${properties.alt || ''}" style="display: block; max-width: ${properties.width || '100%'}; height: auto; border: 0;" />
    </td>
  </tr>
</table>`.trim();

    case 'divider':
      return `
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0;">
  <tr>
    <td style="border-top: ${properties.height || '1px'} ${properties.style || 'solid'} ${properties.color || '#cccccc'}; font-size: 0; line-height: 0;">&nbsp;</td>
  </tr>
</table>`.trim();

    case 'text':
      return `
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 8px 0;">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: ${properties.fontSize || '14px'}; color: ${properties.color || '#000000'}; text-align: ${properties.align || 'left'}; line-height: 1.4; padding: 8px 0;">
      ${properties.content || ''}
    </td>
  </tr>
</table>`.trim();

    case 'heading':
      const fontSize = {
        h1: '24px',
        h2: '20px',
        h3: '18px',
        h4: '16px',
        h5: '14px',
        h6: '12px'
      }[properties.level as string] || '20px';

      return `
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0 8px 0;">
  <tr>
    <td style="font-family: Arial, sans-serif; font-size: ${fontSize}; font-weight: bold; color: ${properties.color || '#000000'}; text-align: ${properties.align || 'left'}; line-height: 1.2;">
      ${properties.text || 'Heading'}
    </td>
  </tr>
</table>`.trim();

    default:
      return `<!-- Unsupported component type: ${type} -->`;
  }
};

// Validate email compatibility
const validateEmailCompatibility = (html: string): EmailWarning[] => {
  const warnings: EmailWarning[] = [];

  const problematicPatterns = [
    {
      pattern: /<div[^>]*>/gi,
      message: 'DIV elements may not render consistently across email clients. Consider using tables instead.',
      severity: 'warning' as const,
      type: 'compatibility' as const
    },
    {
      pattern: /position:\s*(absolute|fixed|relative)/gi,
      message: 'CSS positioning may not work in email clients. Use table-based layouts instead.',
      severity: 'error' as const,
      type: 'compatibility' as const
    },
    {
      pattern: /float:\s*(left|right)/gi,
      message: 'CSS float property is not supported in many email clients.',
      severity: 'warning' as const,
      type: 'compatibility' as const
    },
    {
      pattern: /display:\s*(flex|grid)/gi,
      message: 'Modern CSS layout methods (flexbox, grid) are not supported in email clients.',
      severity: 'error' as const,
      type: 'compatibility' as const
    },
    {
      pattern: /background-image:/gi,
      message: 'Background images may not display in all email clients, especially Outlook.',
      severity: 'warning' as const,
      type: 'compatibility' as const
    }
  ];

  problematicPatterns.forEach(({ pattern, message, severity, type }) => {
    const matches = html.match(pattern);
    if (matches) {
      warnings.push({
        type,
        severity,
        message,
        count: matches.length,
        examples: matches.slice(0, 3)
      });
    }
  });

  // Check for missing alt attributes on images
  const imgWithoutAlt = html.match(/<img(?![^>]*alt=)[^>]*>/gi);
  if (imgWithoutAlt) {
    warnings.push({
      type: 'accessibility',
      severity: 'warning',
      message: 'Images without alt attributes may cause accessibility issues.',
      count: imgWithoutAlt.length,
      examples: imgWithoutAlt.slice(0, 3)
    });
  }

  return warnings;
};

// Render for specific email client
const renderForEmailClient = (html: string, client: EmailClientPreview): string => {
  let clientHtml = html;

  if (!client.features.supportsMediaQueries) {
    clientHtml = clientHtml.replace(/@media[^{]*{[^}]*}/gi, '');
  }

  if (!client.features.supportsWebFonts) {
    clientHtml = clientHtml.replace(/font-family:\s*[^,;]*,\s*/gi, 'font-family: ');
  }

  if (client.features.stripsStyleTags) {
    clientHtml = clientHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  }

  if (!client.features.supportsBackgroundImages) {
    clientHtml = clientHtml.replace(/background-image:[^;]*;?/gi, '');
  }

  return clientHtml;
};

const WarningIcon: React.FC<{ severity: string }> = ({ severity }) => {
  switch (severity) {
    case 'error':
      return <XCircleIcon className="w-4 h-4 text-red-500" />;
    case 'warning':
      return <ExclamationTriangleIcon className="w-4 h-4 text-yellow-500" />;
    default:
      return <InformationCircleIcon className="w-4 h-4 text-blue-500" />;
  }
};

export const EmailCompatibleRenderer: React.FC<EmailCompatibleRendererProps> = ({
  components,
  showWarnings = true,
  showClientPreviews = false,
  className = ''
}) => {
  const emailHtml = useMemo(() => {
    return components.map(component => renderEmailSafeComponent(component)).join('\n\n');
  }, [components]);

  const warnings = useMemo(() => {
    return validateEmailCompatibility(emailHtml);
  }, [emailHtml]);

  const clientPreviews = useMemo(() => {
    return EMAIL_CLIENTS.map(client => ({
      client,
      html: renderForEmailClient(emailHtml, client)
    }));
  }, [emailHtml]);

  return (
    <div className={className}>
      {/* Email Compatibility Warnings */}
      {showWarnings && warnings.length > 0 && (
        <Card className="mb-4 p-4 border-yellow-200 bg-yellow-50">
          <h3 className="text-sm font-medium text-yellow-800 mb-2 flex items-center">
            <ExclamationTriangleIcon className="w-4 h-4 mr-2" />
            Email Compatibility Warnings
          </h3>
          <div className="space-y-2">
            {warnings.map((warning, index) => (
              <div key={index} className="flex items-start space-x-2 text-sm">
                <WarningIcon severity={warning.severity} />
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-700">{warning.message}</span>
                    <Badge variant={warning.severity === 'error' ? 'destructive' : 'secondary'}>
                      {warning.count} {warning.count === 1 ? 'issue' : 'issues'}
                    </Badge>
                  </div>
                  {warning.examples && warning.examples.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      Example: <code className="bg-gray-100 px-1 rounded">{warning.examples[0]}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Main Email Preview */}
      <Card className="mb-4">
        <div className="p-4 border-b">
          <h3 className="text-sm font-medium text-gray-700">Email Preview</h3>
        </div>
        <div className="p-4">
          <div
            className="border rounded bg-white"
            style={{ maxWidth: '600px', margin: '0 auto' }}
            dangerouslySetInnerHTML={{ __html: emailHtml }}
          />
        </div>
      </Card>

      {/* Email Client Previews */}
      {showClientPreviews && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Email Client Previews</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clientPreviews.map(({ client, html }) => (
              <Card key={client.id} className="overflow-hidden">
                <div className="p-3 border-b bg-gray-50">
                  <h4 className="text-sm font-medium text-gray-700">{client.name}</h4>
                  <div className="text-xs text-gray-500 mt-1">
                    {client.viewport.width} × {client.viewport.height}
                  </div>
                </div>
                <div className="p-2">
                  <div
                    className="border rounded bg-white overflow-hidden"
                    style={{
                      width: Math.min(client.viewport.width * 0.5, 300),
                      height: Math.min(client.viewport.height * 0.5, 400),
                      transform: 'scale(0.5)',
                      transformOrigin: 'top left'
                    }}
                  >
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                  </div>
                </div>
                <div className="p-2 border-t bg-gray-50">
                  <div className="text-xs text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Media Queries:</span>
                      <span className={client.features.supportsMediaQueries ? 'text-green-600' : 'text-red-600'}>
                        {client.features.supportsMediaQueries ? '✓' : '✗'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Web Fonts:</span>
                      <span className={client.features.supportsWebFonts ? 'text-green-600' : 'text-red-600'}>
                        {client.features.supportsWebFonts ? '✓' : '✗'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Background Images:</span>
                      <span className={client.features.supportsBackgroundImages ? 'text-green-600' : 'text-red-600'}>
                        {client.features.supportsBackgroundImages ? '✓' : '✗'}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailCompatibleRenderer;
