/* eslint-disable react-refresh/only-export-components */
import React, { useCallback } from 'react';
import { Mail, Clock } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import type {
  AbTest,
  AbTestDimension,
  AbTestWinMetric,
  AbTestVariant,
  VariantId,
} from '@/types/issues';

// Defaults for a newly-enabled A/B test.
const DEFAULT_TEST_FRACTION = 0.2;
const DEFAULT_CONFIDENCE = 0.95;
const DEFAULT_EVALUATE_AFTER_MINUTES = 240;
const DEFAULT_MIN_SAMPLE_PER_VARIANT = 500;

// Allowed bounds (mirrors server expectations described in the spec).
const MIN_TEST_FRACTION = 0.01;
const MAX_TEST_FRACTION = 0.5;
const MIN_CONFIDENCE = 0.8;
const MAX_CONFIDENCE = 0.99;

const SUBJECT_MAX_LENGTH = 200;

/**
 * Per-field validation errors for an A/B test configuration. Variant errors are
 * keyed by variant id so the form can surface them next to the right input.
 */
export interface AbTestErrors {
  variantA?: string;
  variantB?: string;
  testFraction?: string;
  confidence?: string;
  evaluateAfterMinutes?: string;
  general?: string;
}

export interface AbTestConfigProps {
  /** Current A/B test config, or null when the test is disabled. */
  value: AbTest | null;
  /** Emits the next config (or null to disable). Caller marks the form dirty. */
  onChange: (next: AbTest | null) => void;
  /** Mirrors the form's disabled state (e.g. published/scheduled issues). */
  disabled?: boolean;
  /** Validation errors to display. */
  errors?: AbTestErrors;
  /**
   * The issue's scheduled time as a `datetime-local` string (local time). Used
   * to default variant A's send time for send-time tests.
   */
  scheduledAtLocal?: string;
}

/** Builds a fresh, fully-defaulted A/B test for the given dimension. */
function makeDefaultAbTest(
  dimension: AbTestDimension,
  scheduledAtLocal?: string
): AbTest {
  const variants: AbTestVariant[] =
    dimension === 'sendTime'
      ? [
          { variantId: 'a', sendAt: scheduledAtLocal || '' },
          { variantId: 'b', sendAt: '' },
        ]
      : [
          { variantId: 'a', subject: '' },
          { variantId: 'b', subject: '' },
        ];

  return {
    dimension,
    variants,
    winMetric: 'openRate',
    confidence: DEFAULT_CONFIDENCE,
    testFraction: DEFAULT_TEST_FRACTION,
    evaluateAfterMinutes: DEFAULT_EVALUATE_AFTER_MINUTES,
    minSamplePerVariant: DEFAULT_MIN_SAMPLE_PER_VARIANT,
  };
}

function getVariant(value: AbTest, id: VariantId): AbTestVariant {
  return (
    value.variants.find((v) => v.variantId === id) ?? { variantId: id }
  );
}

/**
 * Validates an A/B test config for submission. `now` is injectable for testing.
 * Returns an errors object; empty object means valid.
 */
export function validateAbTest(
  value: AbTest | null,
  now: Date = new Date()
): AbTestErrors {
  const errors: AbTestErrors = {};
  if (!value) {
    return errors;
  }

  const a = getVariant(value, 'a');
  const b = getVariant(value, 'b');

  if (value.dimension === 'subject') {
    const subjectA = (a.subject ?? '').trim();
    const subjectB = (b.subject ?? '').trim();
    if (!subjectA) {
      errors.variantA = 'Subject is required';
    } else if (subjectA.length > SUBJECT_MAX_LENGTH) {
      errors.variantA = `Subject must be ${SUBJECT_MAX_LENGTH} characters or less`;
    }
    if (!subjectB) {
      errors.variantB = 'Subject is required';
    } else if (subjectB.length > SUBJECT_MAX_LENGTH) {
      errors.variantB = `Subject must be ${SUBJECT_MAX_LENGTH} characters or less`;
    }
    if (!errors.variantA && !errors.variantB && subjectA === subjectB) {
      errors.general = 'The two variant subject lines must be different';
    }
  } else {
    const sendA = (a.sendAt ?? '').trim();
    const sendB = (b.sendAt ?? '').trim();
    const validateSend = (raw: string): string | undefined => {
      if (!raw) {
        return 'Send time is required';
      }
      const date = new Date(raw);
      if (isNaN(date.getTime())) {
        return 'Invalid date format';
      }
      if (date <= now) {
        return 'Send time must be in the future';
      }
      return undefined;
    };
    errors.variantA = validateSend(sendA);
    errors.variantB = validateSend(sendB);
    if (!errors.variantA && !errors.variantB && sendA === sendB) {
      errors.general = 'The two variant send times must be different';
    }
  }

  const fraction = value.testFraction ?? DEFAULT_TEST_FRACTION;
  if (
    typeof fraction !== 'number' ||
    isNaN(fraction) ||
    fraction < MIN_TEST_FRACTION ||
    fraction > MAX_TEST_FRACTION
  ) {
    errors.testFraction = `Sample size must be between ${Math.round(
      MIN_TEST_FRACTION * 100
    )}% and ${Math.round(MAX_TEST_FRACTION * 100)}%`;
  }

  const confidence = value.confidence ?? DEFAULT_CONFIDENCE;
  if (
    typeof confidence !== 'number' ||
    isNaN(confidence) ||
    confidence < MIN_CONFIDENCE ||
    confidence > MAX_CONFIDENCE
  ) {
    errors.confidence = `Confidence must be between ${Math.round(
      MIN_CONFIDENCE * 100
    )}% and ${Math.round(MAX_CONFIDENCE * 100)}%`;
  }

  const wait = value.evaluateAfterMinutes ?? DEFAULT_EVALUATE_AFTER_MINUTES;
  if (typeof wait !== 'number' || isNaN(wait) || wait < 1) {
    errors.evaluateAfterMinutes = 'Hold-out wait must be at least 1 minute';
  }

  return errors;
}

/** True when the errors object contains any actual error. */
export function hasAbTestErrors(errors: AbTestErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * Strips empty error entries so `errors={...}` props never carry stale
 * `undefined` keys that could be mistaken for present errors.
 */
function fieldError(message?: string): string | undefined {
  return message || undefined;
}

const RADIO_BASE =
  'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed';
const RADIO_SELECTED =
  'border-primary-500 bg-primary-50 dark:bg-primary-900/20';
const RADIO_UNSELECTED = 'border-border bg-background hover:border-primary-300';

export const AbTestConfig: React.FC<AbTestConfigProps> = ({
  value,
  onChange,
  disabled = false,
  errors = {},
  scheduledAtLocal,
}) => {
  const enabled = value !== null;

  const handleToggle = useCallback(() => {
    if (disabled) return;
    if (enabled) {
      onChange(null);
    } else {
      onChange(makeDefaultAbTest('subject', scheduledAtLocal));
    }
  }, [disabled, enabled, onChange, scheduledAtLocal]);

  const handleDimensionChange = useCallback(
    (dimension: AbTestDimension) => {
      if (!value || value.dimension === dimension) return;
      // Reset variants for the new dimension but keep the test parameters.
      const fresh = makeDefaultAbTest(dimension, scheduledAtLocal);
      onChange({
        ...value,
        dimension,
        variants: fresh.variants,
      });
    },
    [value, onChange, scheduledAtLocal]
  );

  const updateVariant = useCallback(
    (id: VariantId, patch: Partial<AbTestVariant>) => {
      if (!value) return;
      const variants = value.variants.map((v) =>
        v.variantId === id ? { ...v, ...patch } : v
      );
      onChange({ ...value, variants });
    },
    [value, onChange]
  );

  const updateField = useCallback(
    (patch: Partial<AbTest>) => {
      if (!value) return;
      onChange({ ...value, ...patch });
    },
    [value, onChange]
  );

  // Informational minimum list size for a conclusive test.
  const minSample = value?.minSamplePerVariant ?? DEFAULT_MIN_SAMPLE_PER_VARIANT;
  const testFraction = value?.testFraction ?? DEFAULT_TEST_FRACTION;
  const recommendedListSize =
    testFraction > 0
      ? Math.ceil((2 * minSample) / testFraction)
      : null;

  const variantA = value ? getVariant(value, 'a') : { variantId: 'a' as const };
  const variantB = value ? getVariant(value, 'b') : { variantId: 'b' as const };

  const confidencePct = Math.round((value?.confidence ?? DEFAULT_CONFIDENCE) * 100);
  const fractionPct = Math.round((value?.testFraction ?? DEFAULT_TEST_FRACTION) * 100);

  return (
    <div className="rounded-lg border border-border bg-background">
      {/* Enable toggle */}
      <div className="flex items-start justify-between gap-4 p-4">
        <div>
          <span className="block text-sm font-medium text-foreground">A/B test</span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            Test two variants on a sample of your audience, then send the winner to
            everyone else.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable A/B test"
          onClick={handleToggle}
          disabled={disabled}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            enabled ? 'bg-primary-600' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {enabled && value && (
        <div className="border-t border-border p-4 space-y-6">
          {/* Dimension */}
          <div>
            <span className="block text-sm font-medium text-foreground mb-2">
              What to test
            </span>
            <div
              role="radiogroup"
              aria-label="A/B test dimension"
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <button
                type="button"
                role="radio"
                aria-checked={value.dimension === 'subject'}
                onClick={() => handleDimensionChange('subject')}
                disabled={disabled}
                className={`${RADIO_BASE} ${
                  value.dimension === 'subject' ? RADIO_SELECTED : RADIO_UNSELECTED
                }`}
              >
                <Mail className="w-5 h-5 mt-0.5 text-primary-600 dark:text-primary-400 shrink-0" />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Subject line
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Compare two subject lines to see which gets more opens.
                  </span>
                </span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={value.dimension === 'sendTime'}
                onClick={() => handleDimensionChange('sendTime')}
                disabled={disabled}
                className={`${RADIO_BASE} ${
                  value.dimension === 'sendTime' ? RADIO_SELECTED : RADIO_UNSELECTED
                }`}
              >
                <Clock className="w-5 h-5 mt-0.5 text-primary-600 dark:text-primary-400 shrink-0" />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Send time
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Compare two send times to find the best moment to deliver.
                  </span>
                </span>
              </button>
            </div>
          </div>

          {/* Variants */}
          <div>
            <span className="block text-sm font-medium text-foreground mb-2">
              Variants
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Variant A (control) */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Variant A (control)
                </span>
                {value.dimension === 'subject' ? (
                  <Input
                    label="Subject *"
                    placeholder="Subject line for variant A"
                    value={variantA.subject ?? ''}
                    onChange={(e) =>
                      updateVariant('a', { subject: e.target.value })
                    }
                    error={fieldError(errors.variantA)}
                    disabled={disabled}
                    maxLength={SUBJECT_MAX_LENGTH}
                  />
                ) : (
                  <div>
                    <label
                      htmlFor="ab-variant-a-sendAt"
                      className="block text-sm font-medium text-muted-foreground mb-1"
                    >
                      Send time *
                    </label>
                    <input
                      type="datetime-local"
                      id="ab-variant-a-sendAt"
                      value={variantA.sendAt ?? ''}
                      onChange={(e) =>
                        updateVariant('a', { sendAt: e.target.value })
                      }
                      disabled={disabled}
                      aria-invalid={!!errors.variantA}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    {errors.variantA && (
                      <p
                        className="mt-1 text-sm text-error-600 dark:text-error-400"
                        role="alert"
                      >
                        {errors.variantA}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Variant B (challenger) */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Variant B (challenger)
                </span>
                {value.dimension === 'subject' ? (
                  <Input
                    label="Subject *"
                    placeholder="Subject line for variant B"
                    value={variantB.subject ?? ''}
                    onChange={(e) =>
                      updateVariant('b', { subject: e.target.value })
                    }
                    error={fieldError(errors.variantB)}
                    disabled={disabled}
                    maxLength={SUBJECT_MAX_LENGTH}
                  />
                ) : (
                  <div>
                    <label
                      htmlFor="ab-variant-b-sendAt"
                      className="block text-sm font-medium text-muted-foreground mb-1"
                    >
                      Send time *
                    </label>
                    <input
                      type="datetime-local"
                      id="ab-variant-b-sendAt"
                      value={variantB.sendAt ?? ''}
                      onChange={(e) =>
                        updateVariant('b', { sendAt: e.target.value })
                      }
                      disabled={disabled}
                      aria-invalid={!!errors.variantB}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    {errors.variantB && (
                      <p
                        className="mt-1 text-sm text-error-600 dark:text-error-400"
                        role="alert"
                      >
                        {errors.variantB}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            {errors.general && (
              <p
                className="mt-2 text-sm text-error-600 dark:text-error-400"
                role="alert"
              >
                {errors.general}
              </p>
            )}
          </div>

          {/* Win metric */}
          <div>
            <span className="block text-sm font-medium text-foreground mb-2">
              Winning metric
            </span>
            <div
              role="radiogroup"
              aria-label="Winning metric"
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              {(
                [
                  ['openRate', 'Open rate'],
                  ['clickRate', 'Click rate'],
                ] as [AbTestWinMetric, string][]
              ).map(([metric, label]) => (
                <button
                  key={metric}
                  type="button"
                  role="radio"
                  aria-checked={(value.winMetric ?? 'openRate') === metric}
                  onClick={() => updateField({ winMetric: metric })}
                  disabled={disabled}
                  className={`${RADIO_BASE} ${
                    (value.winMetric ?? 'openRate') === metric
                      ? RADIO_SELECTED
                      : RADIO_UNSELECTED
                  }`}
                >
                  <span className="text-sm font-medium text-foreground">
                    {label}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Apple Mail Privacy Protection can inflate open counts, so click rate is
              often a more reliable signal of real engagement.
            </p>
          </div>

          {/* Test sample size */}
          <div>
            <label
              htmlFor="ab-testFraction"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Test sample size: {fractionPct}%
            </label>
            <input
              type="range"
              id="ab-testFraction"
              min={Math.round(MIN_TEST_FRACTION * 100)}
              max={Math.round(MAX_TEST_FRACTION * 100)}
              step={1}
              value={fractionPct}
              onChange={(e) =>
                updateField({ testFraction: Number(e.target.value) / 100 })
              }
              disabled={disabled}
              aria-invalid={!!errors.testFraction}
              className="w-full accent-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {errors.testFraction && (
              <p
                className="mt-1 text-sm text-error-600 dark:text-error-400"
                role="alert"
              >
                {errors.testFraction}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Each variant is sent to half of this sample. The winner is sent to the
              remaining {100 - fractionPct}% of subscribers.
            </p>
          </div>

          {/* Confidence + hold-out wait */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Confidence (%)"
              type="number"
              min={Math.round(MIN_CONFIDENCE * 100)}
              max={Math.round(MAX_CONFIDENCE * 100)}
              step={1}
              value={confidencePct}
              onChange={(e) =>
                updateField({ confidence: Number(e.target.value) / 100 })
              }
              error={fieldError(errors.confidence)}
              disabled={disabled}
              helperText="Statistical confidence required to declare a winner."
            />
            <Input
              label="Hold-out wait (minutes)"
              type="number"
              min={1}
              step={1}
              value={value.evaluateAfterMinutes ?? DEFAULT_EVALUATE_AFTER_MINUTES}
              onChange={(e) =>
                updateField({ evaluateAfterMinutes: Number(e.target.value) })
              }
              error={fieldError(errors.evaluateAfterMinutes)}
              disabled={disabled}
              helperText="How long to wait after the test send before picking a winner."
            />
          </div>

          {/* Informational minimum list size hint */}
          {recommendedListSize !== null && (
            <div
              className="rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 p-3"
              role="note"
            >
              <p className="text-xs text-primary-800 dark:text-primary-200">
                For a conclusive test at these settings you generally need at least{' '}
                <span className="font-semibold">
                  {recommendedListSize.toLocaleString()}
                </span>{' '}
                active subscribers (about {minSample.toLocaleString()} per variant).
                With smaller lists the test may end inconclusive and the control
                variant is sent to everyone.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
