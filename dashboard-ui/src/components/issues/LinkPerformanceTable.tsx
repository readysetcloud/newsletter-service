import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { LinkPerformance } from '../../types/issues';

export interface LinkPerformanceTableProps {
  links: LinkPerformance[];
  totalClicks: number;
}

export const LinkPerformanceTable: React.FC<LinkPerformanceTableProps> = ({ links, totalClicks }) => {
  if (!links || links.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No link performance data available
      </div>
    );
  }

  const sortedLinks = [...links].sort((a, b) => b.clicks - a.clicks);

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <div className="inline-block min-w-full align-middle">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-border bg-muted/30">
              <th className="text-left py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground">
                Link
              </th>
              <th className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground hidden sm:table-cell">
                Position
              </th>
              <th className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground">
                Clicks
              </th>
              <th className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground">
                % of Total
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedLinks.map((link, index) => (
              <tr
                key={`${link.url}-${index}`}
                className="border-b border-border hover:bg-muted/20 transition-colors"
              >
                <td className="py-2 sm:py-3 px-2 sm:px-4">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 sm:gap-2 text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded text-xs sm:text-sm touch-manipulation"
                    aria-label={`Open link: ${link.url}`}
                  >
                    <span className="truncate max-w-[200px] sm:max-w-md">{link.url}</span>
                    <ExternalLink className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" aria-hidden="true" />
                  </a>
                </td>
                <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm text-muted-foreground hidden sm:table-cell">
                  {link.position}
                </td>
                <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm font-medium whitespace-nowrap">
                  {link.clicks.toLocaleString()}
                </td>
                <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm font-medium text-blue-600 whitespace-nowrap">
                  {link.percentOfTotal.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/50">
              <td className="py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm text-foreground" colSpan={2}>
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
    </div>
  );
};
