import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SnippetBuilder } from '../SnippetBuilder';

// Mock the templateService
vi.mock('@/services/templateService', () => ({
  templateService: {
    getSnippetUsage: vi.fn().mockResolvedValue([]),
    createSnippetWithRetry: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateSnippetWithRetry: vi.fn().mockResolvedValue({ success: true, data: {} }),
    previewSnippet: vi.fn().mockResolvedValue({ success: true, data: { html: '<p>Test</p>' } })
  }
}));

// Mock the useDebounce hook
vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: (value: any) => value
}));

describe('SnippetBuilder', () => {
  it('renders create snippet form', () => {
    render(<SnippetBuilder />);

    expect(screen.getByRole('heading', { name: 'Create Snippet' })).toBeInTheDocument();
    expect(screen.getByText('Snippet Settings')).toBeInTheDocument();
    expect(screen.getByText('Parameters')).toBeInTheDocument();
    expect(screen.getByText('Snippet Content')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter snippet name...')).toBeInTheDocument();
  });

  it('renders edit snippet form when snippet is provided', () => {
    const mockSnippet = {
      id: 'test-snippet',
      tenantId: 'test-tenant',
      name: 'Test Snippet',
      description: 'A test snippet',
      type: 'snippet' as const,
      content: '{{> test}}',
      parameters: [
        {
          name: 'title',
          type: 'string' as const,
          required: true,
          defaultValue: 'Default Title',
          description: 'The title parameter'
        }
      ],
      s3Key: 'test-key',
      s3VersionId: 'test-version',
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-01T00:00:00Z',
      version: 1,
      isActive: true
    };

    render(<SnippetBuilder snippet={mockSnippet} />);

    expect(screen.getByRole('heading', { name: 'Edit Snippet' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Snippet')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A test snippet')).toBeInTheDocument();
  });

  it('shows parameter form when parameters exist', () => {
    const mockSnippet = {
      id: 'test-snippet',
      tenantId: 'test-tenant',
      name: 'Test Snippet',
      type: 'snippet' as const,
      content: '{{> test title=title}}',
      parameters: [
        {
          name: 'title',
          type: 'string' as const,
          required: true,
          defaultValue: 'Default Title',
          description: 'The title parameter'
        }
      ],
      s3Key: 'test-key',
      s3VersionId: 'test-version',
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-01T00:00:00Z',
      version: 1,
      isActive: true
    };

    render(<SnippetBuilder snippet={mockSnippet} />);

    expect(screen.getByDisplayValue('title')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Default Title')).toHaveLength(2); // One in parameter definition, one in test parameters
    expect(screen.getByDisplayValue('The title parameter')).toBeInTheDocument();
  });
});
