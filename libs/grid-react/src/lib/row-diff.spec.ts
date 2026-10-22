import { describe, expect, it } from 'vitest';
import { computeRowDiff } from './row-diff';

type Row = { id: string; value?: number; nodes?: Row[] | null; tags?: string[] };
const getId = (row: Row) => row.id;

describe('structural array changes', () => {
  it.each([
    [{ id: 'a' }, { id: 'a', nodes: [] }],
    [{ id: 'a', nodes: [] }, { id: 'a' }],
    [
      { id: 'a', nodes: [] },
      { id: 'a', nodes: null },
    ],
    [
      { id: 'a', nodes: null },
      { id: 'a', nodes: [] },
    ],
    [
      { id: 'a', nodes: [] },
      { id: 'a', nodes: undefined },
    ],
    [
      { id: 'a', nodes: undefined },
      { id: 'a', nodes: [] },
    ],
    [
      { id: 'a', tags: ['one'] },
      { id: 'a', tags: ['two'] },
    ],
    [
      { id: 'a', nodes: [{ id: 'child', value: 1 }] },
      { id: 'a', nodes: [{ id: 'child', value: 2 }] },
    ],
  ] satisfies [Row, Row][])('reprocesses replaced, added or removed arrays: %j -> %j', (before, after) => {
    expect(computeRowDiff([after], [before], getId, true)).toBeNull();
    expect(computeRowDiff([after], [before], getId)).toEqual([{ id: 'a', changes: after }]);
  });

  it('retains scalar sync when child collections are unchanged', () => {
    const nodes: Row[] = [{ id: 'child' }];
    const before = { id: 'a', value: 1, nodes };
    const after = { ...before, value: 2 };
    expect(computeRowDiff([after], [before], getId, true)).toEqual([{ id: 'a', changes: after }]);
    expect(computeRowDiff([after], [after], getId, true)).toEqual([]);
  });
});
