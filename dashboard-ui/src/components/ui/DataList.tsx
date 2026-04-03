import React, { useCallback } from 'react';
import { cn } from '../../utils/cn';

export interface DataListColumn<T> {
  key: string;
  header: string;
  render: (item: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export interface DataListProps<T> {
  items: T[];
  columns: DataListColumn<T>[];
  getKey: (item: T) => string;
  onRowClick: (item: T) => void;
  ariaLabel: string;
}

export function DataList<T>({
  items,
  columns,
  getKey,
  onRowClick,
  ariaLabel,
}: DataListProps<T>) {
  const handleRowKeyDown = useCallback(
    (item: T) => (e: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onRowClick(item);
      }
    },
    [onRowClick]
  );

  return (
    <table className="w-full" aria-label={ariaLabel}>
      <thead>
        <tr className="bg-muted">
          {columns.map((col) => (
            <th
              key={col.key}
              className={cn(
                'px-4 py-3 text-left text-sm font-medium text-muted-foreground',
                col.headerClassName
              )}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={getKey(item)}
            tabIndex={0}
            role="link"
            className={cn(
              'hover:bg-muted/50 cursor-pointer transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'
            )}
            onClick={() => onRowClick(item)}
            onKeyDown={handleRowKeyDown(item)}
          >
            {columns.map((col) => (
              <td
                key={col.key}
                className={cn('px-4 py-3 text-sm', col.className)}
              >
                {col.render(item)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
