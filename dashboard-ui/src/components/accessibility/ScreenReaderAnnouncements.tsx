import React, { useEffect, useRef } from 'react';

interface ScreenReaderAnnouncementsProps {
  /**
   * The message to announce to screen readers
   */
  message: string;

  /**
   * Priority level for the announcement
   * - 'polite': Waits for current speech to finish
   * - 'assertive': Interrupts current speech
   */
  priority?: 'polite' | 'assertive';

  /**
   * Whether the entire region should be read when changed
   */
  atomic?: boolean;

  /**
   * Clear the message after announcement
   */
  clearAfterAnnouncement?: boolean;

  /**
   * Delay before clearing (in milliseconds)
   */
  clearDelay?: number;
}

/**
 * Component for making announcements to screen readers
 *
 * This component uses ARIA live regions to communicate dynamic content
 * changes to assistive technologies without requiring focus changes.
 */
export const ScreenReaderAnnouncements: React.FC<ScreenReaderAnnouncementsProps> = ({
  message,
  priority = 'polite',
  atomic = true,
  clearAfterAnnouncement = true,
  clearDelay = 1000
}) => {
  const announcementRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!message || !announcementRef.current) return;

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set the message
    announcementRef.current.textContent = message;

    // Clear the message after delay if requested
    if (clearAfterAnnouncement) {
      timeoutRef.current = setTimeout(() => {
        if (announcementRef.current) {
          announcementRef.current.textContent = '';
        }
      }, clearDelay);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [message, clearAfterAnnouncement, clearDelay]);

  return (
    <div
      ref={announcementRef}
      aria-live={priority}
      aria-atomic={atomic}
      className="sr-only"
      role="status"
    />
  );
};

export default ScreenReaderAnnouncements;
