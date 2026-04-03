import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Eye, RefreshCw, Users, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Card, CardContent } from '@/components/ui/Card';
import { segmentService } from '@/services/segmentService';
import type { Segment } from '@/services/segmentService';

export const SegmentListPage: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Delete confirmation state
  const [segmentToDelete, setSegmentToDelete] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSegments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await segmentService.listSegments();
      if (response.success && response.data) {
        setSegments(response.data.segments);
      } else {
        setError(response.error || 'Failed to load segments');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load segments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSegments();
  }, [loadSegments]);

  // --- Validation ---
  const nameError = (() => {
    const trimmed = createName.trim();
    if (trimmed.length === 0 && createName.length > 0) return 'Name cannot be only whitespace';
    if (trimmed.length > 100) return 'Name must not exceed 100 characters';
    return null;
  })();

  const descriptionError = createDescription.length > 500
    ? 'Description must not exceed 500 characters'
    : null;

  const canSubmit = createName.trim().length >= 1 && !nameError && !descriptionError && !creating;

  // --- Handlers ---
  const handleCreate = useCallback(async () => {
    if (!canSubmit) return;
    setCreating(true);
    setCreateError(null);

    const response = await segmentService.createSegment({
      name: createName.trim(),
      description: createDescription.trim() || undefined,
    });

    if (response.success && response.data) {
      setSegments(prev => [response.data!, ...prev]);
      setShowCreateModal(false);
      setCreateName('');
      setCreateDescription('');
      addToast({ title: 'Segment Created', message: `"${response.data.name}" created successfully`, type: 'success' });
    } else {
      const errMsg = response.error || 'Failed to create segment';
      if (errMsg.includes('409') || errMsg.includes('Conflict') || errMsg.toLowerCase().includes('already exists')) {
        setCreateError('A segment with this name already exists');
      } else {
        setCreateError(errMsg);
      }
    }
    setCreating(false);
  }, [canSubmit, createName, createDescription, addToast]);

  const handleDelete = useCallback(async () => {
    if (!segmentToDelete) return;
    setDeleting(true);

    // Optimistic removal
    const prev = [...segments];
    setSegments(s => s.filter(seg => seg.segmentId !== segmentToDelete.segmentId));
    setSegmentToDelete(null);

    const response = await segmentService.deleteSegment(segmentToDelete.segmentId);
    if (response.success) {
      addToast({ title: 'Segment Deleted', message: `"${segmentToDelete.name}" has been deleted`, type: 'success' });
    } else {
      setSegments(prev);
      addToast({ title: 'Delete Failed', message: response.error || 'Could not delete segment', type: 'error' });
    }
    setDeleting(false);
  }, [segmentToDelete, segments, addToast]);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const manualSegments = useMemo(() => segments.filter(s => !s.autoManaged), [segments]);
  const autoSegments = useMemo(() => segments.filter(s => s.autoManaged), [segments]);

  const renderSegmentTable = (items: Segment[], label: string) => (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border" role="table" aria-label={label}>
        <thead className="bg-muted">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Description</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Members</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Created</th>
            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-surface divide-y divide-border">
          {items.map(segment => (
            <tr key={segment.segmentId} className="hover:bg-muted/50 transition-colors group">
              <td className="px-6 py-4">
                <button
                  onClick={() => navigate(`/segments/${segment.segmentId}`)}
                  className="text-left text-sm font-medium text-foreground group-hover:text-primary-600 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 rounded"
                  aria-label={`View segment: ${segment.name}`}
                >
                  {segment.name}
                </button>
              </td>
              <td className="px-6 py-4 text-sm text-muted-foreground max-w-xs truncate hidden sm:table-cell">
                {segment.description || '—'}
              </td>
              <td className="px-6 py-4 text-sm text-muted-foreground">{segment.memberCount}</td>
              <td className="px-6 py-4 text-sm text-muted-foreground hidden md:table-cell">{formatDate(segment.createdAt)}</td>
              <td className="px-6 py-4 text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/segments/${segment.segmentId}`)} aria-label={`View segment: ${segment.name}`}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSegmentToDelete(segment)} aria-label={`Delete segment: ${segment.name}`} className="hover:bg-error-50 dark:hover:bg-error-900/20">
                    <Trash2 className="w-4 h-4 text-error-600 dark:text-error-400" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // --- Render ---
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite">
            <span className="sr-only">Loading segments...</span>
            <div className="mb-8 flex items-center justify-between">
              <div><div className="h-8 w-48 bg-muted rounded animate-pulse mb-2" /><div className="h-4 w-64 bg-muted rounded animate-pulse" /></div>
              <div className="h-10 w-40 bg-muted rounded animate-pulse" />
            </div>
            <Card>
              <div className="divide-y divide-border">
                {[1, 2, 3].map(i => (
                  <div key={i} className="px-6 py-4 flex items-center justify-between">
                    <div className="space-y-2"><div className="h-4 w-40 bg-muted rounded animate-pulse" /><div className="h-3 w-64 bg-muted rounded animate-pulse" /></div>
                    <div className="h-8 w-20 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  if (error && segments.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="alert" className="text-center py-12">
            <h3 className="text-lg font-medium text-foreground mb-2">Failed to load segments</h3>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <Button onClick={loadSegments}><RefreshCw className="w-4 h-4 mr-2" />Try Again</Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Segments</h1>
            <p className="text-sm text-muted-foreground mt-1">Organize subscribers into targeted groups</p>
          </div>
          <Button onClick={() => { setShowCreateModal(true); setCreateError(null); setCreateName(''); setCreateDescription(''); }}>
            <Plus className="w-4 h-4 mr-2" />Create Segment
          </Button>
        </div>

        {/* Segment list */}
        {segments.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Users className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No segments yet</h3>
                <p className="text-sm text-muted-foreground mb-6">Create your first segment to start organizing subscribers.</p>
                <Button onClick={() => setShowCreateModal(true)}><Plus className="w-4 h-4 mr-2" />Create Segment</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {/* Your Segments */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold text-foreground">Your Segments</h2>
                <span className="text-xs text-muted-foreground">({manualSegments.length})</span>
              </div>
              {manualSegments.length === 0 ? (
                <Card>
                  <CardContent className="py-8">
                    <div className="text-center">
                      <Users className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground mb-4">No manual segments yet. Create one to start organizing subscribers.</p>
                      <Button size="sm" onClick={() => setShowCreateModal(true)}><Plus className="w-4 h-4 mr-2" />Create Segment</Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>{renderSegmentTable(manualSegments, 'Your segments')}</Card>
              )}
            </section>

            {/* Interest Segments */}
            {autoSegments.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-primary-500" />
                  <h2 className="text-lg font-semibold text-foreground">Interest Segments</h2>
                  <span className="text-xs text-muted-foreground">({autoSegments.length})</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  These segments are built automatically from subscriber click behavior. When a subscriber clicks enough links about a topic in your newsletters, they are added to the matching interest segment. Open a segment to learn more.
                </p>
                <Card>{renderSegmentTable(autoSegments, 'Interest segments')}</Card>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Create Segment Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" role="presentation" onClick={() => setShowCreateModal(false)} onKeyDown={e => { if (e.key === 'Escape') setShowCreateModal(false); }} />
          <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Create Segment</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="segment-name" className="block text-sm font-medium text-foreground mb-1">Name</label>
                <input
                  id="segment-name"
                  type="text"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="e.g. VIP Subscribers"
                  maxLength={100}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <div className="flex justify-between mt-1">
                  {nameError && <p className="text-xs text-error-600">{nameError}</p>}
                  <p className="text-xs text-muted-foreground ml-auto">{createName.trim().length}/100</p>
                </div>
              </div>

              <div>
                <label htmlFor="segment-description" className="block text-sm font-medium text-foreground mb-1">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                <textarea
                  id="segment-description"
                  value={createDescription}
                  onChange={e => setCreateDescription(e.target.value)}
                  placeholder="Describe this segment..."
                  rows={3}
                  maxLength={500}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
                <div className="flex justify-between mt-1">
                  {descriptionError && <p className="text-xs text-error-600">{descriptionError}</p>}
                  <p className="text-xs text-muted-foreground ml-auto">{createDescription.length}/500</p>
                </div>
              </div>

              {createError && (
                <p className="text-sm text-error-600 bg-error-50 dark:bg-error-900/20 rounded-md px-3 py-2">{createError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!canSubmit} isLoading={creating}>Create</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {segmentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" role="presentation" onClick={() => setSegmentToDelete(null)} onKeyDown={e => { if (e.key === 'Escape') setSegmentToDelete(null); }} />
          <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 z-10">
            <h2 className="text-lg font-semibold text-foreground mb-2">Delete Segment</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete <span className="font-medium text-foreground">&quot;{segmentToDelete.name}&quot;</span>? This will remove all member associations. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setSegmentToDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} isLoading={deleting}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
