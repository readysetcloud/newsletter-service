export interface ColorLegendProps {
  minValue: number;
  maxValue: number;
  colorScale: (value: number) => string;
  metricLabel: string;
}

export function ColorLegend({ minValue, maxValue, colorScale, metricLabel }: ColorLegendProps) {
  const steps = 5;
  const gradientStops = Array.from({ length: steps }, (_, i) => {
    const value = minValue + (maxValue - minValue) * (i / (steps - 1));
    return colorScale(value);
  });

  return (
    <div className="flex items-center gap-3 mt-4">
      <span className="text-xs text-gray-600">{minValue.toLocaleString()}</span>
      <div className="flex-1 h-3 rounded-full" style={{
        background: `linear-gradient(to right, ${gradientStops.join(', ')})`
      }} />
      <span className="text-xs text-gray-600">{maxValue.toLocaleString()}</span>
      <span className="text-xs text-gray-500 ml-2">{metricLabel}</span>
    </div>
  );
}
