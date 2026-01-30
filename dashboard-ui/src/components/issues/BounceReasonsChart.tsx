import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { BounceReasons } from '../../types/issues';

export interface BounceReasonsChartProps {
  bounceReasons: BounceReasons;
}

export const BounceReasonsChart: React.FC<BounceReasonsChartProps> = ({ bounceReasons }) => {
  const { permanent, temporary, suppressed } = bounceReasons;
  const total = permanent + temporary + suppressed;

  const data = [
    {
      name: 'Permanent',
      count: permanent,
      percentage: total > 0 ? (permanent / total) * 100 : 0,
    },
    {
      name: 'Temporary',
      count: temporary,
      percentage: total > 0 ? (temporary / total) * 100 : 0,
    },
    {
      name: 'Suppressed',
      count: suppressed,
      percentage: total > 0 ? (suppressed / total) * 100 : 0,
    },
  ];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 rounded shadow-lg p-3">
          <p className="font-semibold text-gray-900">{payload[0].payload.name}</p>
          <p className="text-sm text-gray-600">
            Count: <span className="font-medium">{payload[0].value}</span>
          </p>
          <p className="text-sm text-gray-600">
            Percentage: <span className="font-medium">{payload[0].payload.percentage.toFixed(1)}%</span>
          </p>
        </div>
      );
    }
    return null;
  };

  if (total === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Bounce Reasons</h3>
        <p className="text-gray-500 text-center py-8">No bounces recorded for this issue</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-3 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Bounce Reasons</h3>

      <div className="mb-4 sm:mb-6">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar dataKey="count" fill="#3b82f6" name="Bounce Count" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-3 sm:pt-4 border-t border-gray-200">
        <div className="text-center">
          <div className="text-lg sm:text-2xl font-bold text-red-600">{permanent}</div>
          <div className="text-xs sm:text-sm text-gray-600">Permanent</div>
          <div className="text-xs text-gray-500">
            {total > 0 ? ((permanent / total) * 100).toFixed(1) : 0}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-lg sm:text-2xl font-bold text-yellow-600">{temporary}</div>
          <div className="text-xs sm:text-sm text-gray-600">Temporary</div>
          <div className="text-xs text-gray-500">
            {total > 0 ? ((temporary / total) * 100).toFixed(1) : 0}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-lg sm:text-2xl font-bold text-gray-600">{suppressed}</div>
          <div className="text-xs sm:text-sm text-gray-600">Suppressed</div>
          <div className="text-xs text-gray-500">
            {total > 0 ? ((suppressed / total) * 100).toFixed(1) : 0}%
          </div>
        </div>
      </div>

      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-200">
        <div className="flex justify-between items-center">
          <span className="text-xs sm:text-sm font-medium text-gray-700">Total Bounces</span>
          <span className="text-base sm:text-lg font-bold text-gray-900">{total.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};
