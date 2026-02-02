import React, { useState, useMemo } from 'react';
import { ComplaintDetail } from '../../types/issues';

export interface ComplaintDetailsTableProps {
  complaints: ComplaintDetail[];
}

type SortField = 'email' | 'timestamp' | 'complaintType';
type SortDirection = 'asc' | 'desc';

const SortIcon: React.FC<{ field: SortField; sortField: SortField; sortDirection: SortDirection }> = ({ field, sortField, sortDirection }) => {
  if (sortField !== field) {
    return <span className="text-gray-400">↕</span>;
  }
  return <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>;
};

export const ComplaintDetailsTable: React.FC<ComplaintDetailsTableProps> = ({ complaints }) => {
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterType, setFilterType] = useState<string>('all');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedAndFilteredComplaints = useMemo(() => {
    let filtered = complaints;

    if (filterType !== 'all') {
      filtered = complaints.filter(c => c.complaintType === filterType);
    }

    return [...filtered].sort((a, b) => {
      let aValue: string | number = a[sortField];
      let bValue: string | number = b[sortField];

      if (sortField === 'timestamp') {
        aValue = new Date(a.timestamp).getTime();
        bValue = new Date(b.timestamp).getTime();
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [complaints, sortField, sortDirection, filterType]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (complaints.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Complaint Details</h3>
        <p className="text-gray-500 text-center py-8">No complaints reported for this issue</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-3 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 sm:mb-4 gap-2">
        <h3 className="text-base sm:text-lg font-semibold">Complaint Details</h3>
        <div className="flex items-center gap-2">
          <label htmlFor="complaint-filter" className="text-xs sm:text-sm text-gray-600">
            Filter:
          </label>
          <select
            id="complaint-filter"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs sm:text-sm border border-gray-300 rounded px-2 py-1 touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter complaints by type"
          >
            <option value="all">All Types</option>
            <option value="spam">Spam</option>
            <option value="abuse">Abuse</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <div className="inline-block min-w-full align-middle">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onClick={() => handleSort('email')}
                  tabIndex={0}
                  role="button"
                  aria-label="Sort by email"
                  onKeyDown={(e) => e.key === 'Enter' && handleSort('email')}
                >
                  <div className="flex items-center gap-1">
                    Email <SortIcon field="email" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </th>
                <th
                  className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500 hidden sm:table-cell"
                  onClick={() => handleSort('timestamp')}
                  tabIndex={0}
                  role="button"
                  aria-label="Sort by timestamp"
                  onKeyDown={(e) => e.key === 'Enter' && handleSort('timestamp')}
                >
                  <div className="flex items-center gap-1">
                    Timestamp <SortIcon field="timestamp" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </th>
                <th
                  className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onClick={() => handleSort('complaintType')}
                  tabIndex={0}
                  role="button"
                  aria-label="Sort by complaint type"
                  onKeyDown={(e) => e.key === 'Enter' && handleSort('complaintType')}
                >
                  <div className="flex items-center gap-1">
                    Type <SortIcon field="complaintType" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedAndFilteredComplaints.map((complaint, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-gray-900 truncate max-w-[150px] sm:max-w-none">{complaint.email}</td>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-gray-600 hidden sm:table-cell whitespace-nowrap">
                    {formatTimestamp(complaint.timestamp)}
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        complaint.complaintType === 'spam'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-orange-100 text-orange-800'
                      }`}
                    >
                      {complaint.complaintType}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 sm:mt-4 text-xs sm:text-sm text-gray-600">
        Showing {sortedAndFilteredComplaints.length} of {complaints.length} complaints
      </div>
    </div>
  );
};
