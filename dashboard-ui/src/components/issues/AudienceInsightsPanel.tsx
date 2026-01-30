import React from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Globe, Smartphone, Clock } from 'lucide-react';
import type { GeoData, DeviceBreakdown, TimingMetrics } from '@/types';

export interface AudienceInsightsPanelProps {
  geoDistribution: GeoData[];
  deviceBreakdown: DeviceBreakdown;
  timingMetrics: TimingMetrics;
}

type TooltipPayloadItem = {
  name?: string;
  value?: number;
  color?: string;
};

function CustomTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (active && Array.isArray(payload) && payload.length > 0) {
    return (
      <div className="bg-surface p-4 border border-border rounded-lg shadow-lg">
        <p className="font-medium text-foreground mb-2">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : '0'}
          </p>
        ))}
      </div>
    );
  }
  return null;
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours}h`;
  } else {
    const days = Math.floor(seconds / 86400);
    return `${days}d`;
  }
};

export const AudienceInsightsPanel: React.FC<AudienceInsightsPanelProps> = ({
  geoDistribution,
  deviceBreakdown,
  timingMetrics
}) => {
  const deviceData = [
    { name: 'Desktop', value: deviceBreakdown.desktop, color: '#3b82f6' },
    { name: 'Mobile', value: deviceBreakdown.mobile, color: '#10b981' },
    { name: 'Tablet', value: deviceBreakdown.tablet, color: '#f59e0b' }
  ].filter(d => d.value > 0);

  const totalDeviceClicks = deviceBreakdown.desktop + deviceBreakdown.mobile + deviceBreakdown.tablet;

  const topCountries = geoDistribution
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10)
    .map(geo => ({
      country: geo.country,
      clicks: geo.clicks,
      opens: geo.opens
    }));

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Geographic Distribution */}
      <div className="bg-surface rounded-lg shadow p-3 sm:p-6">
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Globe className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 flex-shrink-0" aria-hidden="true" />
          <h3 className="text-base sm:text-lg font-medium text-foreground">
            Geographic Distribution
          </h3>
        </div>

        {topCountries.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64">
            <p className="text-sm sm:text-base text-muted-foreground">No geographic data available</p>
          </div>
        ) : (
          <div className="h-64 sm:h-80" role="img" aria-label="Bar chart showing clicks and opens by country">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCountries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="country"
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  label={{ value: 'Clicks', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#6b7280' } }}
                />
                <Tooltip content={CustomTooltip} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  dataKey="clicks"
                  fill="#3b82f6"
                  name="Clicks"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="opens"
                  fill="#10b981"
                  name="Opens"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Device Breakdown */}
      <div className="bg-surface rounded-lg shadow p-3 sm:p-6">
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Smartphone className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 flex-shrink-0" aria-hidden="true" />
          <h3 className="text-base sm:text-lg font-medium text-foreground">
            Device Breakdown
          </h3>
        </div>

        {deviceData.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64">
            <p className="text-sm sm:text-base text-muted-foreground">No device data available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div className="h-48 sm:h-64" role="img" aria-label="Pie chart showing device distribution">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deviceData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={60}
                    fill="#8884d8"
                    dataKey="value"
                    style={{ fontSize: '11px' }}
                  >
                    {deviceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-col justify-center space-y-3 sm:space-y-4">
              {deviceData.map((device) => (
                <div key={device.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <div
                      className="w-3 h-3 sm:w-4 sm:h-4 rounded flex-shrink-0"
                      style={{ backgroundColor: device.color }}
                      aria-hidden="true"
                    />
                    <span className="text-sm sm:text-base text-foreground font-medium truncate">{device.name}</span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-base sm:text-lg font-semibold text-foreground">
                      {device.value.toLocaleString()}
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground">
                      {((device.value / totalDeviceClicks) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Timing Metrics */}
      <div className="bg-surface rounded-lg shadow p-3 sm:p-6">
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 flex-shrink-0" aria-hidden="true" />
          <h3 className="text-base sm:text-lg font-medium text-foreground">
            Engagement Timing
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-muted/30 rounded-lg p-3 sm:p-4 border border-border">
            <div className="text-xs sm:text-sm text-muted-foreground mb-2">Time to Open</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center gap-2">
                <span className="text-xs sm:text-sm font-medium text-foreground">Median:</span>
                <span className="text-base sm:text-lg font-semibold text-primary-600" aria-label={`Median time to open: ${formatTime(timingMetrics.medianTimeToOpen)}`}>
                  {formatTime(timingMetrics.medianTimeToOpen)}
                </span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-xs sm:text-sm font-medium text-foreground">95th %ile:</span>
                <span className="text-base sm:text-lg font-semibold text-muted-foreground" aria-label={`95th percentile time to open: ${formatTime(timingMetrics.p95TimeToOpen)}`}>
                  {formatTime(timingMetrics.p95TimeToOpen)}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-3 sm:p-4 border border-border">
            <div className="text-xs sm:text-sm text-muted-foreground mb-2">Time to Click</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center gap-2">
                <span className="text-xs sm:text-sm font-medium text-foreground">Median:</span>
                <span className="text-base sm:text-lg font-semibold text-primary-600" aria-label={`Median time to click: ${formatTime(timingMetrics.medianTimeToClick)}`}>
                  {formatTime(timingMetrics.medianTimeToClick)}
                </span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-xs sm:text-sm font-medium text-foreground">95th %ile:</span>
                <span className="text-base sm:text-lg font-semibold text-muted-foreground" aria-label={`95th percentile time to click: ${formatTime(timingMetrics.p95TimeToClick)}`}>
                  {formatTime(timingMetrics.p95TimeToClick)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
