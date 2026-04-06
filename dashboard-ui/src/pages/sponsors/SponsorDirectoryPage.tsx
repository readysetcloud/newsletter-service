import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search, Building2, X, Archive } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Card, CardContent } from '@/components/ui/Card';
import { SponsorPhotoUpload } from '../../components/forms/SponsorPhotoUpload';
import {
  listSponsors,
  createSponsor,
  uploadSponsorLogo,
  filterSponsors,
} from '../../services/sponsorService';
import type { SponsorRecord, CreateSponsorRequest } from '../../services/sponsorService';

export const SponsorDirectoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [sponsors, setSponsors] = useState<SponsorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateSponsorRequest>({
    sponsorName: '',
    shortDescription: '',
    longDescription: '',
    logoUrl: '',
    contactName: '',
    contactEmail: '',
    notes: '',
  });

  // Logo file state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | undefined>(undefined);

  // Duplicate name warning state
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);

  const loadSponsors = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listSponsors(includeArchived);
      setSponsors(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sponsors');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    loadSponsors();
  }, [loadSponsors]);

  const filteredSponsors = useMemo(
    () => filterSponsors(sponsors, searchQuery),
    [sponsors, searchQuery],
  );

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatCurrency = (amount: number) =>
    `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const resetForm = () => {
    setFormData({
      sponsorName: '',
      shortDescription: '',
      longDescription: '',
      logoUrl: '',
      contactName: '',
      contactEmail: '',
      notes: '',
    });
    setCreateError(null);
    setShowDuplicateWarning(false);
    setLogoFile(null);
    setLogoUploadError(undefined);
  };

  const handleOpenCreate = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const handleCreate = useCallback(
    async (allowDuplicate = false) => {
      setCreating(true);
      setCreateError(null);

      try {
        const request: CreateSponsorRequest = {
          ...formData,
          allowDuplicateName: allowDuplicate || undefined,
        };
        const created = await createSponsor(request);

        // If a logo file was selected, upload it after sponsor creation
        if (logoFile) {
          try {
            setLogoUploading(true);
            await uploadSponsorLogo(created.sponsorId, logoFile);
          } catch (uploadErr) {
            // Sponsor was created but logo upload failed — notify but don't block
            addToast({
              title: 'Logo Upload Failed',
              message: uploadErr instanceof Error ? uploadErr.message : 'Failed to upload logo',
              type: 'warning',
            });
          } finally {
            setLogoUploading(false);
          }
        }

        setSponsors((prev) => [created, ...prev]);
        setShowCreateModal(false);
        setShowDuplicateWarning(false);
        resetForm();
        addToast({
          title: 'Sponsor Created',
          message: `"${created.sponsorName}" has been added`,
          type: 'success',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create sponsor';
        if (msg.includes('409') || msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('duplicate')) {
          setShowDuplicateWarning(true);
        } else {
          setCreateError(msg);
        }
      } finally {
        setCreating(false);
      }
    },
    [formData, logoFile, addToast],
  );

  const updateField = (field: keyof CreateSponsorRequest, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Validation
  const nameError = (() => {
    const trimmed = formData.sponsorName.trim();
    if (formData.sponsorName.length > 0 && trimmed.length === 0) return 'Name cannot be only whitespace';
    return null;
  })();

  const emailError = (() => {
    const email = formData.contactEmail.trim();
    if (email.length > 0 && !email.includes('@')) return 'Invalid email format';
    return null;
  })();

  const shortDescError = (() => {
    if ((formData.shortDescription?.length ?? 0) > 200) return 'Short description must not exceed 200 characters';
    return null;
  })();

  const canSubmit =
    formData.sponsorName.trim().length > 0 &&
    formData.contactEmail.trim().length > 0 &&
    !nameError &&
    !emailError &&
    !shortDescError &&
    !creating;

  // --- Loading state ---
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite">
            <span className="sr-only">Loading sponsors...</span>
            <div className="mb-8 flex items-center justify-between">
              <div>
                <div className="h-8 w-48 bg-muted rounded animate-pulse mb-2" />
                <div className="h-4 w-64 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-10 w-40 bg-muted rounded animate-pulse" />
            </div>
            <div className="mb-6 flex gap-4">
              <div className="h-10 w-64 bg-muted rounded animate-pulse" />
              <div className="h-10 w-48 bg-muted rounded animate-pulse" />
            </div>
            <Card>
              <div className="divide-y divide-border">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="px-6 py-4 flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="h-4 w-40 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-64 bg-muted rounded animate-pulse" />
                    </div>
                    <div className="h-4 w-20 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  // --- Error state ---
  if (error && sponsors.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="alert" aria-live="assertive" className="text-center py-12">
            <h3 className="text-lg font-medium text-foreground mb-2">Failed to load sponsors</h3>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <Button onClick={loadSponsors} aria-label="Retry loading sponsors">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // --- Main render ---
  return (
    <div className="min-h-screen bg-background">
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Sponsors</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your sponsor relationships</p>
          </div>
          <Button onClick={handleOpenCreate} aria-label="Add new sponsor">
            <Plus className="w-4 h-4 mr-2" />
            Add Sponsor
          </Button>
        </div>

        {/* Search and filters */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, contact, or email..."
              className="w-full pl-10 pr-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Search sponsors"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded border-border text-primary-600 focus:ring-primary-500"
            />
            <Archive className="w-4 h-4" />
            Show archived
          </label>
        </div>

        {/* Sponsor list */}
        {filteredSponsors.length === 0 && sponsors.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Building2 className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No sponsors yet</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Add your first sponsor to start tracking relationships and revenue.
                </p>
                <Button onClick={handleOpenCreate}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Sponsor
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : filteredSponsors.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Search className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No matching sponsors</h3>
                <p className="text-sm text-muted-foreground">
                  Try adjusting your search or filters.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border" role="table" aria-label="Sponsors list">
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Sponsor</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Contact</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Sponsorships</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Revenue</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Last Sponsored</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Last Outreach</th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-border">
                  {filteredSponsors.map((sponsor) => (
                    <tr
                      key={sponsor.sponsorId}
                      className="hover:bg-muted/50 transition-colors cursor-pointer group"
                      onClick={() => navigate(`/sponsors/${sponsor.sponsorId}`)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/sponsors/${sponsor.sponsorId}`);
                        }
                      }}
                      aria-label={`View sponsor: ${sponsor.sponsorName}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="text-sm font-medium text-foreground group-hover:text-primary-600 transition-colors">
                              {sponsor.sponsorName}
                            </div>
                            {sponsor.shortDescription && (
                              <div className="text-xs text-muted-foreground max-w-xs truncate mt-0.5">
                                {sponsor.shortDescription}
                              </div>
                            )}
                          </div>
                          {sponsor.status === 'archived' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                              Archived
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground hidden md:table-cell">
                        {sponsor.contactName || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground hidden lg:table-cell">
                        {sponsor.totalFulfilledSponsorships}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground hidden sm:table-cell">
                        {formatCurrency(sponsor.totalRevenue)}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground hidden lg:table-cell">
                        {formatDate(sponsor.lastSponsoredDate)}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground hidden xl:table-cell">
                        {formatDate(sponsor.lastOutreachAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>

      {/* Create Sponsor Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            role="presentation"
            onClick={() => setShowCreateModal(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
          />
          <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 z-10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Add Sponsor</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Sponsor Name */}
              <div>
                <label htmlFor="sponsor-name" className="block text-sm font-medium text-foreground mb-1">
                  Sponsor Name <span className="text-error-600">*</span>
                </label>
                <input
                  id="sponsor-name"
                  type="text"
                  value={formData.sponsorName}
                  onChange={(e) => updateField('sponsorName', e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {nameError && <p className="text-xs text-error-600 mt-1">{nameError}</p>}
              </div>

              {/* Contact Email */}
              <div>
                <label htmlFor="sponsor-email" className="block text-sm font-medium text-foreground mb-1">
                  Contact Email <span className="text-error-600">*</span>
                </label>
                <input
                  id="sponsor-email"
                  type="email"
                  value={formData.contactEmail}
                  onChange={(e) => updateField('contactEmail', e.target.value)}
                  placeholder="sponsor@example.com"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {emailError && <p className="text-xs text-error-600 mt-1">{emailError}</p>}
              </div>

              {/* Contact Name */}
              <div>
                <label htmlFor="sponsor-contact" className="block text-sm font-medium text-foreground mb-1">
                  Contact Name
                </label>
                <input
                  id="sponsor-contact"
                  type="text"
                  value={formData.contactName ?? ''}
                  onChange={(e) => updateField('contactName', e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Short Description */}
              <div>
                <label htmlFor="sponsor-short-desc" className="block text-sm font-medium text-foreground mb-1">
                  Short Description
                </label>
                <input
                  id="sponsor-short-desc"
                  type="text"
                  value={formData.shortDescription ?? ''}
                  onChange={(e) => updateField('shortDescription', e.target.value)}
                  placeholder="Brief description (max 200 chars)"
                  maxLength={200}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <div className="flex justify-between mt-1">
                  {shortDescError && <p className="text-xs text-error-600">{shortDescError}</p>}
                  <p className="text-xs text-muted-foreground ml-auto">{(formData.shortDescription ?? '').length}/200</p>
                </div>
              </div>

              {/* Long Description */}
              <div>
                <label htmlFor="sponsor-long-desc" className="block text-sm font-medium text-foreground mb-1">
                  Long Description
                </label>
                <textarea
                  id="sponsor-long-desc"
                  value={formData.longDescription ?? ''}
                  onChange={(e) => updateField('longDescription', e.target.value)}
                  placeholder="Detailed description..."
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
                <p className="text-xs text-muted-foreground mt-1 text-right">{(formData.longDescription ?? '').length}/2000</p>
              </div>

              {/* Logo Upload */}
              <SponsorPhotoUpload
                onPhotoChange={(file) => {
                  setLogoFile(file);
                  setLogoUploadError(undefined);
                }}
                onPhotoRemove={() => {
                  setLogoFile(null);
                  setLogoUploadError(undefined);
                }}
                isUploading={logoUploading}
                error={logoUploadError}
              />

              {/* Notes */}
              <div>
                <label htmlFor="sponsor-notes" className="block text-sm font-medium text-foreground mb-1">
                  Notes
                </label>
                <textarea
                  id="sponsor-notes"
                  value={formData.notes ?? ''}
                  onChange={(e) => updateField('notes', e.target.value)}
                  placeholder="Internal notes about this sponsor..."
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>

              {/* Error display */}
              {createError && (
                <p className="text-sm text-error-600 bg-error-50 dark:bg-error-900/20 rounded-md px-3 py-2">
                  {createError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button onClick={() => handleCreate(false)} disabled={!canSubmit} isLoading={creating}>
                Add Sponsor
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Name Warning Dialog */}
      {showDuplicateWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            role="presentation"
            onClick={() => setShowDuplicateWarning(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') setShowDuplicateWarning(false); }}
          />
          <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 z-10">
            <h2 className="text-lg font-semibold text-foreground mb-2">Duplicate Sponsor Name</h2>
            <p className="text-sm text-muted-foreground mb-6">
              A sponsor named <span className="font-medium text-foreground">&quot;{formData.sponsorName.trim()}&quot;</span> already exists. Do you want to create another sponsor with the same name?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDuplicateWarning(false)}>
                Cancel
              </Button>
              <Button onClick={() => handleCreate(true)} isLoading={creating}>
                Create Anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
