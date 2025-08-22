import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { BrandInfo } from '../../types';
import { BuildingOfficeIcon, GlobeAltIcon, TagIcon } from '@heroicons/react/24/outline';

interface BrandPreviewProps {
  brand: Partial<BrandInfo>;
  previewPhoto?: string;
  className?: string;
}

export const BrandPreview: React.FC<BrandPreviewProps> = ({
  brand,
  previewPhoto,
  className
}) => {
  const displayLogo = previewPhoto || brand.brandLogo;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Brand Preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Brand Logo */}
        <div className="flex items-center space-x-4">
          {displayLogo ? (
            <img
              src={displayLogo}
              alt="Brand logo"
              className="h-16 w-16 object-cover rounded-lg border border-slate-200"
            />
          ) : (
            <div className="h-16 w-16 bg-slate-100 rounded-lg flex items-center justify-center">
              <BuildingOfficeIcon className="h-8 w-8 text-slate-400" />
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {brand.brandName || 'Your Brand Name'}
            </h3>
            {brand.brandId && (
              <p className="text-sm text-slate-500 font-mono">
                ID: {brand.brandId}
              </p>
            )}
          </div>
        </div>

        {/* Brand Details */}
        <div className="space-y-3">
          {brand.website && (
            <div className="flex items-center space-x-2 text-sm">
              <GlobeAltIcon className="h-4 w-4 text-slate-400" />
              <a
                href={brand.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-500"
              >
                {brand.website}
              </a>
            </div>
          )}

          {brand.industry && (
            <div className="flex items-center space-x-2 text-sm">
              <BuildingOfficeIcon className="h-4 w-4 text-slate-400" />
              <span className="text-slate-600 capitalize">
                {brand.industry.replace('-', ' ')}
              </span>
            </div>
          )}

          {brand.brandDescription && (
            <div className="text-sm text-slate-600">
              <p className="leading-relaxed">{brand.brandDescription}</p>
            </div>
          )}

          {brand.tags && brand.tags.length > 0 && (
            <div className="flex items-start space-x-2 text-sm">
              <TagIcon className="h-4 w-4 text-slate-400 mt-0.5" />
              <div className="flex flex-wrap gap-1">
                {brand.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Empty State */}
        {!brand.brandName && !brand.website && !brand.industry && !brand.brandDescription && (
          <div className="text-center py-8 text-slate-500">
            <BuildingOfficeIcon className="mx-auto h-12 w-12 text-slate-300 mb-4" />
<p className="text-sm">
              Fill out the form to see your brand preview
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
