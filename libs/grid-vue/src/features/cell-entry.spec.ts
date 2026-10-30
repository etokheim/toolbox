// @vitest-environment happy-dom
import type { DataGridElement } from '@toolbox-web/grid';
import { createApp, h, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import TbwGrid from '../lib/TbwGrid.vue';
import './cell-entry';
import './editing';
import './selection';
import './undo-redo';
import type { CellClearDetail } from '@toolbox-web/grid/plugins/cell-entry';

describe('Vue cellEntry feature', () => {
  it.each(['props', 'config'])('forwards opt-in clearing and its native result event via %s', async (entry) => {
    const container = document.createElement('div');
    document.body.append(container);
    const rows = [{ id: 1, first: 'Alice', last: 'Example' }];
    const features = {
      selection: { mode: 'range' as const },
      editing: { editOn: 'manual' as const },
      undoRedo: true,
      cellEntry: { clearOnDelete: true },
    };
    const report = vi.fn<(event: CustomEvent<CellClearDetail>) => void>();
    const app = createApp({
      render: () =>
        h(TbwGrid, {
          rows,
          columns: [
            { field: 'first', type: 'string', editable: true },
            { field: 'last', type: 'string', editable: true },
          ],
          ...(entry === 'props' ? features : { gridConfig: { features } }),
          'onCell-clear': report,
        }),
    });
    try {
      app.mount(container);
      await nextTick();
      const grid = container.querySelector('tbw-grid') as DataGridElement;
      await grid.ready();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      grid.getPluginByName('selection')!.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }]);
      grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      expect(rows[0]).toEqual({ id: 1, first: '', last: '' });
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0][0].detail.cells.map((cell) => cell.status)).toEqual(['cleared', 'cleared']);
      expect(grid.getPluginByName('undoRedo')!.getUndoStack()).toHaveLength(1);
      grid.getPluginByName('undoRedo')!.undo();
      expect(rows[0]).toEqual({ id: 1, first: 'Alice', last: 'Example' });
    } finally {
      app.unmount();
      container.remove();
    }
  });

  it('extracts the prop and continues one-cell editing with Tab', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const app = createApp({
      render: () =>
        h(TbwGrid, {
          rows: [{ id: 1, first: 'Alice', last: 'Example' }],
          columns: [
            { field: 'first', editable: true },
            { field: 'last', editable: true },
          ],
          selection: 'range',
          editing: { editOn: 'manual', tabToEdit: true },
          cellEntry: { singleClick: true },
        }),
    });
    const warn = vi.fn();
    app.config.warnHandler = warn;
    try {
      app.mount(container);
      await nextTick();
      const grid = container.querySelector('tbw-grid') as DataGridElement;
      await grid.ready();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(grid.getPluginByName('cellEntry')).toBeDefined();
      grid.querySelector<HTMLElement>('[data-row="0"][data-field="first"]')!.click();
      const input = grid.querySelector<HTMLInputElement>('.cell.editing input')!;
      expect(input).not.toBeNull();
      input.value = 'Alicia';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      await nextTick();
      expect(grid.querySelectorAll('.cell.editing')).toHaveLength(1);
      expect(grid.querySelector('.cell.editing')?.getAttribute('data-field')).toBe('last');
      expect(grid.rows[0]).toMatchObject({ first: 'Alicia' });
      expect(input.isConnected).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      app.unmount();
      container.remove();
    }
  });
});
