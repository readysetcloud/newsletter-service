// Feature: dashboard-ux-overhaul, Property 6: Segment list renders required fields
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { DataList } from '../DataList';
import type { DataListColumn } from '../DataList';

/**
 * **Validates: Requirements 5.5**
 *
 * Property 6: Segment list renders required fields
 *
 * For any non-empty list of segments, the rendered DataList output should
 * contain each segment's name, memberCount, and formatted createdAt date.
 * No segment in the list should be missing from the rendered output.
 *
 * Uses the same formatDate function and column definitions as SubscribersPage.
 */

interface Segment {
  segmentId: string;
  name: string;
  description?: string;
  memberCount: number;
  createdAt: string;
  updatedAt?: string;
}

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const segmentColumns: DataListColumn<Segment>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (segment) => (
      <span className="font-medium text-foreground">{segment.name}</span>
    ),
  },
  {
    key: 'description',
    header: 'Description',
    className: 'hidden md:table-cell',
    headerClassName: 'hidden md:table-cell',
    render: (segment) => (
      <span className="text-muted-foreground truncate max-w-xs block">
        {segment.description || '—'}
      </span>
    ),
  },
  {
    key: 'members',
    header: 'Members',
    render: (segment) => (
      <span className="text-muted-foreground">{segment.memberCount}</span>
    ),
  },
  {
    key: 'created',
    header: 'Created',
    className: 'hidden md:table-cell',
    headerClassName: 'hidden md:table-cell',
    render: (segment) => (
      <span className="text-muted-foreground">
        {formatDate(segment.createdAt)}
      </span>
    ),
  },
];

// Generator: alphanumeric names to avoid whitespace-only edge cases with RTL
const nameGen = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/);

// Generator: valid ISO date strings within a safe range
const isoDateGen = fc.integer({ min: 946684800000, max: 4102444800000 })
  .map((ts) => new Date(ts).toISOString());

const segmentGen = fc.record({
  segmentId: fc.uuid(),
  name: nameGen,
  memberCount: fc.nat({ max: 1_000_000 }),
  createdAt: isoDateGen,
});

const segmentArrayGen = fc.array(segmentGen, { minLength: 1, maxLength: 5 });

function renderSegmentList(segments: Segment[]) {
  return render(
    <DataList
      items={segments}
      columns={segmentColumns}
      getKey={(s) => s.segmentId}
      onRowClick={vi.fn()}
      ariaLabel="Segments list"
    />,
  );
}

describe('DataList Segment Rendering - Property-Based Tests', () => {
  describe('Property 6: Segment list renders required fields', () => {
    it('every segment name appears in the rendered output', () => {
      fc.assert(
        fc.property(segmentArrayGen, (segments) => {
          const { container, unmount } = renderSegmentList(segments);
          const text = container.textContent || '';

          for (const segment of segments) {
            expect(text).toContain(segment.name);
          }

          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('every segment member count appears in the rendered output', () => {
      fc.assert(
        fc.property(segmentArrayGen, (segments) => {
          const { container, unmount } = renderSegmentList(segments);
          const text = container.textContent || '';

          for (const segment of segments) {
            expect(text).toContain(String(segment.memberCount));
          }

          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('every segment formatted date appears in the rendered output', () => {
      fc.assert(
        fc.property(segmentArrayGen, (segments) => {
          const { container, unmount } = renderSegmentList(segments);
          const text = container.textContent || '';

          for (const segment of segments) {
            const formatted = formatDate(segment.createdAt);
            expect(text).toContain(formatted);
          }

          unmount();
        }),
        { numRuns: 100 },
      );
    });

    it('rendered row count matches segment array length', () => {
      fc.assert(
        fc.property(segmentArrayGen, (segments) => {
          const { container, unmount } = renderSegmentList(segments);
          const rows = container.querySelectorAll('tbody tr');

          expect(rows.length).toBe(segments.length);

          unmount();
        }),
        { numRuns: 100 },
      );
    });
  });
});
