import React, { useState } from 'react';
import { ExternalLink, Copy, Check, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import { InfoTooltip } from '../ui/InfoTooltip';
import type { LinkPerformance } from '../../types/issues';

export interface LinkPerformanceTableProps {
  links: LinkPerformance[];
  totalClicks: number;
  onViewOnMap?: (linkUrl: string) => void;
}

export const LinkPerformanceTable: React.FC<LinkPerformanceTableProps> = ({ links, totalClicks, onViewOnMap }) => {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set());

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  const toggleUrlExpansion = (url: string) => {
    setExpandedUrls(prev => {
      const newSet = new Set(prev);
      if (newSet.has(url)) {
        newSet.delete(url);
      } else {
        newSet.add(url);
      }
      return newSet;
    });
  };
  if (!links || links.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No link performance data available
      </div>
    );
  }

  const sortedLinks = [...links].sort((a, b) => b.clicks - a.clicks);
  const hasUniqueUsers = sortedLinks.some(link =>
    (link.geoDistribution || []).some(geo =>
      typeof geo.uniqueUsers === 'number' || typeof geo.uniqueClickUsers === 'number'
    )
  );
  const getUniqueUsers = (link: LinkPerformance) => {
    if (!link.geoDistribution) return null;
    const total = link.geoDistribution.reduce((sum, geo) => {
      const value = geo.uniqueUsers ?? geo.uniqueClickUsers;
      return typeof value === 'number' ? sum + value : sum;
    }, 0);
    return total > 0 ? total : null;
  };

  // Determine top 3 performing links
  const topThreeUrls = new Set(sortedLinks.slice(0, 3).map(link => link.url));

  // Helper to check if URL should be truncated
  const shouldTruncateUrl = (url: string) => url.length > 50;

  // Helper to get max click count for bar chart scaling
  const maxClicks = sortedLinks.length > 0 ? sortedLinks[0].clicks : 1;

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <div className="inline-block min-w-full align-middle">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-semibold">Link Performance</h3>
            <InfoTooltip
              label="Link Performance"
              description="Shows which links in your email received the most clicks. Top 3 performing links are highlighted. Use the map icon to view geographic distribution for each link."
            />
          </div>
        </div>
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-border bg-muted/30">
              <th className="text-left py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground">
                <div className="flex items-center gap-1">
                  Link
                  <InfoTooltip
                    label="Link Column"
                    description="The URL that was clicked. Click the external link icon to open, copy icon to copy URL, or map icon to view geographic distribution."
                  />
                </div>
              </th>
              <th className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground hidden sm:table-cell">
                <div className="flex items-center justify-end gap-1">
                  Position
                  <InfoTooltip
                    label="Position"
                    description="The position of this link in your email content (1 = first link, 2 = second link, etc.)."
                  />
                </div>
              </th>
              {hasUniqueUsers && (
                <th className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground hidden md:table-cell">
                  <div className="flex items-center justify-end gap-1">
                    Unique Users
                    <InfoTooltip
                      label="Unique Users"
                      description="Number of distinct recipients who clicked this link. A recipient is counted once even if they clicked multiple times."
                    />
                  </div>
                </th>
              )}
              <th className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground">
                <div className="flex items-center justify-end gap-1">
                  Clicks
                  <InfoTooltip
                    label="Clicks"
                    description="Total number of clicks on this link. Includes multiple clicks from the same recipient."
                  />
                </div>
              </th>
              <th className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground">
                <div className="flex items-center justify-end gap-1">
                  % of Total
                  <InfoTooltip
                    label="Percentage of Total"
                    description="This link's clicks as a percentage of all clicks in this email. Helps identify which content resonates most with your audience."
                  />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedLinks.map((link, index) => {
              const isTopThree = topThreeUrls.has(link.url);
              const isTruncated = shouldTruncateUrl(link.url);
              const isExpanded = expandedUrls.has(link.url);
              const displayUrl = isTruncated && !isExpanded ? link.url.substring(0, 50) + '...' : link.url;
              const barWidth = (link.clicks / maxClicks) * 100;

              return (
                <tr
                  key={`${link.url}-${index}`}
                  className={`border-b border-border hover:bg-muted/20 transition-colors ${
                    isTopThree ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <td className="py-2 sm:py-3 px-2 sm:px-4">
                    <div className="flex items-center gap-1 sm:gap-2">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded text-xs sm:text-sm touch-manipulation"
                        aria-label={`Open link: ${link.url}`}
                      >
                        <span className={isTruncated && !isExpanded ? 'truncate max-w-[150px] sm:max-w-xs' : 'break-all'}>
                          {displayUrl}
                        </span>
                        <ExternalLink className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" aria-hidden="true" />
                      </a>
                      {isTruncated && (
                        <button
                          onClick={() => toggleUrlExpansion(link.url)}
                          className="text-muted-foreground hover:text-foreground p-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          aria-label={isExpanded ? 'Collapse URL' : 'Expand URL'}
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      )}
                      <button
                        onClick={() => handleCopyUrl(link.url)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 touch-manipulation"
                        aria-label="Copy URL to clipboard"
                      >
                        {copiedUrl === link.url ? (
                          <Check className="w-3 h-3 sm:w-4 sm:h-4 text-green-600" />
                        ) : (
                          <Copy className="w-3 h-3 sm:w-4 sm:h-4" />
                        )}
                      </button>
                      {onViewOnMap && link.geoDistribution && link.geoDistribution.length > 0 && (
                        <button
                          onClick={() => onViewOnMap(link.url)}
                          className="text-muted-foreground hover:text-foreground p-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 touch-manipulation"
                          aria-label="View on map"
                        >
                          <MapPin className="w-3 h-3 sm:w-4 sm:h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm text-muted-foreground hidden sm:table-cell">
                    {link.position > 0 ? link.position : '—'}
                  </td>
                  {hasUniqueUsers && (
                    <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm text-muted-foreground hidden md:table-cell">
                      {getUniqueUsers(link)?.toLocaleString() ?? '—'}
                    </td>
                  )}
                  <td className="py-2 sm:py-3 px-2 sm:px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden sm:block w-16 h-4 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${barWidth}%` }}
                          aria-label={`${barWidth.toFixed(1)}% of maximum clicks`}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-medium">{link.clicks.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="py-2 sm:py-3 px-2 sm:px-4 text-right whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs sm:text-sm font-medium text-blue-600">
                        {link.percentOfTotal.toFixed(1)}%
                      </span>
                      <div className="w-full max-w-[60px] h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 transition-all duration-300"
                          style={{ width: `${link.percentOfTotal}%` }}
                          aria-label={`${link.percentOfTotal.toFixed(1)}% of total clicks`}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/50">
              <td
                className="py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground"
                colSpan={hasUniqueUsers ? 3 : 2}
              >
                Total
              </td>
              <td className="py-2 sm:py-3 px-2 sm:px-4 text-right font-semibold text-xs sm:text-sm text-foreground whitespace-nowrap">
                {totalClicks.toLocaleString()}
              </td>
              <td className="py-2 sm:py-3 px-2 sm:px-4 text-right font-semibold text-xs sm:text-sm text-foreground whitespace-nowrap">
                100.0%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
        <p className="font-semibold mb-1">Understanding Link Performance:</p>
        <p>
          The top 3 performing links are highlighted with a blue background.
          Links positioned earlier in your email typically receive more clicks.
          Use the map icon to see geographic distribution for each link and identify regional preferences.
        </p>
      </div>
    </div>
  );
};
