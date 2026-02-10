import React, { useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../utils/cn';

export interface KeyboardShortcut {
  key: string;
  description: string;
  condition?: string;
}

export interface KeyboardShortcutsHelpProps {
  shortcuts: KeyboardShortcut[];
  className?: string;
}

export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  shortcuts,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Trigger Button */}
      <Button
        onClick={() => setIsOpen(true)}
        variant="ghost"
        size="sm"
        className={cn('fixed bottom-4 right-4 z-40', className)}
        aria-label="Show keyboard shortcuts"
        title="Keyboard shortcuts (Press ? to toggle)"
      >
        <Keyboard className="w-4 h-4" aria-hidden="true" />
      </Button>

      {/* Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="presentation"
        >
          {/* Backdrop */}
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setIsOpen(false)}
            aria-label="Close dialog"
            tabIndex={-1}
          />
          {/* Dialog */}
          <div
            className="bg-surface rounded-lg shadow-xl max-w-md w-full mx-4 p-6 relative z-10"
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-shortcuts-title"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="keyboard-shortcuts-title" className="text-xl font-bold text-foreground">
                Keyboard Shortcuts
              </h2>
              <Button
                onClick={() => setIsOpen(false)}
                variant="ghost"
                size="sm"
                aria-label="Close keyboard shortcuts help"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="space-y-3">
              {shortcuts.map((shortcut, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <span className="text-sm text-foreground">
                    {shortcut.description}
                    {shortcut.condition && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({shortcut.condition})
                      </span>
                    )}
                  </span>
                  <kbd className="px-2 py-1 text-xs font-semibold text-foreground bg-muted border border-border rounded">
                    {shortcut.key}
                  </kbd>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Press <kbd className="px-1 py-0.5 text-xs font-semibold bg-muted border border-border rounded">Esc</kbd> to close this dialog
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
