import React from 'react';

interface MiniSparklineProps {
  value: number;
  average: number;
  color?: string;
}

/**
 * Tiny inline SVG sparkline bar showing a value relative to the average.
 * Green if above average, red if below.
 */
export const MiniSparkline: React.FC<MiniSparklineProps> = ({ value, average, color }) => {
  const isAbove = value >= average;
  // Themed token classes so the bar tracks the design system in both modes;
  // an explicit color prop still wins. Position against the dashed average
  // marker carries the same signal for color-blind readers.
  const barClass = isAbove ? 'text-success-500' : 'text-error-500';
  // Normalize to 0-100 range, capping at 2x average
  const maxVal = Math.max(average * 2, 1);
  const pct = Math.min((value / maxVal) * 100, 100);
  const avgPct = Math.min((average / maxVal) * 100, 100);

  return (
    <svg
      width="48"
      height="16"
      viewBox="0 0 48 16"
      className="inline-block align-middle"
      role="img"
      aria-label={`${value.toFixed(1)}% vs ${average.toFixed(1)}% average`}
    >
      {/* Background track */}
      <rect x="0" y="6" width="48" height="4" rx="2" fill="currentColor" className="text-muted/20" />
      {/* Value bar */}
      <rect
        x="0"
        y="6"
        width={Math.max((pct / 100) * 48, 2)}
        height="4"
        rx="2"
        fill={color ?? 'currentColor'}
        className={color ? undefined : barClass}
      />
      {/* Average marker */}
      <line
        x1={(avgPct / 100) * 48}
        y1="3"
        x2={(avgPct / 100) * 48}
        y2="13"
        stroke="currentColor"
        className="text-muted-foreground"
        strokeWidth="1"
        strokeDasharray="2 1"
      />
    </svg>
  );
};

export default MiniSparkline;
