import React from 'react';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { getFallbackIcon } from '@/utils/navigationErrorRecovery';

/**
 * Safe icon wrapper that handles icon loading errors
 */
export const SafeIcon: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  fallbackId: string;
  className?: string;
}> = ({ icon: Icon, fallbackId, className }) => {
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [Icon]);

  if (hasError) {
    const FallbackIcon = getFallbackIcon(fallbackId);
    return <FallbackIcon className={className} />;
  }

  try {
    return (
      <React.Suspense fallback={<QuestionMarkCircleIcon className={className} />}>
        <ErrorBoundaryIcon
          icon={Icon}
          fallbackId={fallbackId}
          className={className}
          onError={() => setHasError(true)}
        />
      </React.Suspense>
    );
  } catch (error) {
    console.warn(`Icon loading failed for ${fallbackId}, using fallback:`, error);
    const FallbackIcon = getFallbackIcon(fallbackId);
    return <FallbackIcon className={className} />;
  }
};

/**
 * Error boundary for individual icons
 */
class ErrorBoundaryIcon extends React.Component<{
  icon: React.ComponentType<{ className?: string }>;
  fallbackId: string;
  className?: string;
  onError: () => void;
}, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn(`Icon error for ${this.props.fallbackId}:`, error);
    this.props.onError();
  }

  render() {
    if (this.state.hasError) {
      const FallbackIcon = getFallbackIcon(this.props.fallbackId);
      return <FallbackIcon className={this.props.className} />;
    }

    const { icon: Icon, className } = this.props;
    return <Icon className={className} />;
  }
}
