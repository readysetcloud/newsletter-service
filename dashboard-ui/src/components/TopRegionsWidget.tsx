import React, { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { issuesService } from '@/services/issuesService';
import type { GeoData } from '@/types';

interface TopRegionsWidgetProps {
  latestIssueId: string;
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', IN: 'India', BR: 'Brazil', NL: 'Netherlands',
  SE: 'Sweden', JP: 'Japan', ES: 'Spain', IT: 'Italy', MX: 'Mexico',
  NZ: 'New Zealand', IE: 'Ireland', SG: 'Singapore', CH: 'Switzerland',
  NO: 'Norway', DK: 'Denmark', FI: 'Finland', PL: 'Poland', BE: 'Belgium',
  AT: 'Austria', PT: 'Portugal', ZA: 'South Africa', KR: 'South Korea',
  unknown: 'Unknown',
};

function getCountryName(code: string): string {
  return COUNTRY_NAMES[code] || code;
}

export const TopRegionsWidget: React.FC<TopRegionsWidgetProps> = ({ latestIssueId }) => {
  const [regions, setRegions] = useState<GeoData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await issuesService.getIssue(latestIssueId);
        if (!cancelled && response.success && response.data?.stats?.analytics?.geoDistribution) {
          const geo = response.data.stats.analytics.geoDistribution;
          // Sort by clicks descending, take top 5
          const sorted = [...geo].sort((a, b) => b.clicks - a.clicks).slice(0, 5);
          setRegions(sorted);
        }
      } catch {
        // Silently fail — widget is supplementary
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [latestIssueId]);

  if (loading) {
    return (
      <div className="bg-surface rounded-lg shadow p-3 sm:p-4">
        <h3 className="text-sm sm:text-base font-medium text-foreground flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-muted-foreground" />
          Top Regions
        </h3>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-5 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (regions.length === 0) {
    return (
      <div className="bg-surface rounded-lg shadow p-3 sm:p-4">
        <h3 className="text-sm sm:text-base font-medium text-foreground flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-muted-foreground" />
          Top Regions
        </h3>
        <p className="text-xs sm:text-sm text-muted-foreground">No geo data available yet</p>
      </div>
    );
  }

  const maxClicks = regions[0].clicks;

  return (
    <div className="bg-surface rounded-lg shadow p-3 sm:p-4">
      <h3 className="text-sm sm:text-base font-medium text-foreground flex items-center gap-2 mb-3">
        <Globe className="w-4 h-4 text-muted-foreground" />
        Top Regions
      </h3>
      <p className="text-xs text-muted-foreground mb-2">Latest issue by clicks</p>
      <div className="space-y-2">
        {regions.map((region) => (
          <div key={region.country} className="flex items-center gap-2">
            <span className="text-xs sm:text-sm text-foreground w-28 truncate">
              {getCountryName(region.country)}
            </span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-2 bg-primary-500 rounded-full"
                style={{ width: `${maxClicks > 0 ? (region.clicks / maxClicks) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-8 text-right">{region.clicks}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TopRegionsWidget;
