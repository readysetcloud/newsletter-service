import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter,
} from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { ApiKey } from '@/types';
import {
  CheckIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface ApiKeyCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: ApiKey;
}

export const ApiKeyCreatedModal: React.FC<ApiKeyCreatedModalProps> = ({
  isOpen,
  onClose,
  apiKey,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const { addToast } = useToast();

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.keyValue);
      setIsCopied(true);
      addToast({ title: 'API key copied to clipboard', type: 'success' });

      // Reset the copied state after 3 seconds
      setTimeout(() => {
        setIsCopied(false);
      }, 3000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      addToast({ title: 'Failed to copy to clipboard', type: 'error' });
    }
  };

  const handleClose = () => {
    setIsCopied(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg" closeOnOverlayClick={false}>
      <ModalHeader>
        <ModalTitle className="flex items-center">
          <CheckIcon className="w-6 h-6 text-success-600 mr-2" />
          API Key Created Successfully
        </ModalTitle>
        <ModalDescription>
          Your new API key has been created. Please copy it now as it will not be shown again.
        </ModalDescription>
      </ModalHeader>

      <ModalContent>
        <div className="space-y-6">
          {/* Warning Banner */}
          <div className="bg-warning-50 border border-warning-200 rounded-md p-4">
            <div className="flex">
              <ExclamationTriangleIcon className="w-5 h-5 text-warning-400 mr-3 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-medium text-warning-800">
                  Important: Save this API key now
                </h3>
                <p className="text-sm text-warning-700 mt-1">
                  This is the only time you&apos;ll be able to see the full API key value.
                  Make sure to copy it and store it securely.
                </p>
              </div>
            </div>
          </div>

          {/* API Key Details */}
          <div className="space-y-4">
            <div>
              <div className="block text-sm font-medium text-muted-foreground mb-1">
                Name
              </div>
              <p className="text-sm text-foreground bg-background px-3 py-2 rounded border">
                {apiKey.name}
              </p>
            </div>

            {apiKey.description && (
              <div>
                <div className="block text-sm font-medium text-muted-foreground mb-1">
                  Description
                </div>
                <p className="text-sm text-foreground bg-background px-3 py-2 rounded border">
                  {apiKey.description}
                </p>
              </div>
            )}

            <div>
              <div className="block text-sm font-medium text-muted-foreground mb-1">
                API Key Value
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-foreground text-success-300 px-4 py-3 rounded font-mono text-sm break-all">
                  {apiKey.keyValue}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyToClipboard}
                  className={isCopied ? 'border-success-300 bg-success-50' : ''}
                >
                  {isCopied ? (
                    <>
                      <CheckIcon className="w-4 h-4 mr-1 text-success-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon className="w-4 h-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Additional Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="block text-sm font-medium text-muted-foreground mb-1">
                  Created
                </div>
                <p className="text-foreground">
                  {new Date(apiKey.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>

              <div>
                <div className="block text-sm font-medium text-muted-foreground mb-1">
                  Expires
                </div>
                <p className="text-foreground">
                  {apiKey.expiresAt
                    ? new Date(apiKey.expiresAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                    : 'Never'
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Usage Instructions */}
          <div className="bg-primary-50 border border-primary-200 rounded-md p-4">
            <h4 className="text-sm font-medium text-primary-900 mb-2">
              How to use this API key
            </h4>
            <div className="text-sm text-primary-800 space-y-2 text-wrap">
              <p>Include this API key in your requests using the Authorization header:</p>
              <code className="block bg-primary-100 px-3 py-2 rounded text-xs font-mono text-wrap">
                Authorization: {apiKey.keyValue}
              </code>
              <p className="text-xs">
                Keep this key secure and never expose it in client-side code or public repositories.
              </p>
            </div>
          </div>
        </div>
      </ModalContent>

      <ModalFooter>
        <Button onClick={handleClose} className="w-full">
          I&apos;ve saved the API key
        </Button>
      </ModalFooter>
    </Modal>
  );
};
