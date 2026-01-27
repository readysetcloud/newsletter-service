import React, { useState, useRef } from 'react';
import { PhotoIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';

interface BrandPhotoUploadProps {
  currentPhoto?: string;
  onPhotoChange: (file: File | null) => void;
  onPhotoRemove: () => void;
  isUploading?: boolean;
  error?: string;
  className?: string;
}

export const BrandPhotoUpload: React.FC<BrandPhotoUploadProps> = ({
  currentPhoto,
  onPhotoChange,
  onPhotoRemove,
  isUploading = false,
  error,
  className
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removedPhoto, setRemovedPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setRemovedPhoto(null); // Reset removal state when new file is selected
    onPhotoChange(file);
  };

  const handleRemovePhoto = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setRemovedPhoto(currentPhoto ?? null);
    onPhotoRemove();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setRemovedPhoto(null); // Reset removal state when new file is dropped
      onPhotoChange(file);
    }
  };

  const isCurrentPhotoHidden = currentPhoto && removedPhoto === currentPhoto;
  const displayImage = previewUrl || (isCurrentPhotoHidden ? null : currentPhoto);

  return (
    <div className={cn('w-full', className)}>
      <label
        htmlFor="brand-logo-upload"
        className="block text-sm font-medium text-muted-foreground mb-2"
      >
        Brand Logo
      </label>

      <div className="space-y-4">
        {displayImage ? (
          <div className="relative inline-block">
            <img
              src={displayImage}
              alt="Brand logo preview"
              className="h-32 w-32 object-cover rounded-lg border border-border"
            />
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={isUploading}
              className="absolute -top-2 -right-2 bg-error-500 text-white rounded-full p-1 hover:bg-error-600 disabled:opacity-50 z-10 shadow-lg"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary-400 transition-colors"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <PhotoIcon className="mx-auto h-12 w-12 text-muted-foreground" />
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">
                Drag and drop your logo here, or{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-primary-600 hover:text-primary-500 font-medium"
                >
                  browse
                </button>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                PNG, JPG, GIF up to 5MB
              </p>
            </div>
          </div>
        )}

        <input
          id="brand-logo-upload"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {!displayImage && (
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            Choose File
          </Button>
        )}

        {isUploading && (
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
            <span>Uploading...</span>
          </div>
        )}

        {error && (
          <p className="text-sm text-error-600">{error}</p>
        )}
      </div>
    </div>
  );
};
