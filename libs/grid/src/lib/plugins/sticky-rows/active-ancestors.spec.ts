import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { getRowWindow } from '../../core/internal/row-window';
import type { RowElementInternal } from '../../core/types';
import { GroupingRowsPlugin } from '../grouping-rows';
import { MasterDetailPlugin } from '../master-detail';
import { PinnedColumnsPlugin } from '../pinned-columns';
import { SelectionPlugin } from '../selection';
import { TreePlugin } from '../tree';
import { ActiveAncestors } from './active-ancestors';
import { StickyRowsPlugin } from './sticky-rows-plugin';

interface Row {
  id: string;
  height: number;
  category?: string;
  actions?: string;
  children?: Row[];
}

async function fixture(count = 80, depth = 1, scrollContainer?: HTMLElement, withActions = false) {
  if (!customElements.get('tbw-grid')) customElements.define('tbw-grid', DataGridElement);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('rows-viewport') ? 180 : 212;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('data-grid-row')
      ? (((this as RowElementInternal).__rowDataRef as Row | undefined)?.height ?? 16)
      : 32;
  });
  const actions = vi.fn();
  const root: Row = {
    id: 'root',
    height: 32,
    children: [
      {
        id: 'branch',
        height: 24,
        children: Array.from({ length: count }, (_, i) => ({
          id: `item-${i}`,
          height: 24,
          category: 'Items',
        })),
      },
    ],
  };
  let branch = root.children![0];
  for (let i = 1; i < depth; i++) {
    const next: Row = { id: `branch-${i}`, height: 24, children: branch.children };
    branch.children = [next];
    branch = next;
  }
  const tree = new TreePlugin({ defaultExpanded: true, animation: false });
  const grouping = new GroupingRowsPlugin({
    groupOn: (row: Row) => row.category ?? null,
    defaultExpanded: true,
    childGroupsCollapsible: false,
    animation: false,
    groupRowRenderer: ({ value }) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.textContent = String(value);
      return cell;
    },
  });
  const selection = new SelectionPlugin({ mode: 'row', checkbox: true });
  const pinned = withActions ? new PinnedColumnsPlugin() : undefined;
  const sticky = new StickyRowsPlugin({ mode: 'ancestors', isSticky: () => true, scrollContainer, topOffset: 12 });
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  grid.gridConfig = {
    columns: [
      {
        field: 'id',
        renderer: ({ row }) => {
          const button = document.createElement('button');
          button.id = `action-${row.id}`;
          button.textContent = row.id;
          button.addEventListener('click', () => actions(row.id));
          return button;
        },
      },
      ...(withActions
        ? [
            {
              field: 'actions',
              width: 32,
              pinned: 'right' as const,
              utility: true,
              expandedCellWidth: 'content' as const,
              renderer: ({ row }: { row: Row }) => {
                const button = document.createElement('button');
                button.textContent = `Actions for ${row.id}`;
                return button;
              },
            },
          ]
        : []),
    ],
    getRowId: (row) => row.id,
    rowHeight: (row) => row.height ?? 16,
    plugins: [tree, grouping, selection, sticky, ...(pinned ? [pinned] : [])],
  };
  grid.rows = [
    root,
    {
      id: 'other-root',
      height: 32,
      children: withActions ? Array.from({ length: 40 }, (_, i) => ({ id: `other-${i}`, height: 24 })) : undefined,
    },
  ];
  (scrollContainer ?? document.body).append(grid);
  await grid.ready();
  if (!scrollContainer) await vi.waitFor(() => expect(grid.findRenderedRowElement(0)).not.toBeNull());
  const scroll = (top: number) => {
    grid._virtualization.container!.scrollTop = top;
    grid.refreshVirtualWindow(false);
    grid._afterPluginRender();
  };
  return { grid, root, tree, selection, sticky, pinned, actions, scroll };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('live ancestor viewport updates', () => {
  it('stores viewport updates before attachment without changing legacy mode', () => {
    const owner = document.createElement('div');
    const sticky = new StickyRowsPlugin({ isSticky: 'id' });
    sticky.setViewport({ scrollContainer: owner, topOffset: 12 });
    expect(sticky.resolvedConfig).toMatchObject({ mode: 'push', scrollContainer: owner, topOffset: 12 });
    sticky.setViewport({});
    expect(sticky.resolvedConfig.scrollContainer).toBeUndefined();
    expect(sticky.resolvedConfig.topOffset).toBeUndefined();
  });

  it('rebinds owner resources without replacing the row window or detaching sibling state', async () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first);
    first.append(second);
    const { grid, sticky, selection } = await fixture(4);
    second.append(grid);
    await grid.ready();
    const window = getRowWindow(grid);
    const detached = vi.spyOn(sticky, 'detach');
    const selectionDetached = vi.spyOn(selection, 'detach');
    const firstEvents = vi.spyOn(first, 'addEventListener');
    const secondEvents = vi.spyOn(second, 'addEventListener');
    const observe = vi.spyOn(ResizeObserver.prototype, 'observe');
    const signals = (events: typeof firstEvents) =>
      events.mock.calls
        .filter(([type]) => type === 'scroll')
        .map(([, , options]) => (typeof options === 'object' ? options.signal : undefined));
    sticky.setViewport({ scrollContainer: first, topOffset: 0 });
    expect(getRowWindow(grid)).toBe(window);
    expect(signals(firstEvents)).toHaveLength(1);
    const observerIndex = observe.mock.calls.findIndex(([target]) => target === first);
    const observer = observe.mock.instances[observerIndex];
    if (!(observer instanceof ResizeObserver)) throw new Error('Missing viewport observer');
    const disconnect = vi.spyOn(observer, 'disconnect');
    sticky.setViewport({ scrollContainer: first, topOffset: 12 });
    expect(signals(firstEvents)).toHaveLength(1);
    expect(disconnect).not.toHaveBeenCalled();
    sticky.setViewport({ scrollContainer: second, topOffset: 12 });
    expect(signals(firstEvents)[0]?.aborted).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(signals(secondEvents)).toHaveLength(1);
    expect(window?.reveal).toBeTypeOf('function');
    sticky.setViewport({});
    expect(signals(secondEvents)[0]?.aborted).toBe(true);
    expect(window?.reveal).toBeUndefined();
    expect(window?.pageHeight).toBeUndefined();
    expect(getRowWindow(grid)).toBe(window);
    expect(detached).not.toHaveBeenCalled();
    expect(selectionDetached).not.toHaveBeenCalled();
    grid.remove();
    expect(getRowWindow(grid)).toBeUndefined();
    expect(detached).toHaveBeenCalledOnce();
  });
});

async function externalHeightFixture(inside = 0) {
  if (!customElements.get('tbw-grid')) customElements.define('tbw-grid', DataGridElement);
  const owner = document.createElement('div');
  document.body.append(owner);
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  let extent = 80 * 120;
  Object.defineProperties(owner, {
    clientHeight: { get: () => 320 },
    scrollHeight: { get: () => extent + 32 },
  });
  vi.spyOn(owner, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 400, 320));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('rows-viewport') ? extent : extent + 32;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('data-grid-row')) return 32;
    const row = (this as RowElementInternal).__rowDataRef as Row;
    const height = grid.effectiveConfig.rowHeight;
    return typeof height === 'function' ? (height(row, 0) ?? 24) : (height ?? 24);
  });
  const comfortable = (row: Row) => row.height ?? 24;
  const compact = (row: Row) => (row.height === 56 ? 32 : row.height === 40 ? 24 : 16);
  grid.gridConfig = {
    columns: [{ field: 'id' }],
    getRowId: (row) => row.id,
    rowHeight: comfortable,
    plugins: [
      new TreePlugin({ defaultExpanded: true, animation: false }),
      new GroupingRowsPlugin({
        groupOn: (row: Row) => row.category ?? null,
        defaultExpanded: true,
        childGroupsCollapsible: false,
        animation: false,
      }),
      new StickyRowsPlugin({ mode: 'ancestors', isSticky: () => true, scrollContainer: owner }),
    ],
  };
  grid.rows = Array.from({ length: 80 }, (_, i) => ({
    id: `root-${i}`,
    height: 56,
    children: [{ id: `child-${i}`, height: 40, category: 'Section' }],
  }));
  owner.append(grid);
  await grid.ready();
  const header = grid._headerRowEl.closest<HTMLElement>('.header')!;
  vi.spyOn(header, 'getBoundingClientRect').mockImplementation(
    () =>
      new DOMRect(
        0,
        -owner.scrollTop + (Number.parseFloat(header.style.getPropertyValue('--tbw-ancestor-header-shift')) || 0),
        400,
        32,
      ),
  );
  vi.spyOn(grid._virtualization.viewportEl!, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 32 - owner.scrollTop, 400, extent),
  );
  owner.scrollTop = 3600 + inside;
  owner.scrollLeft = 41;
  grid.refreshVirtualWindow(true);
  expect(grid.rows[90].id).toBe('root-30');
  expect(grid._virtualization.positionCache![90].offset).toBe(3600);
  const replace = async () => {
    grid.gridConfig = { ...grid.gridConfig, rowHeight: compact };
    await vi.waitFor(() => expect(grid._virtualization.positionCache![90].offset).toBe(2160));
  };
  const settle = () => {
    extent = 80 * 72;
    window.dispatchEvent(new Event('resize'));
  };
  return { grid, owner, replace, settle };
}

describe('external occurrence height anchoring', () => {
  it.each([0, 9])(
    'preserves occurrence30 and intra-row offset %i through asynchronous natural extent',
    async (inside) => {
      const { grid, owner, replace, settle } = await externalHeightFixture(inside);
      await replace();
      expect(owner.scrollTop).toBe(3600 + inside);
      expect(getRowWindow(grid)!.elements.has(90)).toBe(true);
      settle();
      await vi.waitFor(() => expect(owner.scrollTop).toBe(2160 + inside));
      expect(owner.scrollLeft).toBe(41);
      expect(getRowWindow(grid)!.viewport?.()?.scrollTop).toBe(2160 + inside);
      expect(grid._bodyEl.style.transform).toBe(
        `translateY(${grid._virtualization.positionCache![grid._virtualization.start].offset}px)`,
      );
    },
  );

  it('lets new user scroll intent cancel the pending occurrence restore', async () => {
    const { owner, replace, settle } = await externalHeightFixture();
    await replace();
    owner.dispatchEvent(new WheelEvent('wheel'));
    owner.scrollTop = 4000;
    settle();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(owner.scrollTop).toBe(4000);
    expect(owner.scrollLeft).toBe(41);
  });

  it('lets explicit row navigation cancel the pending occurrence restore', async () => {
    const { grid, owner, replace, settle } = await externalHeightFixture();
    vi.spyOn(owner, 'scrollTo').mockImplementation((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options.top !== undefined) owner.scrollTop = options.top;
    });
    await replace();
    grid.scrollToRow(150, { align: 'start' });
    const requested = owner.scrollTop;
    expect(requested).not.toBe(2160);
    settle();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(owner.scrollTop).toBe(requested);
  });
});

describe('live ancestor row ownership', () => {
  it('retains original live rows, controls and logical DOM order outside the contiguous window', async () => {
    const { grid, actions, scroll } = await fixture();
    const root = grid.findRenderedRowElement(0)!;
    const button = root.querySelector<HTMLButtonElement>('#action-root')!;
    button.focus();
    scroll(500);

    expect(grid._virtualization.start).toBeGreaterThan(2);
    expect(grid.findRenderedRowElement(0)).toBe(root);
    expect(root.parentElement).toBe(grid._bodyEl);
    expect(root.classList.contains('tbw-ancestor-live')).toBe(true);
    expect(root.classList.contains('tbw-ancestor-retained')).toBe(true);
    expect(root.querySelector('#action-root')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(grid.querySelectorAll('#action-root')).toHaveLength(1);
    expect(grid.querySelector('.tbw-sticky-rows')).toBeNull();
    const indices = [...grid._bodyEl.querySelectorAll(':scope > .data-grid-row')].map((row) =>
      Number(row.querySelector(':scope > .cell[data-row]')?.getAttribute('data-row')),
    );
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(root.getAttribute('aria-rowindex')).toBe('2');
    button.click();
    expect(actions.mock.calls).toEqual([['root']]);
  });

  it('retains only the entity surface while an expanded detail leaves the contiguous window', async () => {
    const { grid, scroll } = await fixture();
    const detail = new MasterDetailPlugin({
      animation: false,
      detailHeight: 32,
      detailRenderer: () => document.createElement('div'),
    });
    grid.gridConfig = { ...grid.gridConfig, plugins: [...grid.gridConfig.plugins!, detail] };
    await grid.forceLayout();
    detail.expand(0);
    await vi.waitFor(() => expect(grid.querySelector('.master-detail-row')).not.toBeNull());
    const root = grid.findRenderedRowElement(0)!;
    expect(grid._virtualization.positionCache![0].height).toBe(64);

    scroll(600);
    expect(grid._virtualization.start).toBeGreaterThan(0);
    expect(grid.findRenderedRowElement(0)).toBe(root);
    expect(root.classList.contains('tbw-ancestor-retained')).toBe(true);
    expect(root.offsetHeight).toBe(32);
    expect(grid.querySelector('.master-detail-row')).toBeNull();

    scroll(0);
    expect(grid.findRenderedRowElement(0)).toBe(root);
    expect(root.nextElementSibling?.classList.contains('master-detail-row')).toBe(true);
    expect(grid._virtualization.positionCache![0].height).toBe(64);
  });

  it('keeps retained checkbox selection on the correct occurrence and headings title-only', async () => {
    const { grid, root, selection, scroll } = await fixture();
    scroll(500);
    const checkbox = grid.findRenderedRowElement(0)!.querySelector<HTMLInputElement>('.tbw-select-row-checkbox')!;
    checkbox.click();
    expect(selection.getSelectedRows()).toContain(root);
    const heading = grid.findRenderedRowElement(2)!;
    expect(heading.textContent).toBe('Items');
    expect(heading.querySelector('input, button')).toBeNull();
  });

  it('navigates retained ancestors by canonical row index and reveals a nonretained descendant', async () => {
    const { grid, scroll } = await fixture();
    scroll(500);
    grid.focusCell(0, 'id');
    expect(grid.focusedCell?.rowIndex).toBe(0);
    expect(grid._virtualization.container!.scrollTop).toBe(500);
    const cell = grid.findRenderedRowElement(0)!.querySelector<HTMLElement>('.cell[data-field="id"]')!;
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(grid.focusedCell?.rowIndex).toBe(1));
    grid.focusCell(3, 'id');
    await vi.waitFor(() => expect(grid.findRenderedRowElement(3)).not.toBeNull());
    expect(grid.focusedCell?.rowIndex).toBe(3);
    expect(grid._virtualization.container!.scrollTop).toBeLessThan(500);
  });

  it('preserves a menu expansion lease only while its ancestor remains an active live surface', async () => {
    const { grid, pinned, scroll } = await fixture(80, 1, undefined, true);
    const root = grid.findRenderedRowElement(0)!;
    const cell = root.querySelector<HTMLElement>('.cell[data-field="actions"]')!;
    const control = cell.querySelector('button')!;
    const release = pinned!.retainCellExpansion('root', 'actions');
    expect(cell.hasAttribute('data-tbw-cell-expanded')).toBe(true);
    scroll(500);
    expect(grid.findRenderedRowElement(0)).toBe(root);
    expect(root.querySelector('.cell[data-field="actions"]')).toBe(cell);
    expect(cell.querySelector('button')).toBe(control);
    expect(cell.hasAttribute('data-tbw-cell-expanded')).toBe(true);
    const other = grid.rows.findIndex((row) => row.id === 'other-root');
    scroll(grid._virtualization.positionCache![other].offset + 100);
    expect(root.isConnected).toBe(false);
    expect(grid.findRenderedRowElement(0)).toBeNull();
    release();
  });

  it('keeps live occurrence rows through immutable model replacement and retires removed identities', async () => {
    const { grid, scroll } = await fixture();
    scroll(500);
    const root = grid.findRenderedRowElement(0)!;
    const branch = grid.findRenderedRowElement(1)!;
    const replacement = structuredClone(grid.sourceRows);
    grid.rows = replacement;
    await vi.waitFor(() => expect(grid.rows[0]).toBe(replacement[0]));
    expect(grid.findRenderedRowElement(0)).toBe(root);
    expect(grid.findRenderedRowElement(1)).toBe(branch);
    expect(getRowWindow(grid)?.elements.get(0)?.__rowDataRef).toBe(replacement[0]);
    expect(getRowWindow(grid)?.elements.get(1)?.__rowDataRef).toBe(replacement[0].children![0]);

    const changed = structuredClone(replacement);
    changed[0].id = 'new-root';
    grid.rows = changed;
    await vi.waitFor(() => expect(grid.rows[0]).toBe(changed[0]));
    expect(grid.findRenderedRowElement(0)).not.toBe(root);
    expect(root.isConnected).toBe(false);
  });

  it('keeps duplicate entities separated by occurrence IDs through reorder and removal', async () => {
    const { grid } = await fixture();
    const occurrences = [
      { id: 'left/entity', rowId: 'entity', height: 24 },
      { id: 'right/entity', rowId: 'entity', height: 24 },
    ];
    grid.rows = occurrences;
    await vi.waitFor(() => expect(grid.rows).toHaveLength(2));
    const left = grid.findRenderedRowElement(0)!;
    const right = grid.findRenderedRowElement(1)!;
    grid.rows = structuredClone(occurrences).reverse();
    await vi.waitFor(() => expect(grid.rows[0].id).toBe('right/entity'));
    expect(grid.findRenderedRowElement(0)).toBe(right);
    expect(grid.findRenderedRowElement(1)).toBe(left);
    grid.rows = [{ ...occurrences[1] }];
    await vi.waitFor(() => expect(grid.rows).toHaveLength(1));
    expect(grid.findRenderedRowElement(0)).toBe(right);
    expect(left.isConnected).toBe(false);
  });

  it('does not transfer live rows through ambiguous IDs or a different ID resolver', async () => {
    const { grid } = await fixture();
    const rows = [
      { id: 'first', height: 24 },
      { id: 'second', height: 24 },
    ];
    const getRowId = () => 'shared';
    grid.gridConfig = { ...grid._sourceConfig, getRowId };
    grid.rows = rows;
    await vi.waitFor(() => expect(grid.rows).toHaveLength(2));
    const first = grid.findRenderedRowElement(0)!;
    const second = grid.findRenderedRowElement(1)!;
    grid.rows = structuredClone(rows).reverse();
    await vi.waitFor(() => expect(grid.rows[0].id).toBe('second'));
    expect(grid.findRenderedRowElement(0)).not.toBe(first);
    expect(grid.findRenderedRowElement(0)).not.toBe(second);
    expect(first.isConnected).toBe(false);
    expect(second.isConnected).toBe(false);
    const current = grid.findRenderedRowElement(0)!;
    grid.gridConfig = { ...grid._sourceConfig, getRowId: (row) => row.id };
    await vi.waitFor(() => expect(grid.findRenderedRowElement(0)).not.toBe(current));
    expect(current.isConnected).toBe(false);
  });

  it('bounds live rows by the visible window plus three active ancestors over long scrolling', async () => {
    const { grid, scroll } = await fixture(300);
    for (let top = 100; top < 6800; top += 137) {
      scroll(top);
      const state = grid._virtualization;
      const rendered = grid._bodyEl.querySelectorAll(':scope > .data-grid-row');
      expect(rendered.length).toBeLessThanOrEqual(state.end - state.start + 3);
      expect(new Set([...rendered].map((row) => (row as RowElementInternal).__rowDataRef)).size).toBe(rendered.length);
      expect(getRowWindow(grid)?.elements.size).toBe(rendered.length);
    }
  });

  it('retires removed ancestors instead of keeping them for focus', async () => {
    const { grid, scroll } = await fixture();
    const button = grid.querySelector<HTMLButtonElement>('#action-root')!;
    scroll(500);
    button.focus();
    grid.rows = [{ id: 'replacement', height: 24 }];
    await vi.waitFor(() => expect(grid.rows[0].id).toBe('replacement'));
    await vi.waitFor(() => expect(grid.querySelector('#action-root')).toBeNull());
    expect(button.isConnected).toBe(false);
    expect([...getRowWindow(grid)!.elements.values()].some((row) => row.contains(button))).toBe(false);
  });

  it('mounts only capacity-retained ancestors for a deep chain in a small viewport', async () => {
    const { grid, scroll } = await fixture(80, 120);
    scroll(32 + 120 * 24 + 16 + 240);
    const state = grid._virtualization;
    const retained = grid._bodyEl.querySelectorAll(':scope > .tbw-ancestor-retained');
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.length).toBeLessThanOrEqual(7);
    const rendered = grid._bodyEl.querySelectorAll(':scope > .data-grid-row');
    expect(rendered.length).toBe(state.end - state.start + retained.length);
    expect(grid.findRenderedRowElement(0)).toBeNull();
    expect(grid.findRenderedRowElement(120)).not.toBeNull();
  });

  it('retires child scopes on collapse and reacquires them without stale slots on expansion', async () => {
    const { grid, tree, scroll } = await fixture();
    scroll(500);
    const heading = grid.findRenderedRowElement(2)!;
    tree.collapse('branch');
    await vi.waitFor(() => expect(grid.rows).toHaveLength(3));
    expect(heading.isConnected).toBe(false);
    expect(grid.querySelectorAll('.tbw-ancestor-retained')).toHaveLength(0);
    tree.expand('branch');
    await vi.waitFor(() => expect(grid.rows.length).toBeGreaterThan(80));
    scroll(500);
    expect(grid.findRenderedRowElement(2)?.textContent).toBe('Items');
  });

  it('uses actual external intersections and reads header geometry without translating it twice', async () => {
    const owner = document.createElement('div');
    document.body.append(owner);
    Object.defineProperty(owner, 'clientHeight', { value: 140, configurable: true });
    vi.spyOn(owner, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 400, 140));
    const { grid } = await fixture(80, 1, owner);
    const window = getRowWindow(grid);
    if (!(window instanceof ActiveAncestors)) throw new Error('Missing active ancestor owner');
    const header = grid._headerRowEl.closest<HTMLElement>('.header')!;
    const viewport = grid._virtualization.viewportEl!;
    const last = grid._virtualization.positionCache!.at(-1)!;
    const total = last.offset + last.height;
    let tableTop = 300;
    vi.spyOn(header, 'getBoundingClientRect').mockImplementation(
      () =>
        new DOMRect(
          0,
          tableTop -
            owner.scrollTop +
            (Number.parseFloat(header.style.getPropertyValue('--tbw-ancestor-header-shift')) || 0),
          400,
          32,
        ),
    );
    vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, tableTop + 32 - owner.scrollTop, 400, total),
    );
    expect(window.viewport()).toMatchObject({ height: 0, exhausted: false });
    window.select(0, grid.rows.length);
    expect(window.indices).toEqual([]);
    const scrollTo = vi.spyOn(owner, 'scrollTo').mockImplementation(vi.fn());
    window.reveal?.(0, { align: 'start' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 288, behavior: 'instant' });

    grid.style.setProperty('--tbw-animation-enabled', '0');
    window.reveal?.(0, { align: 'start', behavior: 'smooth' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 288, behavior: 'instant' });
    grid.style.setProperty('--tbw-animation-enabled', '1');
    window.reveal?.(0, { align: 'start', behavior: 'smooth' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 288, behavior: 'smooth' });
    window.reveal?.(0, { align: 'nearest' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 224, behavior: 'instant' });
    window.reveal?.(10, { align: 'start' });
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 300 + 32 + grid._virtualization.positionCache![10].offset - (44 + 72),
      behavior: 'instant',
    });

    tableTop = 0;
    owner.scrollTop = 250;
    expect(window.viewport()).toMatchObject({ scrollTop: 262, height: 96, headerShift: 262, exhausted: false });
    const style = header.style.cssText;
    window.viewport();
    expect(header.style.cssText).toBe(style);
    window.layout();
    expect(window.viewport()).toMatchObject({ scrollTop: 262, height: 96, headerShift: 262 });

    owner.scrollTop = total + 32 - 20;
    expect(window.viewport()).toMatchObject({ height: 0, exhausted: false });
    window.select(0, grid.rows.length);
    expect(window.indices).toEqual([]);
    owner.scrollTop = total + 100;
    expect(window.viewport()).toMatchObject({ height: 0, exhausted: false });
    window.select(0, grid.rows.length);
    expect(window.indices).toEqual([]);
    tableTop = 300;
    owner.scrollTop = total + 500;
    window.reveal?.(0, { align: 'start' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 288, behavior: 'instant' });

    Object.defineProperty(owner, 'clientHeight', { value: 20, configurable: true });
    owner.scrollTop = 0;
    expect(window.viewport()).toMatchObject({ height: 0, exhausted: false });
    tableTop = 0;
    expect(window.viewport()).toMatchObject({ height: 0, exhausted: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    window.layout();
    window.layout();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Header/footer leave no usable ancestor viewport'));
  });
});
