import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateSponsorLogoUploadUrl,
  confirmSponsorLogoUpload,
  uploadSponsorLogo,
} from '../sponsorService';

// Mock the API client
vi.mock('../api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock fetch for S3 upload
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Sponsor Logo Upload Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateSponsorLogoUploadUrl', () => {
    it('should call POST /sponsors/:sponsorId/logo with fileName and contentType', async () => {
      const { apiClient } = await import('../api');
      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: {
          uploadUrl: 'https://s3.amazonaws.com/presigned-url',
          key: 'sponsor-logos/tenant1/sponsor1/1234-logo.png',
          publicUrl: 'https://cdn.example.com/logo.png',
        },
      });

      const result = await generateSponsorLogoUploadUrl('sponsor1', 'logo.png', 'image/png');

      expect(apiClient.post).toHaveBeenCalledWith('/sponsors/sponsor1/logo', {
        fileName: 'logo.png',
        contentType: 'image/png',
      });
      expect(result.uploadUrl).toBe('https://s3.amazonaws.com/presigned-url');
      expect(result.key).toBe('sponsor-logos/tenant1/sponsor1/1234-logo.png');
      expect(result.publicUrl).toBe('https://cdn.example.com/logo.png');
    });

    it('should throw when the API returns an error', async () => {
      const { apiClient } = await import('../api');
      vi.mocked(apiClient.post).mockResolvedValue({
        success: false,
        error: 'Only image files are allowed',
      });

      await expect(
        generateSponsorLogoUploadUrl('sponsor1', 'doc.pdf', 'application/pdf')
      ).rejects.toThrow('Only image files are allowed');
    });

    it('should throw when no data is returned', async () => {
      const { apiClient } = await import('../api');
      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: undefined,
      });

      await expect(
        generateSponsorLogoUploadUrl('sponsor1', 'logo.png', 'image/png')
      ).rejects.toThrow('No data received from sponsor logo upload URL generation');
    });
  });

  describe('confirmSponsorLogoUpload', () => {
    it('should call PUT /sponsors/:sponsorId/logo with key', async () => {
      const { apiClient } = await import('../api');
      const mockKey = 'sponsor-logos/tenant1/sponsor1/1234-logo.png';
      vi.mocked(apiClient.put).mockResolvedValue({
        success: true,
        data: {
          message: 'Sponsor logo updated successfully',
          logoUrl: 'https://cdn.example.com/logo.png',
          key: mockKey,
        },
      });

      const result = await confirmSponsorLogoUpload('sponsor1', mockKey);

      expect(apiClient.put).toHaveBeenCalledWith('/sponsors/sponsor1/logo', { key: mockKey });
      expect(result.message).toBe('Sponsor logo updated successfully');
      expect(result.logoUrl).toBe('https://cdn.example.com/logo.png');
      expect(result.key).toBe(mockKey);
    });

    it('should throw when the API returns an error', async () => {
      const { apiClient } = await import('../api');
      vi.mocked(apiClient.put).mockResolvedValue({
        success: false,
        error: 'Invalid logo key for this sponsor',
      });

      await expect(
        confirmSponsorLogoUpload('sponsor1', 'wrong-prefix/key.png')
      ).rejects.toThrow('Invalid logo key for this sponsor');
    });

    it('should throw when no data is returned', async () => {
      const { apiClient } = await import('../api');
      vi.mocked(apiClient.put).mockResolvedValue({ success: true, data: undefined });

      await expect(
        confirmSponsorLogoUpload('sponsor1', 'sponsor-logos/t/s/logo.png')
      ).rejects.toThrow('No data received from sponsor logo upload confirmation');
    });
  });

  describe('uploadSponsorLogo', () => {
    const mockKey = 'sponsor-logos/tenant1/sponsor1/1234-logo.png';
    const mockPublicUrl = 'https://cdn.example.com/logo.png';

    it('should orchestrate the three-step upload flow and return publicUrl', async () => {
      const mockFile = new File(['img'], 'logo.png', { type: 'image/png' });
      const { apiClient } = await import('../api');

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: { uploadUrl: 'https://s3.example.com/put', key: mockKey, publicUrl: mockPublicUrl },
      });
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      vi.mocked(apiClient.put).mockResolvedValue({
        success: true,
        data: { message: 'ok', logoUrl: mockPublicUrl, key: mockKey },
      });

      const result = await uploadSponsorLogo('sponsor1', mockFile);

      expect(result).toBe(mockPublicUrl);
      expect(apiClient.post).toHaveBeenCalledWith('/sponsors/sponsor1/logo', {
        fileName: 'logo.png',
        contentType: 'image/png',
      });
      expect(mockFetch).toHaveBeenCalledWith('https://s3.example.com/put', {
        method: 'PUT',
        body: mockFile,
        headers: { 'Content-Type': 'image/png' },
      });
      expect(apiClient.put).toHaveBeenCalledWith('/sponsors/sponsor1/logo', { key: mockKey });
    });

    it('should throw when presigned URL generation fails', async () => {
      const mockFile = new File(['img'], 'logo.png', { type: 'image/png' });
      const { apiClient } = await import('../api');

      vi.mocked(apiClient.post).mockResolvedValue({
        success: false,
        error: 'Sponsor not found',
      });

      await expect(uploadSponsorLogo('bad-id', mockFile)).rejects.toThrow('Sponsor not found');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw when S3 upload fails', async () => {
      const mockFile = new File(['img'], 'logo.png', { type: 'image/png' });
      const { apiClient } = await import('../api');

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: { uploadUrl: 'https://s3.example.com/put', key: mockKey, publicUrl: mockPublicUrl },
      });
      mockFetch.mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }));

      await expect(uploadSponsorLogo('sponsor1', mockFile)).rejects.toThrow('Logo upload failed: Forbidden');
      expect(apiClient.put).not.toHaveBeenCalled();
    });

    it('should throw when confirm upload fails', async () => {
      const mockFile = new File(['img'], 'logo.png', { type: 'image/png' });
      const { apiClient } = await import('../api');

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: { uploadUrl: 'https://s3.example.com/put', key: mockKey, publicUrl: mockPublicUrl },
      });
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      vi.mocked(apiClient.put).mockResolvedValue({
        success: false,
        error: 'Logo not found in storage. Upload may have failed.',
      });

      await expect(uploadSponsorLogo('sponsor1', mockFile)).rejects.toThrow(
        'Logo not found in storage. Upload may have failed.'
      );
    });
  });
});
