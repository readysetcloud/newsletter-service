import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiKeyCard } from '../ApiKeyCard';
import type { ApiKey } from '@/types';

// Mock the apiKeyService
vi.mock('@/services/apiKeyService', () => ({
  apiKeyService: {
    isApiKeyExpired: vi.fn(),
    isApiKeyActive: vi.fn(),
  },
}));

import { apiKeyService } from '@/services/apiKeyService';

const mockApiKey: Omit<ApiKey, 'keyValue'> = {
  keyId: 'test-key-id',
  name: 'Test API Key',
  description: 'A test API key for testing purposes',
  createdAt: '2024-01-01T00:00:00Z',
  lastUsed: '2024-01-15T12:00:00Z',
  usageCount: 42,
  expiresAt: '2024-12-31T23:59:59Z',
  status: 'active',
};

describe('ApiKeyCard', () => {
  const mockOnRevoke = vi.fn();
  const mockOnDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiKeyService.isApiKeyExpired).mockReturnValue(false);
    vi.mocked(apiKeyService.isApiKeyActive).mockReturnValue(true);
  });

  it('renders API key information correctly', () => {
    render(
      <ApiKeyCard
        apiKey={mockApiKey}
        onRevoke={mockOnRevoke}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('Test API Key')).toBeInTheDocument();
    expect(screen.getByText('A test API key for testing purposes')).toBeInTheDocument();
    expect(screen.getByText('***hidden***')).toBeInTheDocument();
    expect(screen.getByText('42 requests')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows revoke and delete buttons for active keys', () => {
    render(
      <ApiKeyCard
        apiKey={mockApiKey}
        onRevoke={mockOnRevoke}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('Revoke')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('calls onRevoke when revoke button is clicked', () => {
    render(
      <ApiKeyCard
        apiKey={mockApiKey}
        onRevoke={mockOnRevoke}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.click(screen.getByText('Revoke'));
    expect(mockOnRevoke).toHaveBeenCalledWith(mockApiKey);
  });

  it('calls onDelete when delete button is clicked', () => {
    render(
      <ApiKeyCard
        apiKey={mockApiKey}
        onRevoke={mockOnRevoke}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.click(screen.getByText('Delete'));
    expect(mockOnDelete).toHaveBeenCalledWith(mockApiKey);
  });

  it('shows revoked status for revoked keys', () => {
    const revokedKey = {
      ...mockApiKey,
      status: 'revoked' as const,
      revokedAt: '2024-01-20T10:00:00Z',
    };

    // Mock the service to return false for isActive for revoked keys
    vi.mocked(apiKeyService.isApiKeyActive).mockReturnValue(false);

    render(
      <ApiKeyCard
        apiKey={revokedKey}
        onRevoke={mockOnRevoke}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText(/This API key was revoked on/)).toBeInTheDocument();
    expect(screen.queryByText('Revoke')).not.toBeInTheDocument();
  });

  it('handles keys without expiration date', () => {
    const keyWithoutExpiration = {
      ...mockApiKey,
      expiresAt: undefined,
    };

    render(
      <ApiKeyCard
        apiKey={keyWithoutExpiration}
        onRevoke={mockOnRevoke}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('handles keys without description', () => {
    const keyWithoutDescription = {
      ...mockApiKey,
      description: undefined,
    };

    render(
      <ApiKeyCard
        apiKey={keyWithoutDescription}
        onRevoke={mockOnRevoke}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.queryByText('A test API key for testing purposes')).not.toBeInTheDocument();
  });

  it('handles keys that have never been used', () => {
    const unusedKey = {
      ...mockApiKey,
      lastUsed: undefined,
      usageCount: 0,
    };

    render(
      <ApiKeyCard
        apiKey={unusedKey}
        onRevoke={mockOnRevoke}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('0 requests')).toBeInTheDocument();
    expect(screen.queryByText(/Last used:/)).not.toBeInTheDocument();
  });
});
