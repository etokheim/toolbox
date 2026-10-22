import { describe, expect, it, vi } from 'vitest';
import { buildAncestorIndex, getAncestorChain } from './ancestor-index';

function hierarchy(levels: readonly (number | undefined)[]) {
  const rows = levels.map((level, occurrence) => ({ occurrence, level }));
  const metadata = new Map<unknown, { level: number } | undefined>(
    rows.map((row) => [row, row.level === undefined ? undefined : { level: row.level }]),
  );
  const positionOf = (row: unknown) => metadata.get(row);
  return { rows, positionOf };
}

describe('StickyRows ancestor index', () => {
  it('indexes entity ancestors and structural headings with individual exclusive subtree ends', () => {
    const { rows, positionOf } = hierarchy([1, 2, 3, 3, 2, 3, 1]);
    const index = buildAncestorIndex(rows, positionOf);

    expect(index.parents).toEqual([-1, 0, 1, 1, 0, 4, -1]);
    expect(index.subtreeEnds).toEqual([6, 4, 3, 4, 6, 6, 7]);
    expect(getAncestorChain(index, 3)).toEqual([0, 1]);
    expect(getAncestorChain(index, 5)).toEqual([0, 4]);
    expect(getAncestorChain(index, 6)).toEqual([]);
  });

  it('handles empty, flat and collapsed generations without stale ancestors', () => {
    expect(buildAncestorIndex([], () => undefined)).toEqual({ rows: [], parents: [], subtreeEnds: [] });
    const flat = hierarchy([undefined, undefined, undefined]);
    expect(buildAncestorIndex(flat.rows, flat.positionOf).parents).toEqual([-1, -1, -1]);
    const collapsed = hierarchy([1, 1, 1]);
    expect(buildAncestorIndex(collapsed.rows, collapsed.positionOf).subtreeEnds).toEqual([1, 2, 3]);
  });

  it('projects removed headings to the nearest surviving source ancestor', () => {
    const { rows, positionOf } = hierarchy([1, 2, 3, 3, 2, 3, 1]);
    const index = buildAncestorIndex(rows, positionOf, [rows[0], rows[3], rows[4], rows[5], rows[6]]);

    expect(index.parents).toEqual([-1, 0, 0, 2, -1]);
    expect(index.subtreeEnds).toEqual([4, 2, 4, 4, 5]);
    expect(getAncestorChain(index, 3)).toEqual([0, 2]);
  });

  it('never attaches a filtered parent promotion to a preceding unrelated root', () => {
    const { rows, positionOf } = hierarchy([1, 2, 1, 2, 3]);
    const index = buildAncestorIndex(rows, positionOf, [rows[0], rows[4]]);

    expect(index.parents).toEqual([-1, -1]);
    expect(index.subtreeEnds).toEqual([1, 2]);
    expect(getAncestorChain(index, 1)).toEqual([]);
  });

  it('keeps duplicate canonical entities separate by occurrence reference', () => {
    const entity = { id: 'shared' };
    const root = { entity: { id: 'root' }, level: 1 };
    const first = { entity, level: 2 };
    const firstChild = { entity: { id: 'child-a' }, level: 3 };
    const second = { entity, level: 2 };
    const secondChild = { entity: { id: 'child-b' }, level: 3 };
    const rows = [root, first, firstChild, second, secondChild];
    const metadata = new Map<unknown, { level: number }>(rows.map((row) => [row, { level: row.level }]));
    const index = buildAncestorIndex(rows, (row) => metadata.get(row));

    expect(getAncestorChain(index, 2)).toEqual([0, 1]);
    expect(getAncestorChain(index, 4)).toEqual([0, 3]);
    expect(index.subtreeEnds[1]).toBe(3);
    expect(index.subtreeEnds[3]).toBe(5);
  });

  it('reindexes same-count subtree reorder without carrying positional ownership forward', () => {
    const { rows, positionOf } = hierarchy([1, 2, 3, 2, 3]);
    const before = buildAncestorIndex(rows, positionOf);
    const reordered = [rows[0], rows[3], rows[4], rows[1], rows[2]];
    const after = buildAncestorIndex(rows, positionOf, reordered);

    expect(before.rows[1]).toBe(rows[1]);
    expect(after.rows[1]).toBe(rows[3]);
    expect(after.parents).toEqual([-1, 0, 1, 0, 3]);
    expect(after.subtreeEnds).toEqual([5, 3, 3, 5, 5]);
    expect(after.rows[getAncestorChain(after, 4)[1]]).toBe(rows[1]);
  });

  it('rebuilds relationships when the same row references are reparented', () => {
    const { rows, positionOf } = hierarchy([1, 2, 1]);
    const before = buildAncestorIndex(rows, positionOf);
    const nextRows = [rows[0], rows[2], rows[1]];
    const nextMetadata = new Map<unknown, { level: number }>([
      [rows[0], { level: 1 }],
      [rows[2], { level: 1 }],
      [rows[1], { level: 2 }],
    ]);
    const after = buildAncestorIndex(nextRows, (row) => nextMetadata.get(row));

    expect(getAncestorChain(before, 1)).toEqual([0]);
    expect(getAncestorChain(after, 2)).toEqual([1]);
    expect(after.subtreeEnds).toEqual([1, 3, 3]);
  });

  it('keeps generation snapshots independent of same-count source replacement', () => {
    const original = hierarchy([1, 2, 3]);
    const before = buildAncestorIndex(original.rows, original.positionOf);
    const replacement = hierarchy([1, 1, 2]);
    original.rows.splice(0, original.rows.length, ...replacement.rows);
    const after = buildAncestorIndex(original.rows, replacement.positionOf);

    expect(before.rows[0]).not.toBe(after.rows[0]);
    expect(before.parents).toEqual([-1, 0, 1]);
    expect(after.parents).toEqual([-1, -1, 1]);
  });

  it('treats missing hierarchy metadata as a scope boundary', () => {
    const { rows, positionOf } = hierarchy([1, 2, undefined, 3, 4]);
    const index = buildAncestorIndex(rows, positionOf);

    expect(index.parents).toEqual([-1, 0, -1, -1, 3]);
    expect(index.subtreeEnds).toEqual([2, 2, 3, 5, 5]);
  });

  it('does not reread rows or metadata during ancestor queries', () => {
    const { rows, positionOf } = hierarchy([1, 2, ...new Array<number>(1000).fill(3)]);
    const readMetadata = vi.fn(positionOf);
    const index = buildAncestorIndex(rows, readMetadata);
    expect(readMetadata).toHaveBeenCalledTimes(rows.length);
    readMetadata.mockClear();

    for (let row = 2; row < index.rows.length; row++) {
      expect(getAncestorChain(index, row)).toEqual([0, 1]);
    }
    expect(readMetadata).not.toHaveBeenCalled();
  });

  it('rejects repeated occurrence references rather than aliasing their ownership', () => {
    const { rows, positionOf } = hierarchy([1, 2]);
    expect(() => buildAncestorIndex([rows[0], rows[0]], positionOf)).toThrow('distinct row occurrences');
    expect(() => buildAncestorIndex([rows[0], rows[0]], positionOf, [rows[0]])).toThrow(
      'distinct hierarchy occurrences',
    );
  });

  it('rejects projections that interleave unrelated subtrees', () => {
    const { rows, positionOf } = hierarchy([1, 2, 1, 2]);
    expect(() => buildAncestorIndex(rows, positionOf, [rows[0], rows[2], rows[1], rows[3]])).toThrow(
      'preserve hierarchy subtree order',
    );
    expect(() => buildAncestorIndex(rows, positionOf, [rows[1], rows[0]])).toThrow('preserve hierarchy subtree order');
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid authoritative hierarchy level %s', (level) => {
    expect(() => buildAncestorIndex([{}], () => ({ level }))).toThrow('positive integer hierarchy levels');
  });

  it.each([-1, 1, 0.5, NaN])('rejects a query outside its row generation: %s', (rowIndex) => {
    const index = buildAncestorIndex([{}], () => ({ level: 1 }));
    expect(() => getAncestorChain(index, rowIndex)).toThrow(RangeError);
  });
});
