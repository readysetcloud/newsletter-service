import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { MarkdownPreview } from '@/components/issues/MarkdownPreview';
import { issuesService } from '@/services/issuesService';
import type { Issue, CreateIssueRequest, UpdateIssueRequest } from '@/types/issues';

interface FormData {
  title: string;
  content: string;
  slug: string;
  scheduledAt?: string;
}

interface FormErrors {
  title?: string;
  content?: string;
  slug?: string;
  scheduledAt?: string;
}

export const IssueFormPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isEditMode = !!id;

  const [formData, setFormData] = useState<FormData>({
    title: '',
    content: '',
    slug: '',
    scheduledAt: '',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [existingIssue, setExistingIssue] = useState<Issue | null>(null);
  const [isFormDisabled, setIsFormDisabled] = useState(false);

  const loadIssue = useCallback(async (issueId: string) => {
    setIsLoading(true);
    try {
      const response = await issuesService.getIssue(issueId);
      if (response.success && response.data) {
        const issue = response.data;
        setExistingIssue(issue);
        setFormData({
          title: issue.title,
          content: issue.content,
          slug: issue.slug,
          scheduledAt: issue.scheduledAt ? toDatetimeLocal(issue.scheduledAt) : '',
        });

        // Disable form for published/scheduled issues
        if (issue.status !== 'draft') {
          setIsFormDisabled(true);
        }
      } else {
        const errorMsg = response.error || 'Failed to load issue';
        addToast({
          type: 'error',
          title: 'Failed to Load Issue',
          message: errorMsg,
        });
        navigate('/issues');
      }
    } catch (error) {
      console.error('Failed to load issue:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to load issue';
      addToast({
        type: 'error',
        title: 'Failed to Load Issue',
        message: errorMsg,
      });
      navigate('/issues');
    } finally {
      setIsLoading(false);
    }
  }, [navigate, addToast]);

  // Load existing issue data for edit mode
  useEffect(() => {
    if (isEditMode && id) {
      loadIssue(id);
    }
  }, [isEditMode, id, loadIssue]);

  // Generate slug from title
  const generateSlug = (title: string): string => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  // Convert ISO datetime to datetime-local format
  const toDatetimeLocal = (isoString: string): string => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Handle input changes
  const handleInputChange = useCallback((field: keyof FormData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    setIsDirty(true);

    // Auto-generate slug from title if slug is empty or hasn't been manually edited
    if (field === 'title' && !isEditMode) {
      const newSlug = generateSlug(value);
      setFormData((prev) => ({
        ...prev,
        slug: newSlug,
      }));
    }

    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    }
  }, [isEditMode, errors]);

  // Validate single field
  const validateField = useCallback((field: keyof FormData, value: string): string | undefined => {
    switch (field) {
      case 'title':
        if (!value.trim()) {
          return 'Title is required';
        }
        if (value.length > 200) {
          return 'Title must be 200 characters or less';
        }
        break;

      case 'content':
        if (!value.trim()) {
          return 'Content is required';
        }
        break;

      case 'slug':
        if (!value.trim()) {
          return 'Slug is required';
        }
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens';
        }
        break;

      case 'scheduledAt':
        if (value && value.trim()) {
          const scheduledDate = new Date(value);
          const now = new Date();

          if (isNaN(scheduledDate.getTime())) {
            return 'Invalid date format';
          }

          if (scheduledDate <= now) {
            return 'Scheduled time must be in the future';
          }
        }
        break;
    }
    return undefined;
  }, []);

  // Validate entire form
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    newErrors.title = validateField('title', formData.title);
    newErrors.content = validateField('content', formData.content);
    newErrors.slug = validateField('slug', formData.slug);
    newErrors.scheduledAt = validateField('scheduledAt', formData.scheduledAt || '');

    setErrors(newErrors);

    return !newErrors.title && !newErrors.content && !newErrors.slug && !newErrors.scheduledAt;
  }, [formData, validateField]);

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditMode && id) {
        // Update existing issue
        const updateData: UpdateIssueRequest = {
          title: formData.title,
          content: formData.content,
          slug: formData.slug,
        };

        if (formData.scheduledAt) {
          updateData.scheduledAt = new Date(formData.scheduledAt).toISOString();
        }

        const response = await issuesService.updateIssue(id, updateData);

        if (response.success) {
          addToast({
            type: 'success',
            title: 'Issue Updated',
            message: 'Your issue has been updated successfully.',
          });
          setIsDirty(false);
          navigate(`/issues/${id}`);
        } else {
          const errorMsg = response.error || 'Failed to update issue';
          if (errorMsg.includes('409') || errorMsg.includes('Conflict') || errorMsg.includes('cannot be modified')) {
            addToast({
              type: 'error',
              title: 'Cannot Edit Issue',
              message: 'This issue cannot be edited because it has already been published or scheduled.',
            });
          } else if (errorMsg.includes('404') || errorMsg.includes('not found')) {
            addToast({
              type: 'error',
              title: 'Issue Not Found',
              message: 'The issue may have been deleted.',
            });
          } else if (errorMsg.includes('403') || errorMsg.includes('Access denied')) {
            addToast({
              type: 'error',
              title: 'Access Denied',
              message: 'You do not have permission to edit this issue.',
            });
          } else {
            addToast({
              type: 'error',
              title: 'Failed to Update',
              message: errorMsg,
            });
          }
        }
      } else {
        // Create new issue
        const createData: CreateIssueRequest = {
          title: formData.title,
          content: formData.content,
          slug: formData.slug,
        };

        if (formData.scheduledAt) {
          createData.scheduledAt = new Date(formData.scheduledAt).toISOString();
        }

        const response = await issuesService.createIssue(createData);

        if (response.success && response.data) {
          addToast({
            type: 'success',
            title: 'Issue Created',
            message: 'Your issue has been created successfully.',
          });
          setIsDirty(false);
          navigate(`/issues/${response.data.id}`);
        } else {
          const errorMsg = response.error || 'Failed to create issue';
          addToast({
            type: 'error',
            title: 'Failed to Create Issue',
            message: errorMsg,
          });
        }
      }
    } catch (error) {
      console.error('Failed to save issue:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to save issue';

      // Handle specific error cases
      if (errorMsg.includes('409') || errorMsg.includes('Conflict')) {
        addToast({
          type: 'error',
          title: 'Cannot Edit Issue',
          message: 'This issue cannot be edited because it has already been published or scheduled.',
        });
      } else if (errorMsg.includes('403') || errorMsg.includes('Access denied')) {
        addToast({
          type: 'error',
          title: 'Access Denied',
          message: 'You do not have permission to perform this action.',
        });
      } else {
        addToast({
          type: 'error',
          title: 'Failed to Save',
          message: errorMsg,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [validateForm, isEditMode, id, formData, navigate, addToast]);

  // Handle cancel with unsaved changes confirmation
  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowCancelDialog(true);
    } else {
      navigate(isEditMode ? `/issues/${id}` : '/issues');
    }
  }, [isDirty, isEditMode, id, navigate]);

  const confirmCancel = useCallback(async () => {
    setShowCancelDialog(false);
    navigate(isEditMode ? `/issues/${id}` : '/issues');
  }, [isEditMode, id, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div role="status" aria-live="polite" aria-label="Loading issue form">
            <span className="sr-only">Loading issue form...</span>
          {/* Header Skeleton */}
          <div className="mb-8">
            <div className="h-9 w-64 bg-muted rounded animate-pulse mb-2" />
            <div className="h-4 w-96 bg-muted rounded animate-pulse" />
          </div>

          {/* Form Skeleton */}
          <div className="bg-surface rounded-lg border border-border p-6 space-y-6">
            {/* Title Input Skeleton */}
            <div className="space-y-2">
              <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              <div className="h-10 w-full bg-muted rounded animate-pulse" />
            </div>

            {/* Slug Input Skeleton */}
            <div className="space-y-2">
              <div className="h-4 w-12 bg-muted rounded animate-pulse" />
              <div className="h-10 w-full bg-muted rounded animate-pulse" />
              <div className="h-3 w-64 bg-muted rounded animate-pulse" />
            </div>

            {/* Content Textarea Skeleton */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-4 w-20 bg-muted rounded animate-pulse" />
                <div className="h-8 w-32 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-64 w-full bg-muted rounded animate-pulse" />
            </div>
          </div>

          {/* Form Actions Skeleton */}
          <div className="mt-6 flex justify-end space-x-3">
            <div className="h-10 w-20 bg-muted rounded animate-pulse" />
            <div className="h-10 w-32 bg-muted rounded animate-pulse" />
          </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {isEditMode ? 'Edit Issue' : 'Create New Issue'}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-muted-foreground">
            {isEditMode
              ? 'Update your newsletter issue details'
              : 'Create a new draft newsletter issue'}
          </p>
          {isFormDisabled && (
            <div className="mt-4 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 p-4" role="alert" aria-live="polite">
              <p className="text-sm text-warning-800 dark:text-warning-200">
                This issue cannot be edited because it has been {existingIssue?.status}.
              </p>
            </div>
          )}
        </header>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6" id="issue-form" aria-label={isEditMode ? 'Edit issue form' : 'Create issue form'}>
          <div className="bg-surface rounded-lg border border-border shadow-sm p-4 sm:p-6 space-y-6">
            {/* Title Input */}
            <Input
              label="Title *"
              placeholder="Enter issue title"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              onBlur={() => {
                const error = validateField('title', formData.title);
                if (error) {
                  setErrors((prev) => ({ ...prev, title: error }));
                }
              }}
              error={errors.title}
              disabled={isFormDisabled}
              maxLength={200}
            />

            {/* Slug Input */}
            <Input
              label="Slug *"
              placeholder="issue-slug"
              value={formData.slug}
              onChange={(e) => handleInputChange('slug', e.target.value)}
              onBlur={() => {
                const error = validateField('slug', formData.slug);
                if (error) {
                  setErrors((prev) => ({ ...prev, slug: error }));
                }
              }}
              error={errors.slug}
              helperText="URL-friendly identifier (lowercase, hyphens, alphanumeric)"
              disabled={isFormDisabled}
            />

            {/* Scheduled At Input */}
            <div>
              <label htmlFor="scheduledAt" className="block text-sm font-medium text-foreground mb-2">
                Schedule Publication (Optional)
              </label>
              <input
                type="datetime-local"
                id="scheduledAt"
                value={formData.scheduledAt}
                onChange={(e) => handleInputChange('scheduledAt', e.target.value)}
                onBlur={() => {
                  const error = validateField('scheduledAt', formData.scheduledAt || '');
                  if (error) {
                    setErrors((prev) => ({ ...prev, scheduledAt: error }));
                  }
                }}
                disabled={isFormDisabled}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {errors.scheduledAt && (
                <p className="mt-1 text-sm text-error-600 dark:text-error-400" role="alert">
                  {errors.scheduledAt}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Leave empty to save as draft. Set a future date/time to schedule automatic publication. Time is in your local timezone.
              </p>
            </div>

            {/* Content Textarea */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="content-textarea" className="block text-sm font-medium text-foreground">
                  Content *
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  disabled={isFormDisabled}
                  aria-label={showPreview ? 'Hide markdown preview' : 'Show markdown preview'}
                  aria-pressed={showPreview}
                >
                  {showPreview ? (
                    <>
                      <EyeOff className="w-4 h-4 mr-2" />
                      <span className="hidden sm:inline">Hide Preview</span>
                      <span className="sm:hidden">Hide</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 mr-2" />
                      <span className="hidden sm:inline">Show Preview</span>
                      <span className="sm:hidden">Preview</span>
                    </>
                  )}
                </Button>
              </div>

              {showPreview ? (
                <div className="rounded-lg border border-border bg-background p-4 sm:p-6 min-h-[300px] max-h-[600px] overflow-y-auto">
                  {formData.content ? (
                    <MarkdownPreview content={formData.content} />
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      No content to preview
                    </p>
                  )}
                </div>
              ) : (
                <TextArea
                  id="content-textarea"
                  placeholder="Write your newsletter content in markdown..."
                  value={formData.content}
                  onChange={(e) => handleInputChange('content', e.target.value)}
                  onBlur={() => {
                    const error = validateField('content', formData.content);
                    if (error) {
                      setErrors((prev) => ({ ...prev, content: error }));
                    }
                  }}
                  error={errors.content}
                  rows={15}
                  disabled={isFormDisabled}
                />
              )}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
              aria-label="Cancel and return to issues"
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isFormDisabled || isSubmitting || !isDirty}
              isLoading={isSubmitting}
              aria-label={isEditMode ? 'Update issue' : 'Create new issue'}
              className="w-full sm:w-auto"
            >
              {isSubmitting ? 'Saving...' : isEditMode ? 'Update Issue' : 'Create Issue'}
            </Button>
          </div>
        </form>
      </div>

      {/* Unsaved Changes Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={confirmCancel}
        title="Discard Changes?"
        description="You have unsaved changes. Are you sure you want to leave this page?"
        confirmText="Discard Changes"
        cancelText="Keep Editing"
        type="warning"
        consequences={['All unsaved changes will be lost']}
      />
    </div>
  );
};
