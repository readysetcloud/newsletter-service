import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataList, DataListColumn } from '../DataList';

interface TestItem {
  id: string;
  name: string;
  count: number;
}

const testItems: TestItem[] = [
  { id: '1', name: 'Alpha', count: 10 },
  { id: '2', name: 'Beta', count: 20 },
  { id: '3', name: 'Gamma', count: 30 },
];

const columns: DataListColumn<TestItem>[] = [
  { key: 'name', header: 'Name', render: (item) => item.name },
  { key: 'count', header: 'Count', render: (item) => item.count },
];

const getKey = (item: TestItem) => item.id;

describe('DataList', () => {
  it('renders table with headers and rows', () => {
    render(
      <DataList
        items={testItems}
        columns={columns}
        getKey={getKey}
        onRowClick={vi.fn()}
        ariaLabel="Test list"
      />
    );

    expect(screen.getByRole('table', { name: 'Test list' })).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('calls onRowClick when a row is clicked', () => {
    const handleClick = vi.fn();

    render(
      <DataList
        items={testItems}
        columns={columns}
        getKey={getKey}
        onRowClick={handleClick}
        ariaLabel="Test list"
      />
    );

    fireEvent.click(screen.getByText('Alpha').closest('tr')!);
    expect(handleClick).toHaveBeenCalledWith(testItems[0]);
  });

  it('calls onRowClick when Enter is pressed on a focused row', () => {
    const handleClick = vi.fn();

    render(
      <DataList
        items={testItems}
        columns={columns}
        getKey={getKey}
        onRowClick={handleClick}
        ariaLabel="Test list"
      />
    );

    const row = screen.getByText('Beta').closest('tr')!;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(handleClick).toHaveBeenCalledWith(testItems[1]);
  });

  it('calls onRowClick when Space is pressed on a focused row', () => {
    const handleClick = vi.fn();

    render(
      <DataList
        items={testItems}
        columns={columns}
        getKey={getKey}
        onRowClick={handleClick}
        ariaLabel="Test list"
      />
    );

    const row = screen.getByText('Gamma').closest('tr')!;
    fireEvent.keyDown(row, { key: ' ' });
    expect(handleClick).toHaveBeenCalledWith(testItems[2]);
  });

  it('does not call onRowClick for other keys', () => {
    const handleClick = vi.fn();

    render(
      <DataList
        items={testItems}
        columns={columns}
        getKey={getKey}
        onRowClick={handleClick}
        ariaLabel="Test list"
      />
    );

    const row = screen.getByText('Alpha').closest('tr')!;
    fireEvent.keyDown(row, { key: 'Tab' });
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('rows have tabIndex={0} for keyboard focus', () => {
    render(
      <DataList
        items={testItems}
        columns={columns}
        getKey={getKey}
        onRowClick={vi.fn()}
        ariaLabel="Test list"
      />
    );

    const rows = screen.getAllByRole('link');
    rows.forEach((row) => {
      expect(row).toHaveAttribute('tabindex', '0');
    });
  });

  it('applies hover and focus-visible classes to rows', () => {
    render(
      <DataList
        items={testItems}
        columns={columns}
        getKey={getKey}
        onRowClick={vi.fn()}
        ariaLabel="Test list"
      />
    );

    const row = screen.getByText('Alpha').closest('tr')!;
    expect(row).toHaveClass('hover:bg-muted/50', 'cursor-pointer', 'transition-colors');
    expect(row).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-ring');
  });

  it('applies column className and headerClassName', () => {
    const responsiveColumns: DataListColumn<TestItem>[] = [
      { key: 'name', header: 'Name', render: (item) => item.name },
      {
        key: 'count',
        header: 'Count',
        render: (item) => item.count,
        className: 'hidden md:table-cell',
        headerClassName: 'hidden md:table-cell',
      },
    ];

    render(
      <DataList
        items={testItems}
        columns={responsiveColumns}
        getKey={getKey}
        onRowClick={vi.fn()}
        ariaLabel="Test list"
      />
    );

    const headerCells = screen.getAllByRole('columnheader');
    expect(headerCells[1]).toHaveClass('hidden', 'md:table-cell');

    const firstRowCells = screen.getByText('Alpha').closest('tr')!.querySelectorAll('td');
    expect(firstRowCells[1]).toHaveClass('hidden', 'md:table-cell');
  });

  it('renders thead with bg-muted class', () => {
    render(
      <DataList
        items={testItems}
        columns={columns}
        getKey={getKey}
        onRowClick={vi.fn()}
        ariaLabel="Test list"
      />
    );

    const headerRow = screen.getByText('Name').closest('tr')!;
    expect(headerRow).toHaveClass('bg-muted');
  });
});
