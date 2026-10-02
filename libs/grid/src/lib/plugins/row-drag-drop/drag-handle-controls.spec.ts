import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { releaseControl } from '../../core/internal/control-lifecycle';
import { lookupDragSession } from '../../core/internal/drag-drop-registry';
import type { ControlView } from '../../core/types';
import { getCurrentDragSession, mimeForZone, TBW_ROW_DRAG_MIME } from '../shared/drag-drop-protocol';
import { TreePlugin } from '../tree/tree-plugin';
import { SelectionPlugin } from '../selection/selection-plugin';
import { ROW_DRAG_HANDLE_FIELD, RowDragDropPlugin } from './row-drag-drop-plugin';
import type { RowDragDropConfig, RowDragHandleContext, RowDragStartDetail } from './types';
import { DragHandleBinding } from './drag-handle-controls';

type Row = { id: string; name: string; children?: Row[] };
const initialRows: Row[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];
const contexts: RowDragHandleContext<Row>[] = [];
const disposals = vi.fn();

function renderer(initial: RowDragHandleContext<Row>): ControlView<RowDragHandleContext<Row>> {
  const element = document.createElement('button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
  element.append(svg);
  initial.bindHandle(element);
  const update = (ctx: RowDragHandleContext<Row>) => {
    contexts.push(ctx);
    element.dataset['id'] = ctx.row.id;
    element.setAttribute('aria-disabled', String(ctx.disabled));
  };
  update(initial);
  return { element, update, dispose: disposals };
}

async function setup(config: RowDragDropConfig<Row> = {}, plugins: (TreePlugin<Row> | SelectionPlugin<Row>)[] = []) {
  const plugin = new RowDragDropPlugin<Row>({ animation: false, debounceMs: 0, ...config });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  grid.gridConfig = { columns: [{ field: 'name' }], plugins: [plugin, ...plugins] };
  grid.rows = initialRows.slice();
  document.body.append(grid);
  await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
  await grid.ready();
  await vi.waitFor(() => expect(grid.querySelector('.rows .cell[data-field="name"]')).not.toBeNull());
  return { grid, plugin };
}

function handle(grid: HTMLElement, id = 'a'): HTMLButtonElement {
  const element = grid.querySelector<HTMLButtonElement>(`button[data-id="${id}"]`);
  if (!element) throw new Error(`Missing handle ${id}`);
  return element;
}

function drag(element: Element) {
  const event = new Event('dragstart', { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

function pickup(element: Element) {
  const transfer = { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() };
  const event = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  element.dispatchEvent(event);
  return { event, transfer };
}

function expectNoPickup(grid: HTMLElement, transfer: ReturnType<typeof pickup>['transfer']) {
  expect(transfer.effectAllowed).toBe('');
  expect(transfer.setData).not.toHaveBeenCalled();
  expect(transfer.setDragImage).not.toHaveBeenCalled();
  expect(getCurrentDragSession()).toBeNull();
  expect(grid.querySelector('.dragging, .tbw-row-drag-clone')).toBeNull();
  expect(grid.classList.contains('tbw-grid--drag-source')).toBe(false);
}

afterEach(() => {
  document.body.innerHTML = '';
  contexts.length = 0;
  disposals.mockClear();
  vi.restoreAllMocks();
});

describe('row drag controls', () => {
  it('activates a non-native root once per Enter or released Space, honoring native cancellation', () => {
    const host = document.createElement('span');
    const root = document.createElement('span');
    host.append(root);
    document.body.append(host);
    const menu = vi.fn();
    const key = vi.fn();
    const close = vi.fn();
    const binding = new DragHandleBinding(
      host,
      host,
      () => true,
      () => false,
      menu,
      key,
      close,
      'Original label',
    );
    binding.bind(root);
    expect(root.getAttribute('role')).toBe('button');
    expect(root.getAttribute('tabindex')).toBe('0');
    const fire = (type: string, key: string, repeat = false) =>
      root.dispatchEvent(new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true }));
    fire('keydown', 'Enter');
    fire('keydown', 'Enter', true);
    expect(menu).toHaveBeenCalledTimes(1);
    fire('keydown', ' ');
    fire('keydown', ' ', true);
    expect(menu).toHaveBeenCalledTimes(1);
    fire('keyup', ' ');
    expect(menu).toHaveBeenCalledTimes(2);
    root.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    fire('keydown', 'Enter');
    expect(menu).toHaveBeenCalledTimes(2);
    fire('keydown', ' ');
    root.dispatchEvent(new Event('focusout', { bubbles: true }));
    fire('keyup', ' ');
    expect(menu).toHaveBeenCalledTimes(2);
    binding.dispose();
    fire('keydown', 'Enter');
    root.click();
    expect(menu).toHaveBeenCalledTimes(2);
    expect(root.hasAttribute('draggable')).toBe(false);
    expect(root.hasAttribute('role')).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('restores owned attributes and rejects foreign controls without taking over their bindings', () => {
    const host = document.createElement('span');
    const first = document.createElement('button');
    const second = document.createElement('button');
    first.setAttribute('draggable', 'auto');
    first.setAttribute('aria-label', 'Consumer label');
    host.append(first, second);
    document.body.append(host);
    const one = new DragHandleBinding(
      host,
      host,
      () => true,
      () => false,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      'Original',
    );
    const two = new DragHandleBinding(
      host,
      host,
      () => true,
      () => false,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      'Original',
    );
    one.bind(first);
    two.bind(second);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    two.bind(first);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(two.element).toBe(second);
    one.dispose();
    expect(first.getAttribute('draggable')).toBe('auto');
    expect(first.getAttribute('aria-label')).toBe('Consumer label');
    second.setAttribute('draggable', 'false');
    two.dispose();
    expect(second.getAttribute('draggable')).toBe('false');
    expect(second.hasAttribute('type')).toBe(false);
  });

  it('preserves omitted markup, width and lazy eligibility; switches visuals without columns rebuild', async () => {
    const canDrag = vi.fn(() => true);
    const { grid, plugin } = await setup({ canDrag });
    const original = grid.querySelector<HTMLElement>('.dg-row-drag-handle');
    expect(original?.outerHTML).toContain('tabindex="-1"');
    expect(original?.getAttribute('role')).toBe('button');
    expect(original?.draggable).toBe(true);
    expect(original?.getAttribute('aria-label')).toBe('Drag to reorder, or activate for move options');
    expect(grid.columns[0].width).toBe(40);
    expect(canDrag).not.toHaveBeenCalled();
    const columns = vi.spyOn(plugin, 'processColumns');
    plugin.setDragHandleRenderer(renderer);
    await vi.waitFor(() => expect(handle(grid).getAttribute('draggable')).toBe('true'));
    expect(columns).not.toHaveBeenCalled();
    plugin.setDragHandleRenderer(undefined);
    await vi.waitFor(() => expect(grid.querySelectorAll('.dg-row-drag-handle')).toHaveLength(3));
    expect(disposals).toHaveBeenCalledTimes(3);
    expect(columns).not.toHaveBeenCalled();
  });

  it('routes nested SVG drag once, respects cancellation and refreshes dragging state', async () => {
    const { grid, plugin } = await setup({ dragHandleRenderer: renderer });
    const start = vi.fn();
    grid.addEventListener('row-drag-start', start);
    const button = handle(grid);
    const path = button.querySelector('path');
    if (!path) throw new Error('Missing SVG path');
    const cancel = (event: Event) => event.preventDefault();
    grid.addEventListener('row-drag-start', cancel);
    expect(drag(path).defaultPrevented).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(grid.classList.contains('tbw-grid--drag-source')).toBe(false);
    grid.removeEventListener('row-drag-start', cancel);
    drag(path);
    expect(start).toHaveBeenCalledTimes(2);
    plugin.afterRender();
    expect(contexts.at(-3)?.dragging).toBe(true);
    button.dispatchEvent(new Event('dragend', { bubbles: true }));
    plugin.afterRender();
    expect(contexts.at(-3)?.dragging).toBe(false);
  });

  it('honors native cancellation, disabled buttons, live predicates and nested independent controls', async () => {
    let allowed = true;
    const { grid, plugin } = await setup({ dragHandleRenderer: renderer, canDrag: () => allowed, dragFrom: 'both' });
    const start = vi.fn();
    grid.addEventListener('row-drag-start', start);
    const button = handle(grid);
    button.addEventListener('dragstart', (event) => event.preventDefault(), { once: true });
    drag(button);
    expect(start).not.toHaveBeenCalled();
    button.disabled = true;
    expect(drag(button).defaultPrevented).toBe(true);
    button.disabled = false;
    const input = document.createElement('input');
    button.append(input);
    expect(drag(input).defaultPrevented).toBe(true);
    allowed = false;
    plugin.afterRender();
    expect(button.getAttribute('draggable')).toBe('false');
    expect(drag(button).defaultPrevented).toBe(true);
    button.click();
    expect(grid.querySelector('.tbw-row-move-menu')).toBeNull();
    allowed = true;
    plugin.afterRender();
    expect(button.getAttribute('draggable')).toBe('true');
  });

  it.each(['native cancellation', 'renderer replacement', 'recycled row', 'nested control'] as const)(
    'rejects %s before policy, payload or session mutation in row-and-handle mode',
    async (reason) => {
      const canDrag = vi.fn(() => true);
      const serializeRow = vi.fn((row: Row) => row);
      const { grid, plugin } = await setup({ dragHandleRenderer: renderer, dragFrom: 'both', canDrag, serializeRow });
      const button = handle(grid);
      const start = vi.fn();
      grid.addEventListener('row-drag-start', start);
      canDrag.mockClear();
      let target: Element = button;
      if (reason === 'native cancellation') {
        button.addEventListener('dragstart', (event) => event.preventDefault(), { once: true });
      } else if (reason === 'renderer replacement') {
        plugin.setDragHandleRenderer((ctx) => renderer(ctx));
      } else if (reason === 'recycled row') {
        const cell = button.closest<HTMLElement>('.cell');
        if (!cell) throw new Error('Missing cell');
        cell.dataset['row'] = '1';
      } else {
        target = document.createElement('input');
        button.append(target);
      }
      const { event, transfer } = pickup(target);
      expect(event.defaultPrevented).toBe(true);
      expect(canDrag).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      expect(serializeRow).not.toHaveBeenCalled();
      expectNoPickup(grid, transfer);
    },
  );

  it('cancels and disposes the binding before serialization without leaving session or menu state', async () => {
    const serializeRow = vi.fn((row: Row) => row);
    const { grid } = await setup({ dragHandleRenderer: renderer, serializeRow });
    const button = handle(grid);
    button.click();
    expect(grid.querySelector('.tbw-row-move-menu')).not.toBeNull();
    const cell = button.closest<HTMLElement>('.cell');
    if (!cell) throw new Error('Missing control cell');
    const start = vi.fn((event: Event) => {
      expect(getCurrentDragSession()).toBeNull();
      expect(grid.classList.contains('tbw-grid--drag-source')).toBe(false);
      event.preventDefault();
      releaseControl(cell);
    });
    grid.addEventListener('row-drag-start', start);
    const { event, transfer } = pickup(button);
    expect(event.defaultPrevented).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(serializeRow).not.toHaveBeenCalled();
    expectNoPickup(grid, transfer);
    expect(button.hasAttribute('draggable')).toBe(false);
    expect(grid.querySelector<HTMLElement>('.tbw-row-move-menu')?.hidden).toBe(true);
    const retry = pickup(button);
    expect(start).toHaveBeenCalledTimes(1);
    expectNoPickup(grid, retry.transfer);
  });

  it.each([false, true])('rechecks canDrag before emission with custom handles=%s', async (custom) => {
    let checks: number | undefined;
    const { grid } = await setup({
      dragHandleRenderer: custom ? renderer : undefined,
      canDrag: () => checks === undefined || ++checks === (custom ? 1 : 0),
    });
    checks = 0;
    const target = custom ? handle(grid) : grid.querySelector('.dg-row-drag-handle');
    if (!target) throw new Error('Missing drag handle');
    const start = vi.fn();
    grid.addEventListener('row-drag-start', start);
    const { event, transfer } = pickup(target);
    expect(event.defaultPrevented).toBe(true);
    expect(checks).toBe(custom ? 2 : 1);
    expect(start).not.toHaveBeenCalled();
    expectNoPickup(grid, transfer);
  });

  it('publishes a custom copy payload only after the cancelable event and clears it on dragend', async () => {
    const order: string[] = [];
    const { grid, plugin } = await setup({
      dragHandleRenderer: renderer,
      operation: 'copy',
      dropZone: 'shared',
      serializeRow: (row) => {
        order.push('serialize');
        expect(grid.classList.contains('tbw-grid--drag-source')).toBe(false);
        return { ...row };
      },
    });
    const start = vi.fn(() => {
      order.push('event');
      expect(getCurrentDragSession()).toBeNull();
      expect(grid.classList.contains('tbw-grid--drag-source')).toBe(false);
    });
    grid.addEventListener('row-drag-start', start);
    const button = handle(grid);
    const { event, transfer } = pickup(button);
    expect(event.defaultPrevented).toBe(false);
    expect(order).toEqual(['event', 'serialize']);
    expect(transfer.effectAllowed).toBe('copyMove');
    expect(transfer.setData.mock.calls.map(([type]) => type)).toEqual([
      TBW_ROW_DRAG_MIME,
      mimeForZone('shared'),
      'text/plain',
    ]);
    const session = getCurrentDragSession<Row>();
    if (!session) throw new Error('Missing drag session');
    expect(session.payload.operation).toBe('copy');
    expect(lookupDragSession(session.sessionId)?.[0]).toBe(grid.rows[0]);
    plugin.afterRender();
    expect(contexts.filter((ctx) => ctx.row.id === 'a').at(-1)?.dragging).toBe(true);
    button.dispatchEvent(new Event('dragend', { bubbles: true }));
    plugin.afterRender();
    expect(getCurrentDragSession()).toBeNull();
    expect(lookupDragSession(session.sessionId)).toBeUndefined();
    expect(contexts.filter((ctx) => ctx.row.id === 'a').at(-1)?.dragging).toBe(false);
    expect(grid.classList.contains('tbw-grid--drag-source')).toBe(false);
  });

  it('opens one menu without selecting a row; Ctrl moves the bound row and menu actions revalidate', async () => {
    const selection = new SelectionPlugin<Row>({ mode: 'row' });
    const { grid } = await setup({ dragHandleRenderer: renderer }, [selection]);
    const selected = vi.fn();
    const moves = vi.fn();
    grid.addEventListener('selection-change', selected);
    grid.addEventListener('row-move', moves);
    handle(grid, 'b').click();
    expect(grid.querySelectorAll('.tbw-row-move-menu')).toHaveLength(1);
    expect(selected).not.toHaveBeenCalled();
    grid
      .querySelector('.tbw-row-move-menu button')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(selected).not.toHaveBeenCalled();
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, bubbles: true, cancelable: true });
    handle(grid, 'b').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(moves).toHaveBeenCalledTimes(1));
    expect(grid.rows[0].id).toBe('b');
    expect(selected).not.toHaveBeenCalled();
  });

  it('retains the selected payload and existing move/drop policy', async () => {
    const selection = new SelectionPlugin<Row>({ mode: 'row' });
    const { grid, plugin } = await setup({ dragHandleRenderer: renderer, canDrop: () => false }, [selection]);
    vi.spyOn(selection, 'getSelectedRowIndices').mockReturnValue([0, 1]);
    const start = vi.fn((_event: CustomEvent<RowDragStartDetail<Row>>) => undefined);
    grid.addEventListener('row-drag-start', start);
    drag(handle(grid));
    expect(start.mock.calls[0][0].detail.rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect(plugin.canMoveRow(0, 2)).toBe(false);
    handle(grid).dispatchEvent(new Event('dragend', { bubbles: true }));
  });

  it('honors consumer-owned sorted-view policy without adding a library sorting restriction', async () => {
    let isSorted = () => false;
    const { grid, plugin } = await setup({
      dragHandleRenderer: renderer,
      canDrag: () => !isSorted(),
      canDrop: () => !isSorted(),
    });
    isSorted = () => grid.sortModel !== null;
    grid.sort('name', 'desc');
    await vi.waitFor(() => expect(handle(grid, 'c').getAttribute('aria-disabled')).toBe('true'));
    expect(grid.rows[0].id).toBe('c');
    expect(drag(handle(grid, 'c')).defaultPrevented).toBe(true);
    handle(grid, 'c').click();
    expect(grid.querySelector('.tbw-row-move-menu')).toBeNull();
    expect(plugin.canMoveRow(0, 1)).toBe(false);
    handle(grid, 'c').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(grid.rows.map((row) => row.id)).toEqual(['c', 'b', 'a']);
    grid.sort(null);
    await vi.waitFor(() => expect(handle(grid).getAttribute('aria-disabled')).toBe('false'));
    handle(grid).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(grid.rows.map((row) => row.id)).toEqual(['b', 'a', 'c']));
  });

  it('revokes replaced callbacks before stale ref-null/dispose and releases only its cleanup owner', async () => {
    const { grid, plugin } = await setup({ dragHandleRenderer: renderer });
    const old = contexts[0];
    const oldButton = handle(grid);
    plugin.setDragHandleRenderer((ctx) => renderer(ctx));
    await vi.waitFor(() => expect(disposals).toHaveBeenCalledTimes(3));
    const next = handle(grid);
    expect(next).not.toBe(oldButton);
    old.bindHandle(null);
    old.bindHandle(oldButton);
    expect(next.getAttribute('draggable')).toBe('true');
    next.click();
    const menuAction = grid.querySelector<HTMLButtonElement>('.tbw-row-move-menu button:nth-child(2)');
    const cell = next.closest<HTMLElement>('.cell');
    if (!cell || !menuAction) throw new Error('Missing menu/cell');
    releaseControl(cell);
    menuAction.click();
    expect(grid.rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(next.hasAttribute('draggable')).toBe(false);
  });

  it('keeps Tree and drag owners independent when omitted treeColumn wraps the utility', async () => {
    const treeDispose = vi.fn();
    const tree = new TreePlugin<Row>({
      disclosureRenderer: () => ({ element: document.createElement('button'), update: vi.fn(), dispose: treeDispose }),
    });
    const { grid, plugin } = await setup({ dragHandleRenderer: renderer }, [tree]);
    grid.rows = [{ ...initialRows[0], children: [{ id: 'child', name: 'Child' }] }];
    await vi.waitFor(() => expect(handle(grid).closest('.tree-cell-wrapper')).not.toBeNull());
    treeDispose.mockClear();
    plugin.setDragHandleRenderer(() => null);
    await vi.waitFor(() => expect(grid.querySelectorAll('button[data-id]')).toHaveLength(0));
    expect(treeDispose).not.toHaveBeenCalled();
    grid.remove();
    expect(treeDispose).toHaveBeenCalled();
  });

  it.each(['null', 'throw', 'undefined'] as const)(
    'revokes bind-before-%s output without default fallback',
    async (output) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const detached: HTMLElement[] = [];
      const { grid } = await setup({
        dragHandleRenderer: (ctx) => {
          const element = document.createElement('button');
          detached.push(element);
          ctx.bindHandle(element);
          if (output === 'throw') throw new Error('renderer failed');
          if (output === 'undefined') return undefined as never;
          return null;
        },
      });
      expect(grid.querySelector('.dg-row-drag-handle')).toBeNull();
      expect(detached.every((element) => !element.hasAttribute('draggable'))).toBe(true);
      if (output !== 'null') expect(warning).toHaveBeenCalled();
    },
  );

  it('updates persistent views for row replacement and clears them on column rebuild/detach', async () => {
    const { grid, plugin } = await setup({ dragHandleRenderer: renderer });
    const button = handle(grid);
    grid.rows = [{ id: 'a', name: 'Changed' }, ...initialRows.slice(1)];
    await vi.waitFor(() => expect(contexts.some((ctx) => ctx.row.name === 'Changed')).toBe(true));
    expect(handle(grid)).toBe(button);
    grid.columns = [{ field: 'name', width: 150 }];
    await grid.ready();
    await vi.waitFor(() => expect(grid.columns.some((column) => column.field === ROW_DRAG_HANDLE_FIELD)).toBe(true));
    plugin.detach();
    expect(button.hasAttribute('draggable')).toBe(false);
  });
});
