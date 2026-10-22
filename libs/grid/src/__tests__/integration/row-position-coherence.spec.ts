import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../lib/core/grid';
import type { DataGridElement } from '../../lib/core/grid';
import { PinnedRowsPlugin } from '../../lib/plugins/pinned-rows';
import { StickyRowsPlugin } from '../../lib/plugins/sticky-rows';

type Row = { id: string; height: number };
const rows = (count: number, height = 40): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, height }));

async function createGrid(external = false) {
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  const owner = document.createElement('div');
  grid.gridConfig = {
    columns: [{ field: 'id' }],
    getRowId: (row) => row.id,
    rowHeight: (row) => row.height,
    plugins: [
      new PinnedRowsPlugin({ scopedFooters: () => null }),
      ...(external ? [new StickyRowsPlugin({ mode: 'ancestors', isSticky: () => false, scrollContainer: owner })] : []),
    ],
  };
  grid.rows = rows(30);
  owner.append(grid);
  document.body.append(owner);
  await customElements.whenDefined('tbw-grid');
  await grid.ready();
  for (const selector of ['.faux-vscroll', '.rows-viewport', '.tbw-scroll-area']) {
    Object.defineProperty(grid.querySelector(selector), 'clientHeight', { value: 200, configurable: true });
  }
  await grid.forceLayout();
  return grid;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('row position generation coherence', () => {
  for (const count of [45, 26, 30]) {
    it(`rebuilds real positions before focus between the property microtask and ROWS frame (${count})`, async () => {
      const grid = await createGrid();
      vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1234);
      const next = rows(count, 56);
      grid.rows = next;
      await Promise.resolve();
      expect(grid.rows).toEqual(next);
      expect(grid._virtualization.positionCache).toHaveLength(30);

      expect(() => grid.focusCell(count - 1, 'id')).not.toThrow();
      expect(grid._virtualization.positionCache).toHaveLength(count);
      expect(grid._virtualization.positionCache?.at(-1)).toMatchObject({
        offset: (count - 1) * 56,
        height: 56,
      });
      expect(grid._virtualization.scrollMapping.rawContentHeight).toBe(count * 56);
      expect(grid._virtualization.container?.scrollTop).toBe(count * 56 - 200);
      expect(grid.querySelector(`.cell[data-row="${count - 1}"]`)).not.toBeNull();
      expect(grid.focusedCell?.rowIndex).toBe(count - 1);
    });
  }

  it('keeps a reentrant data-change reveal coherent before the scheduler forced refresh', async () => {
    const grid = await createGrid();
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1234);
    grid.rows = rows(45, 56);
    await Promise.resolve();
    let observed = false;
    grid.addEventListener(
      'data-change',
      () => {
        grid.focusCell(44, 'id');
        observed = true;
        expect(grid._virtualization.positionCache?.at(-1)).toMatchObject({ offset: 44 * 56, height: 56 });
      },
      { once: true },
    );
    grid._schedulerProcessRows();
    expect(observed).toBe(true);
    expect(grid._virtualization.container?.scrollTop).toBe(45 * 56 - 200);
  });

  it('makes a non-forced refresh reconcile positions and extent without a focus call', async () => {
    const grid = await createGrid();
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1234);
    grid.rows = rows(45, 56);
    await Promise.resolve();
    expect(() => grid.refreshVirtualWindow(false)).not.toThrow();
    expect(grid._virtualization.positionCache).toHaveLength(45);
    expect(grid._virtualization.scrollMapping.rawContentHeight).toBe(45 * 56);
  });

  for (const byId of [false, true]) {
    it(`reconciles geometry before public end-aligned reveal (byId=${byId})`, async () => {
      const grid = await createGrid();
      vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1234);
      grid.rows = rows(45, 56);
      await Promise.resolve();
      if (byId) grid.scrollToRowById('row-44', { align: 'end' });
      else grid.scrollToRow(44, { align: 'end' });
      expect(grid._virtualization.container?.scrollTop).toBe(45 * 56 - 200);
      expect(grid._virtualization.positionCache).toHaveLength(45);
      const positions = grid._virtualization.positionCache;
      grid.scrollToRow(43);
      grid.focusCell(43, 'id');
      expect(grid._virtualization.positionCache).toBe(positions);
    });
  }

  it('preserves current processed-index semantics before the property microtask', async () => {
    const grid = await createGrid();
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1234);
    grid.rows = rows(45, 56);
    grid.focusCell(44, 'id');
    expect(grid.focusedCell?.rowIndex).toBe(29);
    expect(grid._virtualization.positionCache).toHaveLength(30);
  });

  it('refreshes physical spacer geometry independently of the external visible band', async () => {
    const grid = await createGrid(true);
    grid._virtualization.cachedViewportHeight = 500;
    grid.refreshVirtualWindow(true);
    expect(grid._virtualization.cachedViewportHeight).toBe(200);
    expect(grid._virtualization.totalHeightEl?.style.height).toBe('1200px');
  });
});
