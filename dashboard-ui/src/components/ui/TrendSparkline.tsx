import React, { useMemo } from 'react';

export interface TrendSparklineProps {
  /** Metric history, oldest first. Needs at least two points to render. */
  values: number[];
  className?: string;
}

/**
 * Decorative trend line for a metric across recent issues, with the latest
 * point emphasized. The values are surfaced as text elsewhere in the tile,
 * so the whole drawing is aria-hidden.
 */
export const TrendSparkline: React.FC<TrendSparklineProps> = React.memo(({ values, className }) => {
  const geometry = useMemo(() => {
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const top = 3;
    const bottom = 25;

    const points = values.map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = range === 0 ? (top + bottom) / 2 : bottom - ((value - min) / range) * (bottom - top);
      return { x, y };
    });

    const line = points.map(p => `${p.x},${p.y}`).join(' ');
    const area = `M0,28 L${points.map(p => `${p.x},${p.y}`).join(' L')} L100,28 Z`;
    const last = points[points.length - 1];

    return { line, area, last };
  }, [values]);

  if (!geometry) return null;

  return (
    <div className={`relative h-8 ${className ?? ''}`} aria-hidden="true">
      <svg
        className="absolute inset-0 w-full h-full text-primary-500"
        viewBox="0 0 100 28"
        preserveAspectRatio="none"
      >
        <path d={geometry.area} fill="currentColor" opacity={0.12} />
        <polyline
          points={geometry.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute w-1.5 h-1.5 rounded-full bg-primary-600 -translate-x-1/2 -translate-y-1/2"
        style={{
          left: `${geometry.last.x}%`,
          top: `${(geometry.last.y / 28) * 100}%`,
        }}
      />
    </div>
  );
});

TrendSparkline.displayName = 'TrendSparkline';

export default TrendSparkline;
