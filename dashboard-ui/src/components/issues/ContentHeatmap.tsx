/* eslint-disable react-refresh/only-export-components */
import React, { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { Flame, ArrowDownWideNarrow } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatMarkdown, escapeHtmlAttribute } from '../../utils/markdown';
import { ColorLegend } from '../analytics/ColorLegend';
import { InfoTooltip } from '../ui/InfoTooltip';
import type { LinkPerformance } from '../../types/issues';

export interface ContentHeatmapProps {
  /** The raw markdown content of the issue. */
  content: string;
  /** Per-link click performance from issue analytics. */
  links: LinkPerformance[];
  /** Total clicks across the issue (used for the share narrative). */
  totalClicks: number;
  /** Optional additional CSS classes for the container. */
  className?: string;
}

/** Cool → hot color ramp used for the link heat overlay. */
export function createHeatColorScale(maxClicks: number): (clicks: number) => string {
  if (maxClicks <= 0) {
    return () => 'transparent';
  }
  return scaleLinear<string>()
    .domain([0, maxClicks / 2, maxClicks])
    .range(['#fef9c3', '#fb923c', '#b91c1c'])
    .clamp(true);
}

export interface ReadDepthStats {
  /** Links with a known position, sorted in document order. */
  ordered: LinkPerformance[];
  /** Total clicks attributed to positioned links. */
  attributedClicks: number;
  /** Number of links that received at least one click. */
  clickedLinks: number;
  /** Total number of positioned links. */
  totalLinks: number;
  /** Highest link position (1-based) that received any click; 0 if none. */
  deepestClickedPosition: number;
  /** Number of links from the top by which 80% of clicks had occurred; 0 if none. */
  depthForEightyPercent: number;
  /** Share (0-100) of clicks captured by the single best-performing link. */
  topLinkSharePct: number;
}

/**
 * Derives "how far did readers get" statistics from per-link click data. The
 * proxy for read depth is link position: links are wrapped for tracking in
 * document order, so engagement on later links implies readers scrolled
 * further. See functions/update-link-tracking.mjs for the position semantics.
 */
export function computeReadDepth(links: LinkPerformance[]): ReadDepthStats {
  const ordered = links
    .filter((link) => link.position > 0)
    .sort((a, b) => a.position - b.position);

  const attributedClicks = ordered.reduce((sum, link) => sum + link.clicks, 0);
  const clickedLinks = ordered.filter((link) => link.clicks > 0).length;
  const deepestClickedPosition = ordered.reduce(
    (deepest, link) => (link.clicks > 0 ? Math.max(deepest, link.position) : deepest),
    0
  );

  let cumulative = 0;
  let depthForEightyPercent = 0;
  if (attributedClicks > 0) {
    for (let i = 0; i < ordered.length; i += 1) {
      cumulative += ordered[i].clicks;
      if (cumulative / attributedClicks >= 0.8) {
        depthForEightyPercent = i + 1;
        break;
      }
    }
  }

  const topLinkClicks = ordered.reduce((max, link) => Math.max(max, link.clicks), 0);
  const topLinkSharePct = attributedClicks > 0 ? (topLinkClicks / attributedClicks) * 100 : 0;

  return {
    ordered,
    attributedClicks,
    clickedLinks,
    totalLinks: ordered.length,
    deepestClickedPosition,
    depthForEightyPercent,
    topLinkSharePct,
  };
}

/**
 * Renders the issue's content with a click heat overlay on every tracked link
 * plus per-link annotations, a legend, and a read-depth summary. Lets the author
 * see, in context, which links drew attention and how far down the content
 * readers engaged.
 */
export const ContentHeatmap: React.FC<ContentHeatmapProps> = React.memo(
  ({ content, links, totalClicks, className }) => {
    const maxClicks = useMemo(
      () => links.reduce((max, link) => Math.max(max, link.clicks), 0),
      [links]
    );

    const readDepth = useMemo(() => computeReadDepth(links), [links]);

    const html = useMemo(() => {
      const colorScale = createHeatColorScale(maxClicks);

      // Match each rendered link to its click data by URL. LinkPerformance.url
      // is the original markdown URL (see functions/update-link-tracking.mjs), so
      // anchors that share a URL share the aggregated data, and untracked links
      // (e.g. mailto:) simply have no match and render plain.
      const byUrl = new Map<string, LinkPerformance>();
      for (const link of links) {
        byUrl.set(link.url.trim(), link);
      }

      const renderLink = (anchorText: string, url: string): string => {
        const perf = byUrl.get(url.trim());
        const safeUrl = escapeHtmlAttribute(url);
        const baseAnchorClasses =
          'rounded-sm px-1 font-medium transition-shadow hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500';

        // Links without click data render plain (e.g. mailto links).
        if (!perf || maxClicks <= 0) {
          return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary-600 underline decoration-primary-300 hover:decoration-primary-500">${anchorText}</a>`;
        }

        const { clicks, percentOfTotal, position } = perf;
        const intensity = clicks / maxClicks;
        const background = clicks > 0 ? colorScale(clicks) : 'transparent';
        const textColor = clicks > 0 && intensity > 0.55 ? '#ffffff' : '#1f2937';
        const noun = clicks === 1 ? 'click' : 'clicks';
        const linkLabel = position > 0 ? `Link #${position}` : 'Link';
        const title = escapeHtmlAttribute(
          `${linkLabel} — ${clicks.toLocaleString()} ${noun} (${percentOfTotal.toFixed(1)}% of total)`
        );

        if (clicks > 0) {
          const badge = `<sup class="ml-0.5 inline-block rounded px-1 text-[10px] font-bold leading-tight align-super" style="background-color:#111827;color:#ffffff;">${clicks.toLocaleString()}</sup>`;
          return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="${title}" class="${baseAnchorClasses}" style="background-color:${background};color:${textColor};box-shadow:inset 0 0 0 1px rgba(0,0,0,0.08);">${anchorText}${badge}</a>`;
        }

        // Tracked but never clicked — show a muted marker so "dead" links stand out.
        const badge = `<sup class="ml-0.5 inline-block rounded px-1 text-[10px] font-semibold leading-tight align-super" style="background-color:#e5e7eb;color:#6b7280;">0</sup>`;
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="${title}" class="${baseAnchorClasses} text-gray-600" style="box-shadow:inset 0 0 0 1px rgba(0,0,0,0.08);border-bottom:1px dashed #9ca3af;">${anchorText}${badge}</a>`;
      };

      return formatMarkdown(content, { renderLink });
    }, [content, links, maxClicks]);

    const hasClickData = maxClicks > 0;

    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-red-500" aria-hidden="true" />
          <h3 className="text-base sm:text-lg font-semibold text-foreground">Content Heatmap</h3>
          <InfoTooltip
            label="Content Heatmap"
            description="Your rendered content with each tracked link shaded by how many clicks it received and annotated with its click count. Darker, hotter links drew more attention. Use it to see which links worked and how far down the content readers stayed engaged."
          />
        </div>

        {hasClickData ? (
          <ReadDepthSummary readDepth={readDepth} totalClicks={totalClicks} />
        ) : (
          <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg">
            No link clicks were recorded for this issue yet, so the content below is shown without heat shading.
          </div>
        )}

        {hasClickData && (
          <div className="bg-muted/20 border border-border rounded-lg px-3 py-2">
            <ColorLegend
              minValue={0}
              maxValue={maxClicks}
              colorScale={createHeatColorScale(maxClicks)}
              metricLabel="clicks per link"
            />
          </div>
        )}

        <article
          aria-label="Issue content heatmap"
          className={cn(
            'prose prose-sm max-w-none rounded-lg border border-border bg-background p-4 sm:p-6',
            'text-foreground',
            '[&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground',
            '[&_p]:text-foreground [&_li]:text-foreground'
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }
);

ContentHeatmap.displayName = 'ContentHeatmap';

interface ReadDepthSummaryProps {
  readDepth: ReadDepthStats;
  totalClicks: number;
}

/** Compact "how far did readers read" summary derived from link positions. */
const ReadDepthSummary: React.FC<ReadDepthSummaryProps> = ({ readDepth }) => {
  const {
    ordered,
    attributedClicks,
    clickedLinks,
    totalLinks,
    deepestClickedPosition,
    depthForEightyPercent,
    topLinkSharePct,
  } = readDepth;

  if (totalLinks === 0) return null;

  const maxClicks = ordered.reduce((max, link) => Math.max(max, link.clicks), 0);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ArrowDownWideNarrow className="w-4 h-4 text-primary-600" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-foreground">Reader engagement depth</h4>
        <InfoTooltip
          label="Reader engagement depth"
          description="Links are tracked in the order they appear in your content, so clicks on links further down imply readers scrolled further. These stats estimate how far readers engaged based on which positions were clicked."
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Links clicked"
          value={`${clickedLinks} / ${totalLinks}`}
          hint="Distinct links that got at least one click"
        />
        <Stat
          label="Deepest click"
          value={deepestClickedPosition > 0 ? `Link #${deepestClickedPosition}` : '—'}
          hint="Furthest link position that drew a click"
        />
        <Stat
          label="80% of clicks by"
          value={depthForEightyPercent > 0 ? `Link #${depthForEightyPercent}` : '—'}
          hint="Most engagement happened within these links"
        />
        <Stat
          label="Top link share"
          value={`${topLinkSharePct.toFixed(0)}%`}
          hint="Share of link clicks taken by the best link"
        />
      </div>

      {/* Per-position click distribution, in document order — the falloff curve. */}
      <ol className="space-y-1.5" aria-label="Click distribution by link position">
        {ordered.map((link) => {
          const widthPct = maxClicks > 0 ? (link.clicks / maxClicks) * 100 : 0;
          const sharePct = attributedClicks > 0 ? (link.clicks / attributedClicks) * 100 : 0;
          return (
            <li key={`${link.position}-${link.url}`} className="flex items-center gap-2 text-xs">
              <span className="w-10 flex-shrink-0 text-right font-mono text-muted-foreground">
                #{link.position}
              </span>
              <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-red-600 transition-all"
                  style={{ width: `${widthPct}%` }}
                  aria-hidden="true"
                />
              </div>
              <span className="w-24 flex-shrink-0 text-right text-muted-foreground tabular-nums">
                {link.clicks.toLocaleString()} ({sharePct.toFixed(0)}%)
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

interface StatProps {
  label: string;
  value: string;
  hint: string;
}

const Stat: React.FC<StatProps> = ({ label, value, hint }) => (
  <div className="rounded-md bg-background border border-border px-3 py-2" title={hint}>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-base sm:text-lg font-semibold text-foreground">{value}</div>
  </div>
);

export default ContentHeatmap;
