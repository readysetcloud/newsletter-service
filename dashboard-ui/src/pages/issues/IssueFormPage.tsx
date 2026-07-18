import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, FileText, FileJson } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { MarkdownPreview } from '@/components/issues/MarkdownPreview';
import {
  MarkdownWysiwygEditor,
  type MarkdownWysiwygEditorHandle,
} from '@/components/issues/MarkdownWysiwygEditor';
import { SnippetShortcodeInserter } from '@/components/issues/SnippetShortcodeInserter';
import { TemplateJsonEditor } from '@/components/issues/TemplateJsonEditor';
import {
  AbTestConfig,
  validateAbTest,
  hasAbTestErrors,
  type AbTestErrors,
} from '@/components/issues/AbTestConfig';
import { issuesService } from '@/services/issuesService';
import { templateService } from '@/services/templateService';
import { timezoneOptions } from '@/schemas/profileSchema';
import type { Issue, CreateIssueRequest, UpdateIssueRequest, IssueContentType, AbTest } from '@/types/issues';
import type { TemplateSummary } from '@/types/api';

// Sentinel value used for the "Default template" option (no templateId persisted).
const DEFAULT_TEMPLATE_VALUE = '';

interface FormData {
  subject: string;
  content: string;
  issueNumber?: string;
  scheduledAt?: string;
  templateId?: string;
  contentType: IssueContentType;
}

interface FormErrors {
  subject?: string;
  content?: string;
  issueNumber?: string;
  scheduledAt?: string;
  templateId?: string;
}

/**
 * Validates issue content for the given authoring mode. Markdown only needs to
 * be non-empty; JSON must additionally parse to an object so the publish
 * pipeline can render it against the selected template.
 */
const validateContent = (value: string, contentType: IssueContentType): string | undefined => {
  if (!value.trim()) {
    return contentType === 'json' ? 'Template data is required' : 'Content is required';
  }
  if (contentType === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return 'Template data must be valid JSON';
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'Template data must be a JSON object';
    }
  }
  return undefined;
};

/**
 * Builds the API-ready A/B test payload from the form's working state:
 * converts variant send times from datetime-local to ISO and strips
 * server-managed fields (testId/status/winner/evaluation).
 */
const buildAbTestRequest = (abTest: AbTest): AbTest => ({
  dimension: abTest.dimension,
  variants: abTest.variants.map((v) => ({
    variantId: v.variantId,
    ...(abTest.dimension === 'subject'
      ? { subject: v.subject }
      : { sendAt: v.sendAt ? new Date(v.sendAt).toISOString() : v.sendAt }),
  })),
  winMetric: abTest.winMetric,
  confidence: abTest.confidence,
  testFraction: abTest.testFraction,
  evaluateAfterMinutes: abTest.evaluateAfterMinutes,
  ...(abTest.minSamplePerVariant !== undefined
    ? { minSamplePerVariant: abTest.minSamplePerVariant }
    : {}),
});

export const IssueFormPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isEditMode = !!id;

  const [formData, setFormData] = useState<FormData>({
    subject: '',
    content: '',
    issueNumber: '',
    scheduledAt: '',
    templateId: DEFAULT_TEMPLATE_VALUE,
    contentType: 'markdown',
  });

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  const [abTest, setAbTest] = useState<AbTest | null>(null);
  const [abTestErrors, setAbTestErrors] = useState<AbTestErrors>({});

  const [localSendEnabled, setLocalSendEnabled] = useState(false);
  const [localSendMode, setLocalSendMode] = useState<'timezone' | 'peak-hour'>('timezone');
  const [localSendTimeZone, setLocalSendTimeZone] = useState(() => {
    // Default to the author's browser timezone when it's one of the options.
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezoneOptions.some((option) => option.value === browserZone)
      ? browserZone
      : 'America/New_York';
  });
  // Interest-aware assembly: personalized section order (contentAssembly).
  const [personalizedOrder, setPersonalizedOrder] = useState(false);

  const [errors, setErrors] = useState<FormErrors>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const editorRef = useRef<MarkdownWysiwygEditorHandle>(null);
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
          subject: issue.subject,
          content: issue.content,
          issueNumber: issue.issueNumber ? String(issue.issueNumber) : '',
          scheduledAt: issue.scheduledAt ? toDatetimeLocal(issue.scheduledAt) : '',
          templateId: issue.templateId ?? DEFAULT_TEMPLATE_VALUE,
          contentType: issue.contentType === 'json' ? 'json' : 'markdown',
        });

        // Hydrate A/B test config, converting send times to datetime-local.
        if (issue.abTest) {
          setAbTest({
            ...issue.abTest,
            variants: issue.abTest.variants.map((v) => ({
              ...v,
              sendAt: v.sendAt ? toDatetimeLocal(v.sendAt) : v.sendAt,
            })),
          });
        } else {
          setAbTest(null);
        }

        // Hydrate local-send config.
        if (issue.localSend?.enabled) {
          setLocalSendEnabled(true);
          if (issue.localSend.defaultTimeZone) {
            setLocalSendTimeZone(issue.localSend.defaultTimeZone);
          }
          setLocalSendMode(issue.localSend.mode === 'peak-hour' ? 'peak-hour' : 'timezone');
        } else {
          setLocalSendEnabled(false);
        }
        // Hydrate the personalized section order flag.
        setPersonalizedOrder(issue.contentAssembly?.enabled === true);

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

  // Load available templates for the template picker
  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      try {
        const response = await templateService.listTemplates();
        if (!cancelled && response.success && response.data) {
          setTemplates(response.data.templates);
        }
      } catch (error) {
        // Non-fatal: the picker simply falls back to the default template.
        console.error('Failed to load templates:', error);
      }
    };
    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

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

    // Clear error for this field (only validated fields have error entries)
    if (field in errors && errors[field as keyof FormErrors]) {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    }
  }, [errors]);

  // Handle A/B test config changes
  const handleAbTestChange = useCallback((next: AbTest | null) => {
    setAbTest(next);
    setIsDirty(true);
    setAbTestErrors({});
  }, []);

  // Validate single field
  const validateField = useCallback((field: keyof FormData, value: string): string | undefined => {
    switch (field) {
      case 'subject':
        if (!value.trim()) {
          return 'Subject is required';
        }
        if (value.length > 200) {
          return 'Subject must be 200 characters or less';
        }
        break;

      case 'issueNumber':
        if (value && value.trim()) {
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 1) {
            return 'Issue number must be a positive whole number';
          }
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

    newErrors.subject = validateField('subject', formData.subject);
    newErrors.content = validateContent(formData.content, formData.contentType);
    newErrors.issueNumber = validateField('issueNumber', formData.issueNumber || '');
    newErrors.scheduledAt = validateField('scheduledAt', formData.scheduledAt || '');

    // JSON mode renders against a template, so a template selection is required.
    if (formData.contentType === 'json' && !formData.templateId) {
      newErrors.templateId = 'Select a template to render the JSON data';
    }

    setErrors(newErrors);

    // Validate A/B test config when enabled.
    const abErrors = validateAbTest(abTest);
    setAbTestErrors(abErrors);

    return (
      !newErrors.subject &&
      !newErrors.content &&
      !newErrors.issueNumber &&
      !newErrors.scheduledAt &&
      !newErrors.templateId &&
      !hasAbTestErrors(abErrors)
    );
  }, [formData, validateField, abTest]);

  // Switch authoring mode (markdown <-> json), clearing content-specific errors.
  const handleModeChange = useCallback((mode: IssueContentType) => {
    setFormData((prev) => (prev.contentType === mode ? prev : { ...prev, contentType: mode }));
    setShowPreview(false);
    setErrors((prev) => ({ ...prev, content: undefined, templateId: undefined }));
    setIsDirty(true);
  }, []);

  // Load the selected template's stored sample data into the JSON editor.
  const handleLoadSampleData = useCallback(async () => {
    if (!formData.templateId) {
      return;
    }
    setIsLoadingSample(true);
    try {
      const response = await templateService.getTemplate(formData.templateId);
      if (response.success && response.data) {
        const sample = response.data.sampleData ?? {};
        setFormData((prev) => ({ ...prev, content: JSON.stringify(sample, null, 2) }));
        setErrors((prev) => ({ ...prev, content: undefined }));
        setIsDirty(true);
      } else {
        addToast({
          type: 'error',
          title: 'Could Not Load Sample Data',
          message: response.error || 'Failed to load template sample data.',
        });
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Could Not Load Sample Data',
        message: error instanceof Error ? error.message : 'Failed to load template sample data.',
      });
    } finally {
      setIsLoadingSample(false);
    }
  }, [formData.templateId, addToast]);

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
          subject: formData.subject,
          content: formData.content,
          contentType: formData.contentType,
        };

        if (formData.scheduledAt) {
          updateData.scheduledAt = new Date(formData.scheduledAt).toISOString();
        }

        // Always send templateId so selecting "Default template" (empty value)
        // clears a previously-saved template instead of leaving it in place.
        updateData.templateId = formData.templateId ?? DEFAULT_TEMPLATE_VALUE;

        if (abTest) {
          updateData.abTest = buildAbTestRequest(abTest);
        } else if (existingIssue?.abTest) {
          // The test was turned off after being saved — send an explicit null so
          // the API clears the stored config (omitting it leaves it in place).
          updateData.abTest = null;
        }

        if (localSendEnabled && !abTest) {
          updateData.localSend = { enabled: true, defaultTimeZone: localSendTimeZone, mode: localSendMode };
        } else if (existingIssue?.localSend?.enabled) {
          // Turned off (or superseded by an A/B test) after being saved —
          // explicit null clears the stored config.
          updateData.localSend = null;
        }

        if (personalizedOrder && !abTest) {
          updateData.contentAssembly = { enabled: true };
        } else if (existingIssue?.contentAssembly?.enabled) {
          // Turned off after being saved — an explicit null clears the stored
          // config (omitting it leaves it in place).
          updateData.contentAssembly = null;
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
          subject: formData.subject,
          content: formData.content,
          contentType: formData.contentType,
        };

        if (formData.issueNumber && formData.issueNumber.trim()) {
          createData.issueNumber = Number(formData.issueNumber);
        }

        if (formData.scheduledAt) {
          createData.scheduledAt = new Date(formData.scheduledAt).toISOString();
        }

        if (formData.templateId) {
          createData.templateId = formData.templateId;
        }

        if (abTest) {
          createData.abTest = buildAbTestRequest(abTest);
        }

        if (localSendEnabled && !abTest) {
          createData.localSend = { enabled: true, defaultTimeZone: localSendTimeZone, mode: localSendMode };
        }

        if (personalizedOrder && !abTest) {
          createData.contentAssembly = { enabled: true };
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
  }, [validateForm, isEditMode, id, formData, abTest, localSendEnabled, localSendTimeZone, localSendMode, personalizedOrder, existingIssue, navigate, addToast]);

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
            {/* Subject Input Skeleton */}
            <div className="space-y-2">
              <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              <div className="h-10 w-full bg-muted rounded animate-pulse" />
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
            {/* Subject Input */}
            <Input
              label="Subject *"
              placeholder="Enter issue subject"
              value={formData.subject}
              onChange={(e) => handleInputChange('subject', e.target.value)}
              onBlur={() => {
                const error = validateField('subject', formData.subject);
                if (error) {
                  setErrors((prev) => ({ ...prev, subject: error }));
                }
              }}
              error={errors.subject}
              disabled={isFormDisabled}
              maxLength={200}
            />

            {!isEditMode && (
              <Input
                label="Issue Number (Optional)"
                placeholder="Leave blank to auto-assign"
                type="number"
                min={1}
                step={1}
                value={formData.issueNumber || ''}
                onChange={(e) => handleInputChange('issueNumber', e.target.value)}
                onBlur={() => {
                  const error = validateField('issueNumber', formData.issueNumber || '');
                  if (error) {
                    setErrors((prev) => ({ ...prev, issueNumber: error }));
                  }
                }}
                error={errors.issueNumber}
                disabled={isFormDisabled}
                helperText="Use this only if you need a specific issue number. Otherwise leave blank."
              />
            )}

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

            {/* Local Send */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="localSendEnabled"
                  checked={localSendEnabled}
                  onChange={(e) => {
                    setLocalSendEnabled(e.target.checked);
                    setIsDirty(true);
                  }}
                  disabled={isFormDisabled || !!abTest}
                  className="mt-1 h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                />
                <div>
                  <label
                    htmlFor="localSendEnabled"
                    className="block text-sm font-medium text-foreground cursor-pointer"
                  >
                    Local send
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Deliver at the send time in each subscriber&rsquo;s local timezone. Subscribers whose
                    timezone hasn&rsquo;t been detected yet receive the issue at the default timezone&rsquo;s time.
                  </p>
                </div>
              </div>

              {localSendEnabled && (
                <fieldset className="pl-7">
                  <legend className="block text-sm font-medium text-foreground mb-1">
                    Delivery time
                  </legend>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="localSendMode"
                        value="timezone"
                        checked={localSendMode === 'timezone'}
                        onChange={() => {
                          setLocalSendMode('timezone');
                          setIsDirty(true);
                        }}
                        disabled={isFormDisabled}
                        className="mt-0.5 h-4 w-4 border-border text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                      />
                      <span className="text-sm text-foreground">
                        At the scheduled time in their timezone
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="localSendMode"
                        value="peak-hour"
                        checked={localSendMode === 'peak-hour'}
                        onChange={() => {
                          setLocalSendMode('peak-hour');
                          setIsDirty(true);
                        }}
                        disabled={isFormDisabled}
                        className="mt-0.5 h-4 w-4 border-border text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                      />
                      <span className="text-sm text-foreground">
                        At each subscriber&rsquo;s personal best hour (falls back to the default time
                        until we&rsquo;ve seen enough opens)
                      </span>
                    </label>
                  </div>
                </fieldset>
              )}

              {localSendEnabled && (
                <div className="pl-7">
                  <label htmlFor="localSendTimeZone" className="block text-sm font-medium text-foreground mb-1">
                    Default timezone
                  </label>
                  <select
                    id="localSendTimeZone"
                    value={localSendTimeZone}
                    onChange={(e) => {
                      setLocalSendTimeZone(e.target.value);
                      setIsDirty(true);
                    }}
                    disabled={isFormDisabled}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {timezoneOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The scheduled time is read as a wall-clock time in this timezone.
                  </p>
                </div>
              )}

              {!!abTest && (
                <p className="pl-7 text-xs text-muted-foreground" role="note">
                  Local send is unavailable while an A/B test is configured — both control send timing.
                </p>
              )}
            </div>

            {/* Authoring Mode Toggle */}
            <div>
              <span className="block text-sm font-medium text-foreground mb-2">Authoring Mode</span>
              <div
                role="radiogroup"
                aria-label="Authoring mode"
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={formData.contentType === 'markdown'}
                  onClick={() => handleModeChange('markdown')}
                  disabled={isFormDisabled}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                    formData.contentType === 'markdown'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-border bg-background hover:border-primary-300'
                  }`}
                >
                  <FileText className="w-5 h-5 mt-0.5 text-primary-600 dark:text-primary-400 shrink-0" />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Markdown editor</span>
                    <span className="block text-xs text-muted-foreground">
                      Write content visually; it&rsquo;s converted to HTML on publish.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={formData.contentType === 'json'}
                  onClick={() => handleModeChange('json')}
                  disabled={isFormDisabled}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                    formData.contentType === 'json'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-border bg-background hover:border-primary-300'
                  }`}
                >
                  <FileJson className="w-5 h-5 mt-0.5 text-primary-600 dark:text-primary-400 shrink-0" />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Template + JSON</span>
                    <span className="block text-xs text-muted-foreground">
                      Pick a template and provide the JSON data to render it.
                    </span>
                  </span>
                </button>
              </div>
            </div>

            {/* Personalized Section Order (interest-aware assembly) */}
            <div className="rounded-lg border border-border p-3 sm:p-4">
              <label htmlFor="personalized-order" className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  id="personalized-order"
                  checked={personalizedOrder}
                  onChange={(e) => {
                    setPersonalizedOrder(e.target.checked);
                    setIsDirty(true);
                  }}
                  disabled={isFormDisabled}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary-600 focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-describedby="personalized-order-description"
                />
                <span className="block text-sm font-medium text-foreground">
                  Personalized section order
                  <span
                    id="personalized-order-description"
                    className="block text-xs font-normal text-muted-foreground"
                  >
                    Readers see the sections matching their interests first. Requires
                    topic-classified links; readers without interest data get the original order.
                  </span>
                </span>
              </label>
            </div>

            {/* Template Picker */}
            <div>
              <label htmlFor="templateId" className="block text-sm font-medium text-foreground mb-2">
                {formData.contentType === 'json' ? 'Template *' : 'Template (Optional)'}
              </label>
              <select
                id="templateId"
                value={formData.templateId ?? DEFAULT_TEMPLATE_VALUE}
                onChange={(e) => handleInputChange('templateId', e.target.value)}
                disabled={isFormDisabled}
                aria-invalid={!!errors.templateId}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value={DEFAULT_TEMPLATE_VALUE}>
                  {formData.contentType === 'json' ? 'Select a template…' : 'Default template'}
                </option>
                {templates.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.name}
                  </option>
                ))}
              </select>
              {errors.templateId && (
                <p className="mt-1 text-sm text-error-600 dark:text-error-400" role="alert">
                  {errors.templateId}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {formData.contentType === 'json'
                  ? 'JSON mode renders your data against the selected template.'
                  : 'Choose a template to render this issue. Leave as “Default template” to use the built-in newsletter layout.'}
              </p>
            </div>

            {/* Content Editor */}
            {formData.contentType === 'json' ? (
              <TemplateJsonEditor
                value={formData.content}
                onChange={(value) => handleInputChange('content', value)}
                onBlur={() => {
                  const error = validateContent(formData.content, 'json');
                  if (error) {
                    setErrors((prev) => ({ ...prev, content: error }));
                  }
                }}
                error={errors.content}
                disabled={isFormDisabled}
                onLoadSampleData={handleLoadSampleData}
                isLoadingSample={isLoadingSample}
                hasTemplate={!!formData.templateId}
              />
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="content-editor" className="block text-sm font-medium text-foreground">
                    Content *
                  </label>
                  <div className="flex items-center gap-1">
                    {!showPreview && (
                      <SnippetShortcodeInserter
                        onInsert={(text) => editorRef.current?.insert(text)}
                        disabled={isFormDisabled}
                      />
                    )}
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
                  <MarkdownWysiwygEditor
                    ref={editorRef}
                    id="content-editor"
                    placeholder="Write your newsletter content…"
                    value={formData.content}
                    onChange={(value) => handleInputChange('content', value)}
                    onBlur={() => {
                      const error = validateContent(formData.content, 'markdown');
                      if (error) {
                        setErrors((prev) => ({ ...prev, content: error }));
                      }
                    }}
                    disabled={isFormDisabled}
                  />
                )}
                {errors.content && (
                  <p className="mt-1 text-sm text-error-600 dark:text-error-400" role="alert">
                    {errors.content}
                  </p>
                )}
              </div>
            )}

            {/* A/B Test Configuration */}
            {!isFormDisabled && (
              <AbTestConfig
                value={abTest}
                onChange={handleAbTestChange}
                disabled={isFormDisabled}
                errors={abTestErrors}
                scheduledAtLocal={formData.scheduledAt}
              />
            )}
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
