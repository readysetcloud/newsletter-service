/* eslint-disable react-refresh/only-export-components */
import { useState, useMemo, useCallback } from 'react';
import { scaleLinear } from 'd3-scale';
import { MapContainer } from './MapContainer';
import { MetricToggle } from './MetricToggle';
import { ColorLegend } from './ColorLegend';
import { Attribution } from './Attribution';
import { Tooltip } from './Tooltip';

export interface GeoDistributionData {
  country: string;
  clicks: number;
  opens: number;
}

export interface GeoMapProps {
  geoDistribution: GeoDistributionData[];
  selectedMetric?: 'clicks' | 'opens' | 'engagementRate';
  onMetricChange?: (metric: 'clicks' | 'opens' | 'engagementRate') => void;
  className?: string;
  linkAnalytics?: LinkAnalytics[];
  selectedLinkId?: string | null;
}

export interface LinkAnalytics {
  linkId: string;
  url: string;
  title?: string;
  totalClicks: number;
  geoDistribution: GeoDistributionData[];
}

export interface TooltipData {
  countryName: string;
  countryCode: string;
  clicks: number;
  opens: number;
  engagementRate: number | null;
}

interface GeoMapState {
  hoveredCountry: string | null;
  tooltipContent: TooltipData | null;
  selectedMetric: 'clicks' | 'opens' | 'engagementRate';
}

export function calculateEngagementRate(clicks: number, opens: number): number | null {
  if (opens === 0) return null;
  return (clicks / opens) * 100;
}

export function getMetricValue(data: GeoDistributionData, metric: 'clicks' | 'opens' | 'engagementRate'): number {
  switch (metric) {
    case 'clicks': {
      return data.clicks;
    }
    case 'opens': {
      return data.opens;
    }
    case 'engagementRate': {
      const rate = calculateEngagementRate(data.clicks, data.opens);
      return rate !== null ? rate : 0;
    }
    default:
      return 0;
  }
}

export function createColorScale(data: GeoDistributionData[], metric: 'clicks' | 'opens' | 'engagementRate'): (value: number) => string {
  if (data.length === 0) {
    return () => '#e5e7eb';
  }

  const values = data.map(d => getMetricValue(d, metric));
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);

  if (data.length === 1 || minValue === maxValue) {
    return () => '#60a5fa';
  }

  return scaleLinear<string>()
    .domain([minValue, maxValue])
    .range(['#dbeafe', '#1e40af'])
    .clamp(true);
}

export function validateGeoDistribution(data: GeoDistributionData[]): GeoDistributionData[] {
  if (!data || !Array.isArray(data)) {
    return [];
  }

  return data.filter(item => {
    if (!item.country || typeof item.country !== 'string' || item.country.length !== 2) {
      console.warn('Invalid country code:', item.country);
      return false;
    }

    if (typeof item.clicks !== 'number' || item.clicks < 0) {
      console.warn('Invalid clicks value for country:', item.country);
      return false;
    }

    if (typeof item.opens !== 'number' || item.opens < 0) {
      console.warn('Invalid opens value for country:', item.country);
      return false;
    }

    return true;
  });
}

export function GeoMap({
  geoDistribution,
  selectedMetric: controlledMetric,
  onMetricChange,
  className = '',
  linkAnalytics = [],
  selectedLinkId = null
}: GeoMapProps) {
  const [state, setState] = useState<GeoMapState>({
    hoveredCountry: null,
    tooltipContent: null,
    selectedMetric: controlledMetric || 'clicks'
  });
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const validatedGeoDistribution = useMemo(
    () => validateGeoDistribution(geoDistribution),
    [geoDistribution]
  );

  const filteredGeoDistribution = useMemo(() => {
    if (!selectedLinkId || linkAnalytics.length === 0) {
      return validatedGeoDistribution;
    }

    const linkData = linkAnalytics.find(link => link.linkId === selectedLinkId);
    return linkData?.geoDistribution ? validateGeoDistribution(linkData.geoDistribution) : [];
  }, [validatedGeoDistribution, linkAnalytics, selectedLinkId]);

  const handleMetricChange = (metric: 'clicks' | 'opens' | 'engagementRate') => {
    setState(prev => ({ ...prev, selectedMetric: metric }));
    onMetricChange?.(metric);
  };

  const colorScale = useMemo(
    () => createColorScale(filteredGeoDistribution, state.selectedMetric),
    [filteredGeoDistribution, state.selectedMetric]
  );

  const countryCodeMap = useMemo(() => new Map<string, string>(), []);

  const handleCountryHover = useCallback((countryCode: string | null, data: GeoDistributionData | null, event?: React.MouseEvent) => {
    const COUNTRY_NAMES: Record<string, string> = {
      US: 'United States', GB: 'United Kingdom', FR: 'France', DE: 'Germany',
      CA: 'Canada', AU: 'Australia', JP: 'Japan', CN: 'China', IN: 'India',
      BR: 'Brazil', MX: 'Mexico', ES: 'Spain', IT: 'Italy', NL: 'Netherlands',
      SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', PL: 'Poland',
      RU: 'Russia', KR: 'South Korea', SG: 'Singapore', NZ: 'New Zealand'
    };

    if (event) {
      setTooltipPosition({ x: event.clientX, y: event.clientY });
    }

    if (countryCode && data) {
      setState(prev => ({
        ...prev,
        hoveredCountry: countryCode,
        tooltipContent: {
          countryName: COUNTRY_NAMES[countryCode] || countryCode,
          countryCode,
          clicks: data.clicks,
          opens: data.opens,
          engagementRate: calculateEngagementRate(data.clicks, data.opens)
        }
      }));
    } else {
      setState(prev => ({
        ...prev,
        hoveredCountry: null,
        tooltipContent: null
      }));
    }
  }, []);

  const values = filteredGeoDistribution.map(d => getMetricValue(d, state.selectedMetric));
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  const metricLabels = {
    clicks: 'Clicks',
    opens: 'Opens',
    engagementRate: 'Engagement Rate (%)'
  };

  if (selectedLinkId && filteredGeoDistribution.length === 0) {
    return (
      <div className={`geo-map ${className}`}>
        <MetricToggle
          selectedMetric={state.selectedMetric}
          onMetricChange={handleMetricChange}
        />
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-600">
          No geographic data available for this link
        </div>
        <Attribution />
      </div>
    );
  }

  return (
    <div className={`geo-map ${className}`}>
      <MetricToggle
        selectedMetric={state.selectedMetric}
        onMetricChange={handleMetricChange}
      />

      <div className="relative bg-gray-50 rounded-lg p-4" style={{ height: '500px' }}>
        <MapContainer
          geoDistribution={filteredGeoDistribution}
          selectedMetric={state.selectedMetric}
          colorScale={colorScale}
          onCountryHover={handleCountryHover}
          countryCodeMap={countryCodeMap}
        />
        <Tooltip content={state.tooltipContent} position={tooltipPosition} />
      </div>

      <ColorLegend
        minValue={minValue}
        maxValue={maxValue}
        colorScale={colorScale}
        metricLabel={metricLabels[state.selectedMetric]}
      />

      <Attribution />
    </div>
  );
}
