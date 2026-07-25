import React, { useState, useMemo, useRef } from 'react';
import { InfoTooltip } from '../ui/InfoTooltip';
import { TablePager } from '../ui/TablePager';
import { ComplaintDetail } from '../../types/issues';
import { formatInTimeZone } from '@/utils/dateFormatting';
import { useTenantDateFormat } from '@/contexts/SettingsContext';

export interface ComplaintDetailsTableProps {
  complaints: ComplaintDetail[];
  /** Rows per page. Exposed for tests; the default suits both phone and desktop. */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 10;

type SortField = 'email' | 'timestamp' | 'complaintType';
type SortDirection = 'asc' | 'desc';

const SortIcon: React.FC<{ field: SortField; sortField: SortField; sortDirection: SortDirection }> = ({ field, sortField, sortDirection }) => {
  if (sortField !== field) {
    return <span className="text-gray-400">↕</span>;
  }
  return <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>;
};

export const ComplaintDetailsTable: React.FC<ComplaintDetailsTableProps> = ({
  complaints,
  pageSize = DEFAULT_PAGE_SIZE,
}) => {
  // Dates render in the newsletter's timezone, not the viewer's.
  const { timeZone } = useTenantDateFormat();
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterType, setFilterType] = useState<string>('all');
  const [page, setPage] = useState(0);
  const listTopRef = useRef<HTMLDivElement>(null);

  // The component stays mounted across issue navigation, so a fresh list can
  // land under the previous issue's page number. Reset during render rather
  // than in an effect so there's no flash of the wrong page.
  const [renderedComplaints, setRenderedComplaints] = useState(complaints);
  if (complaints !== renderedComplaints) {
    setRenderedComplaints(complaints);
    setPage(0);
  }

  // The pager sits below the table, so after a page change the new rows can all
  // be above the viewport. Bring the top of the table back into view.
  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);

    const listTop = listTopRef.current;
    if (!listTop || typeof listTop.scrollIntoView !== 'function') return;
    if (listTop.getBoundingClientRect().top >= 0) return; // already on screen

    listTop.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Re-sorting or re-filtering changes what row 1 is, so go back to page one.
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(0);
  };

  const handleFilterChange = (value: string) => {
    setFilterType(value);
    setPage(0);
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

  // Clamped so a shorter filtered list can't leave us on a page past the end.
  const pageCount = Math.max(1, Math.ceil(sortedAndFilteredComplaints.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleComplaints = sortedAndFilteredComplaints.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize
  );

  const formatTimestamp = (timestamp: string) => {
    return formatInTimeZone(timestamp, timeZone, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }, 'en-US');
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
      {/* Scroll target for page changes; `scroll-mt-24` clears the sticky nav. */}
      <div
        ref={listTopRef}
        className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-3 sm:mb-4 gap-2 scroll-mt-24"
      >
        <div className="flex items-start gap-2">
          <h3 className="text-base sm:text-lg font-semibold">Complaint Details</h3>
          <InfoTooltip
            label="Complaint Details"
            description="Recipients who marked your email as spam. High complaint rates can severely damage your sender reputation and lead to blacklisting. Keep complaint rate below 0.1%."
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="complaint-filter" className="text-xs sm:text-sm text-gray-600">
            Filter:
          </label>
          <select
            id="complaint-filter"
            value={filterType}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="text-xs sm:text-sm border border-gray-300 rounded px-2 py-2 min-h-[44px] touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              {visibleComplaints.map((complaint, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-gray-900 max-w-[190px] sm:max-w-none">
                    <span className="block truncate">{complaint.email}</span>
                    {/* The timestamp column is hidden on phones, so keep the date
                        with the address rather than dropping it entirely. */}
                    <span className="block sm:hidden text-[11px] text-gray-500 mt-0.5">
                      {formatTimestamp(complaint.timestamp)}
                    </span>
                  </td>
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

      <TablePager
        page={currentPage}
        pageSize={pageSize}
        totalItems={sortedAndFilteredComplaints.length}
        onPageChange={handlePageChange}
        itemLabel={filterType === 'all' ? 'complaints' : `${filterType} complaints`}
      />

      {sortedAndFilteredComplaints.length <= pageSize && (
        <div className="mt-3 sm:mt-4 text-xs sm:text-sm text-gray-600">
          Showing {sortedAndFilteredComplaints.length} of {complaints.length} complaints
        </div>
      )}

      <details className="mt-4 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
        <summary className="font-semibold cursor-pointer touch-manipulation min-h-[24px]">
          Understanding complaint types
        </summary>
        <ul className="space-y-1 list-disc list-inside mt-2">
          <li><strong>Spam:</strong> Recipient marked your email as spam or junk</li>
          <li><strong>Abuse:</strong> Recipient reported your email as abusive content</li>
        </ul>
        <p className="mt-2">
          To reduce complaints: ensure recipients opted in, provide clear unsubscribe links,
          send relevant content, and honor unsubscribe requests immediately.
        </p>
      </details>
    </div>
  );
};
