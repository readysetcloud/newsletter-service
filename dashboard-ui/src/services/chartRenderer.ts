import React from 'react';
import { createRoot } from 'react-dom/client';
import type { TrendPoint } from '@/utils/reportFormatters';
import { formatReportDate } from '@/utils/reportFormatters';
import { TrendChartComponent, CHART_WIDTH, CHART_HEIGHT } from './TrendChartComponent';
import type { ChartDataPoint } from './TrendChartComponent';

function formatChartData(trendData: TrendPoint[]): ChartDataPoint[] {
  return trendData.map((point) => ({
    date: formatReportDate(point.date),
    recommendedPrice: point.recommendedPrice,
    subscriberCount: point.subscriberCount,
  }));
}

function svgToCanvas(svgElement: SVGSVGElement): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = CHART_WIDTH * 2;  // 2x for retina clarity
      canvas.height = CHART_HEIGHT * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not get canvas 2d context'));
        return;
      }
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, CHART_WIDTH, CHART_HEIGHT);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG as image'));
    };

    img.src = url;
  });
}

/**
 * Renders a Recharts LineChart offscreen, converts it to a base64 PNG data URL.
 * Returns null if rendering fails for any reason.
 */
export async function renderTrendChart(trendData: TrendPoint[]): Promise<string | null> {
  if (!trendData || trendData.length === 0) {
    return null;
  }

  try {
    const chartData = formatChartData(trendData);

    // Create offscreen container
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = `${CHART_WIDTH}px`;
    container.style.height = `${CHART_HEIGHT}px`;
    document.body.appendChild(container);

    // Render chart using React
    const root = createRoot(container);

    await new Promise<void>((resolve) => {
      root.render(
        React.createElement(TrendChartComponent, { data: chartData })
      );
      // Allow React and Recharts to complete rendering
      setTimeout(resolve, 200);
    });

    // Extract SVG element
    const svgElement = container.querySelector('svg');
    if (!svgElement) {
      root.unmount();
      document.body.removeChild(container);
      return null;
    }

    // Convert SVG to canvas, then to base64 PNG
    const canvas = await svgToCanvas(svgElement as SVGSVGElement);
    const base64Png = canvas.toDataURL('image/png');

    // Cleanup
    root.unmount();
    document.body.removeChild(container);

    return base64Png;
  } catch {
    return null;
  }
}
