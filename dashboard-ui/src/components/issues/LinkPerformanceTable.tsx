import React, { useMemo, useState } from 'react';
import { ExternalLink, Copy, Check, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import { InfoTooltip } from '../ui/InfoTooltip';
import { TablePager } from '../ui/TablePager';
import { cn } from '../../utils/cn';
import type { LinkPerformance } from '../../types/issues';

export interface LinkPerformanceTableProps {
  links: LinkPerformance[];
  totalClicks: number;
  onViewOnMap?: (linkUrl: string) => void;
  /** Rows per page. Exposed for tests; the default suits both phone and desktop. */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 10;

export const LinkPerformanceTable: React.FC<LinkPerformanceTableProps> = ({
  links,
  totalClicks,
  onViewOnMap,
  pageSize = DEFAULT_PAGE_SIZE,
}) => {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

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

  const sortedLinks = useMemo(
    () => [...(links || [])].sort((a, b) => b.clicks - a.clicks),
    [links]
  );

  // A shorter list (or a different issue) can leave `page` past the end, so the
  // page actually rendered is always clamped to what exists.
  const pageCount = Math.max(1, Math.ceil(sortedLinks.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const visibleLinks = sortedLinks.slice(pageStart, pageStart + pageSize);

  if (!links || links.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No link performance data available
      </div>
    );
  }

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

  const actionButtonClasses =
    'text-muted-foreground hover:text-foreground rounded touch-manipulation ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-base sm:text-lg font-semibold">Link Performance</h3>
        <InfoTooltip
          label="Link Performance"
          description="Shows which links in your email received the most clicks. Top 3 performing links are highlighted. Use the map icon to view geographic distribution for each link."
        />
      </div>

      {/* Mobile: a card per link. The desktop table has five columns; squeezing
          those into a phone-width viewport left the URL unreadable and the
          numbers cramped, so narrow screens get a stacked layout instead. */}
      <ol className="sm:hidden space-y-2" aria-label="Link performance">
        {visibleLinks.map((link, index) => {
          const rank = pageStart + index + 1;
          const isTopThree = topThreeUrls.has(link.url);

          return (
            <li
              key={`${link.url}-${index}`}
              className={cn(
                'rounded-lg border border-border p-3',
                isTopThree && 'border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-900/20'
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground flex items-center justify-center"
                  aria-hidden="true"
                >
                  {rank}
                </span>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 text-sm text-blue-600 dark:text-blue-400 break-all line-clamp-2 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                  aria-label={`Open link ranked ${rank}: ${link.url}`}
                >
                  {link.url}
                </a>
              </div>

              <div className="mt-2 flex items-center gap-3">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${(link.clicks / maxClicks) * 100}%` }}
                    aria-hidden="true"
                  />
                </div>
                <span className="text-sm font-medium whitespace-nowrap">
                  {link.clicks.toLocaleString()} {link.clicks === 1 ? 'click' : 'clicks'}
                </span>
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
                  {link.percentOfTotal.toFixed(1)}%
                </span>
              </div>

              <div className="mt-1 flex items-center gap-1">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(actionButtonClasses, 'inline-flex items-center justify-center min-w-[44px] min-h-[44px]')}
                  aria-label={`Open ${link.url} in a new tab`}
                >
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                </a>
                <button
                  type="button"
                  onClick={() => handleCopyUrl(link.url)}
                  className={cn(actionButtonClasses, 'inline-flex items-center justify-center min-w-[44px] min-h-[44px]')}
                  aria-label="Copy URL to clipboard"
                >
                  {copiedUrl === link.url ? (
                    <Check className="w-4 h-4 text-green-600" aria-hidden="true" />
                  ) : (
                    <Copy className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
                {onViewOnMap && link.geoDistribution && link.geoDistribution.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onViewOnMap(link.url)}
                    className={cn(actionButtonClasses, 'inline-flex items-center justify-center min-w-[44px] min-h-[44px]')}
                    aria-label="View on map"
                  >
                    <MapPin className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
                {link.position > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Position {link.position}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="hidden sm:block overflow-x-auto">
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
              <th className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground">
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
            {visibleLinks.map((link, index) => {
              const isTopThree = topThreeUrls.has(link.url);
              const isTruncated = shouldTruncateUrl(link.url);
              const isExpanded = expandedUrls.has(link.url);
              const displayUrl = isTruncated && !isExpanded ? link.url.substring(0, 50) + '...' : link.url;
              const barWidth = (link.clicks / maxClicks) * 100;

              return (
                <tr
                  key={`${link.url}-${index}`}
                  className={cn(
                    'border-b border-border hover:bg-muted/20 transition-colors',
                    isTopThree && 'bg-blue-50/50 dark:bg-blue-900/20'
                  )}
                >
                  <td className="py-2 sm:py-3 px-2 sm:px-4">
                    <div className="flex items-center gap-1 sm:gap-2">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded text-xs sm:text-sm touch-manipulation"
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
                          className={cn(actionButtonClasses, 'p-1')}
                          aria-label={isExpanded ? 'Collapse URL' : 'Expand URL'}
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      )}
                      <button
                        onClick={() => handleCopyUrl(link.url)}
                        className={cn(actionButtonClasses, 'p-1')}
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
                          className={cn(actionButtonClasses, 'p-1')}
                          aria-label="View on map"
                        >
                          <MapPin className="w-3 h-3 sm:w-4 sm:h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm text-muted-foreground">
                    {link.position > 0 ? link.position : '—'}
                  </td>
                  {hasUniqueUsers && (
                    <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm text-muted-foreground hidden md:table-cell">
                      {getUniqueUsers(link)?.toLocaleString() ?? '—'}
                    </td>
                  )}
                  <td className="py-2 sm:py-3 px-2 sm:px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden sm:block w-16 h-4 bg-muted rounded-full overflow-hidden">
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
                      <span className="text-xs sm:text-sm font-medium text-blue-600 dark:text-blue-400">
                        {link.percentOfTotal.toFixed(1)}%
                      </span>
                      <div className="w-full max-w-[60px] h-1.5 bg-muted rounded-full overflow-hidden">
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
                Total (all {sortedLinks.length.toLocaleString()} links)
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

      <TablePager
        page={currentPage}
        pageSize={pageSize}
        totalItems={sortedLinks.length}
        onPageChange={setPage}
        itemLabel="links"
      />

      <details className="mt-4 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
        <summary className="font-semibold cursor-pointer touch-manipulation min-h-[24px]">
          Understanding link performance
        </summary>
        <p className="mt-2">
          The top 3 performing links are highlighted. Links positioned earlier in your email
          typically receive more clicks. Use the map icon to see geographic distribution for each
          link and identify regional preferences.
        </p>
      </details>
    </div>
  );
};
