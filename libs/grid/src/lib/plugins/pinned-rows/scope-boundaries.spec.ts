import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { getRowFlow } from '../../core/internal/row-flow';
import { getRowIndexAtOffset, getTotalHeight, updateRowHeight } from '../../core/internal/virtualization';
import { buildAncestorIndex } from '../sticky-rows/ancestor-index';
import { layoutAncestors } from '../sticky-rows/ancestor-layout';
import { TreePlugin } from '../tree';
import { PinnedRowsPlugin } from './pinned-rows-plugin';

interface Row {
  id: string;
  height: number;
  children?: Row[];
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function fixture(final = false, outerFooter = true, innerHeight = 24) {
  const root: Row = {
    id: 'outer',
    height: 56,
    children: [{ id: 'inner', height: 24, children: [{ id: 'leaf', height: 40 }] }],
  };
  const tree = new TreePlugin({ defaultExpanded: true, animation: false });
  const render = () => document.createElement('button');
  const pinned = new PinnedRowsPlugin<Row>({
    scopedFooters: (scope) => {
      if (scope.kind === 'grid') return { height: 32, render };
      if (scope.kind !== 'row') return null;
      if (scope.row.id === 'inner') return { height: innerHeight, render };
      return outerFooter ? { height: 40, render } : null;
    },
  });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  grid.gridConfig = {
    columns: [{ field: 'id' }],
    rowHeight: (row) => row.height,
    getRowId: (row) => row.id,
    plugins: [tree, pinned],
  };
  grid.rows = final ? [root] : [root, { id: 'next', height: 120 }];
  document.body.append(grid);
  await grid.ready();
  const flow = getRowFlow(grid)!;
  const cache = grid._virtualization.positionCache!;
  const hierarchy = grid.getPluginByName('hierarchy')!;
  const index = buildAncestorIndex(grid.rows, (row) => hierarchy.getRowMeta(row));
  const end = (row: number) =>
    flow.scopeEnd?.(row, index.subtreeEnds[row]) ?? cache[index.subtreeEnds[row]]?.offset ?? getTotalHeight(cache);
  const layout = (top: number, height = 1000) =>
    layoutAncestors(
      index,
      grid.rows.map((row) => !!row.children?.length),
      (row) => cache[row]?.offset ?? getTotalHeight(cache),
      (row) => cache[row].height,
      (offset) => getRowIndexAtOffset(cache, offset),
      top,
      height,
      (offset) => flow.scopeAt?.(offset),
      end,
    );
  return { grid, flow, cache, end, layout };
}

describe('footer-inclusive sticky scope boundaries', () => {
  it('retains the outgoing ancestor inside its footer rather than selecting the next subtree', async () => {
    const { layout } = await fixture();
    expect(layout(145).map((frame) => frame.index)).toEqual([0]);
    expect(layout(183.999).map((frame) => frame.index)).toEqual([0]);
    expect(layout(184)).toEqual([]);
  });

  it.each([false, true])('owns co-terminal inner/outer/grid segments, including final=%s', async (final) => {
    const { flow, cache, end, layout } = await fixture(final);
    expect(cache.map((row) => row.offset)).toEqual(final ? [0, 56, 80] : [0, 56, 80, 184]);
    expect(cache[2]).toMatchObject({ height: 40, after: final ? 96 : 64 });
    expect(end(0)).toBe(184);
    expect(end(1)).toBe(144);
    expect(end(2)).toBe(120);
    expect(flow.scopeAt!(119.999)).toBeUndefined();
    expect(flow.scopeAt!(120)).toEqual({ owner: 1, surface: 2 });
    expect(flow.scopeAt!(143.999)).toEqual({ owner: 1, surface: 2 });
    expect(flow.scopeAt!(144)).toEqual({ owner: 0, surface: 2 });
    expect(flow.scopeAt!(183.999)).toEqual({ owner: 0, surface: 2 });
    expect(flow.scopeAt!(184)).toEqual(final ? { owner: -1, surface: 2 } : undefined);
    // The inner row is now covered by its still-live outer row, not replaced
    // with the unrelated next subtree chosen by ordinary data navigation.
    expect(layout(121).map((frame) => frame.index)).toEqual([0]);
    expect(layout(145).map((frame) => frame.index)).toEqual([0]);
    expect(layout(183.999)[0].top + layout(183.999)[0].height).toBeCloseTo(0.001);
    expect(layout(184)).toEqual([]);
    expect(layout(getTotalHeight(cache))).toEqual([]);
    expect(flow.scopeAt!(getTotalHeight(cache))).toEqual({ owner: -1, surface: -1 });
    // Data navigation still skips gaps; only sticky scope membership changes.
    expect(getRowIndexAtOffset(cache, 121)).toBe(final ? 2 : 3);
    for (const top of [119.999, 120, 121, 143.999, 144, 145, 183.999, 184]) {
      for (const frame of layout(top)) {
        expect(frame.top + frame.height).toBeLessThanOrEqual(end(frame.index) - top);
        expect(frame.top + frame.height).toBeGreaterThan(0);
      }
    }
  });

  it('keeps both ancestors where the inner footer leaves enough push-off space', async () => {
    const { flow, end, layout } = await fixture(false, true, 96);
    expect(flow.scopeAt!(121)).toEqual({ owner: 1, surface: 2 });
    expect(end(1)).toBe(216);
    expect(end(0)).toBe(256);
    expect(layout(121).map((frame) => frame.index)).toEqual([0, 1]);
    expect(layout(217).map((frame) => frame.index)).toEqual([0]);
    expect(layout(256)).toEqual([]);
  });

  it('retains a parent through descendant footers without admitting it into a grid-only footer', async () => {
    const { flow, end, layout } = await fixture(true, false);
    expect(end(0)).toBe(144);
    expect(end(1)).toBe(144);
    expect(flow.scopeAt!(130)).toEqual({ owner: 1, surface: 2 });
    expect(layout(130).map((frame) => frame.index)).toEqual([1]);
    expect(flow.scopeAt!(144)).toEqual({ owner: -1, surface: 2 });
    expect(layout(144)).toEqual([]);
  });

  it('reuses current measured offsets without reserving the following subtree surface in a gap', async () => {
    const { grid, flow, cache, end } = await fixture();
    Object.defineProperty(grid._virtualization.viewportEl, 'clientHeight', { value: 70, configurable: true });
    grid._virtualization.container!.scrollTop = 121;
    expect(flow.exhausted!()).toBe(false); // inner24 + preceding data40, not next120
    updateRowHeight(cache, 2, 60);
    expect(flow.scopeAt!(121)).toBeUndefined();
    expect(flow.scopeAt!(141)).toEqual({ owner: 1, surface: 2 });
    expect(end(1)).toBe(164);
    expect(end(0)).toBe(204);
    grid._virtualization.container!.scrollTop = 141;
    expect(flow.exhausted!()).toBe(true); // same capacity policy, current data60
    expect(flow.bottom()).toBe(0);
  });
});
