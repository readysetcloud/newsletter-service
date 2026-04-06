import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandForm } from '../BrandForm';
import { BrandInfo } from '../../../types';
import { ToastProvider } from '../../ui/Toast';

describe('BrandForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnPreviewChange = vi.fn();

  const mockInitialData: Partial<BrandInfo> = {
    brandId: 'test-brand-123',
    brandName: 'Test Brand',
    website: 'https://example.com',
    industry: 'technology',
    brandDescription: 'A test brand description',
    tags: ['newsletter', 'tech'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form fields correctly', () => {
    render(
      <ToastProvider>
        <BrandForm
          onSubmit={mockOnSubmit}
          onPreviewChange={mockOnPreviewChange}
        />
      </ToastProvider>
    );

    expect(screen.getByPlaceholderText(/enter your brand name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/https:\/\/example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/select your industry/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/describe your brand/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/newsletter, marketing, tech/i)).toBeInTheDocument();
  });

  it('populates form with initial data', () => {
    render(
      <ToastProvider>
        <BrandForm
          initialData={mockInitialData}
          onSubmit={mockOnSubmit}
          onPreviewChange={mockOnPreviewChange}
        />
      </ToastProvider>
    );

    expect(screen.getByDisplayValue('Test Brand')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A test brand description')).toBeInTheDocument();
    expect(screen.getByDisplayValue('newsletter, tech')).toBeInTheDocument();
  });

  it('displays brand ID when provided', () => {
    render(
      <ToastProvider>
        <BrandForm
          initialData={mockInitialData}
          onSubmit={mockOnSubmit}
          onPreviewChange={mockOnPreviewChange}
        />
      </ToastProvider>
    );

    expect(screen.getByText('Brand ID *')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test-brand-123')).toBeInTheDocument();
    // Brand ID input should be disabled when brand already exists
    expect(screen.getByDisplayValue('test-brand-123')).toBeDisabled();
  });

  it('shows correct button text based on initial data', () => {
    // Test create mode (default submitButtonText)
    const { rerender } = render(
      <ToastProvider>
        <BrandForm
          onSubmit={mockOnSubmit}
          onPreviewChange={mockOnPreviewChange}
          submitButtonText="Create Brand"
        />
      </ToastProvider>
    );

    expect(screen.getByRole('button', { name: /create brand/i })).toBeInTheDocument();

    // Test update mode
    rerender(
      <ToastProvider>
        <BrandForm
          initialData={mockInitialData}
          onSubmit={mockOnSubmit}
          onPreviewChange={mockOnPreviewChange}
          submitButtonText="Update Brand"
        />
      </ToastProvider>
    );

    expect(screen.getByRole('button', { name: /update brand/i })).toBeInTheDocument();
  });

  it('disables submit button when not dirty and no logo file', () => {
    render(
      <ToastProvider>
        <BrandForm
          initialData={mockInitialData}
          onSubmit={mockOnSubmit}
          onPreviewChange={mockOnPreviewChange}
          submitButtonText="Update Brand"
        />
      </ToastProvider>
    );

    const submitButton = screen.getByRole('button', { name: /update brand/i });
    expect(submitButton).toBeDisabled();
  });

  it('shows loading state when submitting', () => {
    render(
      <ToastProvider>
        <BrandForm
          onSubmit={mockOnSubmit}
          onPreviewChange={mockOnPreviewChange}
          isSubmitting={true}
          submitButtonText="Create Brand"
        />
      </ToastProvider>
    );

    const submitButton = screen.getByRole('button', { name: /saving.../i });
    expect(submitButton).toBeDisabled();
  });
});
