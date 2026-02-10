/**
 * Animation utilities for the Issue Detail Page redesign
 *
 * Provides reusable animation classes and utilities for:
 * - Fade-in animations for lazy-loaded content
 * - Smooth transitions for interactive elements
 * - Hover effects
 * - Focus indicators
 */

/**
 * Fade-in animation classes for lazy-loaded content
 * Usage: Add to components wrapped in Suspense
 */
export const fadeInClasses = {
  // Fast fade-in (200ms) for small components
  fast: 'animate-fade-in-fast',
  // Normal fade-in (300ms) for most content
  normal: 'animate-fade-in',
  // Slow fade-in (500ms) for large sections
  slow: 'animate-fade-in-slow',
  // Fade-in with slide up effect
  slideUp: 'animate-fade-in-slide-up',
  // Fade-in with scale effect
  scale: 'animate-fade-in-scale',
};

/**
 * Transition classes for interactive elements
 */
export const transitionClasses = {
  // All properties transition
  all: 'transition-all duration-200 ease-in-out',
  // Colors only (background, text, border)
  colors: 'transition-colors duration-200 ease-in-out',
  // Transform only (scale, rotate, translate)
  transform: 'transition-transform duration-200 ease-in-out',
  // Opacity only
  opacity: 'transition-opacity duration-200 ease-in-out',
  // Shadow only
  shadow: 'transition-shadow duration-200 ease-in-out',
  // Slower transition for complex animations
  slow: 'transition-all duration-300 ease-in-out',
};

/**
 * Hover effect classes for interactive elements
 */
export const hoverEffects = {
  // Subtle elevation on hover
  lift: 'hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200',
  // Scale up slightly on hover
  scale: 'hover:scale-105 transition-transform duration-200',
  // Brighten on hover
  brighten: 'hover:brightness-110 transition-all duration-200',
  // Background color change
  bgChange: 'hover:bg-muted/80 transition-colors duration-200',
  // Border highlight
  borderHighlight: 'hover:border-primary-400 transition-colors duration-200',
  // Combined lift and border
  liftBorder: 'hover:shadow-lg hover:-translate-y-0.5 hover:border-primary-300 transition-all duration-200',
};

/**
 * Focus indicator classes for keyboard navigation
 */
export const focusClasses = {
  // Standard focus ring
  ring: 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  // Focus ring with primary color
  primary: 'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
  // Focus ring with visible outline
  visible: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  // Focus with background change
  bgChange: 'focus:outline-none focus:bg-muted focus:ring-2 focus:ring-ring',
};

/**
 * Loading state animation classes
 */
export const loadingClasses = {
  // Pulse animation for skeleton loaders
  pulse: 'animate-pulse',
  // Spin animation for spinners
  spin: 'animate-spin',
  // Bounce animation for loading indicators
  bounce: 'animate-bounce',
};

/**
 * Smooth scroll behavior utility
 * @param elementId - ID of the element to scroll to
 * @param offset - Offset from top in pixels (default: 100)
 */
export const smoothScrollTo = (elementId: string, offset: number = 100): void => {
  const element = document.getElementById(elementId);
  if (element) {
    const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
    const offsetPosition = elementPosition - offset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  }
};

/**
 * Stagger animation delay utility
 * Returns a delay class for staggered animations
 * @param index - Index of the element in a list
 * @param delayMs - Delay in milliseconds per item (default: 50)
 */
export const getStaggerDelay = (index: number, delayMs: number = 50): string => {
  const delay = index * delayMs;
  return `animation-delay-${delay}`;
};

/**
 * Check if user prefers reduced motion
 * @returns true if user prefers reduced motion
 */
export const prefersReducedMotion = (): boolean => {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

/**
 * Apply animation only if user doesn't prefer reduced motion
 * @param animationClass - Animation class to apply
 * @returns Animation class or empty string based on user preference
 */
export const respectMotionPreference = (animationClass: string): string => {
  return prefersReducedMotion() ? '' : animationClass;
};
