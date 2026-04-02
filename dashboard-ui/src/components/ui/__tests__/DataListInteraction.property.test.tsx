// Feature: dashboard-ux-overhaul, Property 11: DataList row interaction parity
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { DataList } from '../DataList';
import type { DataListColumn } from '../DataList';

/**
 * **Validates: Requirements 13.1, 13.6**
 *
 * Property 11: DataList row interaction parity
 *
 * For any DataList row, clicking the row and pressing Enter or Space while
 * the row is focused must both invoke the same `onRowClick` callback with
 * the same item argument. All three interactions produce identical callback
 * arguments.
 */

interface SimpleItem {
  id: string;
  name: string;
}

const columns: DataListColumn<SimpleItem>[] = [
  { key: 'name', header: 'Name', render: (item) => item.name },
];

// Generator: arrays of simple items with unique IDs and non-empty names
const nameGen = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,19}$/);

const itemArrayGen = fc
  .array(
    fc.record({
      id: fc.uuid(),
      name: nameGen,
    }),
    { minLength: 1, maxLength: 10 },
  )
  // Ensure unique IDs
  .map((items) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  })
  .filter((items) => items.length > 0);

describe('DataList Row Interaction Parity - Property-Based Tests', () => {
  describe('Property 11: DataList row interaction parity', () => {
    it('clicking a row invokes onRowClick with the correct item', () => {
      fc.assert(
        fc.property(itemArrayGen, (items) => {
          const handleClick = vi.fn();
          const { container, unmount } = render(
            <DataList
              items={items}
              columns={columns}
              getKey={(item) => item.id}
              onRowClick={handleClick}
              ariaLabel="Test list"
            />,
          );

          const rows = container.querySelectorAll('tbody tr');
          for (let i = 0; i < items.length; i++) {
            fireEvent.click(rows[i]);
            expect(handleClick).toHaveBeenLastCalledWith(items[i]);
          }

          expect(handleClick).toHaveBeenCalledTimes(items.length);
          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('pressing Enter on a focused row invokes onRowClick with the same item', () => {
      fc.assert(
        fc.property(itemArrayGen, (items) => {
          const handleClick = vi.fn();
          const { container, unmount } = render(
            <DataList
              items={items}
              columns={columns}
              getKey={(item) => item.id}
              onRowClick={handleClick}
              ariaLabel="Test list"
            />,
          );

          const rows = container.querySelectorAll('tbody tr');
          for (let i = 0; i < items.length; i++) {
            fireEvent.keyDown(rows[i], { key: 'Enter' });
            expect(handleClick).toHaveBeenLastCalledWith(items[i]);
          }

          expect(handleClick).toHaveBeenCalledTimes(items.length);
          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('pressing Space on a focused row invokes onRowClick with the same item', () => {
      fc.assert(
        fc.property(itemArrayGen, (items) => {
          const handleClick = vi.fn();
          const { container, unmount } = render(
            <DataList
              items={items}
              columns={columns}
              getKey={(item) => item.id}
              onRowClick={handleClick}
              ariaLabel="Test list"
            />,
          );

          const rows = container.querySelectorAll('tbody tr');
          for (let i = 0; i < items.length; i++) {
            fireEvent.keyDown(rows[i], { key: ' ' });
            expect(handleClick).toHaveBeenLastCalledWith(items[i]);
          }

          expect(handleClick).toHaveBeenCalledTimes(items.length);
          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('click, Enter, and Space all produce identical callback arguments for each row', () => {
      fc.assert(
        fc.property(itemArrayGen, (items) => {
          const clickHandler = vi.fn();
          const enterHandler = vi.fn();
          const spaceHandler = vi.fn();

          // Render three separate instances to isolate handlers
          const { container: c1, unmount: u1 } = render(
            <DataList
              items={items}
              columns={columns}
              getKey={(item) => item.id}
              onRowClick={clickHandler}
              ariaLabel="Click list"
            />,
          );
          const { container: c2, unmount: u2 } = render(
            <DataList
              items={items}
              columns={columns}
              getKey={(item) => item.id}
              onRowClick={enterHandler}
              ariaLabel="Enter list"
            />,
          );
          const { container: c3, unmount: u3 } = render(
            <DataList
              items={items}
              columns={columns}
              getKey={(item) => item.id}
              onRowClick={spaceHandler}
              ariaLabel="Space list"
            />,
          );

          const clickRows = c1.querySelectorAll('tbody tr');
          const enterRows = c2.querySelectorAll('tbody tr');
          const spaceRows = c3.querySelectorAll('tbody tr');

          for (let i = 0; i < items.length; i++) {
            fireEvent.click(clickRows[i]);
            fireEvent.keyDown(enterRows[i], { key: 'Enter' });
            fireEvent.keyDown(spaceRows[i], { key: ' ' });

            const clickArg = clickHandler.mock.calls[i][0];
            const enterArg = enterHandler.mock.calls[i][0];
            const spaceArg = spaceHandler.mock.calls[i][0];

            // All three interactions must produce the exact same item
            expect(clickArg).toEqual(enterArg);
            expect(clickArg).toEqual(spaceArg);
            // And it must be the correct item
            expect(clickArg).toEqual(items[i]);
          }

          u1();
          u2();
          u3();
        }),
        { numRuns: 100 },
      );
    });
  });
});
