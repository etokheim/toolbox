import { afterEach, describe, expect, it } from 'vitest';
import '../../lib/core/grid';
import type { DataGridElement } from '../../lib/core/grid';
import { StickyRowsPlugin } from '../../lib/plugins/sticky-rows';

type Row = { id: string; value: number; derived?: number; control?: string };

afterEach(() => document.body.replaceChildren());

describe('retained row mutation rendering', () => {
  for (const method of ['updateRow', 'updateRows', 'transaction'] as const) {
    it(`updates dependent displays without replacing stable owners through ${method}`, async () => {
      const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
      const owner = document.createElement('input');
      owner.value = 'draft';
      const row = { id: 'item', value: 2 };
      grid.rows = [row];
      grid.gridConfig = {
        getRowId: (row) => row.id,
        columns: [
          { field: 'id', renderer: ({ row }) => `value:${row.value}` },
          { field: 'derived', valueAccessor: ({ row }) => row.value * 2, renderer: ({ value }) => `double:${value}` },
          { field: 'control', renderer: () => owner },
        ],
        plugins: [new StickyRowsPlugin({ mode: 'ancestors', isSticky: () => false })],
      };
      document.body.append(grid);
      await customElements.whenDefined('tbw-grid');
      await grid.ready();
      expect(grid._bodyEl.querySelector('.cell[data-field="derived"]')?.textContent).toBe('double:4');

      const rendered = new Promise<void>((resolve) => grid.addEventListener('render', () => resolve(), { once: true }));
      if (method === 'updateRow') grid.updateRow('item', { value: 7 });
      else if (method === 'updateRows') grid.updateRows([{ id: 'item', changes: { value: 7 } }], 'sync');
      else await grid.applyTransaction({ update: [{ id: 'item', changes: { value: 7 } }] });
      await rendered;

      expect(grid._bodyEl.querySelector('.cell[data-field="id"]')?.textContent).toBe('value:7');
      expect(grid._bodyEl.querySelector('.cell[data-field="derived"]')?.textContent).toBe('double:14');
      expect(grid.querySelector('input')).toBe(owner);
      expect(owner.value).toBe('draft');
      expect(grid.rows[0]).toBe(row);
    });
  }
});
