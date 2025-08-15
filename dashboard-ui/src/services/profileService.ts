import { apiClient } from './api';
import type {
  ApiResponse,
  UserProfile,
  BrandUpdateRequest,
  BrandPhotoUploadRequest,
  BrandPhotoUploadResponse,
} from '@/types';

export interface ProfileUpdateRequest {
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  phoneNumber?: string;
  timezone?: string;
  locale?: string;
  links?: Array<{
    name: string;
    url: string;
  }>;
}

/**
 * Profile Service - Handles all profile-related API operations
 */
export class ProfileService {
  /**
   * Get the current user's complete profile
   */
  async getProfile(): Promise<ApiResponse<UserProfile>> {
    return apiClient.get<UserProfile>('/me');
  }

  /**
   * Update the user's personal profile information
   */
  async updateProfile(data: ProfileUpdateRequest): Promise<ApiResponse<{ message: string; profile: any }>> {
    return apiClient.put<{ message: string; profile: any }>('/me/profile', data);
  }

  /**
   * Update the user's brand information
   */
  async updateBrand(data: BrandUpdateRequest): Promise<ApiResponse<{ message: string; brand: any }>> {
    return apiClient.put<{ message: string; brand: any }>('/me/brand', data);
  }

  /**
   * Generate a presigned URL for brand photo upload
   */
  async generateBrandPhotoUploadUrl(
    request: BrandPhotoUploadRequest
  ): Promise<ApiResponse<BrandPhotoUploadResponse>> {
    return apiClient.post<BrandPhotoUploadResponse>('/brand/logo', request);
  }

  /**
   * Confirm brand photo upload after successful S3 upload
   */
  async confirmBrandPhotoUpload(key: string): Promise<ApiResponse<{ message: string }>> {
    return apiClient.put<{ message: string }>('/brand/logo', { key });
  }

  /**
   * Upload brand photo directly to S3 using presigned URL
   */
  async uploadBrandPhoto(file: File): Promise<ApiResponse<string>> {
    try {
      // Step 1: Generate presigned URL
      const uploadUrlResponse = await this.generateBrandPhotoUploadUrl({
        fileName: file.name,
        contentType: file.type,
      });

      if (!uploadUrlResponse.success || !uploadUrlResponse.data) {
        return {
          success: false,
          error: uploadUrlResponse.error || 'Failed to generate upload URL',
        };
      }

      const { uploadUrl, publicUrl, key } = uploadUrlResponse.data;

      // Step 2: Upload file to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        return {
          success: false,
          error: `Upload failed: ${uploadResponse.statusText}`,
        };
      }

      // Step 3: Confirm upload with the S3 key
      const confirmResponse = await this.confirmBrandPhotoUpload(key);

      if (!confirmResponse.success) {
        return {
          success: false,
          error: confirmResponse.error || 'Failed to confirm upload',
        };
      }

      return {
        success: true,
        data: publicUrl,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }
}

// Export singleton instance
export const profileService = new ProfileService();
