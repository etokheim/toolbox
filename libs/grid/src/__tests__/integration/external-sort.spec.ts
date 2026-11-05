/**
 * Integration tests: controlled (external) sorting — `gridConfig.sortMode: 'external'`.
 *
 * The grid keeps its sort cycle, indicators, `sortModel` and `sort-change` events
 * but never reorders rows: the caller-provided `rows` order is rendered as-is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../index';
import '../../lib/features/editing';
import '../../lib/features/multi-sort';
import '../../lib/features/selection';
import '../../lib/features/tree';
import '../../lib/features/undo-redo';

interface Row {
  id: number;
  name: string;
  children?: Row[];
}

const data = (): Row[] => [
  { id: 2, name: 'b' },
  { id: 3, name: 'c' },
  { id: 1, name: 'a' },
];

const ids = (rows: readonly Row[]) => rows.map((r) => r.id);

async function createGrid(config: Record<string, unknown> = {}, rows: Row[] = data()) {
  const grid = document.createElement('tbw-grid') as any;
  grid.gridConfig = {
    columns: [
      { field: 'id', header: 'Id', type: 'number', sortable: true },
      { field: 'name', header: 'Name', sortable: true },
    ],
    sortMode: 'external',
    ...config,
  };
  grid.rows = rows;
  document.body.appendChild(grid);
  await grid.ready();
  return grid;
}

const headerCell = (grid: HTMLElement, field: string) =>
  grid.querySelector(`.header-row .cell[data-field="${field}"]`) as HTMLElement;

describe('controlled sorting (sortMode: external)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('header clicks cycle sort state and emit sort-change without reordering', async () => {
    const grid = await createGrid();
    const events: unknown[] = [];
    grid.on('sort-change', (detail: unknown) => events.push(detail));

    headerCell(grid, 'id').click();
    expect(grid.sortModel).toEqual({ field: 'id', direction: 'asc' });
    expect(ids(grid.rows)).toEqual([2, 3, 1]);
    expect(headerCell(grid, 'id').getAttribute('aria-sort')).toBe('ascending');

    headerCell(grid, 'id').click();
    expect(grid.sortModel).toEqual({ field: 'id', direction: 'desc' });
    expect(ids(grid.rows)).toEqual([2, 3, 1]);

    headerCell(grid, 'id').click();
    expect(grid.sortModel).toBeNull();
    expect(ids(grid.rows)).toEqual([2, 3, 1]);
    expect(events).toEqual([
      { field: 'id', direction: 1 },
      { field: 'id', direction: -1 },
      { field: 'id', direction: 0 },
    ]);
  });

  it('renders the caller-provided order when rows are replaced under an active sort', async () => {
    const grid = await createGrid();
    grid.sort('id', 'desc');
    grid.rows = [
      { id: 1, name: 'a' },
      { id: 3, name: 'c' },
      { id: 2, name: 'b' },
    ];
    await vi.waitFor(() => expect(ids(grid.rows)).toEqual([1, 3, 2]));
    expect(grid.sortModel).toEqual({ field: 'id', direction: 'desc' });
  });

  it('grid.sort() accepts fields without a (visible) column and clearing keeps row order', async () => {
    const grid = await createGrid({
      columns: [
        { field: 'id', header: 'Id', sortable: true },
        { field: 'name', header: 'Name', hidden: true },
      ],
    });
    const events: unknown[] = [];
    grid.on('sort-change', (detail: unknown) => events.push(detail));

    grid.sort('name', 'desc');
    expect(grid.sortModel).toEqual({ field: 'name', direction: 'desc' });
    grid.sort('rank', 'asc');
    expect(grid.sortModel).toEqual({ field: 'rank', direction: 'asc' });
    expect(ids(grid.rows)).toEqual([2, 3, 1]);

    grid.sort(null);
    expect(grid.sortModel).toBeNull();
    expect(ids(grid.rows)).toEqual([2, 3, 1]);
    expect(events).toEqual([
      { field: 'name', direction: -1 },
      { field: 'rank', direction: 1 },
      { field: 'rank', direction: 0 },
    ]);
  });

  it('applies initialSort for a field with no column without reordering', async () => {
    const grid = await createGrid({ initialSort: { field: 'rank', direction: 'desc' } });
    expect(grid.sortModel).toEqual({ field: 'rank', direction: 'desc' });
    expect(ids(grid.rows)).toEqual([2, 3, 1]);
  });

  it('local mode (default) still sorts', async () => {
    const grid = await createGrid({ sortMode: undefined });
    headerCell(grid, 'id').click();
    expect(ids(grid.rows)).toEqual([1, 2, 3]);
    headerCell(grid, 'id').click();
    headerCell(grid, 'id').click();
    expect(ids(grid.rows)).toEqual([2, 3, 1]);
  });

  it('MultiSort keeps its model and events but does not reorder', async () => {
    const grid = await createGrid({ features: { multiSort: true } });
    const models: unknown[] = [];
    grid.on('sort-change', (detail: any) => models.push(detail.sortModel));
    const plugin = grid.getPluginByName('multiSort');

    plugin.setSortModel([
      { field: 'name', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ]);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(plugin.getSortModel()).toEqual([
      { field: 'name', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ]);
    expect(ids(grid.rows)).toEqual([2, 3, 1]);

    headerCell(grid, 'id').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(models.length).toBeGreaterThan(0);
    expect(ids(grid.rows)).toEqual([2, 3, 1]);
  });

  it('Tree keeps child order under an external sort', async () => {
    const grid = await createGrid({ features: { tree: { defaultExpanded: true } } }, [
      {
        id: 10,
        name: 'p',
        children: [
          { id: 12, name: 'y' },
          { id: 11, name: 'x' },
        ],
      },
    ]);
    grid.sort('id', 'asc');
    await vi.waitFor(() => expect(ids(grid.rows)).toEqual([10, 12, 11]));
  });

  it('row selection survives sort-change and follows rows by identity on reorder', async () => {
    const grid = await createGrid({ features: { selection: 'row' }, getRowId: (r: Row) => String(r.id) });
    const selection = grid.getPluginByName('selection');
    selection.selectRows([0]); // id 2
    expect(selection.getSelectedRowIndices()).toEqual([0]);

    headerCell(grid, 'id').click();
    expect(selection.getSelectedRowIndices()).toEqual([0]);

    // Caller re-sorts (fresh objects — identity via getRowId).
    grid.rows = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ];
    await vi.waitFor(() => expect(selection.getSelectedRowIndices()).toEqual([1]));
  });

  it('cell selection follows its row by object identity on reorder', async () => {
    const rows = data();
    const grid = await createGrid({ features: { selection: 'cell' } }, rows);
    const selection = grid.getPluginByName('selection');
    selection.onCellClick({
      rowIndex: 2, // id 1
      colIndex: 1,
      field: 'name',
      value: 'a',
      row: rows[2],
      cellEl: document.createElement('div'),
      originalEvent: new MouseEvent('click'),
    });
    const cell = () => selection.getSelection().ranges.map((r: any) => r.from);
    expect(cell()).toEqual([{ row: 2, col: 1 }]);

    grid.sort('id', 'asc');
    grid.rows = [rows[2], rows[0], rows[1]];
    await vi.waitFor(() => expect(ids(grid.rows)).toEqual([1, 2, 3]));
    await vi.waitFor(() => expect(cell()).toEqual([{ row: 0, col: 1 }]));
  });

  it('range selection clears on sort-change', async () => {
    const grid = await createGrid({ features: { selection: 'range' } });
    const selection = grid.getPluginByName('selection');
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 1, col: 1 } }]);
    expect(selection.getSelectedCells().length).toBe(4);

    headerCell(grid, 'id').click();
    expect(selection.getSelectedCells()).toEqual([]);
  });

  it('undo history replays onto the right row after a controlled re-order', async () => {
    const grid = await createGrid({
      columns: [
        { field: 'id', header: 'Id', sortable: true },
        { field: 'name', header: 'Name', sortable: true, editable: true },
      ],
      features: { editing: true, undoRedo: true },
      getRowId: (r: Row) => String(r.id),
    });
    const undo = grid.getPluginByName('undoRedo');
    grid.updateRow('2', { name: 'B' });
    undo.recordEdit(0, 'name', 'b', 'B', '2');

    grid.sort('id', 'asc');
    grid.rows = [
      { id: 1, name: 'a' },
      { id: 2, name: 'B' },
      { id: 3, name: 'c' },
    ];
    await vi.waitFor(() => expect(ids(grid.rows)).toEqual([1, 2, 3]));

    undo.undo();
    await vi.waitFor(() => expect(grid.rows.map((r: Row) => r.name)).toEqual(['a', 'b', 'c']));
  });
});
