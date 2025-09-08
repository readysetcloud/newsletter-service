import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { TemplateBuilder } from '../TemplateBuilder';
import { templateService } from '@/services/templateService';
import type { Template, Snippet } from '@/types/template';

// Mock the template service
vi.mock('@/services/templateService', () => ({
  templateService: {
    getSnippets: vi.fn(),
    getTemplateCategories: vi.fn(),
    getTemplateTags: vi.fn(),
    createTemplateWithRetry: vi.fn(),
    updateTemplateWithRetry: vi.fn()
  }
}));

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}));

const mockSnippets: Snippet[] = [
  {
    id: 'snippet-1',
    tenantId: 'tenant-1',
    name: 'header',
    description: 'Newsletter header',
    type: 'snippet',
    parameters: [
      { name: 'title', type: 'string', required: true, description: 'Header title' }
    ],
    s3Key: 'snippets/tenant-1/snippet-1.hbs',
    s3VersionId: 'v1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true
  }
];

const mockTemplate: Template = {
  id: 'template-1',
  tenantId: 'tenant-1',
  name: 'Test Template',
  description: 'A test template',
  type: 'template',
  category: 'Newsletter',
  tags: ['test', 'newsletter'],
  content: '<h1>{{title}}</h1>',
  s3Key: 'templates/tenant-1/template-1.hbs',
  s3VersionId: 'v1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  version: 1,
  isActive: true
};

describe('TemplateBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock responses
    (templateService.getSnippets as any).mockResolvedValue({
      success: true,
      data: { snippets: mockSnippets, total: 1 }
    });

    (templateService.getTemplateCategories as any).mockResolvedValue(['Newsletter', 'Marketing']);
    (templateService.getTemplateTags as any).mockResolvedValue(['test', 'newsletter', 'marketing']);
  });

  it('renders create template form', async () => {
    render(<TemplateBuilder />);

    await waitFor(() => {
      expect(screen.getByText('Create Template')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Template Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Category/)).toBeInTheDocument();
    expect(screen.getByText('Template Content')).toBeInTheDocument();
  });

  it('renders edit template form with existing data', async () => {
    render(<TemplateBuilder template={mockTemplate} />);

    await waitFor(() => {
      expect(screen.getByText('Edit Template')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('Test Template')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A test template')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toHaveValue('<h1>{{title}}</h1>');
  });

  it('toggles between code and visual modes', async () => {
    render(<TemplateBuilder />);

    await waitFor(() => {
      expect(screen.getByText('Code Editor')).toBeInTheDocument();
    });

    // Should start in code mode
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();

    // Switch to visual mode
    fireEvent.click(screen.getByText('Visual Builder'));
    expect(screen.getByText('Visual Builder Coming Soon')).toBeInTheDocument();

    // Switch back to code mode
    fireEvent.click(screen.getByText('Switch to Code Editor'));
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('handles form field changes', async () => {
    render(<TemplateBuilder />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Template Name/)).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/Template Name/);
    fireEvent.change(nameInput, { target: { value: 'New Template' } });
    expect(nameInput).toHaveValue('New Template');

    const descriptionInput = screen.getByLabelText(/Description/);
    fireEvent.change(descriptionInput, { target: { value: 'New description' } });
    expect(descriptionInput).toHaveValue('New description');
  });

  it('handles tag management', async () => {
    render(<TemplateBuilder />);

    await waitFor(() => {
      expect(screen.getByText('Add Tag')).toBeInTheDocument();
    });

    // Add a tag
    fireEvent.click(screen.getByText('Add Tag'));

    const tagInput = screen.getByPlaceholderText('Enter tag name...');
    fireEvent.change(tagInput, { target: { value: 'new-tag' } });
    fireEvent.click(screen.getByText('Add'));

    expect(screen.getByText('new-tag')).toBeInTheDocument();
  });

  it('calls onSave when creating a new template', async () => {
    const mockOnSave = vi.fn();
    const mockResponse = { success: true, data: mockTemplate };
    (templateService.createTemplateWithRetry as any).mockResolvedValue(mockResponse);

    render(<TemplateBuilder onSave={mockOnSave} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Template Name/)).toBeInTheDocument();
    });

    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/Template Name/), {
      target: { value: 'Test Template' }
    });

    const editor = screen.getByTestId('monaco-editor');
    fireEvent.change(editor, { target: { value: '<h1>Test</h1>' } });

    // Save template
    const saveButton = screen.getByText('Create Template');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(templateService.createTemplateWithRetry).toHaveBeenCalledWith({
        name: 'Test Template',
        description: '',
        content: '<h1>Test</h1>',
        category: '',
        tags: [],
        isVisualMode: false,
        visualConfig: undefined
      });
    });

    expect(mockOnSave).toHaveBeenCalledWith(mockTemplate);
  });

  it('calls onSave when updating an existing template', async () => {
    const mockOnSave = vi.fn();
    const mockResponse = { success: true, data: mockTemplate };
    (templateService.updateTemplateWithRetry as any).mockResolvedValue(mockResponse);

    render(<TemplateBuilder template={mockTemplate} onSave={mockOnSave} />);

    await waitFor(() => {
      expect(screen.getByText('Edit Template')).toBeInTheDocument();
    });

    // Modify the template name
    const nameInput = screen.getByDisplayValue('Test Template');
    fireEvent.change(nameInput, { target: { value: 'Updated Template' } });

    // Save template
    const saveButton = screen.getByText('Update Template');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(templateService.updateTemplateWithRetry).toHaveBeenCalledWith(
        'template-1',
        expect.objectContaining({
          name: 'Updated Template'
        })
      );
    });

    expect(mockOnSave).toHaveBeenCalledWith(mockTemplate);
  });

  it('calls onCancel when cancel button is clicked', () => {
    const mockOnCancel = vi.fn();
    render(<TemplateBuilder onCancel={mockOnCancel} />);

    fireEvent.click(screen.getByText('Back'));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('calls onPreview when preview button is clicked', async () => {
    const mockOnPreview = vi.fn();
    render(<TemplateBuilder onPreview={mockOnPreview} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Template Name/)).toBeInTheDocument();
    });

    // Fill in some data
    fireEvent.change(screen.getByLabelText(/Template Name/), {
      target: { value: 'Preview Template' }
    });

    fireEvent.click(screen.getByText('Preview'));

    expect(mockOnPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Preview Template'
      })
    );
  });

  it('disables save button when validation errors exist', async () => {
    render(<TemplateBuilder />);

    await waitFor(() => {
      expect(screen.getByText('Create Template')).toBeInTheDocument();
    });

    const saveButton = screen.getByText('Create Template');
    expect(saveButton).toBeDisabled();
  });

  it('shows loading state while saving', async () => {
    const mockResponse = { success: true, data: mockTemplate };
    (templateService.createTemplateWithRetry as any).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(mockResponse), 100))
    );

    render(<TemplateBuilder />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Template Name/)).toBeInTheDocument();
    });

    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/Template Name/), {
      target: { value: 'Test Template' }
    });

    const editor = screen.getByTestId('monaco-editor');
    fireEvent.change(editor, { target: { value: '<h1>Test</h1>' } });

    // Click save
    fireEvent.click(screen.getByText('Create Template'));

    // Should show loading state
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });
});
