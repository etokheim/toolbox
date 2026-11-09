/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nearestSlot } from './column-drag';
import { ReorderPlugin } from './reorder-plugin';
import type { ColumnMoveDetail, ReorderConfig } from './types';

const WIDTH = 100;

/** A host with a header row of cells (100px unless given) laid out from x = 0. */
function createGrid(columns: { field: string; lockPosition?: boolean; width?: number }[]) {
  const widths = columns.map((c) => c.width ?? WIDTH);
  const total = widths.reduce((a, b) => a + b, 0);
  const host = document.createElement('tbw-grid');
  host.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 300, width: total, height: 300 }) as DOMRect;
  const headerRow = document.createElement('div');
  headerRow.className = 'header-row';
  headerRow.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 30, width: total, height: 30 }) as DOMRect;
  let x = 0;
  columns.forEach((col, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.setAttribute('data-field', col.field);
    const left = x;
    x += widths[i];
    cell.getBoundingClientRect = () => ({ left, top: 0, bottom: 30, width: widths[i], height: 30 }) as DOMRect;
    headerRow.appendChild(cell);
  });
  host.appendChild(headerRow);
  document.body.appendChild(host);

  const order = columns.map((c) => c.field);
  const grid = {
    columns,
    _visibleColumns: columns,
    _hostElement: host,
    gridConfig: {},
    effectiveConfig: {},
    getPlugin: () => undefined,
    getPluginByName: () => undefined,
    query: vi.fn(() => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn((_e: Event) => true),
    requestRender: vi.fn(),
    requestStateChange: vi.fn(),
    requestAfterRender: vi.fn(),
    setColumnOrder: vi.fn((next: string[]) => order.splice(0, order.length, ...next)),
    getColumnOrder: vi.fn(() => [...order]),
    querySelectorAll: (sel: string) => host.querySelectorAll(sel),
    querySelector: (sel: string) => host.querySelector(sel),
    disconnectSignal: new AbortController().signal,
  };
  return { grid, host };
}

function setup(config: ReorderConfig = { livePreview: true, animation: false }, columns = defaultColumns) {
  const { grid, host } = createGrid(columns);
  const plugin = new ReorderPlugin(config);
  plugin.attach(grid as never);
  plugin.afterRender();
  return { grid, host, plugin };
}

const defaultColumns = [{ field: 'a' }, { field: 'b' }, { field: 'c' }, { field: 'd' }];

const cell = (host: HTMLElement, field: string) =>
  host.querySelector(`.header-row > .cell[data-field="${field}"]`) as HTMLElement;

function drag(type: string, target: HTMLElement, clientX = 0, relatedTarget: EventTarget | null = null, clientY = 10) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.assign(e, { clientX, clientY, relatedTarget });
  Object.defineProperty(e, 'dataTransfer', {
    value: { effectAllowed: '', dropEffect: 'none', setData: vi.fn(), setDragImage: vi.fn() },
  });
  target.dispatchEvent(e);
  return e;
}

const previewCss = () => [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n');
const moveEvents = (grid: ReturnType<typeof createGrid>['grid']) =>
  grid.dispatchEvent.mock.calls
    .map(([e]) => e as CustomEvent<ColumnMoveDetail>)
    .filter((e) => e.type === 'column-move');

describe('ReorderPlugin livePreview', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('translates cells to the hovered order without emitting anything', () => {
    const { grid, host } = setup();
    drag('dragstart', cell(host, 'a'), 50);
    const over = drag('dragover', cell(host, 'd'), 380);

    expect(over.defaultPrevented).toBe(true);
    expect(host.hasAttribute('data-tbw-reorder-preview')).toBe(true);
    const css = previewCss();
    expect(css).toMatch(/\.cell\[data-field="a"\][^{]*\{transform:translateX\(300px\)\}/);
    expect(css).toMatch(/\.cell\[data-field="b"\][^{]*\{transform:translateX\(-100px\)\}/);
    expect(grid.dispatchEvent).not.toHaveBeenCalled();
    expect(grid.setColumnOrder).not.toHaveBeenCalled();
  });

  it('persists the previewed order once, on drop', () => {
    const { grid, host } = setup();
    drag('dragstart', cell(host, 'a'), 50);
    drag('dragover', cell(host, 'd'), 380);
    drag('drop', cell(host, 'd'), 380);
    drag('dragend', cell(host, 'a'), 380);

    const [move] = moveEvents(grid);
    expect(moveEvents(grid)).toHaveLength(1);
    expect(move.detail).toEqual({ field: 'a', fromIndex: 0, toIndex: 3, columnOrder: ['b', 'c', 'd', 'a'] });
    expect(grid.setColumnOrder).toHaveBeenCalledWith(['b', 'c', 'd', 'a']);
    expect(grid.requestStateChange).toHaveBeenCalledTimes(1);
    expect(host.hasAttribute('data-tbw-reorder-preview')).toBe(false);
    expect(previewCss()).toBe('');
  });

  it('rolls back on a vetoed column-move', () => {
    const { grid, host } = setup();
    grid.dispatchEvent.mockImplementation((e: Event) => {
      e.preventDefault();
      return false;
    });
    drag('dragstart', cell(host, 'a'), 50);
    drag('dragover', cell(host, 'c'), 280);
    drag('drop', cell(host, 'c'), 280);

    expect(moveEvents(grid)).toHaveLength(1);
    expect(grid.setColumnOrder).not.toHaveBeenCalled();
    expect(grid.requestStateChange).not.toHaveBeenCalled();
    expect(host.hasAttribute('data-tbw-reorder-preview')).toBe(false);
  });

  it('rolls back without events when the drag ends without a drop (Escape)', () => {
    const { grid, host } = setup();
    drag('dragstart', cell(host, 'a'), 50);
    drag('dragover', cell(host, 'c'), 280);
    drag('dragend', cell(host, 'a'), 280);

    expect(grid.dispatchEvent).not.toHaveBeenCalled();
    expect(grid.setColumnOrder).not.toHaveBeenCalled();
    expect(host.hasAttribute('data-tbw-reorder-preview')).toBe(false);
    expect(previewCss()).toBe('');
  });

  it('slides back over the animation duration when animated', () => {
    vi.useFakeTimers();
    try {
      const { host } = setup({ livePreview: true, animation: 'flip', animationDuration: 100 });
      drag('dragstart', cell(host, 'a'), 50);
      drag('dragover', cell(host, 'c'), 280);
      expect(previewCss()).toContain('transition:transform 100ms');
      drag('dragend', cell(host, 'a'), 280);
      expect(previewCss()).not.toContain('translateX');
      expect(host.hasAttribute('data-tbw-reorder-preview')).toBe(true);
      vi.advanceTimersByTime(200);
      expect(host.hasAttribute('data-tbw-reorder-preview')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a release back on the dragged slot as a no-op', () => {
    const { grid, host } = setup();
    drag('dragstart', cell(host, 'b'), 150);
    drag('dragover', cell(host, 'c'), 280);
    drag('dragover', cell(host, 'b'), 150);
    drag('drop', cell(host, 'b'), 150);

    expect(grid.dispatchEvent).not.toHaveBeenCalled();
    expect(grid.setColumnOrder).not.toHaveBeenCalled();
  });

  it('never moves a locked column, even with the pointer over it', () => {
    const { grid, host } = setup(undefined, [{ field: 'a', lockPosition: true }, { field: 'b' }, { field: 'c' }]);
    drag('dragstart', cell(host, 'c'), 250);
    const over = drag('dragover', cell(host, 'a'), 20);

    expect(over.defaultPrevented).toBe(true);
    expect(previewCss()).not.toMatch(/data-field="a"/);
    drag('drop', cell(host, 'a'), 20);
    expect(grid.setColumnOrder).toHaveBeenCalledWith(['a', 'c', 'b']);
  });

  it('rests at the original order while the pointer is outside the header lane', () => {
    const { grid, host } = setup();
    const body = document.createElement('div');
    host.appendChild(body);
    drag('dragstart', cell(host, 'a'), 50);
    drag('dragover', cell(host, 'c'), 280);
    expect(previewCss()).toContain('translateX');
    expect(drag('dragover', body, 280, null, 120).defaultPrevented).toBe(false);
    expect(previewCss()).not.toContain('translateX');
    drag('drop', body, 280, null, 120);
    expect(grid.setColumnOrder).not.toHaveBeenCalled();
  });

  it('picks the slot from geometry, not from the element under the pointer', () => {
    const { host } = setup();
    const gap = host.querySelector('.header-row') as HTMLElement;
    drag('dragstart', cell(host, 'a'), 50);
    drag('dragover', gap, 280);
    expect(previewCss()).toMatch(/\.cell\[data-field="a"\][^{]*\{transform:translateX\(200px\)\}/);
  });

  it('leaves the classic drop indicator untouched when off', () => {
    const { grid, host } = setup({ animation: false });
    drag('dragstart', cell(host, 'a'), 50);
    drag('dragover', cell(host, 'c'), 280);

    expect(host.hasAttribute('data-tbw-reorder-preview')).toBe(false);
    expect(cell(host, 'c').classList.contains('drop-after')).toBe(true);
    drag('drop', cell(host, 'c'), 280);
    expect(grid.setColumnOrder).toHaveBeenCalledWith(['b', 'c', 'a', 'd']);
  });
});

describe('ReorderPlugin classic drag fixes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('drops nothing after hovering back over the dragged column', () => {
    const { grid, host } = setup({ animation: false });
    drag('dragstart', cell(host, 'a'), 50);
    drag('dragover', cell(host, 'c'), 280);
    drag('dragover', cell(host, 'a'), 50);
    drag('drop', cell(host, 'a'), 50);

    expect(grid.setColumnOrder).not.toHaveBeenCalled();
  });

  it('keeps the indicator while the pointer crosses into a child element', () => {
    const { host } = setup({ animation: false });
    const target = cell(host, 'c');
    const child = document.createElement('span');
    target.appendChild(child);
    drag('dragstart', cell(host, 'a'), 50);
    drag('dragover', target, 280);
    drag('dragleave', target, 280, child);

    expect(target.classList.contains('drop-after')).toBe(true);
    drag('dragleave', target, 280, document.body);
    expect(target.classList.contains('drop-after')).toBe(false);
  });
});

describe('nearestSlot', () => {
  const slots = [0, 100, 200, 300];
  const all = [true, true, true, true];

  it('keeps the current slot until another wins by more than the hysteresis', () => {
    expect(nearestSlot(slots, all, 53, 0, 8)).toBe(0);
    expect(nearestSlot(slots, all, 55, 1, 8)).toBe(1);
    expect(nearestSlot(slots, all, 55, 0, 8)).toBe(1);
    expect(nearestSlot(slots, all, 47, 1, 8)).toBe(1);
    expect(nearestSlot(slots, all, 45, 1, 8)).toBe(0);
  });

  it('skips refused slots', () => {
    expect(nearestSlot(slots, [true, false, true, true], 90, 0, 8)).toBe(0);
    expect(nearestSlot(slots, [true, false, true, true], 160, 0, 8)).toBe(2);
  });
});

/** Pointer event on `target`; happy-dom does not route capture, so events go straight to the header. */
function pointer(type: string, target: HTMLElement, clientX: number, extra: Record<string, unknown> = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.assign(e, { clientX, clientY: 10, pointerId: 1, pointerType: 'mouse', button: 0, ...extra });
  target.dispatchEvent(e);
  return e;
}

function capturable(el: HTMLElement) {
  let captured = false;
  el.setPointerCapture = () => (captured = true);
  el.hasPointerCapture = () => captured;
  el.releasePointerCapture = () => (captured = false);
  return el;
}

describe('ReorderPlugin livePreview pointer lift', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('lifts the header itself and refuses the native drag image', () => {
    const { host } = setup();
    const a = capturable(cell(host, 'a'));
    pointer('pointerdown', a, 50);
    expect(drag('dragstart', a, 50).defaultPrevented).toBe(true);
    pointer('pointermove', a, 70);

    expect(a.classList.contains('tbw-reorder-lifted')).toBe(true);
    expect(a.classList.contains('dragging')).toBe(false);
    expect(host.hasAttribute('data-tbw-reorder-lifting')).toBe(true);
    expect(a.style.transform).toBe('translateX(20px)');
  });

  it('follows the pointer horizontally only, clamped to the header lane', () => {
    const { host } = setup();
    const b = capturable(cell(host, 'b'));
    pointer('pointerdown', b, 150);
    pointer('pointermove', b, -500, { clientY: 400 });
    expect(b.style.transform).toBe('translateX(-100px)');
    pointer('pointermove', b, 5000, { clientY: -400 });
    expect(b.style.transform).toBe('translateX(200px)');
  });

  it('reorders when the threshold is passed and commits once on release', () => {
    const { grid, host } = setup();
    const a = capturable(cell(host, 'a'));
    pointer('pointerdown', a, 50);
    pointer('pointermove', a, 95);
    expect(previewCss()).not.toContain('translateX');
    pointer('pointermove', a, 115);
    expect(previewCss()).toMatch(/\.cell\[data-field="b"\][^{]*\{transform:translateX\(-100px\)\}/);
    expect(grid.dispatchEvent).not.toHaveBeenCalled();
    pointer('pointerup', a, 115);

    expect(moveEvents(grid)).toHaveLength(1);
    expect(grid.setColumnOrder).toHaveBeenCalledWith(['b', 'a', 'c', 'd']);
    expect(a.classList.contains('tbw-reorder-lifted')).toBe(false);
    expect(a.style.transform).toBe('');
    expect(host.hasAttribute('data-tbw-reorder-lifting')).toBe(false);
  });

  it('does not oscillate when a wide column passes a narrow one', () => {
    const { host } = setup(undefined, [{ field: 'a' }, { field: 'b' }, { field: 'c' }, { field: 'd', width: 300 }]);
    const d = capturable(cell(host, 'd'));
    pointer('pointerdown', d, 450);
    const orders: string[] = [];
    for (let x = 450; x >= 150; x -= 5) {
      pointer('pointermove', d, x);
      const moved = previewCss().match(/data-field="d"[^{]*\{transform:translateX\((-?\d+)px\)/)?.[1] ?? '0';
      if (orders.at(-1) !== moved) orders.push(moved);
    }
    expect(orders).toEqual(['0', '-100', '-200', '-300']);
  });

  it('swallows the click that ends the drag so the header does not sort', () => {
    const { host } = setup();
    const a = capturable(cell(host, 'a'));
    const sort = vi.fn();
    a.addEventListener('click', sort);
    pointer('pointerdown', a, 50);
    pointer('pointermove', a, 150);
    pointer('pointerup', a, 150);
    a.click();
    expect(sort).not.toHaveBeenCalled();
  });

  it('slides back without events on Escape', () => {
    const { grid, host } = setup();
    const a = capturable(cell(host, 'a'));
    pointer('pointerdown', a, 50);
    pointer('pointermove', a, 250);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(grid.dispatchEvent).not.toHaveBeenCalled();
    expect(a.classList.contains('tbw-reorder-lifted')).toBe(false);
    expect(previewCss()).not.toContain('translateX');
    pointer('pointerup', a, 250);
    expect(grid.setColumnOrder).not.toHaveBeenCalled();
  });

  it('settles into the slot over the animation before committing', () => {
    vi.useFakeTimers();
    try {
      const { grid, host } = setup({ livePreview: true, animation: 'flip', animationDuration: 100 });
      const a = capturable(cell(host, 'a'));
      pointer('pointerdown', a, 50);
      pointer('pointermove', a, 160);
      pointer('pointerup', a, 160);
      expect(a.style.transform).toBe('translateX(100px)');
      expect(a.style.transition).toContain('100ms');
      expect(grid.setColumnOrder).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(grid.setColumnOrder).toHaveBeenCalledWith(['b', 'a', 'c', 'd']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves touch on the native drag', () => {
    const { host } = setup();
    const a = capturable(cell(host, 'a'));
    pointer('pointerdown', a, 50, { pointerType: 'touch' });
    expect(drag('dragstart', a, 50).defaultPrevented).toBe(false);
  });
});
