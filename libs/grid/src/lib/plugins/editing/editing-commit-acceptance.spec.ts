import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitUpgrade } from '../../../../test/helpers';
import '../../core/grid';
import type { DataGridElement } from '../../core/grid';
import { BaseGridPlugin } from '../../core/plugin/base-plugin';
import type { PluginQuery } from '../../core/plugin/types';
import type { CellChangeDetail } from '../../core/types';
import { CellEntryPlugin } from '../cell-entry';
import { clearSelectedCells } from '../cell-entry/clear-selection';
import { SelectionPlugin } from '../selection';
import { UndoRedoPlugin } from '../undo-redo';
import { EditingPlugin } from './editing-plugin';

type Row = { id: string; value: string; other?: string };

class LaterVeto extends BaseGridPlugin {
  readonly name = 'laterVeto';
  static override readonly manifest = { queries: [{ type: 'commitCellValue' }] };
  respond: () => unknown = () => false;

  override handleQuery(query: PluginQuery): unknown {
    if (query.type === 'commitCellValue') return this.respond();
    return undefined;
  }
}

async function setup(vetoes = true, vetoFirst = false) {
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  const editing = new EditingPlugin<Row>({ editOn: 'manual', dirtyTracking: true });
  const undo = new UndoRedoPlugin();
  const veto = new LaterVeto();
  if (!vetoes) veto.respond = () => undefined;
  grid.gridConfig = {
    getRowId: (row) => row.id,
    columns: [
      { field: 'value', editable: true, type: 'string' },
      { field: 'other', editable: true, type: 'string' },
    ],
    plugins: [
      ...(vetoFirst ? [veto] : []),
      new SelectionPlugin({ mode: 'range' }),
      editing,
      undo,
      new CellEntryPlugin({ clearOnDelete: true }),
      ...(vetoFirst ? [] : [veto]),
    ],
  };
  const row: Row = { id: 'a', value: 'before', other: 'old' };
  grid.rows = [row];
  document.body.append(grid);
  await waitUpgrade(grid);
  return { grid, row, editing, undo, veto };
}

function clear(grid: DataGridElement<Row>, undo: UndoRedoPlugin) {
  return clearSelectedCells(grid, [{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }], undo);
}

function track(grid: DataGridElement<Row>) {
  const changes: CellChangeDetail<Row>[] = [];
  const proposals = new Map<object, string>();
  grid.addEventListener('cell-change', (event) => changes.push(event.detail));
  grid.addEventListener('cell-commit', (event) => {
    expect(event.detail.operationId).toBeDefined();
    proposals.set(event.detail.operationId!, event.detail.field);
  });
  return { changes, proposals };
}

function commitEditor(grid: DataGridElement<Row>, editing: EditingPlugin<Row>, value: string) {
  editing.beginBulkEdit(0);
  const input = grid.querySelector<HTMLInputElement>('.cell[data-col="0"] input')!;
  expect(input).not.toBeNull();
  input.value = value;
  input.dispatchEvent(new Event('blur'));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('final Editing acceptance', () => {
  it('rechecks owner/value after the deferred clear editability callback', async () => {
    const { grid, row, undo, veto } = await setup(false);
    let applying = false;
    grid.columns = [
      {
        field: 'value',
        type: 'string',
        editable: () => {
          if (applying) row.value = 'replacement';
          return true;
        },
      },
    ];
    await waitUpgrade(grid);
    veto.respond = () => {
      applying = true;
      return undefined;
    };
    const changes = vi.fn();
    grid.addEventListener('cell-change', changes);
    expect(clear(grid, undo).cells[0].status).toBe('rejected');
    expect(row.value).toBe('replacement');
    expect(undo.getUndoStack()).toEqual([]);
    expect(changes).not.toHaveBeenCalled();
  });

  it.each(['updateRow', 'selected clear'])('a later query veto prevents built-in writes via %s', async (path) => {
    const { grid, row, editing, undo } = await setup();
    const changes = vi.fn();
    const dirty = vi.fn();
    const history = vi.fn();
    grid.addEventListener('cell-change', changes);
    grid.addEventListener('dirty-change', dirty);
    grid.addEventListener('history-change', history);
    if (path === 'updateRow') grid.updateRow('a', { value: 'after' });
    else {
      const result = clearSelectedCells(grid, [{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }], undo);
      expect(result.cells[0].status).toBe('rejected');
    }
    expect(row.value).toBe('before');
    expect(editing.isDirty('a')).toBe(false);
    expect(editing.changedRows).toEqual([]);
    expect(undo.getUndoStack()).toEqual([]);
    expect(changes).not.toHaveBeenCalled();
    expect(dirty).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it('emits one final correlated outcome for a direct interactive edit', async () => {
    const { grid, row, editing, undo } = await setup(false);
    const { changes, proposals } = track(grid);
    commitEditor(grid, editing, 'after');
    expect(row.value).toBe('after');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ source: 'user', oldValue: 'before', newValue: 'after', row });
    expect(proposals.get(changes[0].operationId!)).toBe('value');
    expect(undo.getUndoStack()).toHaveLength(1);
  });

  it('honors a veto participant before Editing without built-in side effects', async () => {
    const { grid, row, editing, undo } = await setup(true, true);
    const { changes } = track(grid);
    grid.updateRow('a', { value: 'after' });
    expect(row.value).toBe('before');
    expect(editing.isDirty('a')).toBe(false);
    expect(undo.canUndo()).toBe(false);
    expect(changes).toEqual([]);
  });

  it('does not promote a proposal canceled by a later DOM listener', async () => {
    const { grid, row, editing, undo } = await setup(false);
    const { changes, proposals } = track(grid);
    grid.addEventListener('cell-commit', (event) => event.preventDefault());
    commitEditor(grid, editing, 'after');
    expect(proposals.size).toBe(1);
    expect(changes).toEqual([]);
    expect(row.value).toBe('before');
    expect(undo.canUndo()).toBe(false);
  });

  it('correlates nested cascades independently and never duplicates final notifications', async () => {
    const { grid, row, undo } = await setup(false);
    const { changes, proposals } = track(grid);
    grid.addEventListener('cell-commit', ({ detail }) => {
      if (detail.field === 'value') detail.updateRow({ other: 'derived' });
    });
    grid.updateRow('a', { value: 'after' });
    expect(row).toMatchObject({ value: 'after', other: 'derived' });
    expect(changes.map((change) => change.field)).toEqual(['other', 'value']);
    expect(new Set(changes.map((change) => change.operationId)).size).toBe(2);
    for (const change of changes) expect(proposals.get(change.operationId!)).toBe(change.field);
    expect(undo.getUndoStack()).toHaveLength(2);
  });

  it('brackets accepted clear notifications with one native transaction', async () => {
    const { grid, undo } = await setup(false);
    const order: string[] = [];
    const { changes, proposals } = track(grid);
    grid.addEventListener('cell-change', () => {
      order.push('accepted');
      expect(undo.getUndoStack()).toHaveLength(0);
    });
    grid.addEventListener('history-change', () => order.push('history'));
    expect(clear(grid, undo).cells[0].status).toBe('cleared');
    expect(order).toEqual(['accepted', 'history']);
    expect(changes).toHaveLength(1);
    expect(proposals.has(changes[0].operationId!)).toBe(true);
  });

  it.each(['history', 'sync'] as const)('defers %s writes and dirty updates until query acceptance', async (source) => {
    const { grid, row, editing, veto } = await setup(false);
    grid.updateRow('a', { value: 'changed' });
    expect(editing.isDirty('a')).toBe(true);
    const { changes, proposals } = track(grid);
    veto.respond = () => false;
    grid.updateRow('a', { value: 'before' }, source);
    expect(row.value).toBe('changed');
    expect(editing.isDirty('a')).toBe(true);
    expect(changes).toEqual([]);
    expect(proposals.size).toBe(0);
  });

  it('keeps a later participant exception from applying the staged clear and releases grouping', async () => {
    const { grid, row, undo, editing, veto } = await setup(false);
    const { changes } = track(grid);
    veto.respond = () => {
      throw new Error('participant failed');
    };
    expect(() => clear(grid, undo)).toThrow('participant failed');
    expect(row.value).toBe('before');
    expect(editing.isDirty('a')).toBe(false);
    expect(undo.canUndo()).toBe(false);
    expect(changes).toEqual([]);
    veto.respond = () => undefined;
    grid.updateRow('a', { value: 'after' });
    expect(undo.getUndoStack()).toHaveLength(1);
  });

  it.each(['value', 'model'])('does not overwrite a %s changed by a later participant', async (kind) => {
    const { grid, row, undo, veto } = await setup(false);
    const { changes } = track(grid);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    veto.respond = () => {
      if (kind === 'value') row.value = 'external';
      else grid.rows = [{ id: 'a', value: 'replacement' }];
      return undefined;
    };
    grid.updateRow('a', { value: 'after' });
    expect(row.value).toBe(kind === 'value' ? 'external' : 'before');
    expect(changes).toEqual([]);
    expect(undo.canUndo()).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('reports the stored normalized value, not the requested value', async () => {
    const { grid, row, undo } = await setup(false);
    let value = 'before';
    Object.defineProperty(row, 'value', {
      enumerable: true,
      get: () => value,
      set: (next: string) => {
        value = next.trim();
      },
    });
    const { changes } = track(grid);
    grid.updateRow('a', { value: ' after ' });
    expect(changes).toHaveLength(1);
    expect(changes[0].newValue).toBe('after');
    expect(undo.getUndoStack()[0]).toMatchObject({ newValue: 'after' });
    grid.updateRow('a', { value: ' after ' });
    expect(changes).toHaveLength(1);
    expect(undo.getUndoStack()).toHaveLength(1);
  });

  it('rejects same-cell recursive proposals but accepts the outer write once', async () => {
    const { grid, undo } = await setup(false);
    const { changes, proposals } = track(grid);
    grid.addEventListener('cell-commit', ({ detail }) => detail.updateRow({ value: 'recursive' }));
    grid.updateRow('a', { value: 'after' });
    expect(changes).toHaveLength(1);
    expect(changes[0].newValue).toBe('after');
    expect(proposals.size).toBe(1);
    expect(undo.getUndoStack()).toHaveLength(1);
  });

  it('preserves an independently accepted nested update rather than overwriting it', async () => {
    const { grid, row, undo, veto } = await setup(false);
    const { changes, proposals } = track(grid);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let nested = false;
    veto.respond = () => {
      if (!nested) {
        nested = true;
        grid.updateRow('a', { value: 'nested' });
      }
      return undefined;
    };
    grid.updateRow('a', { value: 'outer' });
    expect(row.value).toBe('nested');
    expect(proposals.size).toBe(2);
    expect(changes).toHaveLength(1);
    expect(changes[0].newValue).toBe('nested');
    expect(proposals.has(changes[0].operationId!)).toBe(true);
    expect(undo.getUndoStack()).toHaveLength(1);
  });
});
