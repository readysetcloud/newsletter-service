import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Download, Pencil, X, RefreshCw, AlertCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Card, CardContent } from '@/components/ui/Card';
import { segmentService } from '@/services/segmentService';
import type { Segment, SegmentMember } from '@/services/segmentService';

export const SegmentDetailPage: React.FC = () => {
  const { segmentId } = useParams<{ segmentId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Segment state
  const [segment, setSegment] = useState<Segment | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Members state
  const [members, setMembers] = useState<SegmentMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [totalCount, setTotalCount] = useState(0);

  // Add members state
  const [showAddForm, setShowAddForm] = useState(false);
  const [emailsInput, setEmailsInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ added: number; skipped: number } | null>(null);

  // Selection state
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportS3Key, setExportS3Key] = useState<string | null>(null);

  // Edit state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // --- Load segment ---
  const loadSegment = useCallback(async () => {
    if (!segmentId) return;
    try {
      setLoading(true);
      setError(null);
      setNotFound(false);
      const response = await segmentService.getSegment(segmentId);
      if (response.success && response.data) {
        setSegment(response.data);
      } else {
        const msg = response.error || '';
        if (msg.includes('404') || msg.includes('not found') || msg.includes('Not Found')) {
          setNotFound(true);
        } else {
          setError(msg || 'Failed to load segment');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load segment');
    } finally {
      setLoading(false);
    }
  }, [segmentId]);

  // --- Load members ---
  const loadMembers = useCallback(async (reset = false) => {
    if (!segmentId) return;
    setMembersLoading(true);
    const token = reset ? undefined : nextToken;
    const response = await segmentService.listMembers(segmentId, { pageSize: 50, nextToken: token });
    if (response.success && response.data) {
      if (reset) {
        setMembers(response.data.members);
      } else {
        setMembers(prev => [...prev, ...response.data!.members]);
      }
      setNextToken(response.data.nextToken);
      setTotalCount(response.data.totalCount);
    }
    setMembersLoading(false);
  }, [segmentId, nextToken]);

  useEffect(() => { loadSegment(); }, [loadSegment]);
  useEffect(() => { if (segment) loadMembers(true); }, [segment]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Add members ---
  const handleAddMembers = useCallback(async () => {
    if (!segmentId) return;
    const emails = emailsInput
      .split(/[,\n]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);
    if (emails.length === 0) return;

    setAdding(true);
    setAddResult(null);
    const response = await segmentService.addMembers(segmentId, emails);
    if (response.success && response.data) {
      setAddResult({ added: response.data.added, skipped: response.data.skipped });
      setEmailsInput('');
      // Refresh members and segment count
      loadMembers(true);
      loadSegment();
    } else {
      addToast({ title: 'Add Failed', message: response.error || 'Could not add members', type: 'error' });
    }
    setAdding(false);
  }, [segmentId, emailsInput, addToast, loadMembers, loadSegment]);

  // --- Remove members ---
  const handleRemoveSelected = useCallback(async () => {
    if (!segmentId || selectedEmails.size === 0) return;
    setRemoving(true);
    const response = await segmentService.removeMembers(segmentId, Array.from(selectedEmails));
    if (response.success && response.data) {
      addToast({ title: 'Members Removed', message: `${response.data.removed} member(s) removed`, type: 'success' });
      setSelectedEmails(new Set());
      loadMembers(true);
      loadSegment();
    } else {
      addToast({ title: 'Remove Failed', message: response.error || 'Could not remove members', type: 'error' });
    }
    setRemoving(false);
  }, [segmentId, selectedEmails, addToast, loadMembers, loadSegment]);

  // --- Export ---
  const handleExport = useCallback(async () => {
    if (!segmentId) return;
    setExporting(true);
    setExportStatus(null);
    setExportS3Key(null);

    const response = await segmentService.exportSegment(segmentId);
    if (response.success && response.data) {
      if (response.data.s3Key) {
        setExportS3Key(response.data.s3Key);
        setExportStatus('completed');
      } else if (response.data.jobId) {
        setExportStatus('pending');
        pollExportJob(response.data.jobId);
      }
    } else {
      addToast({ title: 'Export Failed', message: response.error || 'Could not start export', type: 'error' });
    }
    setExporting(false);
  }, [segmentId, addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const pollExportJob = useCallback(async (jobId: string) => {
    const poll = async () => {
      const res = await segmentService.getJobStatus(jobId);
      if (res.success && res.data) {
        if (res.data.status === 'completed') {
          setExportStatus('completed');
          setExportS3Key(res.data.s3Key || null);
          return;
        } else if (res.data.status === 'failed') {
          setExportStatus('failed');
          addToast({ title: 'Export Failed', message: res.data.error || 'Export job failed', type: 'error' });
          return;
        }
      }
      // Still pending — poll again
      setTimeout(poll, 3000);
    };
    poll();
  }, [addToast]);

  // --- Edit segment ---
  const openEditModal = useCallback(() => {
    if (!segment) return;
    setEditName(segment.name);
    setEditDescription(segment.description || '');
    setEditError(null);
    setShowEditModal(true);
  }, [segment]);

  const handleSaveEdit = useCallback(async () => {
    if (!segmentId) return;
    const trimmedName = editName.trim();
    if (trimmedName.length < 1 || trimmedName.length > 100) return;
    if (editDescription.length > 500) return;

    setSaving(true);
    setEditError(null);
    const response = await segmentService.updateSegment(segmentId, {
      name: trimmedName,
      description: editDescription.trim() || undefined,
    });
    if (response.success && response.data) {
      setSegment(response.data);
      setShowEditModal(false);
      addToast({ title: 'Segment Updated', message: 'Changes saved', type: 'success' });
    } else {
      const msg = response.error || '';
      if (msg.includes('409') || msg.includes('Conflict') || msg.toLowerCase().includes('already exists')) {
        setEditError('A segment with this name already exists');
      } else {
        setEditError(msg || 'Failed to update segment');
      }
    }
    setSaving(false);
  }, [segmentId, editName, editDescription, addToast]);

  // --- Selection helpers ---
  const toggleSelect = (email: string) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedEmails.size === members.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(members.map(m => m.email)));
    }
  };

  const editNameError = (() => {
    const t = editName.trim();
    if (t.length === 0 && editName.length > 0) return 'Name cannot be only whitespace';
    if (t.length > 100) return 'Name must not exceed 100 characters';
    return null;
  })();
  const editDescError = editDescription.length > 500 ? 'Description must not exceed 500 characters' : null;
  const canSaveEdit = editName.trim().length >= 1 && !editNameError && !editDescError && !saving;

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  // --- Render: Loading ---
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite"><span className="sr-only">Loading segment...</span>
            <div className="mb-6"><div className="h-9 w-32 bg-muted rounded animate-pulse" /></div>
            <Card><CardContent className="py-6"><div className="space-y-4"><div className="h-6 w-48 bg-muted rounded animate-pulse" /><div className="h-4 w-96 bg-muted rounded animate-pulse" /></div></CardContent></Card>
          </div>
        </main>
      </div>
    );
  }

  // --- Render: Not found ---
  if (notFound) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card><CardContent className="py-12">
            <div className="text-center" role="alert">
              <AlertCircle className="mx-auto h-12 w-12 text-error-400 mb-4" />
              <h2 className="text-2xl font-semibold text-foreground mb-2">Segment not found</h2>
              <p className="text-muted-foreground mb-6">This segment may have been deleted.</p>
              <Button variant="outline" onClick={() => navigate('/segments')}><ArrowLeft className="h-4 w-4 mr-2" />Back to Segments</Button>
            </div>
          </CardContent></Card>
        </main>
      </div>
    );
  }

  // --- Render: Error ---
  if (error || !segment) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card><CardContent className="py-12">
            <div className="text-center" role="alert">
              <AlertCircle className="mx-auto h-12 w-12 text-error-400 mb-4" />
              <h2 className="text-2xl font-semibold text-foreground mb-2">Error</h2>
              <p className="text-muted-foreground mb-6">{error || 'Something went wrong'}</p>
              <Button onClick={loadSegment}><RefreshCw className="h-4 w-4 mr-2" />Try Again</Button>
            </div>
          </CardContent></Card>
        </main>
      </div>
    );
  }

  // --- Render: Main ---
  return (
    <div className="min-h-screen bg-background">
      <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back */}
        <div className="mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/segments')}><ArrowLeft className="h-4 w-4 mr-2" />Back to Segments</Button>
        </div>

        {/* Segment header */}
        <Card className="mb-6">
          <CardContent className="py-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-foreground">{segment.name}</h1>
                {segment.description && <p className="text-sm text-muted-foreground mt-1">{segment.description}</p>}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2">
                  <span>{segment.memberCount} member{segment.memberCount !== 1 ? 's' : ''}</span>
                  <span>Created {formatDate(segment.createdAt)}</span>
                  {segment.updatedAt && <span>Updated {formatDate(segment.updatedAt)}</span>}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={openEditModal}><Pencil className="h-4 w-4 mr-2" />Edit</Button>
                <Button variant="outline" size="sm" onClick={handleExport} isLoading={exporting} disabled={exporting || segment.memberCount === 0}>
                  <Download className="h-4 w-4 mr-2" />Export
                </Button>
              </div>
            </div>

            {/* Export status */}
            {exportStatus === 'pending' && (
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md text-sm text-blue-700 dark:text-blue-300">
                Export in progress... Polling for completion.
              </div>
            )}
            {exportStatus === 'completed' && exportS3Key && (
              <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-md text-sm text-green-700 dark:text-green-300">
                Export ready: <span className="font-mono text-xs break-all">{exportS3Key}</span>
              </div>
            )}
            {exportStatus === 'failed' && (
              <div className="mt-4 p-3 bg-error-50 dark:bg-error-900/20 rounded-md text-sm text-error-700 dark:text-error-300">
                Export failed. Please try again.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add members */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">Add Members</h2>
              {!showAddForm && (
                <Button variant="outline" size="sm" onClick={() => { setShowAddForm(true); setAddResult(null); }}>
                  <Plus className="h-4 w-4 mr-2" />Add
                </Button>
              )}
            </div>
            {showAddForm && (
              <div className="space-y-3">
                <textarea
                  value={emailsInput}
                  onChange={e => setEmailsInput(e.target.value)}
                  placeholder="Paste emails separated by commas or newlines..."
                  rows={4}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
                <div className="flex items-center gap-3">
                  <Button size="sm" onClick={handleAddMembers} isLoading={adding} disabled={adding || emailsInput.trim().length === 0}>Add Members</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowAddForm(false); setEmailsInput(''); setAddResult(null); }}>Cancel</Button>
                </div>
              </div>
            )}
            {addResult && (
              <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-md text-sm text-green-700 dark:text-green-300">
                {addResult.added} added, {addResult.skipped} skipped
              </div>
            )}
          </CardContent>
        </Card>

        {/* Members table */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">Members ({totalCount})</h2>
              {selectedEmails.size > 0 && (
                <Button variant="destructive" size="sm" onClick={handleRemoveSelected} isLoading={removing} disabled={removing}>
                  <Trash2 className="h-4 w-4 mr-2" />Remove Selected ({selectedEmails.size})
                </Button>
              )}
            </div>

            {members.length === 0 && !membersLoading ? (
              <div className="text-center py-8">
                <Users className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No subscribers have been added to this segment yet.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border" role="table" aria-label="Segment members">
                    <thead className="bg-muted">
                      <tr>
                        <th scope="col" className="px-4 py-2 w-10">
                          <input
                            type="checkbox"
                            checked={members.length > 0 && selectedEmails.size === members.length}
                            onChange={toggleSelectAll}
                            className="rounded border-border"
                            aria-label="Select all members"
                          />
                        </th>
                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Email</th>
                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase hidden sm:table-cell">Last Engaged Issue</th>
                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase hidden sm:table-cell">Engagement Count</th>
                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase hidden md:table-cell">Added</th>
                      </tr>
                    </thead>
                    <tbody className="bg-surface divide-y divide-border">
                      {members.map(member => (
                        <tr key={member.email} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={selectedEmails.has(member.email)}
                              onChange={() => toggleSelect(member.email)}
                              className="rounded border-border"
                              aria-label={`Select ${member.email}`}
                            />
                          </td>
                          <td className="px-4 py-2 text-sm text-foreground">{member.email}</td>
                          <td className="px-4 py-2 text-sm text-muted-foreground hidden sm:table-cell">{member.lastEngagedIssue ?? '—'}</td>
                          <td className="px-4 py-2 text-sm text-muted-foreground hidden sm:table-cell">{member.engagementCount ?? '—'}</td>
                          <td className="px-4 py-2 text-sm text-muted-foreground hidden md:table-cell">{formatDate(member.addedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {nextToken && (
                  <div className="mt-4 flex justify-center">
                    <Button variant="outline" size="sm" onClick={() => loadMembers(false)} isLoading={membersLoading} disabled={membersLoading}>
                      Load More
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Edit Segment Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" role="presentation" onClick={() => setShowEditModal(false)} onKeyDown={e => { if (e.key === 'Escape') setShowEditModal(false); }} />
          <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Edit Segment</h2>
              <button onClick={() => setShowEditModal(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="edit-name" className="block text-sm font-medium text-foreground mb-1">Name</label>
                <input id="edit-name" type="text" value={editName} onChange={e => setEditName(e.target.value)} maxLength={100}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500" />
                <div className="flex justify-between mt-1">
                  {editNameError && <p className="text-xs text-error-600">{editNameError}</p>}
                  <p className="text-xs text-muted-foreground ml-auto">{editName.trim().length}/100</p>
                </div>
              </div>
              <div>
                <label htmlFor="edit-description" className="block text-sm font-medium text-foreground mb-1">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                <textarea id="edit-description" value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} maxLength={500}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" />
                <div className="flex justify-between mt-1">
                  {editDescError && <p className="text-xs text-error-600">{editDescError}</p>}
                  <p className="text-xs text-muted-foreground ml-auto">{editDescription.length}/500</p>
                </div>
              </div>
              {editError && <p className="text-sm text-error-600 bg-error-50 dark:bg-error-900/20 rounded-md px-3 py-2">{editError}</p>}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={!canSaveEdit} isLoading={saving}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
