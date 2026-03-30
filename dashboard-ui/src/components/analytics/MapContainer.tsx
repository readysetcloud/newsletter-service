import { useEffect, useState, useMemo, useCallback } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { GeoDistributionData, getMetricValue } from './GeoMap';
import type { GeoMetric } from './MetricToggle';

// ISO 3166-1 numeric to alpha-2 mapping
const NUMERIC_TO_ALPHA2: Record<string, string> = {
  '004': 'AF', '008': 'AL', '010': 'AQ', '012': 'DZ', '024': 'AO', '031': 'AZ',
  '032': 'AR', '036': 'AU', '040': 'AT', '044': 'BS', '050': 'BD', '051': 'AM',
  '056': 'BE', '064': 'BT', '068': 'BO', '070': 'BA', '072': 'BW', '076': 'BR',
  '084': 'BZ', '090': 'SB', '096': 'BN', '100': 'BG', '104': 'MM', '108': 'BI',
  '112': 'BY', '116': 'KH', '120': 'CM', '124': 'CA', '140': 'CF', '144': 'LK',
  '148': 'TD', '152': 'CL', '156': 'CN', '158': 'TW', '170': 'CO', '178': 'CG',
  '180': 'CD', '188': 'CR', '191': 'HR', '192': 'CU', '196': 'CY', '203': 'CZ',
  '204': 'BJ', '208': 'DK', '214': 'DO', '218': 'EC', '222': 'SV', '226': 'GQ',
  '231': 'ET', '232': 'ER', '233': 'EE', '238': 'FK', '242': 'FJ', '246': 'FI',
  '250': 'FR', '260': 'TF', '262': 'DJ', '266': 'GA', '268': 'GE', '270': 'GM',
  '275': 'PS', '276': 'DE', '288': 'GH', '300': 'GR', '304': 'GL', '320': 'GT',
  '324': 'GN', '328': 'GY', '332': 'HT', '340': 'HN', '348': 'HU', '352': 'IS',
  '356': 'IN', '360': 'ID', '364': 'IR', '368': 'IQ', '372': 'IE', '376': 'IL',
  '380': 'IT', '384': 'CI', '388': 'JM', '392': 'JP', '398': 'KZ', '400': 'JO',
  '404': 'KE', '408': 'KP', '410': 'KR', '414': 'KW', '417': 'KG', '418': 'LA',
  '422': 'LB', '426': 'LS', '428': 'LV', '430': 'LR', '434': 'LY', '440': 'LT',
  '442': 'LU', '450': 'MG', '454': 'MW', '458': 'MY', '466': 'ML', '478': 'MR',
  '484': 'MX', '496': 'MN', '498': 'MD', '499': 'ME', '504': 'MA', '508': 'MZ',
  '512': 'OM', '516': 'NA', '524': 'NP', '528': 'NL', '540': 'NC', '548': 'VU',
  '554': 'NZ', '558': 'NI', '562': 'NE', '566': 'NG', '578': 'NO', '586': 'PK',
  '591': 'PA', '598': 'PG', '600': 'PY', '604': 'PE', '608': 'PH', '616': 'PL',
  '620': 'PT', '624': 'GW', '626': 'TL', '630': 'PR', '634': 'QA', '642': 'RO',
  '643': 'RU', '646': 'RW', '682': 'SA', '686': 'SN', '688': 'RS', '694': 'SL',
  '700': 'SG', '703': 'SK', '704': 'VN', '705': 'SI', '706': 'SO', '710': 'ZA',
  '716': 'ZW', '724': 'ES', '728': 'SS', '729': 'SD', '732': 'EH', '740': 'SR',
  '748': 'SZ', '752': 'SE', '756': 'CH', '760': 'SY', '762': 'TJ', '764': 'TH',
  '768': 'TG', '780': 'TT', '784': 'AE', '788': 'TN', '792': 'TR', '795': 'TM',
  '800': 'UG', '804': 'UA', '807': 'MK', '818': 'EG', '826': 'GB', '834': 'TZ',
  '840': 'US', '854': 'BF', '858': 'UY', '860': 'UZ', '862': 'VE', '887': 'YE',
  '894': 'ZM'
};

export interface MapContainerProps {
  geoDistribution: GeoDistributionData[];
  selectedMetric: GeoMetric;
  colorScale: (value: number) => string;
  onCountryHover: (country: string | null, data: GeoDistributionData | null, event?: React.MouseEvent) => void;
  countryCodeMap: Map<string, string>;
  highlightedCountry?: string | null;
  zoomLevel?: number;
}

export function MapContainer({
  geoDistribution,
  selectedMetric,
  colorScale,
  onCountryHover,
  countryCodeMap,
  highlightedCountry = null,
  zoomLevel = 1
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
      projectionConfig={{ scale: 100 * zoomLevel }}
      className="w-full h-full"
    >
      <ZoomableGroup zoom={zoomLevel}>
        <Geographies geography={geographiesData}>
          {({ geographies }: { geographies: Array<Record<string, unknown>> }) =>
            geographies.map((geo: Record<string, unknown>) => {
              const isoCode = NUMERIC_TO_ALPHA2[geo.id as string] || countryCodeMap.get(geo.id as string) || (geo.properties as Record<string, unknown>)?.iso_a2 as string;
              const countryData = isoCode ? countryDataMap.get(isoCode) : null;
              const isHighlighted = highlightedCountry === isoCode;

              const fillColor = countryData
                ? colorScale(getMetricValue(countryData, selectedMetric))
                : '#e5e7eb';

              return (
                <Geography
                  key={geo.rsmKey as string}
                  geography={geo}
                  fill={fillColor}
                  stroke={isHighlighted ? '#1e40af' : '#d1d5db'}
                  strokeWidth={isHighlighted ? 2 : 0.5}
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
