import { TooltipData } from './GeoMap';

export interface TooltipProps {
  content: TooltipData | null;
  position: { x: number; y: number };
}

export function Tooltip({ content, position }: TooltipProps) {
  if (!content) return null;

  const formatNumber = (num: number) => num.toLocaleString();
  const formatEngagementRate = (rate: number | null) =>
    rate !== null ? `${rate.toFixed(1)}%` : 'N/A';
  const formatUniqueEngagementRate = (rate?: number | null) =>
    rate !== undefined ? formatEngagementRate(rate) : null;

  return (
    <div
      className="absolute z-50 bg-white shadow-xl rounded-lg p-4 pointer-events-none border-2 border-blue-200 max-w-xs"
      style={{
        left: `${position.x + 10}px`,
        top: `${position.y + 10}px`
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-base font-bold text-gray-900">{content.countryName}</p>
        <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded">
          {content.countryCode}
        </span>
      </div>

      <div className="space-y-2">
        <div className="border-b border-gray-200 pb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Total Engagement</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-gray-600">Clicks:</span>
              <span className="ml-1 font-semibold text-blue-600">{formatNumber(content.clicks)}</span>
            </div>
            <div>
              <span className="text-gray-600">Opens:</span>
              <span className="ml-1 font-semibold text-green-600">{formatNumber(content.opens)}</span>
            </div>
          </div>
        </div>

        {(content.uniqueClicks !== undefined || content.uniqueOpens !== undefined) && (
          <div className="border-b border-gray-200 pb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Unique Users</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {content.uniqueClicks !== undefined && (
                <div>
                  <span className="text-gray-600">Clicks:</span>
                  <span className="ml-1 font-semibold text-blue-600">{formatNumber(content.uniqueClicks)}</span>
                </div>
              )}
              {content.uniqueOpens !== undefined && (
                <div>
                  <span className="text-gray-600">Opens:</span>
                  <span className="ml-1 font-semibold text-green-600">{formatNumber(content.uniqueOpens)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Engagement Rate</p>
          <div className="text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Click-through:</span>
              <span className="font-semibold text-purple-600">{formatEngagementRate(content.engagementRate)}</span>
            </div>
            {formatUniqueEngagementRate(content.uniqueEngagementRate) && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-gray-600">Unique CTR:</span>
                <span className="font-semibold text-purple-600">{formatUniqueEngagementRate(content.uniqueEngagementRate)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
