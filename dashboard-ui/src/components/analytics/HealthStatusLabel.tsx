export type HealthStatus = 'healthy' | 'warning' | 'critical';
export type HealthLabel = 'Stable' | 'Declining' | 'Improving';

export interface HealthStatusLabelProps {
  status: HealthStatus;
  label: HealthLabel;
}

export default function HealthStatusLabel({ status, label }: HealthStatusLabelProps) {
  const getColorClasses = () => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800';
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
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
