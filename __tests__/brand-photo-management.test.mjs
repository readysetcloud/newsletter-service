import { jest } from '@jest/globals';

// Mock AWS SDK
const mockS3Send = jest.fn();
const mockGetUserContext = jest.fn();
const mockFormatResponse = jest.fn((statusCode, data) => ({ statusCode, body: JSON.stringify(data) }));
const mockFormatAuthError = jest.fn((message) => ({ statusCode: 401, body: JSON.stringify({ error: message }) }));
const mockGetSignedUrl = jest.fn();

// Set up mocks before importing modules
jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: mockS3Send
  })),
  ListObjectsV2Command: jest.fn((params) => params),
  DeleteObjectCommand: jest.fn((params) => params),
  HeadObjectCommand: jest.fn((params) => params),
  PutObjectCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: jest.fn()
  })),
  UpdateItemCommand: jest.fn((params) => params),
  GetItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj)
}));

jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  formatResponse: mockFormatResponse,
  formatAuthError: mockFormatAuthError
}));

jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
  getUserContext: mockGetUserContext
}));

// Import handlers after mocks are set up
const { handler: listBrandPhotosHandler } = await import('../functions/admin/list-brand-photos.mjs');
const { handler: deleteBrandPhotoHandler } = await import('../functions/admin/delete-brand-photo.mjs');
const { handler: uploadBrandPhotoHandler } = await import('../functions/admin/upload-brand-photo.mjs');

describe('Brand Photo Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HOSTING_BUCKET_NAME = 'test-bucket';

    // Reset mock implementations
    mockFormatResponse.mockImplementation((statusCode, data) => ({
      statusCode,
      body: JSON.stringify(data)
    }));
    mockFormatAuthError.mockImplementation((message) => ({
      statusCode: 401,
      body: JSON.stringify({ error: message })
    }));
  });

  describe('List Brand Photos', () => {
    it('should list brand photos for a tenant', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant' });
      mockS3Send.mockResolvedValue({
        Contents: [
          {
            Key: 'brand-photos/test-tenant/123-image1.jpg',
            Size: 1024,
            LastModified: new Date('2023-01-01')
          },
          {
            Key: 'brand-photos/test-tenant/456-image2.png',
            Size: 2048,
            LastModified: new Date('2023-01-02')
          }
        ],
        IsTruncated: false
      });

      const event = {
        queryStringParameters: { limit: '10' }
      };

      const result = await listBrandPhotosHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.photos).toHaveLength(2);
      expect(body.photos[0].originalName).toBe('image2.png'); // Sorted by date, newest first
      expect(body.photos[1].originalName).toBe('image1.jpg');
    });

    it('should filter photos by search term', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant' });
      mockS3Send.mockResolvedValue({
        Contents: [
          {
            Key: 'brand-photos/test-tenant/123-logo.jpg',
            Size: 1024,
            LastModified: new Date('2023-01-01')
          },
          {
            Key: 'brand-photos/test-tenant/456-banner.png',
            Size: 2048,
            LastModified: new Date('2023-01-02')
          }
        ],
        IsTruncated: false
      });

      const event = {
        queryStringParameters: { search: 'logo', limit: '10' }
      };

      const result = await listBrandPhotosHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.photos).toHaveLength(1);
      expect(body.photos[0].originalName).toBe('logo.jpg');
    });

    it('should require tenant ID', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: null });
      mockFormatResponse.mockReturnValue({ statusCode: 400, body: JSON.stringify('Tenant ID is required. Please complete brand setup first.') });

      const event = {};

      const result = await listBrandPhotosHandler(event);

      expect(result.statusCode).toBe(400);
      expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Tenant ID is required. Please complete brand setup first.');
    });
  });

  describe('Delete Brand Photo', () => {
    it('should delete a brand photo', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant' });
      mockS3Send.mockResolvedValue({}); // HeadObject and DeleteObject success

      const event = {
        pathParameters: { key: 'brand-photos/test-tenant/123-image.jpg' }
      };

      const result = await deleteBrandPhotoHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Brand photo deleted successfully');
    });

    it('should reject deletion of photos from other tenants', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant' });
      mockFormatResponse.mockReturnValue({ statusCode: 403, body: JSON.stringify('Invalid photo key for this tenant') });

      const event = {
        pathParameters: { key: 'brand-photos/other-tenant/123-image.jpg' }
      };

      const result = await deleteBrandPhotoHandler(event);

      expect(result.statusCode).toBe(403);
      expect(mockFormatResponse).toHaveBeenCalledWith(403, 'Invalid photo key for this tenant');
    });

    it('should handle non-existent photos', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant' });
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      mockS3Send.mockRejectedValue(notFoundError);
      mockFormatResponse.mockReturnValue({ statusCode: 404, body: JSON.stringify('Photo not found') });

      const event = {
        pathParameters: { key: 'brand-photos/test-tenant/nonexistent.jpg' }
      };

      const result = await deleteBrandPhotoHandler(event);

      expect(result.statusCode).toBe(404);
      expect(mockFormatResponse).toHaveBeenCalledWith(404, 'Photo not found');
    });
  });

  describe('Upload Brand Photo', () => {
    it('should generate presigned URL for photo upload', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant' });
      mockGetSignedUrl.mockResolvedValue('https://presigned-url.com');

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          fileName: 'test-image.jpg',
          contentType: 'image/jpeg',
          isLogo: false
        })
      };

      const result = await uploadBrandPhotoHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.uploadUrl).toBe('https://presigned-url.com');
      expect(body.key).toContain('brand-photos/test-tenant/');
      expect(body.maxSize).toBe(5242880);
    });

    it('should reject invalid file types', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant' });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          fileName: 'test-document.pdf',
          contentType: 'application/pdf',
          isLogo: false
        })
      };

      const result = await uploadBrandPhotoHandler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body).toBe('Only image files are allowed (JPEG, PNG, GIF, WebP)');
    });

    it('should require tenant ID for upload', async () => {
      mockGetUserContext.mockReturnValue({ tenantId: null });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          fileName: 'test-image.jpg',
          contentType: 'image/jpeg'
        })
      };

      const result = await uploadBrandPhotoHandler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body).toBe('Tenant ID is required. Please complete brand setup first.');
    });
  });
});
