import { describe, expect, it, vi } from 'vitest';
import { buildAncestorIndex, indexEligibleAncestors } from './ancestor-index';
import { layoutAncestors } from './ancestor-layout';

function fixture(levels: number[], heights: number[], extents = heights) {
  const rows = levels.map((level) => ({ level }));
  const metadata = new Map<unknown, { level: number }>(rows.map((row) => [row, row]));
  const index = buildAncestorIndex(rows, (row) => metadata.get(row));
  const offsets = [0];
  for (const height of extents) offsets.push(offsets[offsets.length - 1] + height);
  const rowAt = (offset: number) => {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid + 1] <= offset) low = mid + 1;
      else high = mid;
    }
    return Math.min(low, rows.length - 1);
  };
  return (scrollTop: number, viewportHeight = 400) =>
    layoutAncestors(
      index,
      rows.map(() => true),
      (i) => offsets[i],
      (i) => heights[i],
      rowAt,
      scrollTop,
      viewportHeight,
    );
}

describe('active ancestor layout', () => {
  it('uses mixed natural heights and latches a heading at its parent stack edge', () => {
    const layout = fixture([1, 2, 3, 3, 2, 3, 1], [56, 24, 40, 40, 24, 40, 56]);
    expect(layout(0)).toEqual([]);
    expect(layout(1)).toEqual([
      { index: 0, top: 0, height: 56 },
      { index: 1, top: 56, height: 24 },
    ]);
    expect(layout(105)).toEqual([
      { index: 0, top: 0, height: 56 },
      { index: 4, top: 56, height: 24 },
    ]);
  });

  it('retires each ancestor at its own subtree boundary', () => {
    const layout = fixture([1, 2, 3, 3, 2, 3, 1], [56, 24, 40, 40, 24, 40, 56]);
    expect(layout(100)).toEqual([
      { index: 0, top: 0, height: 56 },
      { index: 1, top: 36, height: 24 },
    ]);
    expect(layout(224)).toEqual([]);
  });

  it('releases outermost context first while reserving actual data-row space', () => {
    const layout = fixture([1, 2, 3, 4, 4, 4, 1], [56, 24, 40, 40, 40, 40, 56]);
    expect(layout(81, 100).map((frame) => frame.index)).toEqual([2]);
    expect(layout(81, 150).map((frame) => frame.index)).toEqual([1, 2]);
    expect(layout(81, 40)).toEqual([]);
    expect(layout(81, 0)).toEqual([]);
  });

  it('keeps nearest context visible when nested scopes share the retiring subtree edge', () => {
    const layout = fixture([1, 2, 3, 1], [56, 24, 40, 56]);
    expect(layout(60)).toEqual([
      { index: 0, top: -20, height: 56 },
      { index: 1, top: 36, height: 24 },
    ]);
    expect(layout(100)).toEqual([{ index: 1, top: -4, height: 24 }]);
    expect(layout(120)).toEqual([]);
  });

  it('does not mistake a master/detail extent for the sticky entity height', () => {
    const layout = fixture([1, 2, 3, 3, 1], [56, 24, 40, 40, 56], [156, 24, 40, 40, 56]);
    expect(layout(10)).toEqual([{ index: 0, top: 0, height: 56 }]);
    expect(layout(101)).toEqual([
      { index: 0, top: 0, height: 56 },
      { index: 1, top: 56, height: 24 },
    ]);
  });

  it('bounds geometry reads by retained context, not a deep off-screen ancestry chain', () => {
    const depth = 5000;
    const rows = Array.from({ length: depth + 100 }, (_, i) => ({ level: Math.min(i + 1, depth + 1) }));
    const metadata = new Map<unknown, { level: number }>(rows.map((row) => [row, row]));
    const eligible = rows.map(() => true);
    const index = indexEligibleAncestors(
      buildAncestorIndex(rows, (row) => metadata.get(row)),
      eligible,
    );
    const heightAt = vi.fn(() => 24);
    const rowAt = vi.fn((offset: number) => Math.min(rows.length - 1, Math.floor(offset / 24)));
    const offsetAt = vi.fn((i: number) => i * 24);
    const frames = layoutAncestors(index, eligible, offsetAt, heightAt, rowAt, depth * 24 + 6, 100);
    expect(frames.map((frame) => frame.index)).toEqual([depth - 3, depth - 2, depth - 1]);
    expect(heightAt.mock.calls.length).toBeLessThan(20);
    expect(offsetAt.mock.calls.length).toBeLessThan(20);
    expect(rowAt.mock.calls.length).toBeLessThan(20);
  });

  it('indexes excluded parents before scroll and does not pull unscrolled deep rows into view', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ level: i + 1 }));
    const metadata = new Map<unknown, { level: number }>(rows.map((row) => [row, row]));
    const source = buildAncestorIndex(rows, (row) => metadata.get(row));
    const eligible = rows.map((_, i) => i % 100 === 0);
    const index = indexEligibleAncestors(source, eligible);
    expect(index.parents[499]).toBe(400);
    expect(index.parents[400]).toBe(300);
    expect(index.subtreeEnds).toBe(source.subtreeEnds);
    const frames = fixture(
      rows.map((row) => row.level),
      rows.map(() => 24),
    )(1, 100);
    expect(frames).toEqual([]);
  });
});
