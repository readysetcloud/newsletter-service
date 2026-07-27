export type HealthStatus = 'healthy' | 'warning' | 'critical';
export type HealthLabel = 'Stable' | 'Declining' | 'Improving';

export interface HealthStatusLabelProps {
  status: HealthStatus;
  label: HealthLabel;
}

export default function HealthStatusLabel({ status, label }: HealthStatusLabelProps) {
  /*
   * The token scales invert in dark mode, so single classes render correctly
   * in both themes — dark: overrides would double-invert and wash out.
   */
  const getColorClasses = () => {
    switch (status) {
      case 'healthy':
        return 'bg-success-100 text-success-800 border-success-200';
      case 'warning':
        return 'bg-warning-100 text-warning-800 border-warning-200';
      case 'critical':
        return 'bg-error-100 text-error-800 border-error-200';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getIcon = () => {
    switch (status) {
      case 'healthy':
        return '✓';
      case 'warning':
        return '⚠';
      case 'critical':
        return '✕';
      default:
        return '○';
    }
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${getColorClasses()}`}
      role="status"
      aria-label={`Health status: ${label}`}
    >
      <span aria-hidden="true">{getIcon()}</span>
      {label}
    </span>
  );
}
