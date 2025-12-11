import { apiClient } from './api';

export interface BrandIdAvailabilityResponse {
  available: boolean;
  brandId: string;
  suggestions?: string[];
}

export interface BrandPhoto {
  key: string;
  fileName: string;
  originalName: string;
  publicUrl: string;
  size: number;
  lastModified: string;
}

export interface BrandPhotosResponse {
  photos: BrandPhoto[];
  hasMore: boolean;
  nextContinuationToken?: string;
  totalCount: number;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  expiresIn: number;
  maxSize: number;
  publicUrl: string;
  isLogo?: boolean;
}

export interface UploadConfirmResponse {
  message: string;
  photoUrl: string;
  key: string;
  isLogo?: boolean;
}

/**
 * Check if a brand ID is available
 */
export async function checkBrandIdAvailability(brandId: string): Promise<BrandIdAvailabilityResponse> {
  const response = await apiClient.get<BrandIdAvailabilityResponse>(`/brand/validate?brandId=${encodeURIComponent(brandId)}`);

  if (!response.success) {
    throw new Error(response.error || 'Failed to check brand ID availability');
  }

  if (!response.data) {
    throw new Error('No data received from brand ID availability check');
  }

  return response.data;
}

/**
 * Update brand information including brand ID
 */
export async function updateBrand(brandData: {
  brandId?: string;
  brandName: string;
  website?: string;
  industry: string;
  brandDescription?: string;
  brandLogo?: string;
  tags?: string[];
}): Promise<any> {
  const response = await apiClient.put('/me/brand', brandData);

  if (!response.success) {
    throw new Error(response.error || 'Failed to update brand');
  }

  return response.data;
}

/**
 * List brand photos with optional search and pagination
 */
export async function listBrandPhotos(options: {
  search?: string;
  limit?: number;
  continuationToken?: string;
} = {}): Promise<BrandPhotosResponse> {
  const params = new URLSearchParams();

  if (options.search?.trim()) {
    params.append('search', options.search.trim());
  }

  if (options.limit) {
    params.append('limit', options.limit.toString());
  }

  if (options.continuationToken) {
    params.append('continuationToken', options.continuationToken);
  }

  const response = await apiClient.get<BrandPhotosResponse>(`/brand/photos?${params}`);

  if (!response.success) {
    throw new Error(response.error || 'Failed to list brand photos');
  }

  if (!response.data) {
    throw new Error('No data received from brand photos list');
  }

  return response.data;
}

/**
 * Generate presigned URL for uploading a brand photo
 */
export async function generateBrandPhotoUploadUrl(
  fileName: string,
  contentType: string,
  isLogo: boolean = false
): Promise<UploadUrlResponse> {
  const response = await apiClient.post<UploadUrlResponse>('/brand/photos', {
    fileName,
    contentType,
    isLogo
  });

  if (!response.success) {
    throw new Error(response.error || 'Failed to generate upload URL');
  }

  if (!response.data) {
    throw new Error('No data received from upload URL generation');
  }

  return response.data;
}

/**
 * Upload file to S3 using presigned URL
 */
export async function uploadFileToS3(uploadUrl: string, file: File, contentType: string): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': contentType,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to upload file: ${response.statusText}`);
  }
}

/**
 * Confirm brand photo upload
 */
export async function confirmBrandPhotoUpload(
  key: string,
  fileName: string,
  isLogo: boolean = false
): Promise<UploadConfirmResponse> {
  const response = await apiClient.put<UploadConfirmResponse>('/brand/photos', {
    key,
    fileName,
    isLogo
  });

  if (!response.success) {
    throw new Error(response.error || 'Failed to confirm upload');
  }

  if (!response.data) {
    throw new Error('No data received from upload confirmation');
  }

  return response.data;
}

/**
 * Delete a brand photo
 */
export async function deleteBrandPhoto(key: string): Promise<{ message: string; key: string }> {
  const response = await apiClient.delete<{ message: string; key: string }>(`/brand/photos/${encodeURIComponent(key)}`);

  if (!response.success) {
    throw new Error(response.error || 'Failed to delete brand photo');
  }

  if (!response.data) {
    throw new Error('No data received from photo deletion');
  }

  return response.data;
}

/**
 * Upload brand photo (complete flow)
 */
export async function uploadBrandPhoto(
  file: File,
  isLogo: boolean = false
): Promise<UploadConfirmResponse> {
  // Step 1: Generate presigned URL
  const uploadData = await generateBrandPhotoUploadUrl(file.name, file.type, isLogo);

  // Step 2: Upload to S3
  await uploadFileToS3(uploadData.uploadUrl, file, file.type);

  // Step 3: Confirm upload
  return await confirmBrandPhotoUpload(uploadData.key, file.name, isLogo);
}
