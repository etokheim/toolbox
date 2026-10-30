import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../core/grid';
import type { DataGridElement } from '../../core/grid';
import { EditingPlugin } from '../editing/editing-plugin';
import { FilteringPlugin } from '../filtering/filtering-plugin';
import { MultiSortPlugin } from '../multi-sort/multi-sort-plugin';
import { UndoRedoPlugin } from './undo-redo-plugin';

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  price: number;
  nested: { value: string };
}

async function fixture() {
  const history = new UndoRedoPlugin();
  const filter = new FilteringPlugin();
  const sort = new MultiSortPlugin();
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  grid.gridConfig = {
    getRowId: (row) => row.id,
    columns: [
      { field: 'id', filterable: true },
      { field: 'name', editable: true },
      { field: 'price', editable: true, type: 'number' },
      { field: 'nested.value', editable: true },
    ],
    plugins: [new EditingPlugin(), history, filter, sort],
  };
  const rows: Row[] = [
    { id: 'a', name: 'Alpha', price: 10, nested: { value: 'old' } },
    { id: 'b', name: 'Beta', price: 20, nested: { value: 'other' } },
  ];
  grid.rows = rows;
  document.body.append(grid);
  await customElements.whenDefined('tbw-grid');
  await grid.ready();
  return { grid, history, filter, sort, rows };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('UndoRedo identity through the Editing pipeline', () => {
  it('undoes the original owner after a real sort and while filtered out', async () => {
    const { grid, history, filter, sort, rows } = await fixture();
    const [alpha, beta] = rows;
    grid.updateRow('a', { name: 'Changed' }, 'user');
    sort.setSortModel([{ field: 'price', direction: 'desc' }]);
    await vi.waitFor(() => expect(grid.rows.map((row) => row.id)).toEqual(['b', 'a']));

    history.undo();
    expect(alpha.name).toBe('Alpha');
    expect(beta.name).toBe('Beta');
    await vi.waitFor(() => expect(grid._focusRow).toBe(1));
    history.redo();
    expect(alpha.name).toBe('Changed');

    filter.setFilter('id', { type: 'text', operator: 'equals', value: 'b' });
    await vi.waitFor(() => expect(grid.rows.map((row) => row.id)).toEqual(['b']));
    history.undo();
    expect(alpha.name).toBe('Alpha');
    expect(beta.name).toBe('Beta');
  });

  it('records a hidden source edit with index -1 and replays its dotted field', async () => {
    const { grid, history, filter, rows } = await fixture();
    filter.setFilter('id', { type: 'text', operator: 'equals', value: 'b' });
    await vi.waitFor(() => expect(grid.rows.map((row) => row.id)).toEqual(['b']));
    const changes: Array<{ row: Row; rowIndex: number; source: string }> = [];
    grid.addEventListener('cell-change', (event) => {
      changes.push((event as CustomEvent<{ row: Row; rowIndex: number; source: string }>).detail);
    });
    grid.updateRow('a', { 'nested.value': 'new' }, 'user');
    expect(history.getUndoStack()[0]).toMatchObject({ rowIndex: -1, field: 'nested.value' });
    history.undo();
    expect(rows[0].nested.value).toBe('old');
    expect(rows[1].nested.value).toBe('other');
    expect(changes.at(-1)).toMatchObject({ row: rows[0], rowIndex: -1, source: 'history' });
    expect(history.getUndoStack()).toHaveLength(0);
    history.redo();
    expect(rows[0].nested.value).toBe('new');
    expect(history.getUndoStack()).toHaveLength(1);
  });

  it('replays against a same-ID immutable replacement without mutating the old object', async () => {
    const { grid, history, rows } = await fixture();
    grid.updateRow('a', { name: 'Changed' }, 'user');
    const replacement = { ...rows[0] };
    grid.rows = [rows[1], replacement];
    await vi.waitFor(() => expect(grid.rows[1]).toBe(replacement));
    history.undo();
    expect(replacement.name).toBe('Alpha');
    expect(rows[0].name).toBe('Changed');
    expect(rows[1].name).toBe('Beta');
    await vi.waitFor(() => expect(grid._focusRow).toBe(1));
  });

  it('warns and advances history rather than writing through a queued source replacement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { grid, history, rows } = await fixture();
      grid.updateRow('a', { name: 'Changed' }, 'user');
      grid.rows = [rows[1]];
      history.undo();
      expect(rows[0].name).toBe('Changed');
      expect(rows[1].name).toBe('Beta');
      expect(history.getUndoStack()).toHaveLength(0);
      expect(history.getRedoStack()).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not discard history for an unrelated queued configuration update', async () => {
    const { grid, history, rows } = await fixture();
    grid.updateRow('a', { name: 'Changed' }, 'user');
    grid.gridConfig = { ...grid.gridConfig };
    history.undo();
    expect(rows[0].name).toBe('Alpha');
    expect(rows[1].name).toBe('Beta');
    expect(history.getRedoStack()).toHaveLength(1);
  });

  it('invalidates core-owned derived values for an ID-less live owner', async () => {
    const grid = document.createElement('tbw-grid') as DataGridElement<{ name: string; derived?: string }>;
    const history = new UndoRedoPlugin();
    grid.gridConfig = {
      columns: [
        { field: 'name', editable: true },
        { field: 'derived', valueAccessor: ({ row }) => row.name.toUpperCase() },
      ],
      plugins: [new EditingPlugin(), history],
    };
    const owner = { name: 'CHANGED' };
    grid.rows = [owner];
    document.body.append(grid);
    await grid.ready();
    await vi.waitFor(() =>
      expect(grid.querySelector('.cell[data-row="0"][data-field="derived"]')?.textContent).toBe('CHANGED'),
    );
    history.recordEdit(0, 'name', 'original', 'CHANGED');
    history.undo();
    await vi.waitFor(() =>
      expect(grid.querySelector('.cell[data-row="0"][data-field="derived"]')?.textContent).toBe('ORIGINAL'),
    );
  });
});
