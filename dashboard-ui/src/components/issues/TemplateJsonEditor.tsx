import React, { useMemo } from 'react';
import { Braces, Check, AlertCircle } from 'lucide-react';
import { TextArea } from '../ui/TextArea';
import { Button } from '../ui/Button';

export interface TemplateJsonEditorProps {
  /** Current JSON content as a string. */
  value: string;
  /** Called with the updated JSON string. */
  onChange: (value: string) => void;
  /** Called when the editor loses focus. */
  onBlur?: () => void;
  /** Validation error to display (e.g. from form-level validation). */
  error?: string;
  /** Disables editing. */
  disabled?: boolean;
  /** id applied to the textarea for label association. */
  id?: string;
  /** Loads the selected template's sample data into the editor. */
  onLoadSampleData?: () => void;
  /** Whether sample data is currently being loaded. */
  isLoadingSample?: boolean;
  /** Whether a template is selected (enables the "load sample data" action). */
  hasTemplate?: boolean;
}

/**
 * Editor for "json" mode issues: the author supplies the data object that is
 * rendered against the selected template on publish. Provides live JSON
 * validity feedback plus helpers to format the JSON and seed it from the
 * template's stored sample data.
 */
export const TemplateJsonEditor: React.FC<TemplateJsonEditorProps> = ({
  value,
  onChange,
  onBlur,
  error,
  disabled = false,
  id = 'template-json',
  onLoadSampleData,
  isLoadingSample = false,
  hasTemplate = false,
}) => {
  // Live validity check so authors get feedback without leaving the field.
  const validity = useMemo<{ valid: boolean; message?: string }>(() => {
    if (!value.trim()) {
      return { valid: false, message: 'JSON is required' };
    }
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { valid: false, message: 'JSON must be an object' };
      }
      return { valid: true };
    } catch (err) {
      return { valid: false, message: err instanceof Error ? err.message : 'Invalid JSON' };
    }
  }, [value]);

  const handleFormat = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      // Ignore formatting requests for invalid JSON; the validity hint already
      // tells the author what's wrong.
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <label htmlFor={id} className="block text-sm font-medium text-foreground">
          Template Data (JSON) *
        </label>
        <div className="flex items-center gap-2">
          {onLoadSampleData && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onLoadSampleData}
              disabled={disabled || !hasTemplate || isLoadingSample}
              isLoading={isLoadingSample}
              aria-label="Load sample data from the selected template"
            >
              {isLoadingSample ? 'Loading…' : 'Load sample data'}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleFormat}
            disabled={disabled || !validity.valid}
            aria-label="Format JSON"
          >
            <Braces className="w-4 h-4 mr-2" />
            Format
          </Button>
        </div>
      </div>

      <TextArea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        error={error}
        disabled={disabled}
        rows={16}
        spellCheck={false}
        className="font-mono text-sm"
        placeholder={'{\n  "metadata": {\n    "title": "My newsletter"\n  }\n}'}
      />

      {!error && (
        <p
          className={`mt-1 flex items-center gap-1.5 text-xs ${
            validity.valid ? 'text-success-600 dark:text-success-400' : 'text-muted-foreground'
          }`}
          role="status"
          aria-live="polite"
        >
          {validity.valid ? (
            <>
              <Check className="w-3.5 h-3.5" />
              Valid JSON
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5" />
              {validity.message}
            </>
          )}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Provide the data object your template expects. It is rendered against the selected template
        on publish instead of being parsed from markdown.
      </p>
    </div>
  );
};

TemplateJsonEditor.displayName = 'TemplateJsonEditor';
