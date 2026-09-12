import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

export interface SectionErrorProps {
  message: string;
  onRetry: () => void;
  /** Label for the retry button's accessible name, e.g. "Retry loading issues". */
  retryLabel?: string;
}

/**
 * A failure that belongs to one section of a page rather than to the page.
 *
 * Pages built this way load their sections independently, so one failing
 * section must not replace everything else with an error screen — the rest of
 * the page still has answers on it. This sits in the failed section's place,
 * at its size, with the retry for that section alone.
 */
export const SectionError: React.FC<SectionErrorProps> = ({ message, onRetry, retryLabel }) => (
  <div
    className="flex items-center gap-3 p-4 rounded-lg bg-error-50 border border-error-200 text-error-700 dark:bg-error-900/20 dark:border-error-800 dark:text-error-300"
    role="alert"
  >
    <AlertCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
    <p className="text-sm flex-1">{message}</p>
    <Button variant="outline" size="sm" onClick={onRetry} aria-label={retryLabel}>
      <RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" />
      Retry
    </Button>
  </div>
);

export default SectionError;
