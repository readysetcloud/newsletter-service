import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TemplatePreview } from '../TemplatePreview';
import { templateService } from '@/services/templateService';
import type { Template, Snippet } from '@/types/template';

// Mock the template service
vi.mock('@/services/templateService', () => ({
  templateService: {
    previewTemplate: vi.fn(),
  },
}));

// Mock Handlebars
vi.mock('handlebars', () => ({
  default: {
    compile: vi.fn(),
    registerHelper: vi.fn(),
    SafeString: vi.fn((str) => str),
  },
}));

// Mock responsive hook
vi.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
  }),
}));

const mockTemplate: Template = {
  id: 'template-1',
  tenantId: 'tenant-1',
  name: 'Test Template',
  description: 'A test template',
  type: 'template',
  content: '<h1>{{title}}</h1><p>{{content}}</p>',
  s3Key: 'templates/tenant-1/template-1.hbs',
  s3VersionId: 'version-1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  version: 1,
  isActive: true,
};

const mockSnippets: Snippet[] = [
  {
    id: 'snippet-1',
    tenantId: 'tenant-1',
    name: 'header',
    description: 'Header snippet',
    type: 'snippet',
    content: '<header>{{title}}</header>',
    parameters: [
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'Header title',
      },
    ],
    s3Key: 'snippets/tenant-1/snippet-1.hbs',
    s3VersionId: 'version-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true,
  },
];

describe('TemplatePreview', () => {
  let mockHandlebars: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup Handlebars mock
    mockHandlebars = vi.mocked((await import('handlebars')).default);
    mockHandlebars.compile.mockReturnValue((data: any) =>
      `<h1>${data.title || 'Default Title'}</h1><p>${data.content || 'Default Content'}</p>`
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders preview with default test data', async () => {
    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
      />
    );

    // Check that preview controls are rendered
    expect(screen.getByText('Preview Mode:')).toBeInTheDocument();
    expect(screen.getAllByText('Desktop')).toHaveLength(2); // Button text and indicator
    expect(screen.getByText('Tablet')).toBeInTheDocument();
    expect(screen.getByText('Mobile')).toBeInTheDocument();

    // Check that test email input is rendered
    expect(screen.getByPlaceholderText('test@example.com')).toBeInTheDocument();
    expect(screen.getByText('Send Test')).toBeInTheDocument();

    // Wait for template to render
    await waitFor(() => {
      expect(mockHandlebars.compile).toHaveBeenCalledWith(mockTemplate.content);
    });
  });

  it('switches between preview modes', async () => {
    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
      />
    );

    const tabletButton = screen.getByText('Tablet');
    const mobileButton = screen.getByText('Mobile');

    // Switch to tablet mode
    fireEvent.click(tabletButton);
    expect(tabletButton.closest('button')).toHaveClass('bg-blue-600');

    // Switch to mobile mode
    fireEvent.click(mobileButton);
    expect(mobileButton.closest('button')).toHaveClass('bg-blue-600');
  });

  it('registers snippet helpers with Handlebars', async () => {
    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
      />
    );

    await waitFor(() => {
      expect(mockHandlebars.registerHelper).toHaveBeenCalledWith(
        'header',
        expect.any(Function)
      );
    });
  });

  it('handles template rendering errors gracefully', async () => {
    const errorTemplate = {
      ...mockTemplate,
      content: '{{invalid handlebars syntax',
    };

    mockHandlebars.compile.mockImplementation(() => {
      throw new Error('Invalid handlebars syntax');
    });

    render(
      <TemplatePreview
        template={errorTemplate}
        snippets={mockSnippets}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Rendering Error')).toBeInTheDocument();
      expect(screen.getByText('Invalid handlebars syntax')).toBeInTheDocument();
    });
  });

  it('sends test email when requested', async () => {
    const mockPreviewResponse = {
      success: true,
      data: {
        html: '<h1>Test</h1>',
        success: true,
      },
    };

    vi.mocked(templateService.previewTemplate).mockResolvedValue(mockPreviewResponse);

    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
      />
    );

    const emailInput = screen.getByPlaceholderText('test@example.com');
    const sendButton = screen.getByText('Send Test');

    // Enter email address
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    // Click send button
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(templateService.previewTemplate).toHaveBeenCalledWith(
        mockTemplate.id,
        {
          testData: expect.any(Object),
          sendTestEmail: true,
          testEmailAddress: 'test@example.com',
        }
      );
    });

    // Check success message
    await waitFor(() => {
      expect(screen.getByText('Test email sent successfully!')).toBeInTheDocument();
    });
  });

  it('shows error when test email fails', async () => {
    const mockErrorResponse = {
      success: false,
      error: 'Failed to send email',
    };

    vi.mocked(templateService.previewTemplate).mockResolvedValue(mockErrorResponse);

    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
      />
    );

    const emailInput = screen.getByPlaceholderText('test@example.com');
    const sendButton = screen.getByText('Send Test');

    // Enter email address
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    // Click send button
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to send email')).toBeInTheDocument();
    });
  });

  it('validates email address before sending', () => {
    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
      />
    );

    const sendButton = screen.getByText('Send Test');

    // Button should be disabled when no email is entered
    expect(sendButton).toBeDisabled();

    const emailInput = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    // Button should be enabled when email is entered
    expect(sendButton).not.toBeDisabled();
  });

  it('updates test data when onTestDataChange is provided', async () => {
    const mockOnTestDataChange = vi.fn();

    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
        onTestDataChange={mockOnTestDataChange}
      />
    );

    // Expand test data editor
    const testDataToggle = screen.getByText('Test Data (Click to expand)');
    fireEvent.click(testDataToggle);

    const textarea = screen.getByPlaceholderText('Enter test data as JSON...');

    const newTestData = JSON.stringify({
      title: 'New Title',
      content: 'New Content',
    }, null, 2);

    fireEvent.change(textarea, { target: { value: newTestData } });

    expect(mockOnTestDataChange).toHaveBeenCalledWith({
      title: 'New Title',
      content: 'New Content',
    });
  });

  it('handles invalid JSON in test data editor gracefully', () => {
    const mockOnTestDataChange = vi.fn();

    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
        onTestDataChange={mockOnTestDataChange}
      />
    );

    // Expand test data editor
    const testDataToggle = screen.getByText('Test Data (Click to expand)');
    fireEvent.click(testDataToggle);

    const textarea = screen.getByPlaceholderText('Enter test data as JSON...');

    // Enter invalid JSON
    fireEvent.change(textarea, { target: { value: '{ invalid json' } });

    // Should not call onTestDataChange with invalid JSON
    expect(mockOnTestDataChange).not.toHaveBeenCalled();
  });

  it('applies custom test data to template rendering', async () => {
    const customTestData = {
      title: 'Custom Title',
      content: 'Custom Content',
    };

    const mockCompiledTemplate = vi.fn().mockReturnValue('<h1>Custom Title</h1><p>Custom Content</p>');
    mockHandlebars.compile.mockReturnValue(mockCompiledTemplate);

    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={mockSnippets}
        testData={customTestData}
      />
    );

    await waitFor(() => {
      expect(mockHandlebars.compile).toHaveBeenCalledWith(mockTemplate.content);
      expect(mockCompiledTemplate).toHaveBeenCalledWith(customTestData);
    });
  });

  it('shows loading state when template content is not available', () => {
    const templateWithoutContent = {
      ...mockTemplate,
      content: undefined,
    };

    render(
      <TemplatePreview
        template={templateWithoutContent}
        snippets={mockSnippets}
      />
    );

    expect(screen.getByText('Template content is not available')).toBeInTheDocument();
  });

  it('applies snippet default values when parameters are missing', async () => {
    const snippetWithDefaults: Snippet = {
      ...mockSnippets[0],
      parameters: [
        {
          name: 'title',
          type: 'string',
          required: false,
          defaultValue: 'Default Header Title',
          description: 'Header title',
        },
      ],
    };

    render(
      <TemplatePreview
        template={mockTemplate}
        snippets={[snippetWithDefaults]}
      />
    );

    await waitFor(() => {
      expect(mockHandlebars.registerHelper).toHaveBeenCalledWith(
        'header',
        expect.any(Function)
      );
    });

    // Test the registered helper function
    const helperFunction = mockHandlebars.registerHelper.mock.calls[0][1];
    const result = helperFunction({ hash: {} });

    // The helper should apply default values
    expect(mockHandlebars.compile).toHaveBeenCalledWith(snippetWithDefaults.content);
  });
});
