import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { useToast } from '@/components/ui/Toast';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { LoadingSpinner } from '@/components/ui/LoadingStates';
import { templateService } from '@/services/templateService';
import { snippetService } from '@/services/snippetService';
import { useDebounce } from '@/hooks/useDebounce';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';
import type { CreateTemplateRequest, SnippetSummary } from '@/types/api';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { CodeEditor, type CodeEditorHandle } from './builder/CodeEditor';
import { PreviewPane } from './builder/PreviewPane';
import { SnippetBrowser } from './builder/SnippetBrowser';
import { collectFieldPaths } from './builder/autocomplete';

const PREVIEW_DEBOUNCE_MS = 400;

/** Parse the sample-data JSON textarea, returning the object or an error. */
function parseSampleData(text: string): {
  data?: Record<string, unknown>;
  error?: string;
} {
  if (!text.trim()) {
    return { data: undefined };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'Sample data must be a JSON object' };
    }
    return { data: parsed as Record<string, unknown> };
  } catch {
    return { error: 'Sample data is not valid JSON' };
  }
}

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

  // Builder state.
  const [snippets, setSnippets] = useState<SnippetSummary[]>([]);
  const [snippetsLoading, setSnippetsLoading] = useState(true);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const editorRef = useRef<CodeEditorHandle>(null);

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

  // Load snippets once; degrade gracefully if the endpoint is unavailable.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await snippetService.listSnippets();
      if (!cancelled) {
        setSnippets(response.success ? (response.data?.snippets ?? []) : []);
        setSnippetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Parsed sample data (memoized) drives both autocomplete and the preview.
  const sampleData = useMemo(() => parseSampleData(sampleDataText), [sampleDataText]);
  const fieldPaths = useMemo(
    () => (sampleData.data ? collectFieldPaths(sampleData.data) : []),
    [sampleData.data],
  );
  const snippetSuggestions = useMemo(
    () => snippets.map((s) => ({ name: s.name, description: s.description })),
    [snippets],
  );

  const debouncedContent = useDebounce(content, PREVIEW_DEBOUNCE_MS);
  const debouncedSampleText = useDebounce(sampleDataText, PREVIEW_DEBOUNCE_MS);

  // Live, server-side preview. Re-renders on debounced content / sample changes.
  useEffect(() => {
    if (!debouncedContent.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewHtml('');
      setPreviewError(null);
      return;
    }

    const parsed = parseSampleData(debouncedSampleText);
    if (parsed.error) {
      setPreviewError(parsed.error);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    templateService
      .previewTemplate({ content: debouncedContent, sampleData: parsed.data })
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (response.success && response.data) {
          setPreviewHtml(response.data.html);
          setPreviewError(null);
        } else {
          setPreviewError(response.error ?? 'Failed to render preview');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedContent, debouncedSampleText]);

  const handleInsertSnippet = useCallback((snippetName: string) => {
    editorRef.current?.insertAtCursor(`{{> ${snippetName} }}`);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);

    const parsed = parseSampleData(sampleDataText);
    if (parsed.error) {
      setFieldError(parsed.error);
      return;
    }

    const payload: CreateTemplateRequest = {
      name,
      content,
      ...(category.trim() && { category }),
      ...(description.trim() && { description }),
      ...(parsed.data && { sampleData: parsed.data }),
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
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                  placeholder="A short description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                />
              </div>

              {/* Builder: editor + sample data on the left, live preview on the right. */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <CodeEditor
                    ref={editorRef}
                    id="template-content"
                    label="Content (Handlebars)"
                    value={content}
                    onChange={setContent}
                    fieldPaths={fieldPaths}
                    snippets={snippetSuggestions}
                    error={previewError}
                    rows={18}
                  />
                  <p className="text-xs text-muted-foreground">
                    Reference data with <code className="font-mono">{'{{ field }}'}</code> and
                    snippets with <code className="font-mono">{'{{> name }}'}</code>. Suggestions
                    appear as you type inside a mustache.
                  </p>

                  <SnippetBrowser
                    snippets={snippets}
                    isLoading={snippetsLoading}
                    onInsert={handleInsertSnippet}
                  />

                  <TextArea
                    label="Sample data (JSON)"
                    placeholder={'{\n  "title": "Hello world"\n}'}
                    value={sampleDataText}
                    onChange={(e) => setSampleDataText(e.target.value)}
                    rows={8}
                    className="font-mono text-sm"
                    error={sampleData.error}
                    helperText="Data merged into the preview. Keys power field autocomplete."
                  />
                </div>

                <div className="lg:sticky lg:top-6 lg:self-start">
                  <PreviewPane
                    html={previewHtml}
                    isLoading={previewLoading}
                    error={previewError}
                  />
                </div>
              </div>

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
