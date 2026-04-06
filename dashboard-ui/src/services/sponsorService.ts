import { apiClient } from './api';

// --- Interfaces ---

export interface PricingSnapshot {
  subscriberCount: number;
  recommendedRate: number;
  openRate: number;
  clickThroughRate: number;
}

export interface ClickCache {
  totalClicks: number;
  uniqueClicks: number;
  computedAt: string;
}

export interface SponsorRecord {
  sponsorId: string;
  sponsorName: string;
  shortDescription?: string;
  longDescription?: string;
  logoUrl?: string;
  contactName?: string;
  contactEmail: string;
  notes?: string;
  status: string;
  version: number;
  totalFulfilledSponsorships: number;
  totalRevenue: number;
  lastSponsoredDate?: string;
  lastOutreachAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface SponsorshipEntry {
  sponsorshipId: string;
  sponsorId: string;
  issueId: string;
  issueTitle: string;
  sponsorshipDate: string;
  amountCharged: number;
  status: string;
  placementType: string;
  sponsorLinkIds: string[];
  pricingSnapshot?: PricingSnapshot;
  clickCache?: ClickCache;
  createdAt: string;
  updatedAt: string;
  fulfilledAt?: string;
}

export interface OutreachEmail {
  generatedAt: string;
  sponsorId: string;
  subject: string;
  body: string;
  metricsSource: string;
  isFallback: boolean;
  sourcePricingRecordId?: string;
  metricsSnapshot: Record<string, unknown>;
}

export interface OutreachJobStatus {
  jobId: string;
  status: string;
  outreachRecordSk?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSponsorRequest {
  sponsorName: string;
  shortDescription?: string;
  longDescription?: string;
  logoUrl?: string;
  contactName?: string;
  contactEmail: string;
  notes?: string;
  allowDuplicateName?: boolean;
}

export interface UpdateSponsorRequest {
  sponsorName?: string;
  shortDescription?: string;
  longDescription?: string;
  logoUrl?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  version: number;
}

export interface CreateSponsorshipRequest {
  issueId: string;
  issueTitle: string;
  sponsorshipDate: string;
  amountCharged: number;
  placementType?: string;
}

export interface UpdateSponsorshipRequest {
  status: string;
  amountCharged?: number;
  confirmNoLinks?: boolean;
}

// --- Sponsor CRUD ---

/**
 * List all sponsors for the authenticated tenant.
 * By default returns only active sponsors; pass true to include archived.
 */
export async function listSponsors(includeArchived?: boolean): Promise<SponsorRecord[]> {
  const query = includeArchived ? '?includeArchived=true' : '';
  const response = await apiClient.get<{ sponsors: SponsorRecord[] }>(`/sponsors${query}`);

  if (!response.success) {
    throw new Error(response.error || 'Failed to list sponsors');
  }

  return response.data?.sponsors ?? [];
}

/**
 * Get a single sponsor by ID.
 */
export async function getSponsor(sponsorId: string): Promise<SponsorRecord> {
  const response = await apiClient.get<SponsorRecord>(`/sponsors/${sponsorId}`);

  if (!response.success) {
    throw new Error(response.error || 'Failed to get sponsor');
  }

  if (!response.data) {
    throw new Error('No data received from sponsor lookup');
  }

  return response.data;
}

/**
 * Create a new sponsor.
 */
export async function createSponsor(data: CreateSponsorRequest): Promise<SponsorRecord> {
  const response = await apiClient.post<SponsorRecord>('/sponsors', data);

  if (!response.success) {
    throw new Error(response.error || 'Failed to create sponsor');
  }

  if (!response.data) {
    throw new Error('No data received from sponsor creation');
  }

  return response.data;
}

/**
 * Update an existing sponsor (optimistic locking via version).
 */
export async function updateSponsor(sponsorId: string, data: UpdateSponsorRequest): Promise<SponsorRecord> {
  const response = await apiClient.put<SponsorRecord>(`/sponsors/${sponsorId}`, data);

  if (!response.success) {
    throw new Error(response.error || 'Failed to update sponsor');
  }

  if (!response.data) {
    throw new Error('No data received from sponsor update');
  }

  return response.data;
}

/**
 * Archive a sponsor. Pass confirmed=true to force-archive when booked sponsorships exist.
 */
export async function archiveSponsor(sponsorId: string, confirmed?: boolean): Promise<void> {
  const body = confirmed ? { confirmed: true } : undefined;
  const response = await apiClient.post<void>(`/sponsors/${sponsorId}/archive`, body);

  if (!response.success) {
    throw new Error(response.error || 'Failed to archive sponsor');
  }
}

/**
 * Restore an archived sponsor to active status.
 */
export async function restoreSponsor(sponsorId: string): Promise<void> {
  const response = await apiClient.post<void>(`/sponsors/${sponsorId}/restore`);

  if (!response.success) {
    throw new Error(response.error || 'Failed to restore sponsor');
  }
}

// --- Sponsorship Entries ---

/**
 * List all sponsorship entries for a sponsor, sorted by date descending.
 */
export async function listSponsorships(sponsorId: string): Promise<SponsorshipEntry[]> {
  const response = await apiClient.get<{ sponsorships: SponsorshipEntry[] }>(
    `/sponsors/${sponsorId}/sponsorships`
  );

  if (!response.success) {
    throw new Error(response.error || 'Failed to list sponsorships');
  }

  return response.data?.sponsorships ?? [];
}

/**
 * Create a new sponsorship entry for a sponsor.
 */
export async function createSponsorship(
  sponsorId: string,
  data: CreateSponsorshipRequest
): Promise<SponsorshipEntry> {
  const response = await apiClient.post<SponsorshipEntry>(
    `/sponsors/${sponsorId}/sponsorships`,
    data
  );

  if (!response.success) {
    throw new Error(response.error || 'Failed to create sponsorship');
  }

  if (!response.data) {
    throw new Error('No data received from sponsorship creation');
  }

  return response.data;
}

/**
 * Update a sponsorship entry (status transitions, amount changes).
 */
export async function updateSponsorship(
  sponsorId: string,
  sponsorshipId: string,
  data: UpdateSponsorshipRequest
): Promise<SponsorshipEntry> {
  const response = await apiClient.put<SponsorshipEntry>(
    `/sponsors/${sponsorId}/sponsorships/${sponsorshipId}`,
    data
  );

  if (!response.success) {
    throw new Error(response.error || 'Failed to update sponsorship');
  }

  if (!response.data) {
    throw new Error('No data received from sponsorship update');
  }

  return response.data;
}

/**
 * Associate tracked link IDs with a sponsorship entry.
 */
export async function updateSponsorshipLinks(
  sponsorId: string,
  sponsorshipId: string,
  linkIds: string[]
): Promise<void> {
  const response = await apiClient.put<void>(
    `/sponsors/${sponsorId}/sponsorships/${sponsorshipId}/links`,
    { linkIds }
  );

  if (!response.success) {
    throw new Error(response.error || 'Failed to update sponsorship links');
  }
}

// --- Outreach ---

/**
 * Trigger outreach email generation for a sponsor. Returns a job ID for polling.
 */
export async function triggerOutreach(
  sponsorId: string
): Promise<{ jobId: string; status: string }> {
  const response = await apiClient.post<{ jobId: string; status: string }>(
    `/sponsors/${sponsorId}/outreach`
  );

  if (!response.success) {
    throw new Error(response.error || 'Failed to trigger outreach');
  }

  if (!response.data) {
    throw new Error('No data received from outreach trigger');
  }

  return response.data;
}

/**
 * List all outreach emails for a sponsor, sorted by generatedAt descending.
 */
export async function listOutreachEmails(sponsorId: string): Promise<OutreachEmail[]> {
  const response = await apiClient.get<{ outreachEmails: OutreachEmail[] }>(
    `/sponsors/${sponsorId}/outreach`
  );

  if (!response.success) {
    throw new Error(response.error || 'Failed to list outreach emails');
  }

  return response.data?.outreachEmails ?? [];
}

/**
 * Poll the status of an outreach generation job.
 */
export async function pollOutreachJob(
  sponsorId: string,
  jobId: string
): Promise<OutreachJobStatus> {
  const response = await apiClient.get<OutreachJobStatus>(
    `/sponsors/${sponsorId}/outreach/jobs/${jobId}`
  );

  if (!response.success) {
    throw new Error(response.error || 'Failed to poll outreach job');
  }

  if (!response.data) {
    throw new Error('No data received from outreach job poll');
  }

  return response.data;
}

// --- Client-side utilities ---

/**
 * Filter sponsors by a search query (case-insensitive substring match
 * on sponsorName, contactName, or contactEmail).
 */
export function filterSponsors(sponsors: SponsorRecord[], query: string): SponsorRecord[] {
  const q = query.toLowerCase().trim();
  if (!q) return sponsors;

  return sponsors.filter((s) => {
    const name = s.sponsorName?.toLowerCase() ?? '';
    const contact = s.contactName?.toLowerCase() ?? '';
    const email = s.contactEmail?.toLowerCase() ?? '';
    return name.includes(q) || contact.includes(q) || email.includes(q);
  });
}
