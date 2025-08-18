import React, { useState, useCallback } from 'react';
import {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter,
} from './Modal';
import { Button } from './Button';
import { EnhancedInput } from './EnhancedInput';
import {
  ExclamationTriangleIcon,
  TrashIcon,
  NoSymbolIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import { cn } from '../../utils/cn';

export interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  requireTextConfirmation?: boolean;
  confirmationText?: string;
  icon?: React.ReactNode;
  details?: Array<{ label: string; value: string }>;
  consequences?: string[];
  isDestructive?: boolean;
  loadingText?: string;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  requireTextConfirmation = false,
  confirmationText = 'DELETE',
  icon,
  details = [],
  consequences = [],
  isDestructive = false,
  loadingText = 'Processing...'
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [textConfirmation, setTextConfirmation] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const isTextConfirmationValid = !requireTextConfirmation ||
    textConfirmation.trim() === confirmationText;

  const handleConfirm = useCallback(async () => {
    if (!isTextConfirmationValid) return;

    try {
      setIsConfirming(true);
      await onConfirm();
      handleClose();
    } catch (error) {
      console.error('Confirmation action failed:', error);
    } finally {
      setIsConfirming(false);
    }
  }, [isTextConfirmationValid, onConfirm]);

  const handleClose = useCallback(() => {
    if (isConfirming) return;
    setTextConfirmation('');
    setShowDetails(false);
    onClose();
  }, [isConfirming, onClose]);

  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          iconColor: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          buttonVariant: 'destructive' as const
        };
      case 'warning':
        return {
          iconColor: 'text-amber-600',
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-200',
          buttonVariant: 'primary' as const
        };
      case 'info':
        return {
          iconColor: 'text-blue-600',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          buttonVariant: 'primary' as const
        };
      default:
        return {
          iconColor: 'text-slate-600',
          bgColor: 'bg-slate-50',
          borderColor: 'border-slate-200',
          buttonVariant: 'primary' as const
        };
    }
  };

  const getDefaultIcon = () => {
    switch (type) {
      case 'danger':
        return isDestructive ? <TrashIcon className="w-6 h-6" /> : <ExclamationTriangleIcon className="w-6 h-6" />;
      case 'warning':
        return <ShieldExclamationIcon className="w-6 h-6" />;
      default:
        return <ExclamationTriangleIcon className="w-6 h-6" />;
    }
  };

  const styles = getTypeStyles();
  const displayIcon = icon || getDefaultIcon();

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md">
      <ModalHeader>
        <ModalTitle className="flex items-center">
          <div className={cn('mr-3', styles.iconColor)}>
            {displayIcon}
          </div>
          {title}
        </ModalTitle>
        <ModalDescription>
          {description}
        </ModalDescription>
      </ModalHeader>

      <ModalContent>
        <div className="space-y-4">
          {/* Warning Banner */}
          <div className={cn('rounded-md p-4', styles.bgColor, styles.borderColor, 'border')}>
            <div className="flex">
              <div className={cn('mr-3 mt-0.5 flex-shrink-0', styles.iconColor)}>
                <ExclamationTriangleIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className={cn('text-sm font-medium',
                  type === 'danger' ? 'text-red-800' :
                  type === 'warning' ? 'text-amber-800' : 'text-blue-800'
                )}>
                  {type === 'danger' ? 'This action cannot be undone' : 'Please confirm this action'}
                </h3>
                {consequences.length > 0 && (
                  <div className={cn('text-sm mt-1 space-y-1',
                    type === 'danger' ? 'text-red-700' :
                    type === 'warning' ? 'text-amber-700' : 'text-blue-700'
                  )}>
                    {consequences.map((consequence, index) => (
                      <p key={index}>• {consequence}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Details Section */}
          {details.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-md p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-slate-900">Details</h4>
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="text-sm text-blue-600 hover:text-blue-500"
                >
                  {showDetails ? 'Hide' : 'Show'} details
                </button>
              </div>

              {showDetails && (
                <div className="space-y-2 text-sm">
                  {details.map((detail, index) => (
                    <div key={index} className="flex justify-between">
                      <span className="text-slate-600">{detail.label}:</span>
                      <span className="font-medium text-slate-900 text-right max-w-xs truncate">
                        {detail.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Text Confirmation */}
          {requireTextConfirmation && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Type <code className="bg-slate-100 px-1 py-0.5 rounded text-xs font-mono">{confirmationText}</code> to confirm:
              </label>
              <EnhancedInput
                value={textConfirmation}
                onChange={(e) => setTextConfirmation(e.target.value)}
                placeholder={`Type "${confirmationText}" here`}
                disabled={isConfirming}
                validationState={
                  textConfirmation.length === 0 ? 'idle' :
                  isTextConfirmationValid ? 'success' : 'error'
                }
                error={
                  textConfirmation.length > 0 && !isTextConfirmationValid
                    ? `Please type "${confirmationText}" exactly as shown`
                    : undefined
                }
              />
            </div>
          )}

          {/* Final Confirmation */}
          <div className="text-center">
            <p className="text-sm text-slate-600">
              {requireTextConfirmation
                ? `Please confirm by typing "${confirmationText}" above.`
                : 'Are you sure you want to proceed?'
              }
            </p>
          </div>
        </div>
      </ModalContent>

      <ModalFooter>
        <Button
          variant="outline"
          onClick={handleClose}
          disabled={isConfirming}
        >
          {cancelText}
        </Button>
        <Button
          variant={styles.buttonVariant}
          onClick={handleConfirm}
          isLoading={isConfirming}
          disabled={isConfirming || !isTextConfirmationValid}
        >
          {isDestructive && type === 'danger' && (
            <TrashIcon className="w-4 h-4 mr-2" />
          )}
          {isConfirming ? loadingText : confirmText}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

// Hook for managing confirmation dialogs
export function useConfirmationDialog() {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    props: Partial<ConfirmationDialogProps>;
  }>({
    isOpen: false,
    props: {}
  });

  const showConfirmation = useCallback((props: Omit<ConfirmationDialogProps, 'isOpen' | 'onClose'>) => {
    return new Promise<boolean>((resolve) => {
      setDialogState({
        isOpen: true,
        props: {
          ...props,
          onConfirm: async () => {
            try {
              await props.onConfirm();
              resolve(true);
            } catch (error) {
              resolve(false);
              throw error;
            }
          }
        }
      });
    });
  }, []);

  const hideConfirmation = useCallback(() => {
    setDialogState({
      isOpen: false,
      props: {}
    });
  }, []);

  const ConfirmationDialogComponent = useCallback(() => {
    if (!dialogState.isOpen) return null;

    return (
      <ConfirmationDialog
        {...dialogState.props as ConfirmationDialogProps}
        isOpen={dialogState.isOpen}
        onClose={hideConfirmation}
      />
    );
  }, [dialogState, hideConfirmation]);

  return {
    showConfirmation,
    hideConfirmation,
    ConfirmationDialog: ConfirmationDialogComponent
  };
}

// Predefined confirmation dialogs for common actions
export const confirmationPresets = {
  deleteApiKey: (apiKeyName: string) => ({
    title: 'Delete API Key',
    description: 'This action cannot be undone. The API key will be permanently removed from the system.',
    confirmText: 'Delete API Key',
    type: 'danger' as const,
    isDestructive: true,
    requireTextConfirmation: true,
    confirmationText: 'DELETE',
    consequences: [
      'The API key will be permanently removed from the system',
      'All usage history will be deleted',
      'Any applications using this key will lose access immediately'
    ],
    details: [
      { label: 'API Key Name', value: apiKeyName }
    ]
  }),

  revokeApiKey: (apiKeyName: string) => ({
    title: 'Revoke API Key',
    description: 'This will immediately disable the API key. The key record will remain for audit purposes.',
    confirmText: 'Revoke API Key',
    type: 'warning' as const,
    icon: <NoSymbolIcon className="w-6 h-6" />,
    consequences: [
      'The API key will be immediately disabled',
      'The key record will remain for audit purposes',
      'This action cannot be undone'
    ],
    details: [
      { label: 'API Key Name', value: apiKeyName }
    ]
  }),

  deleteBrand: (brandName: string) => ({
    title: 'Delete Brand',
    description: 'This will permanently delete your brand and all associated data.',
    confirmText: 'Delete Brand',
    type: 'danger' as const,
    isDestructive: true,
    requireTextConfirmation: true,
    confirmationText: 'DELETE',
    consequences: [
      'All brand data will be permanently deleted',
      'Newsletter templates and settings will be lost',
      'This action cannot be undone'
    ],
    details: [
      { label: 'Brand Name', value: brandName }
    ]
  }),

  resetForm: () => ({
    title: 'Reset Form',
    description: 'This will clear all form data and reset to default values.',
    confirmText: 'Reset Form',
    type: 'warning' as const,
    consequences: [
      'All unsaved changes will be lost',
      'Form will be reset to default values'
    ]
  })
};
