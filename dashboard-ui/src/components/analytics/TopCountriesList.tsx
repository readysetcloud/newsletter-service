import React from 'react';
import { MapPin } from 'lucide-react';
import type { GeoDistributionData } from './GeoMap';
import type { GeoMetric } from './MetricToggle';
import { getMetricValue } from './GeoMap';

export interface TopCountriesListProps {
  geoDistribution: GeoDistributionData[];
  selectedMetric: GeoMetric;
  onCountryClick?: (countryCode: string) => void;
  highlightedCountry?: string | null;
  maxCountries?: number;
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  FR: 'France',
  DE: 'Germany',
  CA: 'Canada',
  AU: 'Australia',
  JP: 'Japan',
  CN: 'China',
  IN: 'India',
  BR: 'Brazil',
  MX: 'Mexico',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  PL: 'Poland',
  RU: 'Russia',
  KR: 'South Korea',
  SG: 'Singapore',
  NZ: 'New Zealand',
  CH: 'Switzerland',
  BE: 'Belgium',
  AT: 'Austria',
  IE: 'Ireland',
  PT: 'Portugal',
  GR: 'Greece',
  CZ: 'Czech Republic',
  RO: 'Romania',
  HU: 'Hungary',
  IL: 'Israel',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  ZA: 'South Africa',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  TH: 'Thailand',
  MY: 'Malaysia',
  ID: 'Indonesia',
  PH: 'Philippines',
  VN: 'Vietnam',
  TR: 'Turkey',
  EG: 'Egypt',
  NG: 'Nigeria',
  KE: 'Kenya'
};

export const TopCountriesList: React.FC<TopCountriesListProps> = ({
  geoDistribution,
  selectedMetric,
  onCountryClick,
  highlightedCountry,
  maxCountries = 5
}) => {
  // Sort countries by the selected metric
  const sortedCountries = [...geoDistribution]
    .sort((a, b) => getMetricValue(b, selectedMetric) - getMetricValue(a, selectedMetric))
    .slice(0, maxCountries);

  if (sortedCountries.length === 0) {
    return (
      <div className="bg-surface rounded-lg border border-border p-4">
        <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          Top Countries
        </h4>
        <p className="text-sm text-muted-foreground">No geographic data available</p>
      </div>
    );
  }

  const getMetricLabel = (metric: GeoMetric): string => {
    switch (metric) {
      case 'clicks':
        return 'Clicks';
      case 'opens':
        return 'Opens';
      case 'uniqueClicks':
        return 'Unique Clicks';
      case 'uniqueOpens':
        return 'Unique Opens';
      case 'engagementRate':
        return 'Engagement Rate';
      case 'uniqueEngagementRate':
        return 'Unique Engagement Rate';
      default:
        return 'Value';
    }
  };

  const formatMetricValue = (value: number, metric: GeoMetric): string => {
    if (metric === 'engagementRate' || metric === 'uniqueEngagementRate') {
      return `${value.toFixed(1)}%`;
    }
    return value.toLocaleString();
  };

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <MapPin className="w-4 h-4" />
        Top {maxCountries} Countries by {getMetricLabel(selectedMetric)}
      </h4>
      <div className="space-y-2">
        {sortedCountries.map((country, index) => {
          const countryName = COUNTRY_NAMES[country.country] || country.country;
          const metricValue = getMetricValue(country, selectedMetric);
          const isHighlighted = highlightedCountry === country.country;

          return (
            <button
              key={country.country}
              onClick={() => onCountryClick?.(country.country)}
              className={`w-full text-left p-2 rounded-lg transition-colors ${
                isHighlighted
                  ? 'bg-blue-100 border-2 border-blue-500'
                  : 'hover:bg-muted/50 border-2 border-transparent'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              aria-label={`View ${countryName} on map`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground w-5">
                    #{index + 1}
                  </span>
                  <span className="text-sm font-medium text-foreground">{countryName}</span>
                  <span className="text-xs text-muted-foreground">({country.country})</span>
                </div>
                <span className="text-sm font-semibold text-blue-600">
                  {formatMetricValue(metricValue, selectedMetric)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
