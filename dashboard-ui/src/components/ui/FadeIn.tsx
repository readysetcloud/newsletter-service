import React from 'react';
import { cn } from '../../utils/cn';
import { fadeInClasses, respectMotionPreference } from '../../utils/animations';

export interface FadeInProps {
  children: React.ReactNode;
  /**
   * Animation speed: 'fast' (200ms), 'normal' (300ms), 'slow' (500ms)
   * @default 'normal'
   */
  speed?: 'fast' | 'normal' | 'slow';
  /**
   * Animation variant: 'fade', 'slideUp', 'scale'
   * @default 'fade'
   */
  variant?: 'fade' | 'slideUp' | 'scale';
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Delay before animation starts (in ms)
   */
  delay?: number;
}

/**
 * FadeIn component for lazy-loaded content
 *
 * Wraps content with a fade-in animation that respects user's motion preferences.
 * Use this component to wrap lazy-loaded sections for a smooth appearance.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<Skeleton />}>
 *   <FadeIn variant="slideUp">
 *     <LazyComponent />
 *   </FadeIn>
 * </Suspense>
 * ```
 */
export const FadeIn: React.FC<FadeInProps> = ({
  children,
  speed = 'normal',
  variant = 'fade',
  className,
  delay = 0,
}) => {
  // Determine animation class based on variant and speed
  const getAnimationClass = () => {
    if (variant === 'slideUp') {
      return respectMotionPreference(fadeInClasses.slideUp);
    }
    if (variant === 'scale') {
      return respectMotionPreference(fadeInClasses.scale);
    }

    // Fade variant with speed
    if (speed === 'fast') {
      return respectMotionPreference(fadeInClasses.fast);
    }
    if (speed === 'slow') {
      return respectMotionPreference(fadeInClasses.slow);
    }
    return respectMotionPreference(fadeInClasses.normal);
  };

  const animationClass = getAnimationClass();
  const delayStyle = delay > 0 ? { animationDelay: `${delay}ms` } : undefined;

  return (
    <div
      className={cn(animationClass, className)}
      style={delayStyle}
    >
      {children}
    </div>
  );
};

export default FadeIn;
