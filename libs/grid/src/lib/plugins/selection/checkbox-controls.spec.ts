import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { releaseControl } from '../../core/internal/control-lifecycle';
import type { ControlView, GridConfig } from '../../core/types';
import { SelectionPlugin } from './selection-plugin';
import type { SelectionConfig, SelectionHeaderCheckboxContext, SelectionRowCheckboxContext } from './types';

type Row = { id: string; name: string; locked?: boolean };
const rows: Row[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob', locked: true },
  { id: 'c', name: 'Carol' },
];
const cells = '.rows .cell[data-field="__tbw_checkbox"]';

async function setup(config: Partial<SelectionConfig<Row>> = {}, overrides: Partial<GridConfig<Row>> = {}) {
  const plugin = new SelectionPlugin<Row>({ mode: 'row', checkbox: true, ...config });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  grid.gridConfig = { columns: [{ field: 'name' }], plugins: [plugin], ...overrides };
  grid.rows = rows.slice();
  document.body.append(grid);
  await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
  await grid.ready();
  await vi.waitFor(() => expect(grid.querySelectorAll(cells)).toHaveLength(3));
  return { grid, plugin };
}

function rowView(contexts: SelectionRowCheckboxContext<Row>[], disposed = vi.fn()) {
  return (initial: SelectionRowCheckboxContext<Row>): ControlView<SelectionRowCheckboxContext<Row>> => {
    const element = document.createElement('button');
    element.setAttribute('role', 'checkbox');
    let context = initial;
    const update = (next: typeof initial) => {
      context = next;
      contexts.push(next);
      element.setAttribute('aria-label', next.ariaLabel);
      element.setAttribute('aria-checked', String(next.checked));
      element.disabled = next.disabled;
    };
    element.onclick = (event) => context.setChecked(!context.checked, event);
    update(initial);
    return { element, update, dispose: disposed };
  };
}

describe('selection checkbox controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('retains default input markup and the empty single-select header', async () => {
    const header = vi.fn(() => document.createElement('button'));
    const { grid } = await setup({ multiSelect: false, headerCheckboxRenderer: header });
    expect(grid.querySelector(`${cells} > input.tbw-select-row-checkbox`)).not.toBeNull();
    expect(grid.querySelector('.tbw-checkbox-header')?.children).toHaveLength(0);
    expect(header).not.toHaveBeenCalled();
  });

  it('updates persistent controls without remounting, preserving focus and exactly-once selection', async () => {
    const contexts: SelectionRowCheckboxContext<Row>[] = [];
    const renderer = vi.fn(rowView(contexts));
    const { grid, plugin } = await setup({ rowCheckboxRenderer: renderer, isSelectable: (row) => !row.locked });
    const button = grid.querySelector<HTMLButtonElement>(`${cells} button`)!;
    const calls = renderer.mock.calls.length;
    const change = vi.fn();
    grid.addEventListener('selection-change', change);
    button.focus();
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-checked')).toBe('true'));
    expect(change).toHaveBeenCalledTimes(1);
    expect(plugin.getSelectedRowIndices()).toEqual([0]);
    expect(document.activeElement).toBe(button);
    expect(renderer).toHaveBeenCalledTimes(calls);
    expect(contexts.find((ctx) => ctx.row.id === 'b')?.disabled).toBe(true);
    const latest = contexts.at(-1)!;
    expect(latest.grid).toBe(grid);
    expect(latest.rowId).toBe(latest.row.id);
  });

  it('uses the existing modifier rules and exposes mixed select-all state', async () => {
    const contexts: SelectionRowCheckboxContext<Row>[] = [];
    let header!: SelectionHeaderCheckboxContext<Row>;
    const { grid, plugin } = await setup({
      isSelectable: (row) => !row.locked,
      rowCheckboxRenderer: rowView(contexts),
      headerCheckboxRenderer: (ctx) => {
        header = ctx;
        return null;
      },
    });
    contexts.find((ctx) => ctx.rowId === 'a')!.setChecked(true);
    plugin.afterRender();
    expect(header.indeterminate).toBe(true);
    contexts.find((ctx) => ctx.rowId === 'c')!.setChecked(true, { shiftKey: true });
    plugin.afterRender();
    expect(plugin.getSelectedRowIndices()).toEqual([0, 2]);
    expect(header.checked).toBe(true);
    header.setChecked(false);
    expect(plugin.getSelectedRowIndices()).toEqual([]);
    expect(grid.querySelector('.header-row [data-field="__tbw_checkbox"]')?.textContent).toBe('');
  });

  it('invalidates recycled actions and disposes once before a header or column rebuild', async () => {
    const contexts: SelectionRowCheckboxContext<Row>[] = [];
    const disposeRow = vi.fn();
    const disposeHeader = vi.fn();
    const { grid, plugin } = await setup({
      rowCheckboxRenderer: rowView(contexts, disposeRow),
      headerCheckboxRenderer: () => ({
        element: document.createElement('button'),
        update: vi.fn(),
        dispose: disposeHeader,
      }),
    });
    const old = contexts.find((ctx) => ctx.rowId === 'a')!;
    grid._rows[0] = { id: 'd', name: 'Dora' };
    grid._virtualization.start = 0;
    plugin.afterRender();
    expect(disposeRow).toHaveBeenCalledTimes(1);
    old.setChecked(true);
    expect(plugin.getSelectedRowIndices()).toEqual([]);
    const headerCount = disposeHeader.mock.calls.length;
    grid._schedulerRenderHeader();
    expect(disposeHeader).toHaveBeenCalledTimes(headerCount + 1);
    grid._clearRowPool();
    expect(disposeRow).toHaveBeenCalledTimes(4);
    grid.remove();
    expect(disposeRow).toHaveBeenCalledTimes(4);
  });

  it('replaces callbacks on STYLE without resetting selection or retaining old actions', async () => {
    const contexts: SelectionRowCheckboxContext<Row>[] = [];
    const disposed = vi.fn();
    const { grid, plugin } = await setup({ rowCheckboxRenderer: rowView(contexts, disposed) });
    contexts[0].setChecked(true);
    const old = contexts[0];
    const columns = grid._columns;
    plugin.setCheckboxRenderers({ rowCheckboxRenderer: () => null });
    plugin.afterRender();
    expect(disposed).toHaveBeenCalledTimes(3);
    expect(grid._columns).toBe(columns);
    expect(plugin.getSelectedRowIndices()).toEqual([0]);
    old.setChecked(false);
    expect(plugin.getSelectedRowIndices()).toEqual([0]);
    expect(grid.querySelector(`${cells} button`)).toBeNull();
  });

  it('reports invalid outputs, never falls back, and releases removed controls idempotently', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    // @ts-expect-error JavaScript callers can return an invalid value.
    const invalid: NonNullable<SelectionConfig<Row>['rowCheckboxRenderer']> = () => undefined;
    const { grid } = await setup({ rowCheckboxRenderer: invalid });
    expect(warning.mock.calls.some((args) => String(args[0]).includes('TBW065'))).toBe(true);
    expect(grid.querySelector('.tbw-select-row-checkbox')).toBeNull();
    const cell = grid.querySelector<HTMLElement>(cells)!;
    releaseControl(cell);
    releaseControl(cell);
  });

  it('invalidates actions on plugin removal and disposes every remaining view once', async () => {
    const contexts: SelectionRowCheckboxContext<Row>[] = [];
    const disposed = vi.fn();
    const { grid, plugin } = await setup({ rowCheckboxRenderer: rowView(contexts, disposed) });
    const oldAction = contexts[0].setChecked;
    grid.gridConfig = { columns: [{ field: 'name' }], plugins: [] };
    await grid.ready();
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(3));
    expect(() => oldAction(true)).not.toThrow();
    expect(plugin.getSelectedRowIndices()).toEqual([]);
    grid.remove();
    expect(disposed).toHaveBeenCalledTimes(3);
  });
});
