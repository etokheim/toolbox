/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RowDragDropPlugin } from './row-drag-drop-plugin';
import type { RowDragDropConfig, RowMoveDetail } from './types';

const H = 30;

interface Row {
  id: string;
  type?: string;
  children?: Row[];
}

/**
 * A host whose body renders one `.data-grid-row` per visible row. happy-dom has
 * no layout, so every row measures as the virtualization height ({@link H}).
 */
function createGrid(rows: Row[], plugins: Record<string, unknown> = {}) {
  const host = document.createElement('tbw-grid');
  const viewport = document.createElement('div');
  viewport.className = 'rows-viewport';
  const body = document.createElement('div');
  body.className = 'rows';
  body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 }) as DOMRect;
  viewport.appendChild(body);
  host.appendChild(viewport);
  const live = document.createElement('div');
  live.className = 'tbw-sr-only';
  host.appendChild(live);
  document.body.appendChild(host);

  const grid = {
    rows,
    sourceRows: rows,
    _hostElement: host,
    _bodyEl: body,
    _virtualization: { enabled: false, start: 0, end: rows.length, rowHeight: H },
    _columns: [],
    gridConfig: {},
    effectiveConfig: { animation: { mode: 'off' } },
    getPlugin: () => undefined,
    getPluginByName: (name: string) => plugins[name],
    queryPlugins: () => [],
    query: vi.fn(() => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn((_e: Event) => true),
    requestRender: vi.fn(),
    refreshVirtualWindow: vi.fn(),
    querySelectorAll: (sel: string) => host.querySelectorAll(sel),
    querySelector: (sel: string) => host.querySelector(sel),
    disconnectSignal: new AbortController().signal,
  };
  const render = (view: Row[]) => {
    body.innerHTML = '';
    view.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'data-grid-row';
      el.innerHTML = `<div class="cell" data-row="${i}" data-col="0"><span>${row.id}</span></div>`;
      body.appendChild(el);
    });
  };
  render(rows);
  return { grid, host, body, render };
}

function setup(rows: Row[], config: RowDragDropConfig<Row> = {}, plugins: Record<string, unknown> = {}) {
  const env = createGrid(rows, plugins);
  const plugin = new RowDragDropPlugin<Row>({
    livePreview: true,
    dragFrom: 'row',
    showDragHandle: false,
    animation: false,
    ...config,
  });
  plugin.attach(env.grid as never);
  return { ...env, plugin };
}

const flat = () => ['a', 'b', 'c', 'd'].map((id) => ({ id }));

const rowEl = (body: HTMLElement, i: number) => body.querySelectorAll<HTMLElement>('.data-grid-row')[i];
const cellOf = (body: HTMLElement, i: number) => rowEl(body, i).querySelector<HTMLElement>('.cell span')!;

function pointer(type: string, target: EventTarget, clientY: number, extra: Record<string, unknown> = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.assign(e, { clientX: 20, clientY, pointerId: 1, pointerType: 'mouse', button: 0, ...extra });
  target.dispatchEvent(e);
  return e;
}

/** Press on row `i` (at its middle) and drag the pointer by `dy`. */
function dragRow(body: HTMLElement, i: number, dy: number) {
  const y = i * H + H / 2;
  const target = cellOf(body, i);
  pointer('pointerdown', target, y);
  pointer('pointermove', target, y + Math.sign(dy) * 7);
  pointer('pointermove', target, y + dy);
  return { target, y: y + dy };
}

const events = (grid: ReturnType<typeof createGrid>['grid'], type: string) =>
  grid.dispatchEvent.mock.calls.map(([e]) => e as CustomEvent).filter((e) => e.type === type);

const announced = (host: HTMLElement) => host.querySelector('.tbw-sr-only')?.textContent ?? '';

interface Meta {
  key: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  parentKey: string | null;
}

/**
 * Tree plugin double over nested rows keyed by `id`. `toggle` flips a parent
 * and hands the new visible rows to `onToggle` (the test decides when the grid
 * re-renders).
 */
function treeOf(top: Row[], collapsed: string[] = []) {
  const closed = new Set(collapsed);
  const meta = new Map<Row, Meta>();
  const byKey = new Map<string, Row>();
  const flatten = () => {
    const view: Row[] = [];
    meta.clear();
    const walk = (list: Row[], parentKey: string | null, depth: number, visible: boolean) => {
      for (const row of list) {
        const kids = row.children ?? [];
        meta.set(row, { key: row.id, depth, hasChildren: kids.length > 0, isExpanded: !closed.has(row.id), parentKey });
        byKey.set(row.id, row);
        if (visible) view.push(row);
        walk(kids, row.id, depth + 1, visible && !closed.has(row.id));
      }
    };
    walk(top, null, 0, true);
    return view;
  };
  const harness = {
    view: flatten(),
    onToggle: (_view: Row[]) => undefined as void,
    plugin: {
      getRowMeta: (row: Row) => meta.get(row),
      getRowByKey: (key: string) => byKey.get(key),
      getChildrenField: () => 'children',
      toggle: vi.fn((key: string) => {
        if (closed.has(key)) closed.delete(key);
        else closed.add(key);
        harness.view = flatten();
        harness.onToggle(harness.view);
      }),
    },
  };
  return harness;
}

/** A tree grid showing `harness.view`; `show` re-renders and runs the plugin's after-render. */
function setupTree(top: Row[], harness: ReturnType<typeof treeOf>, config: RowDragDropConfig<Row> = {}) {
  const env = setup(top, config, { tree: harness.plugin });
  const show = (view: Row[]) => {
    env.grid.rows = view;
    env.render(view);
    env.plugin.afterRender();
  };
  env.grid.rows = harness.view;
  env.render(harness.view);
  return { ...env, show };
}

describe('RowDragDropPlugin livePreview', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('lifts only after the movement threshold', () => {
    const { host, body } = setup(flat());
    const target = cellOf(body, 0);
    pointer('pointerdown', target, 15);
    pointer('pointermove', target, 19);
    expect(rowEl(body, 0).classList.contains('tbw-row-lifted')).toBe(false);
    pointer('pointermove', target, 22);
    expect(rowEl(body, 0).classList.contains('tbw-row-lifted')).toBe(true);
    expect(host.hasAttribute('data-tbw-row-lifting')).toBe(true);
  });

  it('follows the pointer vertically and opens room for the hovered slot', () => {
    const { body, grid } = setup(flat());
    dragRow(body, 0, 2 * H + 6);
    expect(rowEl(body, 0).style.transform).toBe(`translateY(${2 * H + 6}px)`);
    expect(rowEl(body, 1).style.transform).toBe(`translateY(-${H}px)`);
    expect(rowEl(body, 2).style.transform).toBe(`translateY(-${H}px)`);
    expect(rowEl(body, 3).style.transform).toBe('');
    expect(events(grid, 'row-move')).toHaveLength(0);
  });

  it('counts non-data gaps after rows (pinned-rows scoped footers) in slot geometry', () => {
    const { body, grid } = setup(flat());
    // A scoped footer (H tall) follows row b: tops are a 0, b H, c 3H, d 4H.
    const gaps = [0, H, 0, 0];
    let offset = 0;
    (grid._virtualization as Record<string, unknown>).positionCache = gaps.map((after) => {
      const entry = { offset, height: H, measured: true, after };
      offset += H + after;
      return entry;
    });
    const { target, y } = dragRow(body, 0, 3 * H);
    expect(rowEl(body, 2).style.transform).toBe(`translateY(-${H}px)`);
    expect(rowEl(body, 3).style.transform).toBe('');
    pointer('pointerup', target, y);
    vi.runAllTimers();
    expect(grid.rows.map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('clamps the lifted row to the body', () => {
    const { body } = setup(flat());
    const { target } = dragRow(body, 1, 10);
    pointer('pointermove', target, -500);
    expect(rowEl(body, 1).style.transform).toBe(`translateY(-${H}px)`);
    pointer('pointermove', target, 5000);
    expect(rowEl(body, 1).style.transform).toBe(`translateY(${2 * H}px)`);
  });

  it('commits once on release and suppresses the following click', () => {
    const { body, grid } = setup(flat());
    const { target, y } = dragRow(body, 0, 2 * H);
    pointer('pointerup', target, y);
    vi.runAllTimers();

    const moves = events(grid, 'row-move');
    expect(moves).toHaveLength(1);
    const detail = moves[0].detail as RowMoveDetail<Row>;
    expect(detail.rows.map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(detail.fromIndex).toBe(0);
    expect(detail.toIndex).toBe(2);
    expect(detail.targetParent).toBeNull();
    expect(detail.targetIndex).toBe(2);
    expect(grid.rows.map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(body.querySelector('.tbw-row-lifted')).toBeNull();
  });

  it('suppresses the click that follows a drag but not a plain click', () => {
    const { host, body } = setup(flat());
    const onClick = vi.fn();
    host.addEventListener('click', onClick);

    const target = cellOf(body, 0);
    pointer('pointerdown', target, 15);
    pointer('pointerup', target, 15);
    target.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    const end = dragRow(body, 0, 2 * H);
    pointer('pointerup', end.target, end.y);
    end.target.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reverts on Escape without emitting row-move', () => {
    const { body, grid, host } = setup(flat());
    dragRow(body, 0, 2 * H);
    vi.advanceTimersToNextFrame();
    expect(announced(host)).toBe('Picked up 1 row(s).');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersToNextFrame();
    expect(announced(host)).toBe('Move cancelled.');
    vi.runAllTimers();
    expect(events(grid, 'row-move')).toHaveLength(0);
    expect(rowEl(body, 1).style.transform).toBe('');
    expect(host.hasAttribute('data-tbw-row-lifting')).toBe(false);
    expect(grid.rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the room closed on an invalid target, shows the reason and reverts on release', () => {
    const canDropAt = vi.fn(({ index }: { index: number }) => (index === 2 ? { reason: 'Not here' } : true));
    const { body, grid, host } = setup(flat(), { canDropAt });
    const { target } = dragRow(body, 0, H);
    expect(rowEl(body, 1).style.transform).toBe(`translateY(-${H}px)`);

    const y = 2 * H + 15;
    pointer('pointermove', target, y);
    expect(host.hasAttribute('data-tbw-row-drop-invalid')).toBe(true);
    expect(host.querySelector('.tbw-row-drop-reason')?.textContent).toBe('Not here');
    vi.advanceTimersToNextFrame();
    expect(announced(host)).toBe('Not here');
    // The room stays where it last was valid.
    expect(rowEl(body, 1).style.transform).toBe(`translateY(-${H}px)`);
    expect(rowEl(body, 2).style.transform).toBe('');

    pointer('pointerup', target, y);
    vi.runAllTimers();
    expect(events(grid, 'row-move')).toHaveLength(0);
    expect(host.querySelector('.tbw-row-drop-reason')).toBeNull();
  });

  it('holds selection-follows-focus for the whole drag', () => {
    const holdFocusSync = vi.fn();
    const selection = { getSelectedRowIndices: () => [], holdFocusSync };
    const { body, grid } = setup([{ id: 'a' }, { id: 'b' }, { id: 'c' }], {}, { selection });
    const { target, y } = dragRow(body, 0, 2 * H);
    expect(holdFocusSync.mock.calls).toEqual([[true]]);
    pointer('pointerup', target, y);
    vi.runAllTimers();
    expect(events(grid, 'row-move')).toHaveLength(1);
    expect(holdFocusSync.mock.calls).toEqual([[true], [false]]);
  });

  it('moves every selected row of the grabbed type together', () => {
    const rows: Row[] = [
      { id: 'a', type: 'x' },
      { id: 'b', type: 'y' },
      { id: 'c', type: 'x' },
      { id: 'd', type: 'x' },
      { id: 'e', type: 'x' },
    ];
    const selection = { getSelectedRowIndices: () => [0, 1, 2] };
    const { body, grid } = setup(rows, { rowType: (r) => r.type }, { selection });
    const { target, y } = dragRow(body, 0, 3 * H);
    expect(rowEl(body, 0).getAttribute('data-tbw-drag-count')).toBe('2');
    expect(rowEl(body, 1).classList.contains('tbw-row-lifted')).toBe(false);
    pointer('pointerup', target, y);
    vi.runAllTimers();
    const detail = events(grid, 'row-move')[0].detail as RowMoveDetail<Row>;
    expect(detail.movedRows?.map((r) => r.id)).toEqual(['a', 'c']);
    expect(grid.rows.map((r) => r.id)).toEqual(['b', 'd', 'e', 'a', 'c']);
  });

  it('carries a tree parent with its subtree and never drops into it', () => {
    const p1: Row = { id: 'p1' };
    const p: Row = { id: 'p', children: [p1] };
    const q: Row = { id: 'q' };
    const r: Row = { id: 'r' };
    const top = [p, q, r];
    const view = [p, p1, q, r];
    const meta = new Map<
      Row,
      { key: string; depth: number; hasChildren: boolean; isExpanded: boolean; parentKey: string | null }
    >([
      [p, { key: 'p', depth: 0, hasChildren: true, isExpanded: true, parentKey: null }],
      [p1, { key: 'p1', depth: 1, hasChildren: false, isExpanded: false, parentKey: 'p' }],
      [q, { key: 'q', depth: 0, hasChildren: false, isExpanded: false, parentKey: null }],
      [r, { key: 'r', depth: 0, hasChildren: false, isExpanded: false, parentKey: null }],
    ]);
    const byKey = new Map([...meta].map(([row, m]) => [m.key, row]));
    const tree = {
      getRowMeta: (row: Row) => meta.get(row),
      getRowByKey: (key: string) => byKey.get(key),
      getChildrenField: () => 'children',
    };
    const { body, grid } = setup(top, {}, { tree });
    grid.rows = view;
    body.innerHTML = '';
    view.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'data-grid-row';
      el.innerHTML = `<div class="cell" data-row="${i}"><span>${row.id}</span></div>`;
      body.appendChild(el);
    });

    const { target, y } = dragRow(body, 0, 2 * H);
    expect(rowEl(body, 1).classList.contains('tbw-row-lifted')).toBe(true);
    pointer('pointerup', target, y);
    vi.runAllTimers();
    const detail = events(grid, 'row-move')[0].detail as RowMoveDetail<Row>;
    expect(detail.movedRows).toEqual([p]);
    expect(grid.rows.map((x) => x.id)).toEqual(['q', 'r', 'p']);
    expect(p.children).toEqual([p1]);
  });

  it('does not start from interactive elements, opt-out markers or a vetoing guard', () => {
    const shouldStartDrag = vi.fn(() => true);
    const { body } = setup(flat(), { shouldStartDrag });
    const cell = rowEl(body, 0).querySelector('.cell')!;
    const button = document.createElement('button');
    const optOut = document.createElement('span');
    optOut.setAttribute('data-tbw-no-row-drag', '');
    cell.append(button, optOut);

    for (const el of [button, optOut]) {
      pointer('pointerdown', el, 15);
      pointer('pointermove', el, 40);
      pointer('pointerup', el, 40);
      expect(rowEl(body, 0).classList.contains('tbw-row-lifted')).toBe(false);
    }
    expect(shouldStartDrag).not.toHaveBeenCalled();

    shouldStartDrag.mockReturnValue(false);
    const target = cellOf(body, 0);
    pointer('pointerdown', target, 15);
    pointer('pointermove', target, 40);
    expect(shouldStartDrag).toHaveBeenCalledWith(expect.objectContaining({ index: 0, origin: 'row' }));
    expect(rowEl(body, 0).classList.contains('tbw-row-lifted')).toBe(false);
  });

  it('leaves touch and disabled live preview to the native path', () => {
    const touch = setup(flat());
    const target = cellOf(touch.body, 0);
    pointer('pointerdown', target, 15, { pointerType: 'touch' });
    pointer('pointermove', target, 60, { pointerType: 'touch' });
    expect(rowEl(touch.body, 0).classList.contains('tbw-row-lifted')).toBe(false);
    document.body.innerHTML = '';

    const off = setup(flat(), { livePreview: false });
    dragRow(off.body, 0, 2 * H);
    expect(rowEl(off.body, 0).classList.contains('tbw-row-lifted')).toBe(false);
  });

  it('shows the row grab cursor only when the row itself is the drag source', () => {
    const row = setup(flat(), { dragFrom: 'row' });
    row.plugin.afterRender();
    expect(row.host.hasAttribute('data-tbw-row-grab')).toBe(true);
    document.body.innerHTML = '';

    const both = setup(flat(), { dragFrom: 'both' });
    both.plugin.afterRender();
    expect(both.host.hasAttribute('data-tbw-row-grab')).toBe(false);
  });

  it('starts from links and checkboxes, blocking native link drag and swallowing only the drag click', () => {
    const { host, body, grid } = setup(flat(), { dragFrom: 'both' });
    const onClick = vi.fn();
    host.addEventListener('click', onClick);
    const cell = rowEl(body, 0).querySelector('.cell')!;
    const link = document.createElement('a');
    link.href = '#a';
    const box = document.createElement('input');
    box.type = 'checkbox';
    cell.append(link, box);

    pointer('pointerdown', link, 15);
    expect(link.getAttribute('draggable')).toBe('false');
    pointer('pointerup', link, 15);
    expect(link.hasAttribute('draggable')).toBe(false);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);

    for (const el of [link, box]) {
      pointer('pointerdown', el, 15);
      pointer('pointermove', el, 22);
      expect(rowEl(body, 0).classList.contains('tbw-row-lifted')).toBe(true);
      pointer('pointermove', el, 15 + 2 * H);
      pointer('pointerup', el, 15 + 2 * H);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      el.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      vi.runAllTimers();
      grid.rows = flat();
      (grid as { sourceRows: Row[] }).sourceRows = grid.rows;
      // Re-render so the next press starts from a clean row.
      rowEl(body, 0).querySelector('.cell')!.append(link, box);
    }
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(events(grid, 'row-move')).toHaveLength(2);
    expect(link.hasAttribute('draggable')).toBe(false);
  });

  it('drops into an empty parent at index 0', () => {
    const d1: Row = { id: 'd1' };
    const m1: Row = { id: 'm1', children: [d1] };
    const m2: Row = { id: 'm2', children: [] };
    const top = [m1, m2];
    const canDropAt = vi.fn(() => true);
    const { body, grid } = setupTree(top, treeOf(top), { canDropAt });
    const { target, y } = dragRow(body, 1, H);
    expect(canDropAt).toHaveBeenCalledWith(expect.objectContaining({ targetParent: m2, index: 0 }));
    pointer('pointerup', target, y);
    vi.runAllTimers();
    const detail = events(grid, 'row-move')[0].detail as RowMoveDetail<Row>;
    expect(detail.targetParent).toBe(m2);
    expect(detail.targetIndex).toBe(0);
    expect(m1.children).toEqual([]);
    expect(m2.children).toEqual([d1]);
  });

  it('reorders top-level rows of a tree', () => {
    const p1: Row = { id: 'p1' };
    const p: Row = { id: 'p', children: [p1] };
    const q: Row = { id: 'q', children: [] };
    const top = [p, q];
    const { body, grid } = setupTree(top, treeOf(top));
    const { target, y } = dragRow(body, 2, -2 * H);
    pointer('pointerup', target, y);
    vi.runAllTimers();
    const detail = events(grid, 'row-move')[0].detail as RowMoveDetail<Row>;
    expect(detail.targetParent).toBeNull();
    expect(detail.targetIndex).toBe(0);
    expect(grid.rows.map((r) => r.id)).toEqual(['q', 'p']);
  });

  /** Collapsed `p` above `s`, whose child `s1` is dragged into `p`. */
  const collapsedAbove = () => {
    const p1: Row = { id: 'p1' };
    const p: Row = { id: 'p', children: [p1] };
    const s1: Row = { id: 's1' };
    const s: Row = { id: 's', children: [s1] };
    return { p, p1, s, s1, top: [p, s] };
  };

  it('opens a collapsed parent above the source after a rest and keeps the drag', () => {
    const { p, p1, s, s1, top } = collapsedAbove();
    const harness = treeOf(top, ['p']);
    const env = setupTree(top, harness);
    harness.onToggle = env.show;
    const { body, grid, host } = env;
    const { target, y } = dragRow(body, 2, -H);
    vi.advanceTimersByTime(599);
    expect(harness.plugin.toggle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(harness.plugin.toggle).toHaveBeenCalledWith('p');

    expect(grid.rows).toEqual([p, p1, s, s1]);
    expect(host.hasAttribute('data-tbw-row-lifting')).toBe(true);
    expect(rowEl(body, 3).classList.contains('tbw-row-lifted')).toBe(true);
    expect(rowEl(body, 3).style.transform).toBe(`translateY(-${2 * H}px)`);
    expect(rowEl(body, 1).style.transform).toBe(`translateY(${H}px)`);

    // The grabbed cell was re-rendered away; the captured pointer reports to the host.
    expect(target.isConnected).toBe(false);
    pointer('pointerup', host, y);
    vi.runAllTimers();
    const detail = events(grid, 'row-move')[0].detail as RowMoveDetail<Row>;
    expect(detail.targetParent).toBe(p);
    expect(detail.targetIndex).toBe(0);
    expect(p.children).toEqual([s1, p1]);
    expect(s.children).toEqual([]);
  });

  it('commits a release that lands before the expanded rows render', () => {
    const { p, p1, s, s1, top } = collapsedAbove();
    const harness = treeOf(top, ['p']);
    const env = setupTree(top, harness);
    let pending: Row[] | null = null;
    harness.onToggle = (view) => {
      pending = view;
    };
    const { y } = dragRow(env.body, 2, -H);
    vi.advanceTimersByTime(600);
    pointer('pointerup', env.host, y);
    env.show(pending!);
    vi.runAllTimers();
    const detail = events(env.grid, 'row-move')[0].detail as RowMoveDetail<Row>;
    expect(detail.targetParent).toBe(p);
    expect(detail.targetIndex).toBe(0);
    expect(p.children).toEqual([s1, p1]);
    expect(s.children).toEqual([]);
  });

  it('never opens a parent with expandOnHoverDelay: false', () => {
    const { top } = collapsedAbove();
    const harness = treeOf(top, ['p']);
    const env = setupTree(top, harness, { expandOnHoverDelay: false });
    dragRow(env.body, 2, -H);
    vi.advanceTimersByTime(5000);
    expect(harness.plugin.toggle).not.toHaveBeenCalled();
  });

  it('a cancelled row-move reverts', () => {
    const { body, grid } = setup(flat());
    grid.dispatchEvent.mockImplementation((e: Event) => {
      if (e.type === 'row-move') e.preventDefault();
      return true;
    });
    const { target, y } = dragRow(body, 0, 2 * H);
    pointer('pointerup', target, y);
    vi.runAllTimers();
    expect(grid.rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(body.querySelector('.tbw-row-lifted')).toBeNull();
  });
});
