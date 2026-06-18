import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { useToast } from '@/components/ui/Toast';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { LoadingSpinner } from '@/components/ui/LoadingStates';
import { templateService } from '@/services/templateService';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';
import type { CreateTemplateRequest } from '@/types/api';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

export function TemplateFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const { addToast } = useToast();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [sampleDataText, setSampleDataText] = useState('');

  const [isLoading, setIsLoading] = useState(isEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const loadTemplate = useCallback(async (templateId: string) => {
    setIsLoading(true);
    setLoadError(null);
    const response = await templateService.getTemplate(templateId);
    if (response.success && response.data) {
      const t = response.data;
      setName(t.name);
      setCategory(t.category ?? '');
      setDescription(t.description ?? '');
      setContent(t.content);
      setSampleDataText(t.sampleData ? JSON.stringify(t.sampleData, null, 2) : '');
    } else {
      setLoadError(getUserFriendlyErrorMessage(response, 'template'));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadTemplate(id);
    }
  }, [id, loadTemplate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);

    // Validate sample data is JSON if provided.
    let sampleData: Record<string, unknown> | undefined;
    if (sampleDataText.trim()) {
      try {
        const parsed = JSON.parse(sampleDataText);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setFieldError('Sample data must be a JSON object');
          return;
        }
        sampleData = parsed as Record<string, unknown>;
      } catch {
        setFieldError('Sample data is not valid JSON');
        return;
      }
    }

    const payload: CreateTemplateRequest = {
      name,
      content,
      ...(category.trim() && { category }),
      ...(description.trim() && { description }),
      ...(sampleData && { sampleData }),
    };

    setIsSaving(true);
    const response = isEditMode && id
      ? await templateService.updateTemplate(id, payload)
      : await templateService.createTemplate(payload);
    setIsSaving(false);

    if (response.success) {
      addToast({
        type: 'success',
        title: isEditMode ? 'Template updated' : 'Template created',
        message: `${name.trim()} was saved successfully`,
      });
      navigate('/templates');
    } else {
      setFieldError(getUserFriendlyErrorMessage(response, 'template'));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <button
            type="button"
            onClick={() => navigate('/templates')}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Back to templates
          </button>

          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
            {isEditMode ? 'Edit template' : 'New template'}
          </h1>

          {isLoading ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <LoadingSpinner size="sm" />
              <span>Loading template…</span>
            </div>
          ) : loadError ? (
            <ErrorDisplay
              title="Error loading template"
              message={loadError}
              severity="error"
              retryable
              onRetry={() => id && loadTemplate(id)}
            />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                label="Name"
                placeholder="Weekly newsletter"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
              />

              <Input
                label="Category (optional)"
                placeholder="newsletter"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={50}
              />

              <Input
                label="Description (optional)"
                placeholder="A short description of what this template is for"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />

              <TextArea
                label="Content (Handlebars)"
                placeholder={'<h1>{{ title }}</h1>\n{{> sponsorBlock }}'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={16}
                className="font-mono text-sm"
                helperText="Handlebars markup. Reference macros (partials) with {{> macroName }}."
                required
              />

              <TextArea
                label="Sample data (optional JSON)"
                placeholder={'{\n  "title": "Hello world"\n}'}
                value={sampleDataText}
                onChange={(e) => setSampleDataText(e.target.value)}
                rows={6}
                className="font-mono text-sm"
                helperText="Default data used to preview this template in the upcoming builder."
              />

              {fieldError && (
                <ErrorDisplay title="Could not save template" message={fieldError} severity="error" compact />
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => navigate('/templates')} disabled={isSaving}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isSaving} disabled={isSaving}>
                  {isEditMode ? 'Save changes' : 'Create template'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
