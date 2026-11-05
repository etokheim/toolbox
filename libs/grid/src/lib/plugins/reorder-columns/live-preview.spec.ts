/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReorderPlugin } from './reorder-plugin';
import type { ColumnMoveDetail, ReorderConfig } from './types';

const WIDTH = 100;

/** A host with a header row of 100px cells laid out from x = 0. */
function createGrid(columns: { field: string; lockPosition?: boolean }[]) {
  const host = document.createElement('tbw-grid');
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: columns.length * WIDTH, height: 30 }) as DOMRect;
  const headerRow = document.createElement('div');
  headerRow.className = 'header-row';
  headerRow.getBoundingClientRect = () => ({ left: 0, top: 0, width: columns.length * WIDTH, height: 30 }) as DOMRect;
  columns.forEach((col, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.setAttribute('data-field', col.field);
    cell.getBoundingClientRect = () => ({ left: i * WIDTH, top: 0, width: WIDTH, height: 30 }) as DOMRect;
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

function drag(type: string, target: HTMLElement, clientX = 0, relatedTarget: EventTarget | null = null) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.assign(e, { clientX, relatedTarget });
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

  it('keeps locked columns drop-refusing', () => {
    const { grid, host } = setup(undefined, [{ field: 'a', lockPosition: true }, { field: 'b' }, { field: 'c' }]);
    drag('dragstart', cell(host, 'c'), 250);
    const over = drag('dragover', cell(host, 'a'), 20);

    expect(over.defaultPrevented).toBe(false);
    expect(previewCss()).not.toContain('translateX');
    drag('drop', cell(host, 'a'), 20);
    expect(grid.setColumnOrder).not.toHaveBeenCalled();
  });

  it('ignores drags outside the header rows', () => {
    const { host } = setup();
    const body = document.createElement('div');
    host.appendChild(body);
    drag('dragstart', cell(host, 'a'), 50);
    expect(drag('dragover', body, 280).defaultPrevented).toBe(false);
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
