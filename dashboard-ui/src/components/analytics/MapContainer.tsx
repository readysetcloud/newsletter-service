import { useEffect, useState, useMemo, useCallback } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { GeoDistributionData, getMetricValue } from './GeoMap';
import type { GeoMetric } from './MetricToggle';

export interface MapContainerProps {
  geoDistribution: GeoDistributionData[];
  selectedMetric: GeoMetric;
  colorScale: (value: number) => string;
  onCountryHover: (country: string | null, data: GeoDistributionData | null, event?: React.MouseEvent) => void;
  countryCodeMap: Map<string, string>;
}

export function MapContainer({
  geoDistribution,
  selectedMetric,
  colorScale,
  onCountryHover,
  countryCodeMap
}: MapContainerProps) {
  const [geographiesData, setGeographiesData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const countryDataMap = useMemo(
    () => new Map(geoDistribution.map(d => [d.country, d])),
    [geoDistribution]
  );

  const handleCountryHover = useCallback((isoCode: string | null, countryData: GeoDistributionData | null | undefined, event?: React.MouseEvent) => {
    if (countryData) {
      onCountryHover(isoCode, countryData, event);
    } else {
      onCountryHover(null, null);
    }
  }, [onCountryHover]);

  useEffect(() => {
    fetch('/world-110m.json')
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load map data');
        }
        return response.json();
      })
      .then(data => setGeographiesData(data))
      .catch(err => {
        console.error('Failed to load TopoJSON:', err);
        setError('Map data could not be loaded');
      });
  }, []);

  if (error) {
    return (
      <div className="p-4 text-center text-gray-600">
        {error}
      </div>
    );
  }

  if (!geographiesData) {
    return (
      <div className="p-4 text-center text-gray-600">
        Loading map...
      </div>
    );
  }

  return (
    <ComposableMap
      projection="geoMercator"
      projectionConfig={{ scale: 100 }}
      className="w-full h-full"
    >
      <ZoomableGroup>
        <Geographies geography={geographiesData}>
          {({ geographies }: { geographies: Array<Record<string, unknown>> }) =>
            geographies.map((geo: Record<string, unknown>) => {
              const isoCode = countryCodeMap.get(geo.id as string) || (geo.properties as Record<string, unknown>)?.iso_a2 as string;
              const countryData = isoCode ? countryDataMap.get(isoCode) : null;

              const fillColor = countryData
                ? colorScale(getMetricValue(countryData, selectedMetric))
                : '#e5e7eb';

              return (
                <Geography
                  key={geo.rsmKey as string}
                  geography={geo}
                  fill={fillColor}
                  stroke="#d1d5db"
                  strokeWidth={0.5}
                  onMouseEnter={(event) => handleCountryHover(isoCode, countryData, event)}
                  onMouseLeave={() => handleCountryHover(null, null)}
                  style={{
                    default: { outline: 'none' },
                    hover: { fill: '#60a5fa', outline: 'none', cursor: 'pointer' },
                    pressed: { fill: '#3b82f6', outline: 'none' }
                  }}
                />
              );
            })
          }
        </Geographies>
      </ZoomableGroup>
    </ComposableMap>
  );
}
