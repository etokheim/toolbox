/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import {
  dropCandidates,
  fillMessage,
  liftLayout,
  moveRows,
  movingRoots,
  nearestRowSlot,
  restShift,
  type RowTreeAccess,
} from './row-lift';

interface Node {
  id: string;
  children?: Node[];
  expanded?: boolean;
}

/** Tree access over plain nested nodes. */
function treeOf(top: Node[]): RowTreeAccess<Node> {
  const parents = new Map<Node, Node | null>();
  const depths = new Map<Node, number>();
  const walk = (list: Node[], parent: Node | null, depth: number) => {
    for (const n of list) {
      parents.set(n, parent);
      depths.set(n, depth);
      walk(n.children ?? [], n, depth + 1);
    }
  };
  walk(top, null, 0);
  return {
    depth: (n) => depths.get(n) ?? 0,
    parent: (n) => parents.get(n) ?? null,
    expanded: (n) => !!n.children?.length && n.expanded !== false,
    children: (p) => (p === null ? top : (p.children ?? [])),
  };
}

const ids = (rows: readonly Node[]) => rows.map((r) => r.id);

describe('liftLayout', () => {
  it('stacks dragged rows and lists the slots the block can take', () => {
    const layout = liftLayout(5, new Set([1, 3]), 1, () => 10);
    expect(layout.block).toEqual([1, 3]);
    expect(layout.rest).toEqual([0, 2, 4]);
    expect([...layout.restPos]).toEqual([0, -1, 1, -1, 2]);
    expect(layout.slotTops).toEqual([0, 10, 20, 30]);
    expect(layout.stack.get(3)).toBe(10);
    expect(layout.blockHeight).toBe(20);
    expect(layout.home).toBe(1);
    expect(layout.contiguous).toBe(false);
  });

  it('uses each row height', () => {
    const layout = liftLayout(3, new Set([0]), 0, (i) => [40, 20, 30][i]);
    expect(layout.slotTops).toEqual([0, 20, 50]);
    expect(layout.blockHeight).toBe(40);
    expect(layout.contiguous).toBe(true);
  });
});

describe('nearestRowSlot', () => {
  const tops = [0, 30, 60, 90];

  it('picks the nearest slot without a current one', () => {
    expect(nearestRowSlot(tops, 44, -1, 8)).toBe(1);
    expect(nearestRowSlot(tops, 46, -1, 8)).toBe(2);
    expect(nearestRowSlot(tops, 500, -1, 8)).toBe(3);
  });

  it('keeps the current slot until the block clearly passes the midpoint', () => {
    expect(nearestRowSlot(tops, 48, 1, 8)).toBe(1);
    expect(nearestRowSlot(tops, 54, 1, 8)).toBe(2);
    expect(nearestRowSlot(tops, 42, 2, 8)).toBe(2);
    expect(nearestRowSlot(tops, 36, 2, 8)).toBe(1);
  });
});

describe('restShift', () => {
  it('moves rows below the open slot down by the block height', () => {
    const layout = liftLayout(4, new Set([0]), 0, () => 10);
    // Rest rows 1..3 start at offsets 10, 20, 30.
    expect(restShift(layout, 1, 0, 10)).toBe(0);
    expect(restShift(layout, 1, 1, 10)).toBe(-10);
    expect(restShift(layout, 3, 2, 30)).toBe(0);
    expect(restShift(layout, 2, 2, 20)).toBe(-10);
  });
});

describe('tree helpers', () => {
  const build = () => {
    const a1: Node = { id: 'a1' };
    const a2: Node = { id: 'a2' };
    const a: Node = { id: 'a', children: [a1, a2] };
    const b: Node = { id: 'b' };
    const c1: Node = { id: 'c1' };
    const c: Node = { id: 'c', children: [c1] };
    const top = [a, b, c];
    return { a, a1, a2, b, c, c1, top, tree: treeOf(top) };
  };

  it('movingRoots drops rows whose ancestor also moves', () => {
    const { a, a1, b, c1, tree } = build();
    expect(ids(movingRoots([a, a1, b, c1], tree))).toEqual(['a', 'b', 'c1']);
  });

  it('dropCandidates prefers the depth of the moving rows', () => {
    const { a2, b, tree } = build();
    const moving = new Set<Node>([{ id: 'x' }]);
    // Gap between a2 (depth 1) and b (depth 0).
    const shallow = dropCandidates(a2, b, moving, 0, tree);
    expect(shallow.map((c) => [c.parent?.id ?? null, c.index])).toEqual([
      [null, 1],
      ['a', 2],
    ]);
    const deep = dropCandidates(a2, b, moving, 1, tree);
    expect(deep.map((c) => [c.parent?.id ?? null, c.index])).toEqual([
      ['a', 2],
      [null, 1],
    ]);
  });

  it('dropCandidates offers the first child of an expanded prev whose children all move', () => {
    const { c, c1, tree } = build();
    const moving = new Set<Node>([c1]);
    const out = dropCandidates(c, undefined, moving, 1, tree);
    expect(out[0]).toEqual({ parent: c, index: 0, depth: 1 });
  });

  it('dropCandidates falls back to the top level', () => {
    const { tree } = build();
    expect(dropCandidates(undefined, undefined, new Set(), 0, tree)).toEqual([{ parent: null, index: 0, depth: 0 }]);
  });

  it('moveRows re-parents without mutating', () => {
    const { a, a1, b, c, top, tree } = build();
    const lists = moveRows([a1, b], { parent: c, index: 1, depth: 1 }, tree);
    expect(ids(lists.get(a)!)).toEqual(['a2']);
    expect(ids(lists.get(null)!)).toEqual(['a', 'c']);
    expect(ids(lists.get(c)!)).toEqual(['c1', 'a1', 'b']);
    expect(ids(top)).toEqual(['a', 'b', 'c']);
    expect(ids(a.children!)).toEqual(['a1', 'a2']);
  });

  it('moveRows reorders within one parent', () => {
    const { b, tree } = build();
    const lists = moveRows([b], { parent: null, index: 2, depth: 0 }, tree);
    expect(ids(lists.get(null)!)).toEqual(['a', 'c', 'b']);
  });
});

describe('fillMessage', () => {
  it('fills known placeholders only', () => {
    expect(fillMessage('{count} rows at {position} of {total}', { count: 2, position: 3 })).toBe(
      '2 rows at 3 of {total}',
    );
  });
});
