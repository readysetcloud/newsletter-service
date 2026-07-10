/* eslint-disable react-refresh/only-export-components */
import React, { useCallback } from 'react';
import { ToastProvider as RscToastProvider, useToast as useRscToast } from '@readysetcloud/ui';

/*
 * Toast rendering (viewport, stacking, variants, dismiss) comes from
 * @readysetcloud/ui. This adapter keeps the app's addToast({type, title,
 * message}) call signature over the package's toast(message, options) API.
 */
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Kept for API compatibility; stacking is handled by the package. */
  maxToasts?: number;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  return <RscToastProvider>{children}</RscToastProvider>;
};

export const useToast = () => {
  const { toast } = useRscToast();

  const addToast = useCallback(
    ({ type, title, message, duration, action }: Omit<Toast, 'id'>) => {
      toast(
        <span className="block">
          <span className="block font-medium">{title}</span>
          {message && <span className="block mt-0.5 text-muted-foreground">{message}</span>}
          {action && (
            <button
              type="button"
              className="mt-1 text-sm font-medium text-primary-600 hover:text-primary-500"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          )}
        </span>,
        { variant: type, duration }
      );
    },
    [toast]
  );

  return { addToast };
};
