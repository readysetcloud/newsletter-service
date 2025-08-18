import { apiClient } from './api';

export interface BrandIdAvailabilityResponse {
  available: boolean;
  brandId: string;
  suggestions?: string[];
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
