import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Archive, ArchiveRestore, Plus, Mail, Copy, ExternalLink,
  RefreshCw, ChevronDown, ChevronUp, AlertTriangle, Check, X, Link2, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  getSponsor,
  updateSponsor,
  uploadSponsorLogo,
  archiveSponsor,
  restoreSponsor,
  listSponsorships,
  createSponsorship,
  updateSponsorship,
  updateSponsorshipLinks,
  triggerOutreach,
  listOutreachEmails,
  pollOutreachJob,
} from '../../services/sponsorService';
import { SponsorPhotoUpload } from '../../components/forms/SponsorPhotoUpload';
import type {
  SponsorRecord,
  SponsorshipEntry,
  OutreachEmail,
  UpdateSponsorRequest,
  CreateSponsorshipRequest,
  UpdateSponsorshipRequest,
} from '../../services/sponsorService';

// --- Helpers ---

const formatDate = (dateString?: string) => {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
};

const formatDateTime = (dateString?: string) => {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const formatCurrency = (amount: number) =>
  `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


// --- Sub-components ---

/** Archived status badge */
const ArchivedBadge: React.FC<{ archivedAt?: string }> = ({ archivedAt }) => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300">
    <Archive className="w-3 h-3" />
    Archived{archivedAt ? ` on ${formatDate(archivedAt)}` : ''}
  </span>
);

/** Confirmation dialog (inline, lightweight) */
const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'destructive';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, message, confirmLabel = 'Confirm', confirmVariant = 'destructive', loading, onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" role="presentation" onClick={onCancel} />
      <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 z-10">
        <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant={confirmVariant} onClick={onConfirm} isLoading={loading}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
};

/** Inline editable field */
const EditableField: React.FC<{
  label: string;
  value: string;
  editing: boolean;
  multiline?: boolean;
  maxLength?: number;
  onChange: (v: string) => void;
}> = ({ label, value, editing, multiline, maxLength, onChange }) => (
  <div>
    <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
    {editing ? (
      multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      )
    ) : (
      <p className="text-sm text-foreground">{value || '—'}</p>
    )}
    {editing && maxLength && (
      <p className="text-xs text-muted-foreground mt-1 text-right">{value.length}/{maxLength}</p>
    )}
  </div>
);


// --- Main Component ---

export const SponsorDetailPage: React.FC = () => {
  const { sponsorId } = useParams<{ sponsorId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Core data
  const [sponsor, setSponsor] = useState<SponsorRecord | null>(null);
  const [sponsorships, setSponsorships] = useState<SponsorshipEntry[]>([]);
  const [outreachEmails, setOutreachEmails] = useState<OutreachEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<SponsorRecord>>({});
  const [saving, setSaving] = useState(false);

  // Archive/restore
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Add sponsorship form
  const [showAddSponsorship, setShowAddSponsorship] = useState(false);
  const [sponsorshipForm, setSponsorshipForm] = useState<CreateSponsorshipRequest>({
    issueId: '', issueTitle: '', sponsorshipDate: '', amountCharged: 0, placementType: 'primary',
  });
  const [creatingSponsorship, setCreatingSponsorship] = useState(false);

  // Sponsorship status update
  const [updatingSponsorship, setUpdatingSponsorship] = useState<string | null>(null);

  // Link association
  const [linkEditSponsorshipId, setLinkEditSponsorshipId] = useState<string | null>(null);
  const [linkIdsInput, setLinkIdsInput] = useState('');
  const [savingLinks, setSavingLinks] = useState(false);

  // Fulfillment no-links confirmation
  const [noLinksConfirm, setNoLinksConfirm] = useState<{ sponsorshipId: string; targetStatus: string } | null>(null);

  // Outreach
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachTimeout, setOutreachTimeout] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [copied, setCopied] = useState(false);
  const outreachPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outreachTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Logo upload
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | undefined>(undefined);
  const [logoRemoved, setLogoRemoved] = useState(false);

  // --- Data loading ---

  const loadData = useCallback(async () => {
    if (!sponsorId) return;
    try {
      setLoading(true);
      setError(null);
      const [sponsorData, sponsorshipsData, outreachData] = await Promise.all([
        getSponsor(sponsorId),
        listSponsorships(sponsorId),
        listOutreachEmails(sponsorId),
      ]);
      setSponsor(sponsorData);
      setSponsorships(sponsorshipsData);
      setOutreachEmails(outreachData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sponsor data');
    } finally {
      setLoading(false);
    }
  }, [sponsorId]);

  useEffect(() => {
    loadData();
    return () => {
      if (outreachPollRef.current) clearInterval(outreachPollRef.current);
      if (outreachTimeoutRef.current) clearTimeout(outreachTimeoutRef.current);
    };
  }, [loadData]);

  // --- Computed values ---

  const totalRevenue = useMemo(
    () => sponsorships.filter((s) => s.status === 'fulfilled').reduce((sum, s) => sum + s.amountCharged, 0),
    [sponsorships],
  );

  const latestOutreach = outreachEmails.length > 0 ? outreachEmails[0] : null;

  const canReachOut = sponsor?.status === 'active' && !!sponsor?.contactEmail;


  // --- Edit handlers ---

  const startEditing = () => {
    if (!sponsor) return;
    setEditForm({
      sponsorName: sponsor.sponsorName,
      shortDescription: sponsor.shortDescription ?? '',
      longDescription: sponsor.longDescription ?? '',
      logoUrl: sponsor.logoUrl ?? '',
      contactName: sponsor.contactName ?? '',
      contactEmail: sponsor.contactEmail,
      notes: sponsor.notes ?? '',
    });
    setLogoFile(null);
    setLogoUploadError(undefined);
    setLogoRemoved(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditForm({});
    setLogoFile(null);
    setLogoUploadError(undefined);
    setLogoRemoved(false);
  };

  const saveEdits = async () => {
    if (!sponsor || !sponsorId) return;
    setSaving(true);
    try {
      // If a new logo file was selected, upload it first
      if (logoFile) {
        try {
          setLogoUploading(true);
          const publicUrl = await uploadSponsorLogo(sponsorId, logoFile);
          // The upload flow already updates logoUrl on the backend,
          // so we update the edit form to reflect the new URL
          setEditForm((prev) => ({ ...prev, logoUrl: publicUrl }));
        } catch (uploadErr) {
          setLogoUploadError(uploadErr instanceof Error ? uploadErr.message : 'Failed to upload logo');
          setSaving(false);
          setLogoUploading(false);
          return;
        } finally {
          setLogoUploading(false);
        }
      }

      const payload: UpdateSponsorRequest = {
        sponsorName: editForm.sponsorName,
        shortDescription: editForm.shortDescription,
        longDescription: editForm.longDescription,
        logoUrl: logoRemoved ? '' : (logoFile ? undefined : editForm.logoUrl),
        contactName: editForm.contactName,
        contactEmail: editForm.contactEmail,
        notes: editForm.notes,
        version: sponsor.version,
      };
      const updated = await updateSponsor(sponsorId, payload);
      setSponsor(updated);
      setEditing(false);
      setLogoFile(null);
      setLogoUploadError(undefined);
      setLogoRemoved(false);
      addToast({ title: 'Sponsor Updated', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      if (msg.includes('409') || msg.toLowerCase().includes('version') || msg.toLowerCase().includes('modified')) {
        addToast({
          title: 'Version Conflict',
          message: 'This record was modified by another session. Please reload and try again.',
          type: 'error',
          action: { label: 'Reload', onClick: loadData },
        });
      } else {
        addToast({ title: 'Update Failed', message: msg, type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const updateEditField = (field: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  // --- Archive / Restore ---

  const handleArchive = async () => {
    if (!sponsorId) return;
    setArchiving(true);
    try {
      await archiveSponsor(sponsorId);
      await loadData();
      setShowArchiveConfirm(false);
      addToast({ title: 'Sponsor Archived', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Archive failed';
      if (msg.includes('409') || msg.toLowerCase().includes('booked')) {
        addToast({
          title: 'Cannot Archive',
          message: 'This sponsor has pending booked sponsorships. Confirm to proceed.',
          type: 'warning',
          action: {
            label: 'Force Archive',
            onClick: async () => {
              try {
                await archiveSponsor(sponsorId, true);
                await loadData();
                addToast({ title: 'Sponsor Archived', type: 'success' });
              } catch (e) {
                addToast({ title: 'Archive Failed', message: e instanceof Error ? e.message : 'Unknown error', type: 'error' });
              }
            },
          },
        });
      } else {
        addToast({ title: 'Archive Failed', message: msg, type: 'error' });
      }
    } finally {
      setArchiving(false);
      setShowArchiveConfirm(false);
    }
  };

  const handleRestore = async () => {
    if (!sponsorId) return;
    try {
      await restoreSponsor(sponsorId);
      await loadData();
      addToast({ title: 'Sponsor Restored', type: 'success' });
    } catch (err) {
      addToast({ title: 'Restore Failed', message: err instanceof Error ? err.message : 'Unknown error', type: 'error' });
    }
  };


  // --- Sponsorship handlers ---

  const handleCreateSponsorship = async () => {
    if (!sponsorId) return;
    setCreatingSponsorship(true);
    try {
      const created = await createSponsorship(sponsorId, sponsorshipForm);
      setSponsorships((prev) => [created, ...prev]);
      setShowAddSponsorship(false);
      setSponsorshipForm({ issueId: '', issueTitle: '', sponsorshipDate: '', amountCharged: 0, placementType: 'primary' });
      addToast({ title: 'Sponsorship Created', type: 'success' });
    } catch (err) {
      addToast({ title: 'Creation Failed', message: err instanceof Error ? err.message : 'Unknown error', type: 'error' });
    } finally {
      setCreatingSponsorship(false);
    }
  };

  const handleUpdateSponsorshipStatus = async (sponsorshipId: string, status: string, confirmNoLinks = false) => {
    if (!sponsorId) return;
    setUpdatingSponsorship(sponsorshipId);
    try {
      const payload: UpdateSponsorshipRequest = { status, confirmNoLinks: confirmNoLinks || undefined };
      const updated = await updateSponsorship(sponsorId, sponsorshipId, payload);
      setSponsorships((prev) => prev.map((s) => (s.sponsorshipId === sponsorshipId ? updated : s)));
      // Reload sponsor to get updated materialized stats
      const refreshed = await getSponsor(sponsorId);
      setSponsor(refreshed);
      setNoLinksConfirm(null);
      addToast({ title: `Status updated to ${status}`, type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      if ((msg.includes('409') || msg.toLowerCase().includes('no sponsor links') || msg.toLowerCase().includes('confirmnolinks')) && !confirmNoLinks) {
        setNoLinksConfirm({ sponsorshipId, targetStatus: status });
      } else if (msg.includes('400') || msg.toLowerCase().includes('immutable')) {
        addToast({ title: 'Update Rejected', message: 'Fulfilled sponsorship amounts are immutable.', type: 'error' });
      } else {
        addToast({ title: 'Update Failed', message: msg, type: 'error' });
      }
    } finally {
      setUpdatingSponsorship(null);
    }
  };

  const handleSaveLinks = async (sponsorshipId: string) => {
    if (!sponsorId) return;
    setSavingLinks(true);
    try {
      const ids = linkIdsInput.split(',').map((s) => s.trim()).filter(Boolean);
      await updateSponsorshipLinks(sponsorId, sponsorshipId, ids);
      // Refresh sponsorships to get updated linkIds
      const refreshed = await listSponsorships(sponsorId);
      setSponsorships(refreshed);
      setLinkEditSponsorshipId(null);
      setLinkIdsInput('');
      addToast({ title: 'Links Updated', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update links';
      addToast({ title: 'Link Update Failed', message: msg, type: 'error' });
    } finally {
      setSavingLinks(false);
    }
  };

  // --- Outreach handlers ---

  const handleTriggerOutreach = async () => {
    if (!sponsorId) return;
    setOutreachLoading(true);
    setOutreachTimeout(false);

    try {
      const { jobId } = await triggerOutreach(sponsorId);

      // Set 15-second timeout
      outreachTimeoutRef.current = setTimeout(() => {
        setOutreachTimeout(true);
        setOutreachLoading(false);
        if (outreachPollRef.current) clearInterval(outreachPollRef.current);
      }, 15000);

      // Poll every 2 seconds
      outreachPollRef.current = setInterval(async () => {
        try {
          const job = await pollOutreachJob(sponsorId, jobId);
          if (job.status === 'completed') {
            if (outreachPollRef.current) clearInterval(outreachPollRef.current);
            if (outreachTimeoutRef.current) clearTimeout(outreachTimeoutRef.current);
            // Refresh outreach emails
            const emails = await listOutreachEmails(sponsorId);
            setOutreachEmails(emails);
            // Refresh sponsor for lastOutreachAt
            const refreshed = await getSponsor(sponsorId);
            setSponsor(refreshed);
            setOutreachLoading(false);
            addToast({ title: 'Outreach Email Generated', type: 'success' });
          } else if (job.status === 'failed') {
            if (outreachPollRef.current) clearInterval(outreachPollRef.current);
            if (outreachTimeoutRef.current) clearTimeout(outreachTimeoutRef.current);
            setOutreachLoading(false);
            addToast({ title: 'Outreach Failed', message: job.error || 'Generation failed', type: 'error' });
          }
        } catch {
          // Polling error — keep trying until timeout
        }
      }, 2000);
    } catch (err) {
      setOutreachLoading(false);
      addToast({ title: 'Outreach Failed', message: err instanceof Error ? err.message : 'Unknown error', type: 'error' });
    }
  };

  const handleCopyOutreach = async (email: OutreachEmail) => {
    try {
      await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast({ title: 'Copied to clipboard', type: 'success' });
    } catch {
      addToast({ title: 'Copy failed', type: 'error' });
    }
  };

  const handleMailto = (email: OutreachEmail) => {
    if (!sponsor) return;
    const mailto = `mailto:${sponsor.contactEmail}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
    window.open(mailto, '_blank');
  };

  // --- Status transition helpers ---

  const getNextStatuses = (current: string): string[] => {
    switch (current) {
      case 'draft': return ['booked', 'cancelled'];
      case 'booked': return ['fulfilled', 'cancelled'];
      default: return [];
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-muted text-muted-foreground';
      case 'booked': return 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300';
      case 'fulfilled': return 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300';
      case 'cancelled': return 'bg-error-100 text-error-800 dark:bg-error-900/30 dark:text-error-300';
      default: return 'bg-muted text-muted-foreground';
    }
  };


  // --- Loading state ---
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite">
            <span className="sr-only">Loading sponsor details...</span>
            <div className="h-6 w-32 bg-muted rounded animate-pulse mb-6" />
            <div className="h-8 w-64 bg-muted rounded animate-pulse mb-2" />
            <div className="h-4 w-48 bg-muted rounded animate-pulse mb-8" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-muted rounded animate-pulse" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --- Error state ---
  if (error || !sponsor) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Button variant="ghost" onClick={() => navigate('/sponsors')} className="mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Sponsors
          </Button>
          <div role="alert" aria-live="assertive" className="text-center py-12">
            <h3 className="text-lg font-medium text-foreground mb-2">Failed to load sponsor</h3>
            <p className="text-sm text-muted-foreground mb-6">{error || 'Sponsor not found'}</p>
            <Button onClick={loadData}><RefreshCw className="w-4 h-4 mr-2" /> Try Again</Button>
          </div>
        </main>
      </div>
    );
  }

  // --- Main render ---
  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back nav */}
        <Button variant="ghost" onClick={() => navigate('/sponsors')} className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Sponsors
        </Button>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{sponsor.sponsorName}</h1>
              {sponsor.status === 'archived' && <ArchivedBadge archivedAt={sponsor.archivedAt} />}
            </div>
            {sponsor.shortDescription && (
              <p className="text-sm text-muted-foreground">{sponsor.shortDescription}</p>
            )}
            {sponsor.lastOutreachAt && (
              <p className="text-xs text-muted-foreground mt-1">
                <Clock className="w-3 h-3 inline mr-1" />
                Last outreach: {formatDateTime(sponsor.lastOutreachAt)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="w-4 h-4 mr-1" /> Edit
              </Button>
            )}
            {sponsor.status === 'active' ? (
              <Button variant="outline" size="sm" onClick={() => setShowArchiveConfirm(true)}>
                <Archive className="w-4 h-4 mr-1" /> Archive
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleRestore}>
                <ArchiveRestore className="w-4 h-4 mr-1" /> Restore
              </Button>
            )}
            {canReachOut && (
              <Button size="sm" onClick={handleTriggerOutreach} isLoading={outreachLoading} disabled={outreachLoading}>
                <Mail className="w-4 h-4 mr-1" /> Reach Out
              </Button>
            )}
          </div>
        </div>


        {/* Outreach timeout warning */}
        {outreachTimeout && (
          <div className="mb-6 p-4 rounded-md bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-warning-800 dark:text-warning-300">Outreach generation timed out</p>
              <p className="text-xs text-warning-700 dark:text-warning-400 mt-1">The email generation took longer than 15 seconds. Please try again.</p>
            </div>
          </div>
        )}

        {/* Sponsor Info Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Sponsor Details</CardTitle>
              {editing && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
                    <X className="w-4 h-4 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={saveEdits} isLoading={saving}>
                    <Check className="w-4 h-4 mr-1" /> Save
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField label="Sponsor Name" value={editing ? (editForm.sponsorName ?? '') : sponsor.sponsorName} editing={editing} onChange={(v) => updateEditField('sponsorName', v)} />
              <EditableField label="Contact Email" value={editing ? (editForm.contactEmail ?? '') : sponsor.contactEmail} editing={editing} onChange={(v) => updateEditField('contactEmail', v)} />
              <EditableField label="Contact Name" value={editing ? (editForm.contactName ?? '') : (sponsor.contactName ?? '')} editing={editing} onChange={(v) => updateEditField('contactName', v)} />
              {editing ? (
                <SponsorPhotoUpload
                  sponsorId={sponsorId}
                  currentPhoto={logoRemoved ? undefined : (sponsor.logoUrl ?? undefined)}
                  onPhotoChange={(file) => {
                    setLogoFile(file);
                    setLogoUploadError(undefined);
                    setLogoRemoved(false);
                  }}
                  onPhotoRemove={() => {
                    setLogoFile(null);
                    setLogoUploadError(undefined);
                    setLogoRemoved(true);
                  }}
                  isUploading={logoUploading}
                  error={logoUploadError}
                />
              ) : (
                <div>
                  <span className="block text-xs font-medium text-muted-foreground mb-1">Logo</span>
                  {sponsor.logoUrl ? (
                    <img src={sponsor.logoUrl} alt="Sponsor logo" className="h-16 w-16 object-cover rounded-lg border border-border" />
                  ) : (
                    <p className="text-sm text-foreground">—</p>
                  )}
                </div>
              )}
              <EditableField label="Short Description" value={editing ? (editForm.shortDescription ?? '') : (sponsor.shortDescription ?? '')} editing={editing} maxLength={200} onChange={(v) => updateEditField('shortDescription', v)} />
              <EditableField label="Notes" value={editing ? (editForm.notes ?? '') : (sponsor.notes ?? '')} editing={editing} multiline onChange={(v) => updateEditField('notes', v)} />
              <div className="md:col-span-2">
                <EditableField label="Long Description" value={editing ? (editForm.longDescription ?? '') : (sponsor.longDescription ?? '')} editing={editing} multiline maxLength={2000} onChange={(v) => updateEditField('longDescription', v)} />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="text-sm font-medium text-foreground capitalize">{sponsor.status}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Version</p>
                <p className="text-sm font-medium text-foreground">{sponsor.version}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm font-medium text-foreground">{formatDate(sponsor.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Updated</p>
                <p className="text-sm font-medium text-foreground">{formatDate(sponsor.updatedAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Revenue Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="text-center py-4">
              <p className="text-xs text-muted-foreground">Total Revenue</p>
              <p className="text-xl font-bold text-foreground">{formatCurrency(totalRevenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="text-center py-4">
              <p className="text-xs text-muted-foreground">Fulfilled Sponsorships</p>
              <p className="text-xl font-bold text-foreground">{sponsor.totalFulfilledSponsorships}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="text-center py-4">
              <p className="text-xs text-muted-foreground">Last Sponsored</p>
              <p className="text-xl font-bold text-foreground">{formatDate(sponsor.lastSponsoredDate)}</p>
            </CardContent>
          </Card>
        </div>


        {/* Sponsorship History */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Sponsorship History</CardTitle>
              <Button size="sm" onClick={() => setShowAddSponsorship(!showAddSponsorship)}>
                <Plus className="w-4 h-4 mr-1" /> Add Sponsorship
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Add Sponsorship Form */}
            {showAddSponsorship && (
              <div className="mb-6 p-4 rounded-md border border-border bg-muted/30">
                <h4 className="text-sm font-medium text-foreground mb-3">New Sponsorship</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="sponsorship-issue-id" className="block text-xs text-muted-foreground mb-1">Issue ID</label>
                    <input id="sponsorship-issue-id" type="text" value={sponsorshipForm.issueId} onChange={(e) => setSponsorshipForm((p) => ({ ...p, issueId: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="e.g. tenant#42" />
                  </div>
                  <div>
                    <label htmlFor="sponsorship-issue-title" className="block text-xs text-muted-foreground mb-1">Issue Title</label>
                    <input id="sponsorship-issue-title" type="text" value={sponsorshipForm.issueTitle} onChange={(e) => setSponsorshipForm((p) => ({ ...p, issueTitle: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Issue #42: Cloud Trends" />
                  </div>
                  <div>
                    <label htmlFor="sponsorship-date" className="block text-xs text-muted-foreground mb-1">Date</label>
                    <input id="sponsorship-date" type="date" value={sponsorshipForm.sponsorshipDate} onChange={(e) => setSponsorshipForm((p) => ({ ...p, sponsorshipDate: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label htmlFor="sponsorship-amount" className="block text-xs text-muted-foreground mb-1">Amount (USD)</label>
                    <input id="sponsorship-amount" type="number" min="0" step="0.01" value={sponsorshipForm.amountCharged || ''} onChange={(e) => setSponsorshipForm((p) => ({ ...p, amountCharged: parseFloat(e.target.value) || 0 }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="150.00" />
                  </div>
                  <div>
                    <label htmlFor="sponsorship-placement" className="block text-xs text-muted-foreground mb-1">Placement Type</label>
                    <select id="sponsorship-placement" value={sponsorshipForm.placementType} onChange={(e) => setSponsorshipForm((p) => ({ ...p, placementType: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      <option value="primary">Primary</option>
                      <option value="secondary">Secondary</option>
                      <option value="inline">Inline</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowAddSponsorship(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleCreateSponsorship} isLoading={creatingSponsorship} disabled={!sponsorshipForm.issueId || !sponsorshipForm.sponsorshipDate || sponsorshipForm.amountCharged <= 0}>
                    Create
                  </Button>
                </div>
              </div>
            )}

            {/* Sponsorship Table */}
            {sponsorships.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No sponsorships yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border" role="table" aria-label="Sponsorship history">
                  <thead className="bg-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Issue</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Amount</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Placement</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Clicks</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sponsorships.map((entry) => (
                      <tr key={entry.sponsorshipId} className="hover:bg-muted/30">
                        <td className="px-4 py-3 text-sm text-foreground max-w-[200px] truncate" title={entry.issueTitle}>
                          {entry.issueTitle || entry.issueId}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{formatDate(entry.sponsorshipDate)}</td>
                        <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">{formatCurrency(entry.amountCharged)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusColor(entry.status)}`}>
                            {entry.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground capitalize">{entry.placementType}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                          {entry.clickCache ? (
                            <span title={`Total: ${entry.clickCache.totalClicks}, Unique: ${entry.clickCache.uniqueClicks}`}>
                              {entry.clickCache.totalClicks} / {entry.clickCache.uniqueClicks}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {/* Status transitions */}
                            {getNextStatuses(entry.status).map((nextStatus) => (
                              <Button
                                key={nextStatus}
                                variant="ghost"
                                size="sm"
                                onClick={() => handleUpdateSponsorshipStatus(entry.sponsorshipId, nextStatus)}
                                disabled={updatingSponsorship === entry.sponsorshipId}
                                className="text-xs px-2 py-1"
                              >
                                {nextStatus === 'cancelled' ? 'Cancel' : nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}
                              </Button>
                            ))}
                            {/* Link association */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setLinkEditSponsorshipId(linkEditSponsorshipId === entry.sponsorshipId ? null : entry.sponsorshipId);
                                setLinkIdsInput(entry.sponsorLinkIds?.join(', ') ?? '');
                              }}
                              className="text-xs px-2 py-1"
                              title="Manage links"
                            >
                              <Link2 className="w-3 h-3" />
                            </Button>
                          </div>
                          {/* Link edit inline */}
                          {linkEditSponsorshipId === entry.sponsorshipId && (
                            <div className="mt-2 flex gap-2 items-center">
                              <input
                                type="text"
                                value={linkIdsInput}
                                onChange={(e) => setLinkIdsInput(e.target.value)}
                                placeholder="link-id-1, link-id-2"
                                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                              <Button size="sm" variant="outline" onClick={() => handleSaveLinks(entry.sponsorshipId)} isLoading={savingLinks} className="text-xs px-2 py-1">
                                Save
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>


        {/* Outreach Section */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Outreach</CardTitle>
              {sponsor.lastOutreachAt && (
                <span className="text-xs text-muted-foreground">
                  Last: {formatDateTime(sponsor.lastOutreachAt)}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Latest outreach preview */}
            {latestOutreach ? (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-muted-foreground">
                    Generated {formatDateTime(latestOutreach.generatedAt)}
                  </p>
                  {latestOutreach.isFallback && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300">
                      <AlertTriangle className="w-3 h-3 mr-1" /> Template Fallback
                    </span>
                  )}
                </div>
                <div className="p-4 rounded-md border border-border bg-muted/20">
                  <p className="text-sm font-medium text-foreground mb-2">Subject: {latestOutreach.subject}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{latestOutreach.body}</p>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={() => handleCopyOutreach(latestOutreach)}>
                    {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleMailto(latestOutreach)}>
                    <ExternalLink className="w-4 h-4 mr-1" /> Open in Email
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {canReachOut ? 'No outreach emails generated yet. Click "Reach Out" to generate one.' : 'Outreach requires an active sponsor with a contact email.'}
              </p>
            )}

            {/* Audit trail */}
            {outreachEmails.length > 1 && (
              <div className="mt-4 pt-4 border-t border-border">
                <button
                  onClick={() => setShowAuditTrail(!showAuditTrail)}
                  className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  {showAuditTrail ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  Outreach History ({outreachEmails.length} emails)
                </button>
                {showAuditTrail && (
                  <div className="mt-3 space-y-3">
                    {outreachEmails.map((email, idx) => (
                      <div key={email.generatedAt} className="p-3 rounded-md border border-border bg-muted/10">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-muted-foreground">{formatDateTime(email.generatedAt)}</p>
                            {email.isFallback && (
                              <span className="text-xs text-warning-600">Fallback</span>
                            )}
                            <span className="text-xs text-muted-foreground capitalize">({email.metricsSource})</span>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => handleCopyOutreach(email)} className="text-muted-foreground hover:text-foreground p-1" title="Copy">
                              <Copy className="w-3 h-3" />
                            </button>
                            <button onClick={() => handleMailto(email)} className="text-muted-foreground hover:text-foreground p-1" title="Open in email">
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm font-medium text-foreground">{email.subject}</p>
                        {idx > 0 && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{email.body}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Confirmation Dialogs */}
        <ConfirmDialog
          open={showArchiveConfirm}
          title="Archive Sponsor"
          message={`Are you sure you want to archive "${sponsor.sponsorName}"? The sponsor will be hidden from the directory but can be restored later. All sponsorship and outreach history will be preserved.`}
          confirmLabel="Archive"
          loading={archiving}
          onConfirm={handleArchive}
          onCancel={() => setShowArchiveConfirm(false)}
        />

        <ConfirmDialog
          open={!!noLinksConfirm}
          title="No Links Associated"
          message="This sponsorship has no tracked links associated. Fulfillment without links means no sponsor-specific click data will be available. Continue?"
          confirmLabel="Fulfill Anyway"
          confirmVariant="primary"
          onConfirm={() => {
            if (noLinksConfirm) {
              handleUpdateSponsorshipStatus(noLinksConfirm.sponsorshipId, noLinksConfirm.targetStatus, true);
            }
          }}
          onCancel={() => setNoLinksConfirm(null)}
        />
      </main>
    </div>
  );
};
