import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { waitUpgrade } from '../../../../test/helpers';
import '../../core/grid';
import type { DataGridElement } from '../../core/grid';
import { CellEntryPlugin } from '../cell-entry';
import { clearSelectedCells } from '../cell-entry/clear-selection';
import { EditingPlugin } from '../editing';
import { SelectionPlugin } from '../selection';
import { UndoRedoPlugin, type ExternalHistoryOwner, type HistoryChangeDetail } from './index';
import { ExternalHistoryBridge } from './external-history';

type Row = { id: string; value: string };

function owner() {
  let state: HistoryChangeDetail = { canUndo: true, canRedo: false };
  const listeners = new Set<() => void>();
  const cleanup = vi.fn();
  const history: ExternalHistoryOwner = {
    request: vi.fn(),
    getState: () => state,
    subscribe: (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
        cleanup();
      };
    },
    beginGroup: vi.fn(),
    endGroup: vi.fn(),
  };
  return {
    history,
    cleanup,
    listeners,
    publish(next = state) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

async function setup(external = owner(), history = new UndoRedoPlugin({ externalHistory: external.history })) {
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  const editing = new EditingPlugin<Row>({ editOn: 'manual' });
  grid.gridConfig = {
    getRowId: (row) => row.id,
    columns: [{ field: 'value', type: 'string', editable: true }],
    plugins: [new SelectionPlugin({ mode: 'range' }), editing, history, new CellEntryPlugin({ clearOnDelete: true })],
  };
  grid.rows = [{ id: 'a', value: 'before' }];
  document.body.append(grid);
  await waitUpgrade(grid);
  return { grid, editing, history, external };
}

function clear(grid: DataGridElement<Row>, history: UndoRedoPlugin, empty = false) {
  return clearSelectedCells(grid, empty ? [] : [{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }], history);
}

function key(target: HTMLElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('external history ownership', () => {
  it('rejects native action APIs before external attachment too', () => {
    const history = new UndoRedoPlugin({ externalHistory: owner().history });
    expect(() => history.getUndoStack()).toThrow('TBW003');
    expect(() => history.clearHistory()).toThrow('TBW003');
    expect(() => history.undo()).toThrow('TBW003');
  });

  it('does not publish availability after getState detaches its subscription', () => {
    const external = owner();
    const emitted = vi.fn();
    const bridge = new ExternalHistoryBridge(external.history, emitted);
    bridge.attach();
    emitted.mockClear();
    external.history.getState = () => {
      bridge.detach();
      return { canUndo: true, canRedo: true };
    };
    external.publish();
    expect(emitted).not.toHaveBeenCalled();
    expect(bridge.state).toEqual({ canUndo: false, canRedo: false });
    expect(external.listeners.size).toBe(0);
  });

  it('delegates explicit requests without returning or emitting native actions', async () => {
    const { grid, history, external } = await setup();
    const undo = vi.fn();
    const redo = vi.fn();
    grid.addEventListener('undo', undo);
    grid.addEventListener('redo', redo);
    expectTypeOf(history.requestUndo()).toEqualTypeOf<void>();
    history.requestRedo();
    expect(external.history.request).toHaveBeenNthCalledWith(1, 'undo');
    expect(external.history.request).toHaveBeenNthCalledWith(2, 'redo');
    expect(grid.rows[0].value).toBe('before');
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'undo'],
    [{ shiftKey: true }, 'redo'],
    [{ key: 'y' }, 'redo'],
    [{ ctrlKey: false, metaKey: true }, 'undo'],
  ] as const)('routes grid shortcuts once: %j', async (options, direction) => {
    const { grid, external } = await setup();
    expect(key(grid, options).defaultPrevented).toBe(true);
    expect(external.history.request).toHaveBeenCalledExactlyOnceWith(direction);
  });

  it('preserves native input priority and falls back only when native history is depleted', async () => {
    const { grid, editing, external } = await setup();
    editing.beginBulkEdit(0);
    const input = grid.querySelector<HTMLInputElement>('input')!;
    expect(key(input).defaultPrevented).toBe(false);
    await Promise.resolve(); // Chromium may checkpoint before the native default action.
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(external.history.request).not.toHaveBeenCalled();
    key(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(external.history.request).toHaveBeenCalledExactlyOnceWith('undo');
  });

  it('cancels deferred native-input requests on detach, including reattachment', async () => {
    const { grid, editing, external } = await setup();
    editing.beginBulkEdit(0);
    key(grid.querySelector<HTMLInputElement>('input')!);
    grid.remove();
    document.body.append(grid);
    await waitUpgrade(grid);
    expect(external.history.request).not.toHaveBeenCalled();
  });

  it('takes availability only from the owner subscription and cleans up without destroying history', async () => {
    const { grid, history, external } = await setup();
    const changes = vi.fn();
    grid.addEventListener('history-change', changes);
    expect(history.canUndo()).toBe(true);
    external.publish({ canUndo: false, canRedo: true });
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    grid.remove();
    expect(external.cleanup).toHaveBeenCalledTimes(1);
    expect(external.listeners.size).toBe(0);
    expect(external.history.getState()).toEqual({ canUndo: false, canRedo: true });
    expect(history.canRedo()).toBe(false);
    external.publish();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(() => history.requestUndo()).toThrow('TBW003');
  });

  it('does not record native scalar history or publish availability for accepted original changes', async () => {
    const { grid, history, external } = await setup();
    const changes = vi.fn();
    grid.addEventListener('history-change', changes);
    grid.updateRow('a', { value: 'changed' });
    expect(grid.rows[0].value).toBe('changed');
    expect(changes).not.toHaveBeenCalled();
    expect(external.history.request).not.toHaveBeenCalled();
    for (const call of [
      () => history.undo(),
      () => history.redo(),
      () => history.getUndoStack(),
      () => history.getRedoStack(),
      () => history.recordEdit(0, 'value', 'before', 'changed'),
      () => history.clearHistory(),
      () => history.captureHistory(),
    ])
      expect(call).toThrow('TBW003');
    const native = new UndoRedoPlugin();
    const source = await setup(owner(), native);
    expect(() => history.restoreHistory(native.captureHistory())).toThrow('TBW003');
    source.grid.remove();
  });

  it.each(['accepted', 'rejected', 'empty'])('balances clear grouping around %s outcomes', async (outcome) => {
    const { grid, history, external } = await setup();
    const order: string[] = [];
    let token: object | undefined;
    external.history.beginGroup = (group) => {
      token = group;
      order.push('begin');
    };
    external.history.endGroup = (group, reason) => {
      expect(group).toBe(token);
      expect(reason).toBe('complete');
      order.push('end');
    };
    grid.addEventListener('cell-change', () => order.push('accepted'));
    if (outcome === 'rejected') grid.addEventListener('cell-commit', (event) => event.preventDefault());
    clear(grid, history, outcome === 'empty');
    expect(order).toEqual(outcome === 'accepted' ? ['begin', 'accepted', 'end'] : ['begin', 'end']);
    expect(Object.isFrozen(token)).toBe(true);
  });

  it('uses distinct owner-scoped group tokens across grids and only brackets the outermost scope', async () => {
    const shared = owner();
    const a = await setup(shared);
    const b = await setup(shared);
    a.history.beginTransaction();
    a.history.beginTransaction();
    b.history.beginTransaction();
    expect(shared.history.beginGroup).toHaveBeenCalledTimes(2);
    const groups = vi.mocked(shared.history.beginGroup).mock.calls.map(([token]) => token);
    expect(groups[0]).not.toBe(groups[1]);
    a.history.endTransaction();
    expect(shared.history.endGroup).not.toHaveBeenCalled();
    b.history.endTransaction();
    a.history.endTransaction();
    expect(shared.history.endGroup).toHaveBeenNthCalledWith(1, groups[1], 'complete');
    expect(shared.history.endGroup).toHaveBeenNthCalledWith(2, groups[0], 'complete');
  });

  it('closes a detached group once and drains old scopes before allowing reattachment', async () => {
    const { grid, history, external } = await setup();
    history.beginTransaction();
    history.beginTransaction();
    grid.remove();
    expect(external.history.endGroup).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'detach');
    expect(() => history.attach(grid)).toThrow('Finish detached transaction scopes');
    history.endTransaction();
    history.endTransaction();
    expect(external.history.endGroup).toHaveBeenCalledTimes(1);
    document.body.append(grid);
    await waitUpgrade(grid);
    grid.getPluginByName('undoRedo')!.requestUndo();
    expect(external.history.request).toHaveBeenCalledTimes(1);
  });

  it('rejects request/group reentry and replay during an active transaction', async () => {
    const { history, external } = await setup();
    external.history.request = () => {
      expect(() => history.requestRedo()).toThrow('non-reentrant');
      expect(() => history.beginTransaction()).toThrow('non-reentrant');
    };
    history.requestUndo();
    history.beginTransaction();
    expect(() => history.requestUndo()).toThrow('open group');
    history.endTransaction();
  });

  it('coalesces synchronous availability notifications and rejects notification-triggered replay', async () => {
    const { grid, history, external } = await setup();
    const changes = vi.fn();
    grid.addEventListener('history-change', () => {
      changes();
      expect(history.canRedo()).toBe(true);
      expect(() => history.requestRedo()).toThrow('non-reentrant');
    });
    external.history.request = () => {
      external.publish({ canUndo: false, canRedo: true });
      external.publish();
    };
    history.requestUndo();
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('preserves partial application effects after callback errors and resets request guards', async () => {
    const { grid, history, external } = await setup();
    external.history.request = () => {
      grid.updateRow('a', { value: 'applied' }, 'history');
      external.publish({ canUndo: false, canRedo: true });
      throw new Error('owner failed after write');
    };
    expect(() => history.requestUndo()).toThrow('owner failed after write');
    expect(grid.rows[0].value).toBe('applied');
    expect(history.canRedo()).toBe(true);
    external.history.request = vi.fn();
    history.requestRedo();
    expect(external.history.request).toHaveBeenCalledExactlyOnceWith('redo');
  });

  it('closes a failed begin callback without poisoning the next group', async () => {
    const { history, external } = await setup();
    external.history.beginGroup = () => {
      throw new Error('begin failed');
    };
    expect(() => history.beginTransaction()).toThrow('begin failed');
    expect(external.history.endGroup).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'error');
    external.history.beginGroup = vi.fn();
    history.beginTransaction();
    history.endTransaction();
    expect(external.history.endGroup).toHaveBeenLastCalledWith(expect.any(Object), 'complete');
  });

  it('supports the void request API in default native mode without changing native events', async () => {
    const native = new UndoRedoPlugin();
    const { grid } = await setup(owner(), native);
    grid.updateRow('a', { value: 'changed' });
    const undo = vi.fn();
    grid.addEventListener('undo', undo);
    native.requestUndo();
    expect(grid.rows[0].value).toBe('before');
    expect(undo).toHaveBeenCalledTimes(1);
    native.requestRedo();
    expect(grid.rows[0].value).toBe('changed');
  });

  it.each(['grid', 'input'])('routes a nested %s shortcut to the shared owner only once', async (target) => {
    const shared = owner();
    const outer = await setup(shared);
    const inner = await setup(shared);
    outer.grid.append(inner.grid);
    await waitUpgrade(inner.grid);
    if (target === 'input') {
      inner.grid.getPluginByName('editing')!.beginBulkEdit(0);
      key(inner.grid.querySelector<HTMLInputElement>('input')!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } else key(inner.grid);
    expect(shared.history.request).toHaveBeenCalledExactlyOnceWith('undo');
  });

  it('preserves native input history inside an open shadow root', async () => {
    const { grid, external } = await setup();
    const host = document.createElement('div');
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    grid.append(host);
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(external.history.request).not.toHaveBeenCalled();
  });

  it('promotes only matched accepted proposals and leaves replay feedback suppression to the owner', async () => {
    const { grid, editing, history, external } = await setup();
    const proposals = new WeakMap<object, { row: Row; before: string }>();
    const records: { row: Row; before: string; after: unknown; group?: object }[] = [];
    let group: object | undefined;
    let replaying = false;
    external.history.beginGroup = (token) => {
      group = token;
    };
    external.history.endGroup = () => {
      group = undefined;
    };
    grid.addEventListener('cell-commit', ({ detail }) => {
      expect(detail.operationId).toBeDefined();
      proposals.set(detail.operationId!, { row: detail.row, before: detail.row.value });
    });
    grid.addEventListener('cell-change', ({ detail }) => {
      if (replaying || detail.source === 'sync' || detail.source === 'history') return;
      const proposal = proposals.get(detail.operationId!);
      expect(proposal).toBeDefined();
      records.push({ ...proposal!, after: detail.newValue, group });
      proposals.delete(detail.operationId!);
    });
    editing.beginBulkEdit(0);
    const input = grid.querySelector<HTMLInputElement>('input')!;
    input.value = 'interactive';
    input.dispatchEvent(new Event('blur'));
    clear(grid, history);
    expect(records.map(({ before, after }) => [before, after])).toEqual([
      ['before', 'interactive'],
      ['interactive', ''],
    ]);
    expect(records[1].group).toBeDefined();
    external.history.request = () => {
      replaying = true;
      try {
        grid.updateRow('a', { value: 'interactive' }, 'history');
      } finally {
        replaying = false;
      }
    };
    history.requestUndo();
    expect(records).toHaveLength(2);
    expect(grid.rows[0].value).toBe('interactive');
  });

  it('preserves accepted clear cleanup when endGroup throws', async () => {
    const { grid, history, external } = await setup();
    const accepted = vi.fn();
    const data = vi.fn();
    grid.addEventListener('cell-change', accepted);
    grid.addEventListener('data-change', data);
    external.history.endGroup = () => {
      throw new Error('end failed');
    };
    expect(() => clear(grid, history)).toThrow('end failed');
    expect(grid.rows[0].value).toBe('');
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledTimes(1);
    external.history.endGroup = vi.fn();
    history.beginTransaction();
    history.endTransaction();
  });

  it('closes a clear group once if its accepted notification detaches the grid', async () => {
    const { grid, history, external } = await setup();
    grid.addEventListener('cell-change', () => grid.remove());
    expect(clear(grid, history).cells[0].status).toBe('cleared');
    expect(external.history.endGroup).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'detach');
    expect(external.listeners.size).toBe(0);
  });

  it('cleans up failed initial availability and ignores a stale subscription callback', () => {
    const external = owner();
    const emitted = vi.fn();
    const bridge = new ExternalHistoryBridge(external.history, emitted);
    external.history.getState = () => {
      throw new Error('state failed');
    };
    expect(() => bridge.attach()).toThrow('state failed');
    expect(external.cleanup).toHaveBeenCalledTimes(1);
    expect(external.listeners.size).toBe(0);
    expect(() => bridge.request('undo')).toThrow('TBW003');

    external.history.getState = () => ({ canUndo: true, canRedo: false });
    bridge.attach();
    const notify = [...external.listeners][0];
    bridge.detach();
    notify();
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(bridge.state).toEqual({ canUndo: false, canRedo: false });
  });

  it('rejects asynchronous request callbacks and recovers without retrying them', () => {
    const external = owner();
    const bridge = new ExternalHistoryBridge(external.history, vi.fn());
    bridge.attach();
    external.history.request = vi.fn(async () => undefined);
    expect(() => bridge.request('undo')).toThrow('must be synchronous');
    expect(external.history.request).toHaveBeenCalledTimes(1);
    external.history.request = vi.fn();
    bridge.request('redo');
    expect(external.history.request).toHaveBeenCalledExactlyOnceWith('redo');
    bridge.detach();
  });

  it('reports both owner and availability errors without leaving a busy guard', () => {
    const external = owner();
    const bridge = new ExternalHistoryBridge(external.history, vi.fn());
    bridge.attach();
    external.history.request = () => {
      external.publish();
      external.history.getState = () => {
        throw new Error('state failed');
      };
      throw new Error('request failed');
    };
    expect(() => bridge.request('undo')).toThrow(AggregateError);
    external.history.request = vi.fn();
    bridge.request('redo');
    expect(external.history.request).toHaveBeenCalledExactlyOnceWith('redo');
    bridge.detach();
  });
});
