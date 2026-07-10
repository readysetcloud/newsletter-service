import React from 'react';
import { Modal as RscModal } from '@readysetcloud/ui';
import { cn } from '../../utils/cn';

/*
 * Dialog shell comes from @readysetcloud/ui (native <dialog>: focus trap,
 * Esc-to-close, bottom sheet on small screens). This adapter keeps the app's
 * isOpen/size API; the Header/Content/Footer spacing components stay local.
 */
export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnOverlayClick?: boolean;
  /** Esc always closes the native dialog; kept for API compatibility. */
  closeOnEscape?: boolean;
}

export interface ModalHeaderProps {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export interface ModalContentProps {
  children: React.ReactNode;
  className?: string;
}

export interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

const sizeVariants = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl'
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  size = 'md',
  closeOnOverlayClick = true
}) => {
  // The package Modal closes on backdrop click via its own onClick on the
  // <dialog>; supplying a no-op onClick replaces that handler when the app
  // needs the modal to stay open (e.g. one-time API key reveal).
  const overlayGuard = closeOnOverlayClick
    ? undefined
    : ({ onClick: () => undefined } as Record<string, unknown>);

  // Unmount when closed (the native <dialog> would keep children mounted):
  // callers rely on modal content/form state resetting between opens.
  if (!isOpen) return null;

  return (
    <RscModal
      open={isOpen}
      onClose={onClose}
      className={cn('sm:w-full', sizeVariants[size])}
      {...overlayGuard}
    >
      {children}
    </RscModal>
  );
};

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  children,
  onClose,
  className
}) => {
  return (
    <div className={cn('flex items-center justify-between p-6 border-b border-border', className)}>
      <div className="flex-1">{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          className="ml-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export const ModalTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <h2
      className={cn('text-lg font-semibold text-foreground', className)}
      {...props}
    >
      {children}
    </h2>
  );
};

export const ModalDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <p
      className={cn('text-sm text-muted-foreground mt-1', className)}
      {...props}
    >
      {children}
    </p>
  );
};

export const ModalContent: React.FC<ModalContentProps> = ({
  children,
  className
}) => {
  return (
    <div className={cn('p-6', className)}>
      {children}
    </div>
  );
};

export const ModalFooter: React.FC<ModalFooterProps> = ({
  children,
  className
}) => {
  return (
    <div className={cn('flex items-center justify-end gap-3 p-6 border-t border-border', className)}>
      {children}
    </div>
  );
};
