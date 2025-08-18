import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandForm } from '../BrandForm';
import { BrandInfo } from '../../../types';

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
      <BrandForm
        onSubmit={mockOnSubmit}
        onPreviewChange={mockOnPreviewChange}
      />
    );

    expect(screen.getByPlaceholderText(/enter your brand name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/https:\/\/example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/select your industry/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/describe your brand/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/newsletter, marketing, tech/i)).toBeInTheDocument();
  });

  it('populates form with initial data', () => {
    render(
      <BrandForm
        initialData={mockInitialData}
        onSubmit={mockOnSubmit}
        onPreviewChange={mockOnPreviewChange}
      />
    );

    expect(screen.getByDisplayValue('Test Brand')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A test brand description')).toBeInTheDocument();
    expect(screen.getByDisplayValue('newsletter, tech')).toBeInTheDocument();
  });

  it('displays brand ID when provided', () => {
    render(
      <BrandForm
        initialData={mockInitialData}
        onSubmit={mockOnSubmit}
        onPreviewChange={mockOnPreviewChange}
      />
    );

    expect(screen.getByText('Brand ID (Immutable)')).toBeInTheDocument();
    expect(screen.getByText('test-brand-123')).toBeInTheDocument();
    expect(screen.getByText(/this id cannot be changed/i)).toBeInTheDocument();
  });

  it('shows correct button text based on initial data', () => {
    // Test create mode
    const { rerender } = render(
      <BrandForm
        onSubmit={mockOnSubmit}
        onPreviewChange={mockOnPreviewChange}
      />
    );

    expect(screen.getByRole('button', { name: /create brand/i })).toBeInTheDocument();

    // Test update mode
    rerender(
      <BrandForm
        initialData={mockInitialData}
        onSubmit={mockOnSubmit}
        onPreviewChange={mockOnPreviewChange}
      />
    );

    expect(screen.getByRole('button', { name: /update brand/i })).toBeInTheDocument();
  });

  it('disables submit button when not dirty and no logo file', () => {
    render(
      <BrandForm
        initialData={mockInitialData}
        onSubmit={mockOnSubmit}
        onPreviewChange={mockOnPreviewChange}
      />
    );

    const submitButton = screen.getByRole('button', { name: /update brand/i });
    expect(submitButton).toBeDisabled();
  });

  it('shows loading state when submitting', () => {
    render(
      <BrandForm
        onSubmit={mockOnSubmit}
        onPreviewChange={mockOnPreviewChange}
        isSubmitting={true}
      />
    );

    const submitButton = screen.getByRole('button', { name: /create brand/i });
    expect(submitButton).toBeDisabled();
  });
});
