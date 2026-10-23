import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnInternal, FrameworkAdapter, GridHost, RowElementInternal } from '../types';
import { registerControlCleanup } from './control-lifecycle';
import { renderInlineRow, renderVisibleRows } from './rows';

function fixture(owned = true) {
  const views = new WeakMap<HTMLElement, HTMLElement>();
  const tracked = new WeakSet<HTMLElement>();
  const context = vi.fn();
  const renderer: NonNullable<ColumnInternal['viewRenderer']> = (ctx) => {
    context(ctx, ctx.cellEl?.getAttribute('data-row'));
    const cell = ctx.cellEl!;
    let view = views.get(cell);
    if (!view || !cell.contains(view)) {
      view = document.createElement('button');
      views.set(cell, view);
      tracked.add(view);
    }
    view.textContent = String(ctx.value);
    return view;
  };
  const release = vi.fn((cell: HTMLElement) => {
    if (cell.firstElementChild instanceof HTMLElement) tracked.delete(cell.firstElementChild);
  });
  const adapter: FrameworkAdapter = {
    canHandle: () => true,
    createRenderer: () => undefined,
    createEditor: () => undefined,
    releaseCell: release,
    canRetainCellView: (cell) =>
      owned && cell.firstElementChild instanceof HTMLElement && tracked.has(cell.firstElementChild),
  };
  const columns: ColumnInternal[] = [{ field: 'name' }, { field: 'action', utility: true, viewRenderer: renderer }];
  const host = document.createElement('div');
  const state: Partial<GridHost> = {
    _visibleColumns: columns,
    _focusRow: -1,
    _focusCol: -1,
    __frameworkAdapter: adapter,
    effectiveConfig: {},
    getRowId: (row: unknown) => {
      if (!row || typeof row !== 'object' || !('id' in row)) throw new Error('Expected an occurrence ID');
      return String(row.id);
    },
  };
  const grid = Object.assign(host, state) as GridHost;
  const rowEl: RowElementInternal = document.createElement('div');
  const row = { id: 'scope/one', name: 'Original', action: 'More' };
  document.body.append(host);
  host.append(rowEl);
  renderInlineRow(grid, rowEl, row, 0);
  rowEl.__rowDataRef = row;
  rowEl.__epoch = 0;
  Object.assign(grid, { _bodyEl: host, _rowPool: [rowEl], _rows: [row], _activeEditRows: -1 });
  const cell = rowEl.children[1] as HTMLElement;
  const button = cell.firstElementChild as HTMLButtonElement;
  const cleanup = vi.fn();
  registerControlCleanup(cell, cleanup);
  release.mockClear();
  return { grid, rowEl, row, cell, button, cleanup, release, columns, renderer, context };
}

afterEach(() => document.body.replaceChildren());

describe('bounded utility view retention', () => {
  it('rebuilds valid unkeyed rows without calling the throwing public identity API', () => {
    const f = fixture();
    const unkeyed = { name: 'Unkeyed', action: 'More' };
    f.rowEl.__rowDataRef = unkeyed;
    const publicId = vi.spyOn(f.grid, 'getRowId');
    expect(() => renderInlineRow(f.grid, f.rowEl, unkeyed, 0, true)).not.toThrow();
    expect(publicId).not.toHaveBeenCalled();
    expect(f.rowEl.children[0].textContent).toBe('Unkeyed');
    expect(f.rowEl.children[1].textContent).toBe('More');
    expect(f.cell.isConnected).toBe(false);
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it('retains explicit identities without hiding resolver errors', () => {
    const f = fixture();
    const resolver = vi.fn((row: { name: string }) => row.name);
    f.grid.effectiveConfig = { ...f.grid.effectiveConfig, getRowId: resolver };
    renderInlineRow(f.grid, f.rowEl, { name: f.row.name, action: 'Updated' }, 0, true);
    expect(f.rowEl.children[1]).toBe(f.cell);
    resolver.mockImplementation(() => {
      throw new Error('Invalid configured identity');
    });
    expect(() => renderInlineRow(f.grid, f.rowEl, f.row, 0, true)).toThrow('Invalid configured identity');
  });

  it('keeps the owned cell physically attached, runs changed siblings and delivers fresh context', () => {
    const f = fixture();
    f.button.focus();
    const removed: Node[] = [];
    const observer = new MutationObserver((records) => records.forEach((r) => removed.push(...r.removedNodes)));
    observer.observe(f.rowEl, { childList: true });
    f.columns[0] = { field: 'name', renderer: () => 'Changed sibling' };
    const next = { ...f.row, action: 'Updated' };
    Object.assign(f.grid, { _rows: [undefined, undefined, undefined, undefined, next] });
    renderVisibleRows(f.grid, 4, 5, 1);
    removed.push(...observer.takeRecords().flatMap((r) => [...r.removedNodes]));
    observer.disconnect();
    expect(f.rowEl.children[1]).toBe(f.cell);
    expect(removed).not.toContain(f.cell);
    expect(document.activeElement).toBe(f.button);
    expect(f.rowEl.children[0].textContent).toBe('Changed sibling');
    expect(f.button.textContent).toBe('Updated');
    expect(f.context.mock.lastCall?.[0].row).toBe(next);
    expect(f.context.mock.lastCall?.[1]).toBe('4');
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.release).not.toHaveBeenCalledWith(f.cell);
  });

  it.each(['renderer', 'width', 'reorder', 'remove', 'occurrence', 'nested', 'explicit-rebuild'] as const)(
    'revokes on %s without duplicate control cleanup',
    (change) => {
      const f = fixture();
      let next = f.row;
      if (change === 'renderer')
        f.columns[1] = { ...f.columns[1], viewRenderer: () => document.createElement('button') };
      if (change === 'width') f.columns[1] = { ...f.columns[1], width: 120 };
      if (change === 'reorder') f.columns.reverse();
      if (change === 'remove') f.columns.pop();
      if (change === 'occurrence') next = { ...f.row, id: 'scope/two' };
      if (change === 'nested') f.columns[1] = { ...f.columns[1], meta: { choice: 'new' } };
      renderInlineRow(f.grid, f.rowEl, next, 0, change !== 'explicit-rebuild');
      expect(f.cell.isConnected).toBe(false);
      expect(f.cleanup).toHaveBeenCalledTimes(1);
      expect(f.release).toHaveBeenCalledWith(f.cell);
      renderInlineRow(f.grid, f.rowEl, next, 0);
      expect(f.cleanup).toHaveBeenCalledTimes(1);
    },
  );

  it('does not turn raw DOM renderers into persistent views', () => {
    const f = fixture(false);
    renderInlineRow(f.grid, f.rowEl, f.row, 0, true);
    expect(f.cell.isConnected).toBe(false);
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });

  it('conservatively rejects unchanged nested options', () => {
    const f = fixture();
    f.columns[1] = { ...f.columns[1], meta: {} };
    renderInlineRow(f.grid, f.rowEl, f.row, 0);
    const cell = f.rowEl.children[1];
    renderInlineRow(f.grid, f.rowEl, f.row, 0, true);
    expect(f.rowEl.children[1]).not.toBe(cell);
  });

  it('does not compare option snapshots on ordinary row patches', () => {
    const f = fixture();
    const keys = vi.fn(Reflect.ownKeys);
    f.columns[1] = new Proxy<ColumnInternal>(f.columns[1], { ownKeys: keys });
    renderVisibleRows(f.grid, 0, 1, 1);
    keys.mockClear();
    renderVisibleRows(f.grid, 0, 1, 1);
    expect(keys).not.toHaveBeenCalled();
    expect(f.rowEl.children[1]).toBe(f.cell);
  });

  it('rejects a different tracked view in the same physical cell', () => {
    const f = fixture();
    const replacement = f.renderer({ ...f.context.mock.lastCall![0], cellEl: document.createElement('div') });
    if (!(replacement instanceof HTMLElement)) throw new Error('Expected a tracked DOM view');
    f.cell.replaceChildren(replacement);
    renderInlineRow(f.grid, f.rowEl, f.row, 0, true);
    expect(f.cell.isConnected).toBe(false);
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });

  it.each(['editor', 'custom-row', 'adapter-release', 'pool-removal'] as const)(
    'keeps existing teardown ownership for %s',
    (transition) => {
      const f = fixture();
      if (transition === 'editor') {
        f.rowEl.__editingCellCount = 1;
        f.cell.classList.add('editing');
      }
      if (transition === 'custom-row') f.rowEl.__isCustomRow = true;
      if (transition === 'adapter-release') f.release(f.cell);
      renderVisibleRows(f.grid, 0, transition === 'pool-removal' ? 0 : 1, 1);
      expect(f.cell.isConnected).toBe(false);
      expect(f.cleanup).toHaveBeenCalledTimes(1);
      renderVisibleRows(f.grid, 0, 0, 2);
      expect(f.cleanup).toHaveBeenCalledTimes(1);
    },
  );

  it('compares declaration element identity but does not traverse its mutable DOM', () => {
    const f = fixture();
    const declaration = document.createElement('tbw-grid-column');
    Object.assign(f.columns[1], { __element: declaration });
    renderInlineRow(f.grid, f.rowEl, f.row, 0);
    const cell = f.rowEl.children[1];
    declaration.textContent = 'Updated registration DOM';
    renderInlineRow(f.grid, f.rowEl, f.row, 0, true);
    expect(f.rowEl.children[1]).toBe(cell);
    Object.assign(f.columns[1], { __element: document.createElement('tbw-grid-column') });
    renderInlineRow(f.grid, f.rowEl, f.row, 0, true);
    expect(f.rowEl.children[1]).not.toBe(cell);
  });
});
