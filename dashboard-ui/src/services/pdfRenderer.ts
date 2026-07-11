import { jsPDF } from 'jspdf';
import type { ReportData } from '@/types/report';
import { BRAND } from '@/constants/brand';
import {
  formatSubscriberCount,
  formatPercentage,
  formatSignedPercentage,
  formatCurrency,
  formatImpressionsEstimate,
  formatReportDate,
} from '@/utils/reportFormatters';
import { renderTrendChart } from '@/services/chartRenderer';

// Colors
const COLOR_DARK = '#0e2233';
const COLOR_ACCENT_BLUE = '#0b82e6';
const COLOR_GREEN = '#14b8a6';
const COLOR_RED = '#c81e22';
const COLOR_GRAY = '#64748b';
const COLOR_CARD_BG = '#f8fafc';

// Page dimensions (A4 portrait in mm)
const PAGE_WIDTH = 210;
const MARGIN_LEFT = 20;
const MARGIN_RIGHT = 20;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}

function setColor(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setTextColor(r, g, b);
}

function setFillColor(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setFillColor(r, g, b);
}

function drawRoundedRect(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, hex: string) {
  setFillColor(doc, hex);
  doc.roundedRect(x, y, w, h, r, r, 'F');
}

function renderHeader(doc: jsPDF, data: ReportData): number {
  let y = 25;

  // Brand logo (left side) if available
  if (data.brandLogo) {
    try {
      doc.addImage(data.brandLogo, 'PNG', MARGIN_LEFT, y - 10, 30, 30);
      // Text starts after logo
      const textX = MARGIN_LEFT + 36;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      setColor(doc, COLOR_DARK);
      doc.text(data.brandName, textX, y + 2);

      if (data.industry) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        setColor(doc, COLOR_GRAY);
        doc.text(data.industry, textX, y + 10);
      }

      if (data.website) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        setColor(doc, COLOR_ACCENT_BLUE);
        doc.text(data.website, textX, y + 17);
      }

      y += 28;
    } catch {
      // Logo failed to load — fall through to text-only header
      y = renderTextOnlyHeader(doc, data, y);
    }
  } else {
    y = renderTextOnlyHeader(doc, data, y);
  }

  return y;
}

function renderTextOnlyHeader(doc: jsPDF, data: ReportData, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  setColor(doc, COLOR_DARK);
  doc.text(data.brandName, MARGIN_LEFT, y);

  if (data.industry) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    setColor(doc, COLOR_GRAY);
    doc.text(data.industry, MARGIN_LEFT, y + 8);
  }

  if (data.website) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setColor(doc, COLOR_ACCENT_BLUE);
    doc.text(data.website, MARGIN_LEFT, y + 15);
  }

  return y + (data.website ? 22 : data.industry ? 15 : 8);
}

function renderValueNarrative(doc: jsPDF, data: ReportData, y: number): number {
  y += 6;

  // Divider line
  setFillColor(doc, '#e2e8f0');
  doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, 0.3, 'F');
  y += 8;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(11);
  setColor(doc, '#475569');

  const lines = doc.splitTextToSize(data.valueNarrative, CONTENT_WIDTH);
  doc.text(lines, MARGIN_LEFT, y);
  y += lines.length * 5.5;

  return y;
}

function renderMetricsGrid(doc: jsPDF, data: ReportData, y: number): number {
  y += 8;

  // Section title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setColor(doc, COLOR_DARK);
  doc.text('Key Metrics', MARGIN_LEFT, y);
  y += 8;

  const cardWidth = (CONTENT_WIDTH - 8) / 3; // 3 cards per row, 4mm gap
  const cardHeight = 28;
  const gap = 4;

  const metrics = [
    { label: 'Subscribers', value: formatSubscriberCount(data.subscriberCount) },
    { label: 'Open Rate', value: formatPercentage(data.avgOpenRate) },
    { label: 'Click-Through Rate', value: formatPercentage(data.avgClickRate) },
    { label: 'Growth Rate', value: formatSignedPercentage(data.subscriberGrowthRate), isGrowth: true },
    { label: 'Est. Reach', value: formatImpressionsEstimate(data.impressionsEstimate) },
  ];

  metrics.forEach((metric, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = MARGIN_LEFT + col * (cardWidth + gap);
    const cardY = y + row * (cardHeight + gap);

    // Card background
    drawRoundedRect(doc, x, cardY, cardWidth, cardHeight, 2, COLOR_CARD_BG);

    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setColor(doc, COLOR_GRAY);
    doc.text(metric.label, x + 5, cardY + 10);

    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);

    if (metric.isGrowth) {
      setColor(doc, data.subscriberGrowthRate >= 0 ? COLOR_GREEN : COLOR_RED);
    } else {
      setColor(doc, COLOR_DARK);
    }

    doc.text(metric.value, x + 5, cardY + 22);
  });

  // Calculate total height: 2 rows of cards
  const rows = Math.ceil(metrics.length / 3);
  y += rows * (cardHeight + gap);

  return y;
}

function renderPricingSection(doc: jsPDF, data: ReportData, y: number): number {
  y += 8;

  // Divider line
  setFillColor(doc, '#e2e8f0');
  doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, 0.3, 'F');
  y += 10;

  // Section title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setColor(doc, COLOR_DARK);
  doc.text('Recommended Sponsorship Price', MARGIN_LEFT, y);
  y += 10;

  // Large price
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  setColor(doc, COLOR_DARK);
  doc.text(formatCurrency(data.recommendedPrice), MARGIN_LEFT, y);
  y += 8;

  // Label
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  setColor(doc, COLOR_GRAY);
  doc.text('Per issue sponsorship (flat fee)', MARGIN_LEFT, y);
  y += 7;

  // Confidence label
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  setColor(doc, '#94a3b8');
  doc.text(data.confidenceLabel, MARGIN_LEFT, y);
  y += 4;

  return y;
}

function renderFooter(doc: jsPDF, data: ReportData) {
  const footerY = 280;

  // Divider line
  setFillColor(doc, '#e2e8f0');
  doc.rect(MARGIN_LEFT, footerY - 4, CONTENT_WIDTH, 0.3, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setColor(doc, COLOR_GRAY);

  doc.text(`Data verified by ${BRAND.appName} analytics`, MARGIN_LEFT, footerY);
  doc.text(
    `Generated ${formatReportDate(data.generatedAt.toISOString())}`,
    MARGIN_LEFT,
    footerY + 4
  );
  doc.text(
    `Data as of ${formatReportDate(data.metricsAsOf)}`,
    MARGIN_LEFT,
    footerY + 8
  );
}

async function renderTrendSection(doc: jsPDF, data: ReportData, y: number): Promise<number> {
  y += 8;

  // Divider line
  setFillColor(doc, '#e2e8f0');
  doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, 0.3, 'F');
  y += 10;

  // Section title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setColor(doc, COLOR_DARK);
  doc.text('Audience Growth Trend', MARGIN_LEFT, y);
  y += 6;

  // Attempt to render the trend chart as an image
  const chartImage = await renderTrendChart(data.trendData);

  if (chartImage) {
    // Chart image dimensions in mm (500×250px → scaled to fit content width)
    const chartWidthMm = CONTENT_WIDTH;
    const chartHeightMm = CONTENT_WIDTH * (250 / 500); // maintain aspect ratio

    // Check if chart fits on current page, add new page if needed
    if (y + chartHeightMm > 270) {
      doc.addPage();
      y = 20;
    }

    doc.addImage(chartImage, 'PNG', MARGIN_LEFT, y, chartWidthMm, chartHeightMm);
    y += chartHeightMm + 4;
  }

  // Growth summary text
  if (data.growthSummary) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    setColor(doc, COLOR_GRAY);
    const summaryLines = doc.splitTextToSize(data.growthSummary, CONTENT_WIDTH);
    doc.text(summaryLines, MARGIN_LEFT, y);
    y += summaryLines.length * 5.5;
  }

  return y;
}

async function generatePdf(data: ReportData): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // 1. Header
  let y = renderHeader(doc, data);

  // 2. Value narrative
  y = renderValueNarrative(doc, data, y);

  // 3. Key metrics grid
  y = renderMetricsGrid(doc, data, y);

  // 4. Pricing section
  y = renderPricingSection(doc, data, y);

  // 5. Trend chart section
  await renderTrendSection(doc, data, y);

  // 6. Footer
  renderFooter(doc, data);

  return doc.output('blob');
}

export const pdfRenderer = { generatePdf };
