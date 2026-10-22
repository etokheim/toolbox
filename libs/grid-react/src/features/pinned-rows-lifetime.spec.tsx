/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import type { GridConfig } from '../lib/react-column-config';
import './editing';
import './undo-redo';
import './selection';
import './pinned-rows';
import type { PinnedRowsConfig } from './pinned-rows';

type Row = { id: string; quantity: number; name: string };
const columns: GridConfig<Row>['columns'] = [{ field: 'quantity', editable: true, type: 'number' }, { field: 'name' }];
const baseConfig: GridConfig<Row> = { getRowId: (row) => row.id, columns };
const roots: Root[] = [];
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

afterEach(async () => {
  for (const root of roots.splice(0)) root.unmount();
  await frame();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe.each(['props', 'canonical'] as const)('PinnedRows live slots (%s)', (surface) => {
  it('updates scoped eligibility and height while preserving editor, Undo, and portal state', async () => {
    const rows: Row[] = [{ id: 'one', quantity: 2, name: 'One' }];
    const unmount = vi.fn();
    function Footer({ revision }: { revision: number }) {
      const [count, setCount] = useState(0);
      useEffect(() => () => unmount(), []);
      return (
        <button data-scoped onClick={() => setCount(count + 1)}>
          {revision}:{count}
        </button>
      );
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const render = (revision: number, height = 40, enabled = true) => {
      const pinnedRows: PinnedRowsConfig<Row> = {
        slots: [{ id: 'status', render: () => <span data-status>Summary</span> }],
        scopedFooters: (scope) =>
          enabled && scope.kind === 'grid' ? { height, render: () => <Footer revision={revision} /> } : null,
      };
      const features = { pinnedRows, editing: true, undoRedo: true, selection: { mode: 'row' as const } };
      root.render(
        surface === 'canonical' ? (
          <DataGrid rows={rows} gridConfig={{ ...baseConfig, rowHeight: 24, features }} />
        ) : (
          <DataGrid rows={rows} gridConfig={{ ...baseConfig, rowHeight: 24 }} {...features} />
        ),
      );
    };
    render(0);
    await vi.waitFor(() => expect(host.querySelector('[data-status]')).not.toBeNull());
    const grid = host.querySelector<DataGridElement<Row>>(DataGridElement.activeTag)!;
    await grid.ready();
    Object.defineProperty(grid._virtualization.viewportEl, 'clientHeight', { value: 100, configurable: true });
    await grid.forceLayout();
    await vi.waitFor(() => expect(grid.querySelector('[data-scoped]')?.textContent).toBe('0:0'));
    const pinned = grid.getPluginByName('pinnedRows')!;
    const editing = grid.getPluginByName('editing')!;
    const undo = grid.getPluginByName('undoRedo')!;
    const selection = grid.getPluginByName('selection')!;
    const detaches = [pinned, editing, undo, selection].map((plugin) => vi.spyOn(plugin, 'detach'));
    undo.recordEdit(0, 'quantity', 1, 2);
    selection.selectRows([0]);
    const button = grid.querySelector<HTMLButtonElement>('[data-scoped]')!;
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe('0:1'));
    editing.beginCellEdit(0, 'quantity');
    await vi.waitFor(() => expect(grid.querySelector('.cell.editing input')).not.toBeNull());
    const editor = grid.querySelector('.cell.editing input');
    render(1, 24);
    await vi.waitFor(() => expect(button.textContent).toBe('1:1'));
    expect(grid.querySelector<HTMLElement>('.tbw-scoped-footer')!.style.height).toBe('24px');
    expect(grid.querySelector('[data-scoped]')).toBe(button);
    expect(grid.querySelector('.cell.editing input')).toBe(editor);
    expect(undo.getUndoStack()).toHaveLength(1);
    expect(selection.getSelectedRowIndices()).toEqual([0]);
    expect(unmount).not.toHaveBeenCalled();
    render(2, 24, false);
    await vi.waitFor(() => expect(grid.querySelector('[data-scoped]')).toBeNull());
    expect(grid.querySelector('[data-status]')).not.toBeNull();
    await vi.waitFor(() => expect(unmount).toHaveBeenCalledOnce());
    expect(grid.querySelector('.cell.editing input')).toBe(editor);
    for (const detach of detaches) expect(detach).not.toHaveBeenCalled();
    editing.cancelActiveRowEdit();
    undo.undo();
    await vi.waitFor(() => expect(rows[0].quantity).toBe(1));
  });

  it('refreshes inline callbacks without resetting plugins, editors, history or panel state', async () => {
    const rows: Row[] = [{ id: 'one', quantity: 2, name: 'One' }];
    const unmount = vi.fn();
    function Panel({ revision }: { revision: number }) {
      const [count, setCount] = useState(0);
      useEffect(() => () => unmount(), []);
      return (
        <button data-panel onClick={() => setCount(count + 1)}>
          {revision}:{count}
        </button>
      );
    }
    const app = (revision: number, position: 'top' | 'bottom' = 'bottom', includePanel = true) => {
      const pinnedRows: PinnedRowsConfig = {
        slots: [
          ...(includePanel ? [{ id: 'panel', position, render: () => <Panel revision={revision} /> }] : []),
          {
            id: 'total',
            position,
            aggregators: { quantity: { aggFunc: 'sum', formatter: (value) => `${revision}:${value}` } },
            cells: { name: () => `cell-${revision}` },
          },
        ],
      };
      const features = { pinnedRows, editing: true, undoRedo: true, selection: { mode: 'row' as const } };
      return (
        <div data-revision={revision}>
          {surface === 'canonical' ? (
            <DataGrid rows={rows} gridConfig={{ ...baseConfig, features }} />
          ) : (
            <DataGrid rows={rows} gridConfig={baseConfig} {...features} />
          )}
        </div>
      );
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    root.render(app(0));
    await vi.waitFor(() => expect(host.querySelector('[data-panel]')?.textContent).toBe('0:0'));
    const grid = host.querySelector<DataGridElement<Row>>(DataGridElement.activeTag);
    if (!grid) throw new Error('Missing grid');
    await grid.ready();
    const pinned = grid.getPluginByName('pinnedRows')!;
    const editing = grid.getPluginByName('editing')!;
    const undo = grid.getPluginByName('undoRedo')!;
    const selection = grid.getPluginByName('selection')!;
    const plugins = [pinned, editing, undo, selection];
    const detaches = plugins.map((plugin) => vi.spyOn(plugin, 'detach'));
    undo.recordEdit(0, 'quantity', 1, 2);
    selection.selectRows([0]);
    const button = grid.querySelector<HTMLButtonElement>('[data-panel]')!;
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe('0:1'));
    editing.beginCellEdit(0, 'quantity');
    await vi.waitFor(() => expect(grid.querySelector('.cell.editing input')).not.toBeNull());
    const editor = grid.querySelector('.cell.editing input');
    const retained = () => {
      expect(grid.getPluginByName('pinnedRows')).toBe(pinned);
      expect(grid.getPluginByName('editing')).toBe(editing);
      expect(grid.getPluginByName('undoRedo')).toBe(undo);
      expect(grid.getPluginByName('selection')).toBe(selection);
      for (const detach of detaches) expect(detach).not.toHaveBeenCalled();
      expect(undo.getUndoStack()).toHaveLength(1);
      expect(selection.getSelectedRowIndices()).toEqual([0]);
      expect(grid.querySelector('.cell.editing input')).toBe(editor);
      expect(editing.isCellEditing(0, 0)).toBe(true);
    };
    for (const revision of [1, 2]) {
      root.render(app(revision));
      await vi.waitFor(() => expect(grid.querySelector('[data-panel]')?.textContent).toBe(`${revision}:1`));
      await frame();
      retained();
      expect(grid.querySelector('[data-panel]')).toBe(button);
      expect(grid.querySelector('.tbw-footer')?.textContent).toContain(`${revision}:2`);
      expect(grid.querySelector('.tbw-footer')?.textContent).toContain(`cell-${revision}`);
      expect(unmount).not.toHaveBeenCalled();
    }
    root.render(app(3, 'top'));
    await vi.waitFor(() => expect(grid.querySelector('.tbw-header-pinned')?.textContent).toContain('cell-3'));
    retained();
    expect(grid.querySelector('.tbw-footer')).toBeNull();
    await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(1));
    root.render(app(4, 'top', false));
    await vi.waitFor(() => expect(grid.querySelector('[data-panel]')).toBeNull());
    retained();
    await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(2));
    editing.cancelActiveRowEdit();
    undo.undo();
    await vi.waitFor(() => expect(rows[0].quantity).toBe(1));
    expect(undo.getRedoStack()).toHaveLength(1);
    roots.splice(roots.indexOf(root), 1);
    root.unmount();
    await frame();
    for (const detach of detaches) expect(detach).toHaveBeenCalledTimes(1);
    expect(unmount).toHaveBeenCalledTimes(2);
  });

  it('applies real slot replacement, clearing and defaults without stale callback replay', async () => {
    const rows: Row[] = [
      { id: 'one', quantity: 2, name: 'One' },
      { id: 'two', quantity: 5, name: 'Two' },
    ];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const render = (pinnedRows: PinnedRowsConfig | boolean, rowHeight = 32) => {
      const config = { ...baseConfig, rowHeight };
      root.render(
        surface === 'canonical' ? (
          <DataGrid rows={rows} gridConfig={{ ...config, features: { pinnedRows, editing: true, undoRedo: true } }} />
        ) : (
          <DataGrid rows={rows} gridConfig={config} pinnedRows={pinnedRows} editing undoRedo />
        ),
      );
    };
    render({ slots: [{ id: 'old', render: () => <span>Old panel</span> }] });
    await vi.waitFor(() => expect(host.textContent).toContain('Old panel'));
    const grid = host.querySelector<DataGridElement<Row>>(DataGridElement.activeTag)!;
    const undo = grid.getPluginByName('undoRedo')!;
    const detach = vi.spyOn(undo, 'detach');
    render({
      slots: [
        { id: 'total', position: 'top', label: 'Changed total', aggregators: { quantity: 'max' } },
        {
          id: 'new',
          render: [
            { zone: 'left', render: () => <span>Latest left</span> },
            { zone: 'right', render: () => <span>Latest right</span> },
          ],
        },
      ],
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Latest right'));
    expect(host.textContent).not.toContain('Old panel');
    expect(grid.querySelector('.tbw-header-pinned')?.textContent).toContain('Changed total');
    expect(grid.querySelector('.tbw-header-pinned [data-field="quantity"]')?.textContent).toBe('5');
    expect(detach).not.toHaveBeenCalled();
    render({ slots: [] });
    await vi.waitFor(() => expect(grid.querySelector('.tbw-footer')).toBeNull());
    expect(grid.querySelector('.tbw-header-pinned')).toBeNull();
    expect(detach).not.toHaveBeenCalled();
    render({});
    await vi.waitFor(() => expect(grid.querySelector('.tbw-footer')).not.toBeNull());
    expect(detach).not.toHaveBeenCalled();
    const latest: PinnedRowsConfig = { slots: [{ id: 'last', render: () => <span>Current callback</span> }] };
    render(latest);
    await vi.waitFor(() => expect(host.textContent).toContain('Current callback'));
    render(latest, 48);
    await vi.waitFor(() => expect(grid.effectiveConfig.rowHeight).toBe(48));
    await frame();
    expect(host.textContent).toContain('Current callback');
    expect(host.textContent).not.toContain('Old panel');
    expect(detach).not.toHaveBeenCalled();
    render(false, 48);
    await vi.waitFor(() => expect(grid.getPluginByName('pinnedRows')).toBeUndefined());
    expect(host.textContent).not.toContain('Current callback');
    render(true, 48);
    await vi.waitFor(() => expect(grid.querySelector('.tbw-footer')).not.toBeNull());
  });
});
