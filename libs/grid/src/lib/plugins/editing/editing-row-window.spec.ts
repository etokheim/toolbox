import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { setRowWindow } from '../../core/internal/row-window';
import type { ColumnEditorContext } from '../../core/types';
import { StickyRowsPlugin } from '../sticky-rows';
import { UndoRedoPlugin } from '../undo-redo';
import { EditingPlugin } from './editing-plugin';

type Row = { id: string; value: string };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('editor exit in a retained row window', () => {
  it('closes an offscreen edit only on an allowed outside click and preserves committed history', async () => {
    let offscreen = false;
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(160);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const offset = this.closest(DataGridElement.activeTag) && offscreen ? 400 : 0;
      return new DOMRect(
        0,
        offset + (this.classList.contains('rows-viewport') ? 32 : 0),
        400,
        this.classList.contains('header') ? 32 : 160,
      );
    });
    const owner = document.createElement('div');
    const overlay = document.createElement('button');
    const heading = document.createElement('h2');
    document.body.append(owner, overlay, heading);
    const beforeClose = vi.fn(() => true);
    const editing = new EditingPlugin<Row>({ onBeforeEditClose: beforeClose });
    const undo = new UndoRedoPlugin();
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    let context: ColumnEditorContext<Row> | undefined;
    grid.gridConfig = {
      getRowId: (row) => row.id,
      rowHeight: 24,
      plugins: [
        editing,
        undo,
        new StickyRowsPlugin({ mode: 'ancestors', isSticky: () => false, scrollContainer: owner }),
      ],
      columns: [
        {
          field: 'value',
          editable: true,
          editor: (ctx) => {
            context = ctx;
            const input = document.createElement('input');
            input.value = String(ctx.value);
            return input;
          },
        },
      ],
    };
    const row = { id: 'first', value: 'Original' };
    grid.rows = [row];
    owner.append(grid);
    await customElements.whenDefined(DataGridElement.activeTag);
    await grid.ready();
    editing.beginCellEdit(0, 'value');
    if (!context) throw new Error('Missing editor context');
    context.commit('Changed');
    expect(undo.getUndoStack()).toHaveLength(1);
    const closed = vi.fn();
    grid.addEventListener('edit-close', closed);
    grid.registerExternalFocusContainer(overlay);
    offscreen = true;
    owner.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(grid.querySelectorAll('.rows > .data-grid-row')).toHaveLength(0));
    expect(grid.findRenderedRowElement(0)).toBeNull();
    expect(closed).not.toHaveBeenCalled();
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    beforeClose.mockReturnValue(false);
    heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    beforeClose.mockReturnValue(true);
    heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
    expect(row.value).toBe('Changed');
    expect(undo.getUndoStack()).toHaveLength(1);
    offscreen = false;
    owner.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(grid.querySelectorAll('.rows > .data-grid-row')).toHaveLength(1));
    expect(grid.querySelector('.cell.editing')).toBeNull();
    undo.undo();
    expect(row.value).toBe('Original');
    undo.redo();
    expect(row.value).toBe('Changed');
  });

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
