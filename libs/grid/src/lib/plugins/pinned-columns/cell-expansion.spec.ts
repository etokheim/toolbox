import { afterEach, describe, expect, it, vi } from 'vitest';
import { releaseControl } from '../../core/internal/control-lifecycle';
import { setupRowHover } from '../../core/internal/row-hover';
import type { AfterCellRenderContext, GridElementRef } from '../../core/plugin/base-plugin';
import type { ColumnConfig, RowElementInternal } from '../../core/types';
import { CellExpansion } from './cell-expansion';

const disposals: (() => void)[] = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(pinned: ColumnConfig['pinned'] = 'right', direction = 'ltr') {
  const host: HTMLElement = document.createElement('div');
  host.setAttribute('data-tbw-grid', '');
  host.style.direction = direction;
  const viewport = document.createElement('div');
  viewport.className = 'tbw-scroll-area';
  const body: HTMLElement = document.createElement('div');
  viewport.append(body);
  host.append(viewport);
  document.body.append(host);
  const columns: ColumnConfig[] = [
    { field: 'id', width: 90, pinned: 'left' },
    { field: 'name', width: 900 },
    { field: '__actions', width: 88, pinned, utility: true, expandedCellWidth: 240 },
    { field: '__chooser', width: 36, pinned: 'right', utility: true },
  ];
  const grid = Object.assign(host, { _bodyEl: body, effectiveConfig: {} }) as GridElementRef;
  const hoverAbort = new AbortController();
  const syncHover = setupRowHover(host, hoverAbort.signal);
  disposals.push(() => hoverAbort.abort());
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frame = undefined;
  });
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  let hit: Element | null = null;
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => hit);
  const flushHover = () => {
    const callback = frame;
    frame = undefined;
    callback?.(0);
  };
  let resize: () => void = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  const header = document.createElement('div');
  header.className = 'header-row';
  for (const column of columns) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.field = column.field;
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({ width: column.width as number } as DOMRect);
    header.append(cell);
  }
  host.prepend(header);
  let viewportWidth = 650;
  Object.defineProperty(viewport, 'clientWidth', { get: () => viewportWidth });
  const expansion = new CellExpansion(grid);
  disposals.push(() => expansion.dispose());
  expansion.configure(columns);
  const contexts: AfterCellRenderContext[] = ['a/one', 'b/one'].map((id, rowIndex) => {
    const row = document.createElement('div');
    row.className = 'data-grid-row';
    const cell = document.createElement('div');
    const button = document.createElement('button');
    cell.append(button);
    row.append(cell);
    body.append(row);
    const context = {
      row: { id },
      rowIndex,
      colIndex: 2,
      column: columns[2],
      value: undefined,
      cellElement: cell,
      rowElement: row,
    };
    (row as RowElementInternal).__rowDataRef = context.row;
    expansion.bind(context);
    return context;
  });
  expansion.afterRender();
  return {
    expansion,
    columns,
    contexts,
    grid,
    hoverAbort,
    hover: (index: number) => {
      hit = contexts[index].rowElement;
      hit.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      flushHover();
    },
    scrollHit: (element: Element | null) => {
      hit = element;
      host.dispatchEvent(new Event('scroll'));
      flushHover();
    },
    syncHover: () => {
      syncHover();
      flushHover();
    },
    resize: (width: number) => {
      viewportWidth = width;
      resize();
    },
  };
}

const expanded = (context: AfterCellRenderContext) => context.cellElement.hasAttribute('data-tbw-cell-expanded');
const width = (context: AfterCellRenderContext) =>
  context.cellElement.style.getPropertyValue('--tbw-pinned-cell-width');

describe('pinned action cell ownership', () => {
  it('transfers unleased expansion with geometric scroll hover, without pointer events or geometry reads', () => {
    const { contexts, hover, scrollHit } = fixture();
    hover(0);
    expect(contexts.map(expanded)).toEqual([true, false]);
    const pointer = vi.fn();
    document.addEventListener('pointerover', pointer, { once: true });
    scrollHit(contexts[1].rowElement);
    expect(contexts.map(expanded)).toEqual([false, true]);
    expect(contexts[0].rowElement.hasAttribute('data-tbw-hovered')).toBe(false);
    expect(contexts[1].rowElement.hasAttribute('data-tbw-hovered')).toBe(true);
    expect(pointer).not.toHaveBeenCalled();
    document.removeEventListener('pointerover', pointer);
  });

  it('retains menu and focus precedence over geometric hover and releases to the latest hit', async () => {
    const { expansion, contexts, hover, scrollHit } = fixture();
    hover(0);
    const button = contexts[0].cellElement.querySelector('button')!;
    button.focus();
    scrollHit(contexts[1].rowElement);
    expect(contexts.map(expanded)).toEqual([true, false]);
    const release = expansion.retain('a/one', '__actions');
    button.blur();
    const updated = { id: 'a/one', name: 'updated' };
    (contexts[0].rowElement as RowElementInternal).__rowDataRef = updated;
    expansion.bind({ ...contexts[0], row: updated });
    expansion.reconcile();
    await Promise.resolve();
    expect(contexts.map(expanded)).toEqual([true, false]);
    release();
    expect(contexts.map(expanded)).toEqual([false, true]);
    const nextRelease = expansion.retain('b/one', '__actions');
    button.focus();
    expect(contexts.map(expanded)).toEqual([false, true]);
    nextRelease();
    expect(contexts.map(expanded)).toEqual([true, false]);
    button.blur();
    await Promise.resolve();
    expect(contexts.map(expanded)).toEqual([false, true]);
  });

  it.each(['leave', 'overlay', 'touch', 'disconnect'])(
    'clears unleased %s hover but preserves explicit leases',
    (reason) => {
      const { expansion, contexts, grid, hover, scrollHit, hoverAbort } = fixture();
      hover(0);
      const release = expansion.retain('a/one', '__actions');
      if (reason === 'leave')
        document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
      if (reason === 'overlay') scrollHit(document.body);
      if (reason === 'touch')
        grid.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      if (reason === 'disconnect') hoverAbort.abort();
      expect(contexts[0].rowElement.hasAttribute('data-tbw-hovered')).toBe(false);
      expect(contexts.map(expanded)).toEqual([true, false]);
      release();
      expect(contexts.map(expanded)).toEqual([false, false]);
    },
  );

  it('reconciles a reused row and ignores geometric updates after disposal', () => {
    const { expansion, contexts, hover, scrollHit, syncHover } = fixture();
    hover(0);
    const replacement = { id: 'successor' };
    (contexts[0].rowElement as RowElementInternal).__rowDataRef = replacement;
    expansion.bind({ ...contexts[0], row: replacement });
    expansion.reconcile();
    syncHover();
    expect(contexts.map(expanded)).toEqual([true, false]);
    expansion.dispose();
    scrollHit(contexts[1].rowElement);
    expect(contexts.map(expanded)).toEqual([false, false]);
  });

  it('uses public occurrence identity and keeps the menu surface while focus leaves', () => {
    const { expansion, contexts } = fixture();
    const release = expansion.retain('a/one', '__actions');
    expect(expanded(contexts[0])).toBe(true);
    expect(expanded(contexts[1])).toBe(false);
    contexts[1].cellElement.querySelector('button')!.focus();
    expect(expanded(contexts[0])).toBe(true);
    expect(expanded(contexts[1])).toBe(false);
    release();
    expect(expanded(contexts[0])).toBe(false);
    expect(expanded(contexts[1])).toBe(true);
    expect(() => expansion.retain('one', '__actions')).toThrow(/occurrence/);
  });

  it('preserves stable renderer updates, but revokes true replacement before successor binding', () => {
    const { expansion, contexts } = fixture();
    const first = contexts[0];
    const oldRelease = expansion.retain('a/one', '__actions');
    const updated = { id: 'a/one', name: 'updated' };
    (first.rowElement as RowElementInternal).__rowDataRef = updated;
    expansion.bind({ ...first, row: updated });
    expansion.reconcile();
    expect(expanded(first)).toBe(true);
    releaseControl(first.cellElement);
    expect(expanded(first)).toBe(false);
    expansion.bind({ ...first, row: updated });
    const successorRelease = expansion.retain('a/one', '__actions');
    oldRelease();
    oldRelease();
    expect(expanded(first)).toBe(true);
    successorRelease();
    expect(expanded(first)).toBe(false);
  });

  it('revokes leases on recycle and does not transfer them to the next occurrence', () => {
    const { expansion, contexts } = fixture();
    const release = expansion.retain('a/one', '__actions');
    const replacement = { id: 'c/one' };
    (contexts[0].rowElement as RowElementInternal).__rowDataRef = replacement;
    expansion.bind({ ...contexts[0], row: replacement });
    expansion.reconcile();
    expect(expanded(contexts[0])).toBe(false);
    const successor = expansion.retain('c/one', '__actions');
    release();
    expect(expanded(contexts[0])).toBe(true);
    successor();
    expect(expanded(contexts[0])).toBe(false);
  });

  it('revokes removal, unpinning, disable and detach, and rejects nonunique identity', () => {
    const { expansion, contexts, columns } = fixture();
    const duplicate = { id: 'a/one' };
    (contexts[1].rowElement as RowElementInternal).__rowDataRef = duplicate;
    expansion.bind({ ...contexts[1], row: duplicate });
    expect(() => expansion.retain('a/one', '__actions')).toThrow(/one mounted/);
    contexts[1].rowElement.remove();
    const release = expansion.retain('a/one', '__actions');
    expansion.configure(columns.map((column) => ({ ...column, pinned: undefined })));
    expect(expanded(contexts[0])).toBe(false);
    release();
    expansion.configure(columns);
    expansion.bind(contexts[0]);
    expansion.retain('a/one', '__actions');
    expansion.dispose();
    expect(expanded(contexts[0])).toBe(false);
    expect(width(contexts[0])).toBe('');
  });

  it('clamps against viewport, opposite rail and adjacent chooser without shrinking normal width', () => {
    const { contexts, resize } = fixture();
    expect(width(contexts[0])).toBe('240px');
    resize(300);
    expect(width(contexts[0])).toBe('174px');
    resize(150);
    expect(width(contexts[0])).toBe('88px');
  });

  it('does not expand over a right-pinned neighbour on its inner side', () => {
    const { contexts, columns, expansion, resize } = fixture();
    columns[1].pinned = 'right';
    expansion.configure(columns);
    resize(650);
    expect(width(contexts[0])).toBe('88px');
  });

  it('applies changed expansion width without requiring a header resize', () => {
    const { contexts, columns, expansion } = fixture();
    const release = expansion.retain('a/one', '__actions');
    expansion.configure(columns.map((column) => ({ ...column, expandedCellWidth: 300 })));
    expansion.afterRender();
    expect(width(contexts[0])).toBe('300px');
    expect(expanded(contexts[0])).toBe(true);
    release();
  });

  it.each([
    ['end', 'ltr', true],
    ['start', 'rtl', false],
    ['end', 'rtl', false],
    ['start', 'ltr', false],
    ['left', 'ltr', false],
  ] as const)('supports only physical resolved-right (%s, %s)', (pin, direction, supported) => {
    const { expansion } = fixture(pin, direction);
    if (supported) expect(expansion.retain('a/one', '__actions')).toBeTypeOf('function');
    else expect(() => expansion.retain('a/one', '__actions')).toThrow(/one mounted/);
  });

  it('ignores nested rows and decorative copies, including focus in them', () => {
    const { contexts, grid, expansion } = fixture();
    const copy = contexts[0].rowElement.cloneNode(true) as HTMLElement;
    grid.append(copy);
    copy.querySelector('button')!.focus();
    expansion.reconcile();
    expect(contexts.some(expanded)).toBe(false);
  });

  it('retires leases when inherited direction becomes RTL and deduplicates diagnostics', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const { contexts, grid, expansion, columns } = fixture();
    const release = expansion.retain('a/one', '__actions');
    grid.style.direction = '';
    document.body.style.direction = 'rtl';
    try {
      expansion.configure(columns);
      expansion.configure(columns);
      expect(expanded(contexts[0])).toBe(false);
      expect(() => expansion.retain('a/one', '__actions')).toThrow(/one mounted/);
      expect(warning).toHaveBeenCalledTimes(1);
      document.body.style.direction = 'ltr';
      expansion.configure(columns);
      expansion.bind(contexts[0]);
      const next = expansion.retain('a/one', '__actions');
      release();
      expect(expanded(contexts[0])).toBe(true);
      next();
    } finally {
      document.body.style.direction = '';
    }
  });
});
