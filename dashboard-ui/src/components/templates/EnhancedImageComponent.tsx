import React, { useState } from 'react';
import { Image as ImageIcon, Upload, ExternalLink } from 'lucide-react';
import { ImageBrowser } from './ImageBrowser';

interface EnhancedImageComponentProps {
  src: string;
  alt: string;
  width: string;
  onSrcChange: (src: string) => void;
  onAltChange: (alt: string) => void;
  onWidthChange: (width: string) => void;
  className?: string;
}

export const EnhancedImageComponent: React.FC<EnhancedImageComponentProps> = ({
  src,
  alt,
  width,
  onSrcChange,
  onAltChange,
  onWidthChange,
  className = ''
}) => {
  const [showImageBrowser, setShowImageBrowser] = useState(false);
  const [imageInputMode, setImageInputMode] = useState<'url' | 'upload'>('url');

  const handleImageSelect = (imageUrl: string) => {
    onSrcChange(imageUrl);
    setShowImageBrowser(false);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Image Source Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Image Source
        </label>

        {/* Mode Toggle */}
        <div className="flex rounded-lg border border-gray-300 mb-3">
          <button
            type="button"
            onClick={() => setImageInputMode('url')}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-l-lg ${
              imageInputMode === 'url'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <ExternalLink className="w-4 h-4 inline mr-2" />
            URL
          </button>
          <button
            type="button"
            onClick={() => setImageInputMode('upload')}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-r-lg ${
              imageInputMode === 'upload'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Upload className="w-4 h-4 inline mr-2" />
            Brand Photos
          </button>
        </div>

        {/* URL Input Mode */}
        {imageInputMode === 'url' && (
          <input
            type="url"
            value={src}
            onChange={(e) => onSrcChange(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )}

        {/* Brand Photos Mode */}
        {imageInputMode === 'upload' && (
          <div className="space-y-3">
            {src && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <img
                  src={src}
                  alt={alt || 'Selected image'}
                  className="w-12 h-12 object-cover rounded"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">Selected Image</p>
                  <p className="text-xs text-gray-500 truncate">{src}</p>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowImageBrowser(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <ImageIcon className="w-5 h-5 text-gray-400" />
              <span className="text-gray-600">
                {src ? 'Change Image' : 'Select from Brand Photos'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Alt Text */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Alt Text
        </label>
        <input
          type="text"
          value={alt}
          onChange={(e) => onAltChange(e.target.value)}
          placeholder="Describe the image for accessibility"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="text-xs text-gray-500 mt-1">
          Helps screen readers and improves email deliverability
        </p>
      </div>

      {/* Width */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Width
        </label>
        <select
          value={width}
          onChange={(e) => onWidthChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="100%">Full Width (100%)</option>
          <option value="75%">Three Quarters (75%)</option>
          <option value="50%">Half Width (50%)</option>
          <option value="25%">Quarter Width (25%)</option>
          <option value="200px">Small (200px)</option>
          <option value="300px">Medium (300px)</option>
          <option value="400px">Large (400px)</option>
          <option value="600px">Extra Large (600px)</option>
        </select>
      </div>

      {/* Preview */}
      {src && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Preview
          </label>
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <img
              src={src}
              alt={alt}
              style={{ width: width, maxWidth: '100%' }}
              className="block mx-auto"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            />
          </div>
        </div>
      )}

      {/* Image Browser Modal */}
      <ImageBrowser
        isOpen={showImageBrowser}
        onClose={() => setShowImageBrowser(false)}
        onSelectImage={handleImageSelect}
        selectedImageUrl={src}
      />
    </div>
  );
};
