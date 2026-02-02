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

  return (
    <div
      className="absolute z-50 bg-white shadow-lg rounded-lg p-3 pointer-events-none border border-gray-200"
      style={{
        left: `${position.x + 10}px`,
        top: `${position.y + 10}px`
      }}
    >
      <p className="text-sm font-semibold text-gray-900 mb-2">{content.countryName}</p>
      <div className="space-y-1 text-xs text-gray-600">
        <p>Clicks: {formatNumber(content.clicks)}</p>
        <p>Opens: {formatNumber(content.opens)}</p>
        <p>Engagement: {formatEngagementRate(content.engagementRate)}</p>
      </div>
    </div>
  );
}
