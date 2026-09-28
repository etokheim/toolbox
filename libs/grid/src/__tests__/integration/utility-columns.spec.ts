import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../lib/core/grid';
import type { BaseGridPlugin } from '../../lib/core/plugin/base-plugin';
import { getUtilityColumnOwner } from '../../lib/core/plugin/utility-column';
import type { ColumnConfig } from '../../lib/core/types';
import '../../lib/features/master-detail';
import '../../lib/features/row-drag-drop';
import '../../lib/features/selection';
import { MasterDetailPlugin } from '../../lib/plugins/master-detail';
import { PinnedColumnsPlugin } from '../../lib/plugins/pinned-columns';
import { ROW_DRAG_HANDLE_FIELD, RowDragDropPlugin } from '../../lib/plugins/row-drag-drop';
import { SelectionPlugin } from '../../lib/plugins/selection';
import { TreePlugin } from '../../lib/plugins/tree';

const checkbox = '__tbw_checkbox';
const expander = '__tbw_expander';
const drag = ROW_DRAG_HANDLE_FIELD;
const sourceColumns: ColumnConfig[] = [{ field: 'id' }, { field: 'name' }, { field: 'age', hidden: true }];

async function waitUpgrade(grid: DataGridElement) {
  await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
  await grid.ready();
}

async function createGrid(
  plugins: BaseGridPlugin[],
  columns = sourceColumns.map((column) => ({ ...column })),
  rows: Record<string, unknown>[] = [{ id: 'a', name: 'Alice', age: 30 }],
) {
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  grid.gridConfig = { columns, plugins };
  grid.rows = rows;
  document.body.appendChild(grid);
  await waitUpgrade(grid);
  return grid;
}

const factories = {
  selection: () => new SelectionPlugin({ mode: 'row', checkbox: true }),
  detail: () => new MasterDetailPlugin({ showExpandColumn: true }),
  drag: () => new RowDragDropPlugin(),
};

describe('managed utility-column lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it.each([
    [
      ['drag', 'selection', 'detail'],
      [expander, checkbox, drag],
    ],
    [
      ['drag', 'detail', 'selection'],
      [expander, checkbox, drag],
    ],
    [
      ['selection', 'drag', 'detail'],
      [expander, drag, checkbox],
    ],
    [
      ['selection', 'detail', 'drag'],
      [drag, expander, checkbox],
    ],
    [
      ['detail', 'drag', 'selection'],
      [drag, expander, checkbox],
    ],
    [
      ['detail', 'selection', 'drag'],
      [drag, expander, checkbox],
    ],
  ] as const)('preserves legacy order for %j, including hidden data columns', async (order, expected) => {
    const grid = await createGrid(order.map((name) => factories[name]()));
    const fields = [...expected, 'id', 'name', 'age'];
    expect(grid._columns.map((column) => column.field)).toEqual(fields);
    for (let pass = 0; pass < 3; pass++) {
      grid._schedulerMergeConfig();
      grid._schedulerProcessColumns();
      expect(grid._columns.map((column) => column.field)).toEqual(fields);
    }
    expect(grid._visibleColumns.map((column) => column.field)).toEqual(fields.filter((field) => field !== 'age'));
  });

  it('keeps a right-positioned drag handle trailing after repeated processing', async () => {
    const grid = await createGrid([
      factories.detail(),
      factories.selection(),
      new RowDragDropPlugin({ dragHandlePosition: 'right', dragHandleWidth: 60 }),
    ]);
    grid._schedulerMergeConfig();
    grid._schedulerProcessColumns();
    expect(grid._columns.map((column) => column.field)).toEqual([expander, checkbox, 'id', 'name', 'age', drag]);
    expect(grid._columns.at(-1)?.width).toBe(60);
  });

  it('preserves utility width, visibility and saved order without serializing ownership', async () => {
    const grid = await createGrid([factories.detail(), factories.selection(), factories.drag()]);
    const state = grid.getColumnState();
    const order = ['name', checkbox, drag, expander, 'id', 'age'];
    state.columns = state.columns.map((column) => ({
      ...column,
      order: order.indexOf(column.field),
      ...(column.field === checkbox ? { width: 49, visible: false } : {}),
    }));
    grid.applyColumnState(state);
    await vi.waitFor(() => expect(grid._columns.map((column) => column.field)).toEqual(order));
    grid._schedulerMergeConfig();
    grid._schedulerProcessColumns();
    expect(grid._columns.filter((column) => column.field === checkbox)).toHaveLength(1);
    expect(grid._columns.find((column) => column.field === checkbox)).toMatchObject({ width: 49, hidden: true });
    expect(grid._visibleColumns.some((column) => column.field === checkbox)).toBe(false);
    expect(grid.getColumnState().columns.map((column) => column.field)).toEqual(order);
    expect(JSON.parse(JSON.stringify(grid.getColumnState()))).toEqual(grid.getColumnState());
    expect(getUtilityColumnOwner(grid._columns.find((column) => column.field === checkbox)!)).toBeDefined();
  });

  it('removes detached owners from reseeded columns, including hidden utilities, without removing consumer utilities', async () => {
    const grid = await createGrid(
      [factories.detail(), factories.selection(), factories.drag()],
      [...sourceColumns, { field: 'actions', utility: true }],
    );
    const columns = grid._columns.map((column) => ({
      ...column,
      ...(column.field === checkbox ? { hidden: true } : {}),
    }));
    grid.gridConfig = { columns, plugins: [] };
    await vi.waitFor(() =>
      expect(grid._columns.map((column) => column.field)).toEqual(['id', 'name', 'age', 'actions']),
    );
    expect(grid._columns.find((column) => column.field === 'actions')?.utility).toBe(true);
    grid.gridConfig = { columns, plugins: [factories.detail(), factories.selection(), factories.drag()] };
    await vi.waitFor(() =>
      expect(grid._columns.map((column) => column.field)).toEqual([
        drag,
        expander,
        checkbox,
        'id',
        'name',
        'age',
        'actions',
      ]),
    );
    expect(grid._columns.filter((column) => column.utility)).toHaveLength(4);
  });

  it('retains a consumer-owned reserved field rather than adopting or duplicating it', async () => {
    const custom: ColumnConfig = { field: drag, width: 71, utility: true };
    const grid = await createGrid([factories.drag()], [{ field: 'id' }, custom]);
    expect(grid._columns.map((column) => column.field)).toEqual(['id', drag]);
    expect(getUtilityColumnOwner(grid._columns[1])).toBeUndefined();
    grid.gridConfig = { columns: grid._columns.slice(), plugins: [] };
    await vi.waitFor(() => expect(grid.getPluginByName('rowDragDrop')).toBeUndefined());
    expect(grid._columns.map((column) => column.field)).toEqual(['id', drag]);
    expect(grid._columns[1].width).toBe(71);
  });

  it.each([false, true])(
    'removes generated columns (hidden: %s) when retained features disable their controls',
    async (hidden) => {
      const grid = await createGrid([]);
      grid.gridConfig = {
        columns: sourceColumns,
        features: {
          selection: { mode: 'row', checkbox: true },
          masterDetail: { showExpandColumn: true },
          rowDragDrop: { showDragHandle: true },
        },
      };
      await vi.waitFor(() => expect(grid._columns.filter((column) => column.utility)).toHaveLength(3));
      const columns = grid._columns.map((column) => ({ ...column, hidden: column.utility ? hidden : column.hidden }));
      const selection = grid.getPluginByName('selection');
      grid.gridConfig = {
        columns,
        features: {
          selection: { mode: 'row', checkbox: false },
          masterDetail: { showExpandColumn: false },
          rowDragDrop: { showDragHandle: false },
        },
      };
      await vi.waitFor(() => expect(grid._columns.map((column) => column.field)).toEqual(['id', 'name', 'age']));
      expect(grid.getPluginByName('selection')).toBe(selection);
    },
  );

  it('leaves tree disclosure in its configured data column and preserves pinning metadata', async () => {
    const grid = await createGrid(
      [new PinnedColumnsPlugin(), new TreePlugin({ treeColumn: 'name' }), factories.selection()],
      [{ field: 'name', pinned: 'left' }, { field: 'id' }],
      [{ id: 'a', name: 'Alice', children: [{ id: 'b', name: 'Bob' }] }],
    );
    expect(grid._columns.map((column) => column.field)).toEqual([checkbox, 'name', 'id']);
    expect(grid._columns.find((column) => column.field === 'name')).toMatchObject({ pinned: 'left' });
    expect(grid.querySelector('.tree-cell-wrapper .tree-content')).not.toBeNull();
    expect(grid.querySelector('.tbw-select-row-checkbox')?.getAttribute('aria-label')).toBeTruthy();
    expect(grid.querySelector('.tbw-checkbox-header')).not.toBeNull();
  });
});
