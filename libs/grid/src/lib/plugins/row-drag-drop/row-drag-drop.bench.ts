import { afterAll, beforeAll, bench, describe, expect, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { RowDragDropPlugin } from './row-drag-drop-plugin';

type Row = { id: string; name: string };
const rows = Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: `Row ${index}` }));

for (const custom of [false, true]) {
  let grid: DataGridElement<Row>;
  let updates = 0;
  const plugin = new RowDragDropPlugin<Row>({
    dragHandleRenderer: custom
      ? (ctx) => {
          const element = document.createElement('button');
          ctx.bindHandle(element);
          return {
            element,
            update(next) {
              element.title = next.row.name;
              updates++;
            },
          };
        }
      : undefined,
  });
  beforeAll(async () => {
    grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    grid.gridConfig = { columns: [{ field: 'name' }], plugins: [plugin] };
    grid.rows = rows;
    document.body.append(grid);
    await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
    await grid.ready();
    grid._virtualization.bypassThreshold = 100;
    grid.refreshVirtualWindow(true);
    await grid.ready();
    if (grid.querySelectorAll('.data-grid-row').length !== 20) throw new Error('Expected 20 mounted rows');
  });
  afterAll(() => grid.remove());
  describe(custom ? 'custom DOM drag controls' : 'default drag handles', () => {
    bench(
      'refresh 20 mounted handles',
      () => {
        const before = updates;
        plugin.afterRender();
        if (custom && updates - before !== 20) throw new Error('Refresh did not update all persistent views');
      },
      { time: 500, iterations: 100 },
    );
  });
}
