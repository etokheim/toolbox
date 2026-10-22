import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../lib/core/grid';
import type { ColumnConfig } from '../../lib/core/types';
import { PinnedColumnsPlugin } from '../../lib/plugins/pinned-columns/pinned-columns-plugin';

interface Row {
  id: string;
  name: string;
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function fixture(width: unknown = 240) {
  const plugin = new PinnedColumnsPlugin();
  const renderers = new WeakMap<HTMLElement, HTMLElement>();
  const column: ColumnConfig<Row> = {
    field: '__actions',
    width: 88,
    pinned: 'right',
    utility: true,
    expandedCellWidth: 240,
    renderer: (ctx) => {
      const cell = ctx.cellEl!;
      let node = renderers.get(cell);
      if (!node) {
        node = document.createElement('button');
        node.textContent = 'More';
        renderers.set(cell, node);
      }
      return node;
    },
  };
  Reflect.set(column, 'expandedCellWidth', width);
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  grid.gridConfig = {
    getRowId: (row) => row.id,
    columns: [{ field: 'name', width: 400 }, column],
    plugins: [plugin],
  };
  grid.rows = [
    { id: 'a/one', name: 'A' },
    { id: 'b/one', name: 'B' },
  ];
  document.body.append(grid);
  await grid.ready();
  const cell = () => grid.querySelector<HTMLElement>('.rows > .data-grid-row > .cell[data-field="__actions"]')!;
  return { grid, plugin, cell };
}

describe('native action-cell lifecycle', () => {
  it.each([240, 'content'])(
    'preserves the same renderer and its lease across stable data updates (%s)',
    async (width) => {
      const { grid, plugin, cell } = await fixture(width);
      const original = cell().firstElementChild;
      const release = plugin.retainCellExpansion('a/one', '__actions');
      grid.updateRow('a/one', { name: 'Updated' });
      await grid.forceLayout();
      expect(cell().firstElementChild).toBe(original);
      expect(cell().hasAttribute('data-tbw-cell-expanded')).toBe(true);
      release();
      expect(cell().hasAttribute('data-tbw-cell-expanded')).toBe(false);
    },
  );

  it('revokes a lease on row removal and stale release does not close a successor', async () => {
    const { grid, plugin, cell } = await fixture();
    const release = plugin.retainCellExpansion('a/one', '__actions');
    grid.rows = [{ id: 'b/one', name: 'B' }];
    await grid.forceLayout();
    expect(cell().hasAttribute('data-tbw-cell-expanded')).toBe(false);
    const next = plugin.retainCellExpansion('b/one', '__actions');
    release();
    expect(cell().hasAttribute('data-tbw-cell-expanded')).toBe(true);
    next();
  });

  it('retires expansion when sticky positioning is explicitly cleared', async () => {
    const { grid, plugin, cell } = await fixture();
    const release = plugin.retainCellExpansion('a/one', '__actions');
    plugin.clearStickyPositions();
    expect(cell().hasAttribute('data-tbw-cell-expanded')).toBe(false);
    expect(() => plugin.retainCellExpansion('a/one', '__actions')).toThrow(/one mounted/);
    await grid.forceLayout();
    const next = plugin.retainCellExpansion('a/one', '__actions');
    release();
    expect(cell().hasAttribute('data-tbw-cell-expanded')).toBe(true);
    next();
  });

  it.each([0, -1, NaN, Infinity, '240px'])('diagnoses and drops invalid numeric width %s', async (width) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const { plugin } = await fixture(width);
    expect(
      warning.mock.calls.some((args) => String(args[0]).includes('expandedCellWidth must be a finite positive number')),
    ).toBe(true);
    expect(() => plugin.retainCellExpansion('a/one', '__actions')).toThrow(/requires an expandedCellWidth/);
  });
});
