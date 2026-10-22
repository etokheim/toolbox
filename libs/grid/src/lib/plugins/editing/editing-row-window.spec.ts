import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { setRowWindow } from '../../core/internal/row-window';
import type { ColumnEditorContext } from '../../core/types';
import { EditingPlugin } from './editing-plugin';

type Row = { id: string; value: string };

afterEach(() => {
  document.body.replaceChildren();
});

describe('editor exit in a retained row window', () => {
  it.each(['cancel', 'commit'] as const)('restores only edited cell content on %s', async (exit) => {
    const editing = new EditingPlugin({ editOn: 'dblclick' });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    let context: ColumnEditorContext<Row> | undefined;
    const display = vi.fn(({ value }: { value: unknown }) => {
      const span = document.createElement('span');
      span.dataset.display = '';
      span.textContent = String(value);
      return span;
    });
    const control = document.createElement('button');
    control.textContent = 'Action';
    const renderControl = vi.fn(() => control);
    grid.gridConfig = {
      getRowId: (row) => row.id,
      plugins: [editing],
      columns: [
        { field: 'id', renderer: renderControl },
        {
          field: 'value',
          editable: true,
          renderer: display,
          editor: (ctx) => {
            context = ctx;
            const host = document.createElement('div');
            const input = document.createElement('input');
            input.value = String(ctx.value);
            host.append(input);
            return host;
          },
        },
      ],
    };
    grid.rows = [{ id: 'first', value: 'Original' }];
    document.body.append(grid);
    await customElements.whenDefined(DataGridElement.activeTag);
    await grid.ready();
    setRowWindow(grid, {
      indices: [0],
      elements: new Map([[0, grid._rowPool[0]]]),
      select: () => false,
      reconcile(pool) {
        this.elements.set(0, pool[0]);
        return pool;
      },
      layout: vi.fn(),
    });
    await grid.forceLayout();
    const cell = grid.querySelector<HTMLElement>('.cell[data-row="0"][data-field="value"]');
    if (!cell) throw new Error('Missing editable cell');
    expect(grid.findRenderedRowElement(0)).toBe(cell.parentElement);
    expect(grid.getPluginByName('editing')).toBe(editing);
    editing.beginCellEdit(0, 'value');
    expect(context).toBeDefined();
    await vi.waitFor(() => expect(cell.querySelector('input')).not.toBeNull());
    const input = cell.querySelector('input');
    const controlCalls = renderControl.mock.calls.length;
    grid.refreshVirtualWindow(true);
    expect(cell.querySelector('input')).toBe(input);
    expect(renderControl).toHaveBeenCalledTimes(controlCalls);
    if (!context) throw new Error('Missing editor context');
    if (exit === 'commit') context.commit('Changed');
    else context.cancel();
    if (exit === 'commit') editing.commitActiveRowEdit();
    else editing.cancelActiveRowEdit();
    expect(cell.classList.contains('editing')).toBe(false);
    expect(cell.hasAttribute('data-editor-managed')).toBe(false);
    expect(cell.querySelector('input')).toBeNull();
    expect(cell.querySelector('[data-display]')?.textContent).toBe(exit === 'commit' ? 'Changed' : 'Original');
    expect(control.isConnected).toBe(true);
    expect(renderControl).toHaveBeenCalledTimes(controlCalls);
    const displayCalls = display.mock.calls.length;
    grid.refreshVirtualWindow(true);
    expect(display).toHaveBeenCalledTimes(displayCalls);
  });
});
