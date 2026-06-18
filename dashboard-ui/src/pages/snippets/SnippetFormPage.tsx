import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { LoadingSpinner } from '@/components/ui/LoadingStates';
import { snippetService } from '@/services/snippetService';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';
import type { CreateSnippetRequest, SnippetParameter, SnippetParameterType } from '@/types/api';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

const PARAMETER_TYPES: SnippetParameterType[] = [
  'string',
  'number',
  'boolean',
  'select',
  'textarea',
  'url',
];

const PARAMETER_TYPE_OPTIONS = PARAMETER_TYPES.map((type) => ({ value: type, label: type }));

/** Local editor row state. `optionsText` is the raw textarea value for select options. */
interface ParameterRow {
  name: string;
  type: SnippetParameterType;
  required: boolean;
  defaultValue: string;
  description: string;
  optionsText: string;
}

function emptyRow(): ParameterRow {
  return { name: '', type: 'string', required: false, defaultValue: '', description: '', optionsText: '' };
}

function toRow(parameter: SnippetParameter): ParameterRow {
  return {
    name: parameter.name,
    type: parameter.type,
    required: parameter.required,
    defaultValue:
      parameter.defaultValue === undefined || parameter.defaultValue === null
        ? ''
        : String(parameter.defaultValue),
    description: parameter.description ?? '',
    optionsText: (parameter.options ?? []).join('\n'),
  };
}

function toParameter(row: ParameterRow): SnippetParameter {
  const parameter: SnippetParameter = {
    name: row.name.trim(),
    type: row.type,
    required: row.required,
  };
  if (row.defaultValue.trim()) {
    parameter.defaultValue = row.defaultValue.trim();
  }
  if (row.description.trim()) {
    parameter.description = row.description.trim();
  }
  if (row.type === 'select') {
    parameter.options = row.optionsText
      .split('\n')
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
  }
  return parameter;
}

export function SnippetFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const { addToast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [parameters, setParameters] = useState<ParameterRow[]>([]);

  const [isLoading, setIsLoading] = useState(isEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const loadSnippet = useCallback(async (snippetId: string) => {
    setIsLoading(true);
    setLoadError(null);
    const response = await snippetService.getSnippet(snippetId);
    if (response.success && response.data) {
      const s = response.data;
      setName(s.name);
      setDescription(s.description ?? '');
      setContent(s.content);
      setParameters((s.parameters ?? []).map(toRow));
    } else {
      setLoadError(getUserFriendlyErrorMessage(response, 'snippet'));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadSnippet(id);
    }
  }, [id, loadSnippet]);

  const addParameter = () => setParameters((prev) => [...prev, emptyRow()]);
  const removeParameter = (index: number) =>
    setParameters((prev) => prev.filter((_, i) => i !== index));
  const updateParameter = (index: number, changes: Partial<ParameterRow>) =>
    setParameters((prev) => prev.map((row, i) => (i === index ? { ...row, ...changes } : row)));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);

    // Build and validate parameters client-side before submitting.
    const builtParameters: SnippetParameter[] = [];
    for (const row of parameters) {
      if (!row.name.trim()) {
        setFieldError('Each parameter must have a name');
        return;
      }
      const parameter = toParameter(row);
      if (parameter.type === 'select' && (!parameter.options || parameter.options.length === 0)) {
        setFieldError(`Parameter "${parameter.name}" of type select must include at least one option`);
        return;
      }
      builtParameters.push(parameter);
    }

    const payload: CreateSnippetRequest = {
      name,
      content,
      ...(description.trim() && { description }),
      ...(builtParameters.length > 0 && { parameters: builtParameters }),
    };

    setIsSaving(true);
    const response = isEditMode && id
      ? await snippetService.updateSnippet(id, payload)
      : await snippetService.createSnippet(payload);
    setIsSaving(false);

    if (response.success) {
      addToast({
        type: 'success',
        title: isEditMode ? 'Snippet updated' : 'Snippet created',
        message: `${name.trim()} was saved successfully`,
      });
      navigate('/snippets');
    } else {
      setFieldError(getUserFriendlyErrorMessage(response, 'snippet'));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <button
            type="button"
            onClick={() => navigate('/snippets')}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Back to snippets
          </button>

          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
            {isEditMode ? 'Edit snippet' : 'New snippet'}
          </h1>

          {isLoading ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <LoadingSpinner size="sm" />
              <span>Loading snippet…</span>
            </div>
          ) : loadError ? (
            <ErrorDisplay
              title="Error loading snippet"
              message={loadError}
              severity="error"
              retryable
              onRetry={() => id && loadSnippet(id)}
            />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                label="Name"
                placeholder="sponsorBlock"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                helperText="Referenced in templates as {{> name }}. Letters, numbers, underscores, and hyphens only (no spaces)."
                required
              />

              <Input
                label="Description (optional)"
                placeholder="A short description of what this snippet is for"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />

              <TextArea
                label="Content (Handlebars)"
                placeholder={'<div class="sponsor">\n  <h2>{{ title }}</h2>\n</div>'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={16}
                className="font-mono text-sm"
                helperText="Handlebars markup. Reference other snippets with {{> otherSnippet }}."
                required
              />

              {/* Parameters editor */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">Parameters (optional)</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Declare the inputs this snippet expects.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addParameter}>
                    <PlusIcon className="w-4 h-4 mr-1" />
                    Add parameter
                  </Button>
                </div>

                {parameters.length === 0 ? (
                  <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">
                    No parameters yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {parameters.map((row, index) => (
                      <div key={index} className="border border-border rounded-lg p-4 space-y-3 bg-surface">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-sm font-medium text-muted-foreground">Parameter {index + 1}</h3>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeParameter(index)}
                            className="text-error-600 hover:text-error-700 hover:bg-error-50"
                            title="Remove parameter"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label="Name"
                            placeholder="title"
                            value={row.name}
                            onChange={(e) => updateParameter(index, { name: e.target.value })}
                            maxLength={100}
                          />
                          <Select
                            label="Type"
                            value={row.type}
                            options={PARAMETER_TYPE_OPTIONS}
                            onChange={(e) =>
                              updateParameter(index, { type: e.target.value as SnippetParameterType })
                            }
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label="Default value (optional)"
                            placeholder="Default"
                            value={row.defaultValue}
                            onChange={(e) => updateParameter(index, { defaultValue: e.target.value })}
                          />
                          <Input
                            label="Description (optional)"
                            placeholder="What this parameter controls"
                            value={row.description}
                            onChange={(e) => updateParameter(index, { description: e.target.value })}
                            maxLength={500}
                          />
                        </div>

                        {row.type === 'select' && (
                          <TextArea
                            label="Options (one per line)"
                            placeholder={'formal\ncasual'}
                            value={row.optionsText}
                            onChange={(e) => updateParameter(index, { optionsText: e.target.value })}
                            rows={3}
                            helperText="Required for select parameters. Enter one option per line."
                          />
                        )}

                        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={row.required}
                            onChange={(e) => updateParameter(index, { required: e.target.checked })}
                            className="rounded border-border text-primary-600 focus:ring-ring"
                          />
                          Required
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {fieldError && (
                <ErrorDisplay title="Could not save snippet" message={fieldError} severity="error" compact />
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => navigate('/snippets')} disabled={isSaving}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isSaving} disabled={isSaving}>
                  {isEditMode ? 'Save changes' : 'Create snippet'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
