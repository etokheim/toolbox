import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { waitUpgrade } from '../../../../test/helpers';
import '../../core/grid';
import type { DataGridElement } from '../../core/grid';
import { EditingPlugin } from '../editing/editing-plugin';
import { UndoRedoPlugin, type UndoRedoSnapshot } from './index';

interface Row {
  id?: string;
  value: unknown;
}

const resolver = (row: Row) => row.id ?? '';

async function fixture(
  rows: Row[] = [{ id: 'a', value: 20 }],
  options: { maxHistorySize?: number; getRowId?: typeof resolver; noId?: boolean; history?: UndoRedoPlugin } = {},
) {
  const history = options.history ?? new UndoRedoPlugin({ maxHistorySize: options.maxHistorySize ?? 100 });
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  grid.gridConfig = {
    getRowId: options.noId ? undefined : (options.getRowId ?? resolver),
    columns: [{ field: 'value', editable: true }],
    plugins: [new EditingPlugin(), history],
  };
  grid.rows = rows;
  document.body.append(grid);
  await waitUpgrade(grid);
  return { grid, history, rows };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('opaque UndoRedo history snapshots', () => {
  it('transfers real edits to a fresh grid and uses accepted history cell-change events', async () => {
    const source = await fixture([{ id: 'a', value: 10 }]);
    source.grid.updateRow('a', { value: 20 }, 'user');
    const snapshot = source.history.captureHistory();
    expectTypeOf(snapshot).toEqualTypeOf<UndoRedoSnapshot>();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.keys(snapshot)).toEqual([]);
    source.grid.remove();

    const destination = await fixture([{ id: 'a', value: 20 }]);
    const changes = vi.fn();
    const historyChanges = vi.fn();
    const undoEvents = vi.fn();
    destination.grid.addEventListener('cell-change', changes);
    destination.grid.addEventListener('history-change', historyChanges);
    destination.grid.addEventListener('undo', undoEvents);
    const render = vi.spyOn(destination.grid, 'requestRenderWithFocus');
    destination.history.restoreHistory(snapshot);
    expect(changes).not.toHaveBeenCalled();
    expect(undoEvents).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(historyChanges).toHaveBeenCalledTimes(1);
    destination.history.undo();
    expect(destination.rows[0].value).toBe(10);
    expect(source.rows[0].value).toBe(20);
    expect(changes).toHaveBeenCalledTimes(1);
    expect((changes.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ source: 'history', newValue: 10 });
    destination.history.redo();
    expect(destination.rows[0].value).toBe(20);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(destination.history.getUndoStack()).toHaveLength(1);
    expect(destination.history.getRedoStack()).toHaveLength(0);
  });

  it.each(['same host', 'new host'])('restores explicitly after detach on the %s', async (host) => {
    const source = await fixture();
    source.history.recordEdit(0, 'value', 10, 20);
    const snapshot = source.history.captureHistory();
    source.grid.remove();
    expect(source.history.canUndo()).toBe(false);
    expect(() => source.history.restoreHistory(snapshot)).toThrow('TBW003');
    expect(() => source.history.captureHistory()).toThrow('TBW003');
    const grid = host === 'same host' ? source.grid : (await fixture(source.rows, { history: source.history })).grid;
    if (host === 'same host') {
      document.body.append(grid);
      await waitUpgrade(grid);
    }
    const history = grid.getPluginByName('undoRedo')!;
    expect(history.canUndo()).toBe(false);
    history.restoreHistory(snapshot);
    history.undo();
    expect(source.rows[0].value).toBe(10);
  });

  it('preserves both partitions and enforces combined capacity without trimming compounds', async () => {
    const source = await fixture(undefined, { maxHistorySize: 2 });
    source.history.recordEdit(0, 'value', 0, 10);
    source.history.beginTransaction();
    source.history.recordEdit(0, 'value', 10, 15);
    source.history.recordEdit(0, 'value', 15, 20);
    source.history.endTransaction();
    source.history.undo();
    const snapshot = source.history.captureHistory();
    expect(source.history.getUndoStack()).toHaveLength(1);
    expect(source.history.getRedoStack()).toHaveLength(1);
    const small = await fixture(undefined, { maxHistorySize: 1 });
    small.history.recordEdit(0, 'value', 19, 20);
    const before = small.history.getUndoStack();
    const events = vi.fn();
    small.grid.addEventListener('history-change', events);
    expect(() => small.history.restoreHistory(snapshot)).toThrow('maxHistorySize');
    expect(small.history.getUndoStack()).toEqual(before);
    expect(events).not.toHaveBeenCalled();
    const equal = await fixture([{ id: 'a', value: 10 }], { maxHistorySize: 2 });
    equal.history.restoreHistory(snapshot);
    equal.history.redo();
    expect(equal.rows[0].value).toBe(20);
    equal.history.undo();
    expect(equal.rows[0].value).toBe(10);
    equal.history.undo();
    expect(equal.rows[0].value).toBe(0);
    equal.history.redo();
    equal.history.recordEdit(0, 'value', 10, 30);
    expect(equal.history.getUndoStack()).toHaveLength(2);
    expect(equal.history.canRedo()).toBe(false);
    equal.history.recordEdit(0, 'value', 30, 40);
    expect(equal.history.getUndoStack()).toHaveLength(2);
  });

  it('copies action containers at capture and each restore, but retains cell value references', async () => {
    const source = await fixture();
    const oldValue = { text: 'old' };
    const newValue = { text: 'new' };
    source.history.beginTransaction();
    source.history.recordEdit(0, 'value', oldValue, newValue);
    source.history.recordEdit(0, 'value', newValue, 20);
    source.history.endTransaction();
    const original = source.history.getUndoStack()[0];
    const snapshot = source.history.captureHistory();
    if (original.type !== 'compound') throw new Error('Expected compound');
    original.actions[0].field = 'corrupted';
    original.actions.pop();
    source.history.clearHistory();

    const destination = await fixture();
    destination.history.restoreHistory(snapshot);
    const first = destination.history.getUndoStack()[0];
    if (first.type !== 'compound') throw new Error('Expected compound');
    expect(first.actions).toHaveLength(2);
    expect(first.actions[0].field).toBe('value');
    expect(first.actions[0].oldValue).toBe(oldValue);
    expect(first.actions[0].newValue).toBe(newValue);
    first.actions[0].oldValue = 'corrupted';
    first.actions.reverse();
    destination.history.restoreHistory(snapshot);
    const second = destination.history.getUndoStack()[0];
    if (second.type !== 'compound') throw new Error('Expected compound');
    expect(second).not.toBe(first);
    expect(second.actions).not.toBe(first.actions);
    expect(second.actions[0].oldValue).toBe(oldValue);
    const another = await fixture();
    another.history.restoreHistory(snapshot);
    destination.history.clearHistory();
    expect(another.history.getUndoStack()).toHaveLength(1);
  });

  it.each(['captured duplicate', 'missing captured owner', 'current duplicate', 'missing row', 'changed resolver'])(
    'does not recapture identity when replay rejects %s',
    async (reason) => {
      const source = await fixture(
        reason === 'captured duplicate'
          ? [
              { id: 'a', value: 20 },
              { id: 'a', value: 30 },
            ]
          : undefined,
      );
      source.history.recordEdit(reason === 'missing captured owner' ? -1 : 0, 'value', 10, 20, 'a');
      // An absent explicit ID records no owner; it must not become valid later.
      if (reason === 'missing captured owner') {
        source.history.clearHistory();
        source.history.recordEdit(-1, 'value', 10, 20, 'missing');
      }
      const snapshot = source.history.captureHistory();
      const rows =
        reason === 'current duplicate'
          ? [
              { id: 'a', value: 20 },
              { id: 'a', value: 30 },
            ]
          : [{ id: reason === 'missing row' ? 'b' : reason === 'missing captured owner' ? 'missing' : 'a', value: 20 }];
      const destination = await fixture(rows, reason === 'changed resolver' ? { getRowId: (row) => row.id ?? '' } : {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const changes = vi.fn();
      const events = vi.fn();
      destination.grid.addEventListener('cell-change', changes);
      destination.grid.addEventListener('undo', events);
      destination.history.restoreHistory(snapshot);
      destination.history.undo();
      expect(rows[0].value).toBe(20);
      expect(changes).not.toHaveBeenCalled();
      expect(events).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('TBW041'));
      expect(destination.history.canUndo()).toBe(false);
      expect(destination.history.canRedo()).toBe(true);
    },
  );

  it.each([false, true])('uses default ID resolution across transfer (queued replacement: %s)', async (queued) => {
    const source = await fixture(undefined, { noId: true });
    source.history.recordEdit(0, 'value', 10, 20);
    const destination = await fixture(undefined, { noId: true });
    destination.history.restoreHistory(source.history.captureHistory());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    if (queued) destination.grid.rows = [{ id: 'a', value: 99 }];
    destination.history.undo();
    expect(destination.rows[0].value).toBe(queued ? 20 : 10);
    expect(warn.mock.calls.length).toBe(queued ? 1 : 0);
  });

  it.each([false, true])('keeps ID-less edits tied to the original object (replaced: %s)', async (replaced) => {
    const owner = { value: 20 };
    const source = await fixture([owner], { noId: true });
    source.history.recordEdit(0, 'value', 10, 20);
    const snapshot = source.history.captureHistory();
    source.grid.remove();
    const destination = await fixture([replaced ? { ...owner } : owner], { noId: true });
    const invalidate = vi.spyOn(destination.grid, '_invalidateRowContent');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    destination.history.restoreHistory(snapshot);
    destination.history.undo();
    expect(owner.value).toBe(replaced ? 20 : 10);
    expect(invalidate.mock.calls.length).toBe(replaced ? 0 : 1);
  });

  it('preserves partial compound replay, accepted-only changes and deferred visible focus', async () => {
    const source = await fixture([
      { id: 'a', value: 20 },
      { id: 'b', value: 40 },
    ]);
    source.history.beginTransaction();
    source.history.recordEdit(1, 'value', 30, 40);
    source.history.recordEdit(0, 'value', 10, 20);
    source.history.endTransaction();
    const destination = await fixture([
      { id: 'c', value: 50 },
      { id: 'a', value: 20 },
    ]);
    const changes = vi.fn();
    destination.grid.addEventListener('cell-change', changes);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    destination.history.restoreHistory(source.history.captureHistory());
    destination.history.undo();
    expect(destination.rows.map((row) => row.value)).toEqual([50, 10]);
    expect(changes).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(destination.grid._focusRow).toBe(1));
    destination.history.redo();
    expect(destination.rows.map((row) => row.value)).toEqual([50, 20]);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid tokens and unsafe states without changing history', async () => {
    const source = await fixture();
    source.history.recordEdit(0, 'value', 10, 20);
    const snapshot = source.history.captureHistory();
    const before = source.history.getUndoStack();
    expect(() => {
      // @ts-expect-error Plain objects cannot construct an opaque checkpoint.
      source.history.restoreHistory({});
    }).toThrow('TBW003');
    expect(() => {
      // @ts-expect-error Public action stacks do not carry snapshot authority.
      source.history.restoreHistory(source.history.getUndoStack());
    }).toThrow('TBW003');
    const invalid: unknown[] = [
      null,
      undefined,
      {},
      { ...snapshot },
      JSON.parse(JSON.stringify(snapshot)),
      source.history.getUndoStack(),
    ];
    for (const token of invalid) {
      expect(() => source.history.restoreHistory(token as UndoRedoSnapshot)).toThrow('TBW003');
    }
    const unattached = new UndoRedoPlugin();
    expect(() => unattached.restoreHistory(snapshot)).toThrow('attached');
    expect(() => unattached.captureHistory()).toThrow('attached');
    source.history.beginTransaction();
    source.history.beginTransaction();
    expect(() => source.history.restoreHistory(snapshot)).toThrow('transactions');
    expect(() => source.history.captureHistory()).toThrow('transactions');
    source.history.endTransaction();
    expect(() => source.history.restoreHistory(snapshot)).toThrow('transactions');
    source.history.endTransaction();
    expect(source.history.getUndoStack()).toEqual(before);
    source.history.restoreHistory(snapshot);
    source.history.undo();
    expect(source.rows[0].value).toBe(10);
  });

  it('does not replay a queued native shortcut into a new attachment', async () => {
    const source = await fixture();
    source.history.recordEdit(0, 'value', 10, 20);
    const snapshot = source.history.captureHistory();
    const input = document.createElement('input');
    source.grid.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    source.history.detach();
    source.history.attach(source.grid);
    source.history.restoreHistory(snapshot);
    await Promise.resolve();
    expect(source.rows[0].value).toBe(20);
    expect(source.history.canUndo()).toBe(true);
  });

  it('releases the replay guard after a resolver error without moving history', async () => {
    let fail = false;
    const getRowId = (row: Row) => {
      if (fail) throw new Error('resolver failure');
      return row.id ?? '';
    };
    const source = await fixture(undefined, { getRowId });
    source.history.recordEdit(0, 'value', 10, 20);
    const snapshot = source.history.captureHistory();
    fail = true;
    expect(() => source.history.undo()).toThrow('resolver failure');
    expect(source.history.canUndo()).toBe(true);
    expect(source.history.canRedo()).toBe(false);
    // Neither snapshot operation calls the resolver again.
    expect(() => source.history.captureHistory()).not.toThrow();
    expect(() => source.history.restoreHistory(snapshot)).not.toThrow();
    fail = false;
    source.history.undo();
    expect(source.rows[0].value).toBe(10);
  });

  it('accepts empty snapshots at zero capacity and rejects nonempty history', async () => {
    const source = await fixture();
    const empty = source.history.captureHistory();
    source.history.recordEdit(0, 'value', 10, 20);
    const destination = await fixture(undefined, { maxHistorySize: 0 });
    destination.history.restoreHistory(empty);
    expect(() => destination.history.restoreHistory(source.history.captureHistory())).toThrow('maxHistorySize');
    expect(destination.history.canUndo()).toBe(false);
  });

  it('rejects capture/restore from synchronous history-change and replay listeners', async () => {
    const source = await fixture();
    const snapshot = source.history.captureHistory();
    const attempts: string[] = [];
    const check = () => {
      for (const operation of [() => source.history.captureHistory(), () => source.history.restoreHistory(snapshot)]) {
        try {
          operation();
        } catch (error) {
          attempts.push(String(error));
        }
      }
    };
    source.grid.addEventListener('history-change', check);
    source.grid.addEventListener('cell-change', check);
    source.grid.addEventListener('undo', check);
    source.history.recordEdit(0, 'value', 10, 20);
    expect(attempts).toHaveLength(2);
    source.history.undo();
    expect(attempts).toHaveLength(8);
    expect(attempts.every((message) => message.includes('TBW003'))).toBe(true);
    source.grid.removeEventListener('history-change', check);
    source.grid.removeEventListener('cell-change', check);
    source.grid.removeEventListener('undo', check);
    expect(() => source.history.captureHistory()).not.toThrow();
  });

  it('guards all history mutators throughout restore notification and emits only once', async () => {
    const source = await fixture();
    source.history.recordEdit(0, 'value', 10, 20);
    const snapshot = source.history.captureHistory();
    const failures: string[] = [];
    const listener = vi.fn(() => {
      for (const operation of [
        () => source.history.restoreHistory(snapshot),
        () => source.history.captureHistory(),
        () => source.history.undo(),
        () => source.history.redo(),
        () => source.history.clearHistory(),
        () => source.history.beginTransaction(),
        () => source.history.endTransaction(),
        () => source.history.recordEdit(0, 'value', 20, 30),
      ]) {
        try {
          operation();
        } catch (error) {
          failures.push(String(error));
        }
      }
    });
    source.grid.addEventListener('history-change', listener);
    source.history.restoreHistory(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(8);
    expect(failures.every((message) => message.includes('TBW003'))).toBe(true);
    expect(source.history.getUndoStack()).toHaveLength(1);
    source.grid.removeEventListener('history-change', listener);
    source.history.undo();
    expect(source.rows[0].value).toBe(10);
  });

  it('restores empty history, clears pending focus and never carries an active transaction', async () => {
    const source = await fixture();
    const empty = source.history.captureHistory();
    source.history.recordEdit(0, 'value', 10, 20);
    source.history.undo();
    source.grid._focusRow = -1;
    const listener = vi.fn();
    source.grid.addEventListener('history-change', listener);
    source.history.restoreHistory(empty);
    source.history.afterRender();
    expect(source.grid._focusRow).toBe(-1);
    source.history.restoreHistory(empty);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(source.history.canUndo()).toBe(false);
    expect(source.history.canRedo()).toBe(false);
    expect(() => source.history.endTransaction()).toThrow('TBW112');
  });
});
