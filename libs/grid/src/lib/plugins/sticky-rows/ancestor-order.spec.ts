import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridElement } from '../../core/plugin/base-plugin';
import type { RowElementInternal } from '../../core/types';
import { ActiveAncestors } from './active-ancestors';

function fixture(moveBefore: boolean) {
  const body = document.createElement('div');
  body.className = 'rows';
  document.body.append(body);
  const rows = Array.from({ length: 60 }, (_, id) => ({ id: String(id) }));
  const grid = document.createElement('tbw-order-fixture') as GridElement;
  Object.assign(grid, {
    _rows: rows,
    _rowPool: [] as RowElementInternal[],
    _bodyEl: body,
    __rowRenderEpoch: 0,
    effectiveConfig: { getRowId: (row: { id: string }) => row.id },
    getPluginByName: () => undefined,
    _virtualization: {
      start: 0,
      end: 60,
      rowHeight: 24,
      container: document.createElement('div'),
      viewportEl: document.createElement('div'),
      scrollMapping: { capped: false, spacerHeight: 1440, rawContentHeight: 1440, viewportHeight: 240 },
    },
  });
  const controller = new AbortController();
  const window = new ActiveAncestors(grid, { mode: 'ancestors', isSticky: () => false }, controller.signal);
  const moves: Element[] = [];
  const insert = body.insertBefore.bind(body);
  if (moveBefore) {
    // happy-dom has no atomic move API; this branch verifies dispatch and move targets.
    Object.defineProperty(body, 'moveBefore', {
      configurable: true,
      value: (node: Element, anchor: Element | null) => {
        moves.push(node);
        insert(node, anchor);
      },
    });
  } else {
    Object.defineProperty(body, 'moveBefore', { configurable: true, value: undefined });
    vi.spyOn(body, 'insertBefore').mockImplementation((node, anchor) => {
      if (node instanceof Element) moves.push(node);
      return insert(node, anchor);
    });
  }
  const render = (indices: number[]) => {
    window.select(0, grid._rows.length);
    window.indices = indices;
    const pool = window.reconcile(grid._rowPool, () => {
      const element = document.createElement('div') as RowElementInternal;
      element.className = 'data-grid-row';
      const input = document.createElement('input');
      input.value = 'draft';
      element.append(input);
      return element;
    });
    for (const element of pool.slice(indices.length)) element.remove();
    grid._rowPool = pool.slice(0, indices.length);
    for (let i = 0; i < indices.length; i++) {
      const element = grid._rowPool[i];
      element.__rowDataRef = grid._rows[indices[i]];
      element.dataset.id = String((element.__rowDataRef as { id: string }).id);
      if (element.parentNode !== body) body.append(element);
    }
    window.layout();
  };
  const order = () =>
    Array.from(body.children)
      .filter((child) => child.classList.contains('data-grid-row'))
      .map((child) => (child as HTMLElement).dataset.id);
  return { body, grid, window, controller, moves, render, order };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe.each([true, false])('ancestor DOM ordering (moveBefore=%s)', (moveBefore) => {
  it('moves only three entrants, not the 25-row retained suffix, on reverse advance', () => {
    const { body, render, order, moves, controller } = fixture(moveBefore);
    const range = (start: number, end: number) => Array.from({ length: end - start }, (_, i) => start + i);
    render([9, 10, ...range(14, 41)]);
    const retained = new Map(Array.from(body.children).map((row) => [(row as HTMLElement).dataset.id, row]));
    const observer = new MutationObserver(() => undefined);
    observer.observe(body, { childList: true });
    moves.length = 0;
    render([9, 10, ...range(11, 39)]);
    const records = observer.takeRecords();
    observer.disconnect();
    expect(order()).toEqual([9, 10, ...range(11, 39)].map(String));
    const overlapping = new Set([9, 10, ...range(14, 39)].map((id) => retained.get(String(id))));
    expect(moves.filter((row) => overlapping.has(row))).toEqual([]);
    expect(moves.map((row) => (row as HTMLElement).dataset.id)).toEqual(['13', '12', '11']);
    expect(
      records.flatMap((record) => Array.from(record.removedNodes)).filter((row) => overlapping.has(row as Element)),
    ).toEqual([]);
    for (const row of overlapping) expect(row?.parentNode).toBe(body);
    moves.length = 0;
    render([9, 10, ...range(14, 41)]);
    expect(order()).toEqual([9, 10, ...range(14, 41)].map(String));
    expect(moves).toEqual([]);
    controller.abort();
  });

  it.each([
    [
      [4, 5, 6],
      [1, 2, 4, 5, 6],
    ],
    [
      [4, 5, 6],
      [4, 5, 6, 8, 9],
    ],
    [
      [4, 6, 8],
      [2, 4, 5, 6, 7, 8, 10],
    ],
    [
      [0, 3, 10, 11],
      [0, 2, 3, 9, 10, 11],
    ],
  ])('preserves ordered overlap for %j → %j', (previous, next) => {
    const { body, render, order, moves, controller } = fixture(moveBefore);
    render(previous);
    const retained = new Set(body.children);
    moves.length = 0;
    render(next);
    expect(order()).toEqual(next.map(String));
    expect(moves.filter((row) => retained.has(row))).toEqual([]);
    controller.abort();
  });

  it.each([0, 1, 2])('orders genuine data reorders around focused row %s', (focused) => {
    const { body, grid, render, order, controller } = fixture(moveBefore);
    render([0, 1, 2]);
    const row = grid._rowPool[focused];
    const input = row.firstElementChild as HTMLInputElement;
    row.classList.add('selected');
    input.focus();
    input.setSelectionRange(1, 3);
    const original = grid._rows.slice();
    grid._rows = [original[2], original[0], original[1]];
    render([0, 1, 2]);
    expect(order()).toEqual(['2', '0', '1']);
    expect(row.parentNode).toBe(body);
    expect(row.firstElementChild).toBe(input);
    expect(row.classList.contains('selected')).toBe(true);
    expect(input.value).toBe('draft');
    if (!moveBefore) expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    grid._rows = [original[2], original[1]];
    render([0, 1]);
    expect(order()).toEqual(['2', '1']);
    controller.abort();
  });

  it('does not move footer siblings or focused overlapping editors', () => {
    const { body, grid, render, order, moves, controller } = fixture(moveBefore);
    render([0, 4, 5, 6]);
    const row = grid._rowPool[2];
    const input = row.firstElementChild as HTMLInputElement;
    row.classList.add('selected');
    input.focus();
    input.setSelectionRange(1, 4);
    const footer = document.createElement('div');
    footer.className = 'tbw-scoped-footer';
    const footerButton = document.createElement('button');
    footer.append(footerButton);
    body.insertBefore(footer, row);
    const tail = document.createElement('div');
    body.append(tail);
    moves.length = 0;
    render([0, 2, 3, 4, 5, 6]);
    expect(order()).toEqual(['0', '2', '3', '4', '5', '6']);
    expect(moves).not.toContain(row);
    expect(moves).not.toContain(footer);
    expect(footer.parentNode).toBe(body);
    expect(footer.firstChild).toBe(footerButton);
    expect(footer.previousElementSibling).toBe(grid._rowPool[3]);
    expect(footer.nextElementSibling).toBe(row);
    expect(tail.parentNode).toBe(body);
    expect(body.lastElementChild).toBe(tail);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.value]).toEqual([1, 4, 'draft']);
    expect(row.classList.contains('selected')).toBe(true);
    moves.length = 0;
    render([0, 2, 3, 4, 5, 6]);
    expect(moves).toEqual([]);
    controller.abort();
  });

  it('handles entrants together with a genuine reorder and a focused retained row', () => {
    const { grid, render, order, controller } = fixture(moveBefore);
    render([0, 2, 4, 6]);
    const focusedRow = grid._rowPool[2];
    const input = focusedRow.firstElementChild as HTMLInputElement;
    input.focus();
    const original = grid._rows.slice();
    grid._rows = [original[5], original[4], original[1], original[0], original[6]];
    render([0, 1, 2, 3, 4]);
    expect(order()).toEqual(['5', '4', '1', '0', '6']);
    expect(grid._rowPool[1]).toBe(focusedRow);
    expect(focusedRow.firstElementChild).toBe(input);
    if (!moveBefore) expect(document.activeElement).toBe(input);
    controller.abort();
  });
});
