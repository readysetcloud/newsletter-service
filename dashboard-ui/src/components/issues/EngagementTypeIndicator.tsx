import React from 'react';
import { EngagementType } from '../../types/issues';

export interface EngagementTypeIndicatorProps {
  engagementType: EngagementType;
  totalClicks: number;
}

export const EngagementTypeIndicator: React.FC<EngagementTypeIndicatorProps> = ({
  engagementType,
  totalClicks,
}) => {
  const { newClickers, returningClickers } = engagementType;

  const newPercent = totalClicks > 0 ? (newClickers / totalClicks) * 100 : 0;
  const returningPercent = totalClicks > 0 ? (returningClickers / totalClicks) * 100 : 0;

  return (
    <div className="bg-white rounded-lg shadow p-3 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Engagement Type</h3>

      <div className="space-y-3 sm:space-y-4">
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs sm:text-sm font-medium text-gray-700">New Clickers</span>
            <span className="text-xs sm:text-sm text-gray-600">{newPercent.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full"
                style={{ width: `${newPercent}%` }}
              />
            </div>
            <span className="text-xs sm:text-sm font-semibold text-gray-900 min-w-[2.5rem] sm:min-w-[3rem] text-right">
              {newClickers.toLocaleString()}
            </span>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs sm:text-sm font-medium text-gray-700">Returning Clickers</span>
            <span className="text-xs sm:text-sm text-gray-600">{returningPercent.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full"
                style={{ width: `${returningPercent}%` }}
              />
            </div>
            <span className="text-xs sm:text-sm font-semibold text-gray-900 min-w-[2.5rem] sm:min-w-[3rem] text-right">
              {returningClickers.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="pt-3 sm:pt-4 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <span className="text-xs sm:text-sm font-medium text-gray-700">Total Unique Clickers</span>
            <span className="text-base sm:text-lg font-bold text-gray-900">
              {totalClicks.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
