import { apiClient } from './api';
import type { ApiResponse } from '@/types';

// --- Types ---

export interface Segment {
  segmentId: string;
  name: string;
  description?: string;
  memberCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface SegmentMember {
  email: string;
  lastEngagedIssue: number | null;
  engagementCount: number | null;
  addedAt: string;
}

export interface CreateSegmentRequest {
  name: string;
  description?: string;
}

export interface UpdateSegmentRequest {
  name?: string;
  description?: string;
}

export interface AddMembersResponse {
  added: number;
  skipped: number;
  skippedEmails: string[];
}

export interface RemoveMembersResponse {
  removed: number;
}

export interface ListMembersResponse {
  members: SegmentMember[];
  nextToken?: string;
  totalCount: number;
}

export interface ExportResponse {
  s3Key?: string;
  jobId?: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'pending' | 'completed' | 'failed';
  s3Key?: string;
  error?: string;
}

// --- Service ---

class SegmentService {
  async listSegments(): Promise<ApiResponse<{ segments: Segment[] }>> {
    return apiClient.get('/segments');
  }

  async createSegment(data: CreateSegmentRequest): Promise<ApiResponse<Segment>> {
    return apiClient.post('/segments', data);
  }

  async getSegment(segmentId: string): Promise<ApiResponse<Segment>> {
    return apiClient.get(`/segments/${segmentId}`);
  }

  async updateSegment(segmentId: string, data: UpdateSegmentRequest): Promise<ApiResponse<Segment>> {
    return apiClient.put(`/segments/${segmentId}`, data);
  }

  async deleteSegment(segmentId: string): Promise<ApiResponse<void>> {
    return apiClient.delete(`/segments/${segmentId}`);
  }

  async addMembers(segmentId: string, emails: string[]): Promise<ApiResponse<AddMembersResponse>> {
    return apiClient.post(`/segments/${segmentId}/members`, { emails });
  }

  async removeMembers(segmentId: string, emails: string[]): Promise<ApiResponse<RemoveMembersResponse>> {
    return apiClient.delete(`/segments/${segmentId}/members`, { body: { emails } });
  }

  async listMembers(
    segmentId: string,
    params?: { pageSize?: number; nextToken?: string }
  ): Promise<ApiResponse<ListMembersResponse>> {
    const query = new URLSearchParams();
    if (params?.pageSize) query.append('pageSize', params.pageSize.toString());
    if (params?.nextToken) query.append('nextToken', params.nextToken);
    const qs = query.toString();
    return apiClient.get(`/segments/${segmentId}/members${qs ? `?${qs}` : ''}`);
  }

  async exportSegment(segmentId: string): Promise<ApiResponse<ExportResponse>> {
    return apiClient.post(`/segments/${segmentId}/export`);
  }

  async getJobStatus(jobId: string): Promise<ApiResponse<JobStatusResponse>> {
    return apiClient.get(`/segments/jobs/${jobId}`);
  }
}

export const segmentService = new SegmentService();
