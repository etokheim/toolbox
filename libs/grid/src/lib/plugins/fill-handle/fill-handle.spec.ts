import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../core/grid';
import type { DataGridElement } from '../../core/grid';
import type { ColumnConfig } from '../../core/types';
import { EditingPlugin } from '../editing';
import { SelectionPlugin } from '../selection';
import { UndoRedoPlugin } from '../undo-redo';
import type { ExternalHistoryOwner } from '../undo-redo/types';
import { FILL_CELL_LIMIT } from './fill-cells';
import { FillHandlePlugin } from './fill-handle-plugin';
import type { FillCompleteDetail, FillHandleConfig } from './types';

type Row = {
  id: string;
  n: number | null;
  d: string;
  text: string;
  locked?: boolean;
  __loading?: boolean;
};
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const row = (id: string, n: number | null = 0, d = '', text = ''): Row => ({ id, n, d, text });

async function setup(
  options: {
    rows?: Row[];
    columns?: ColumnConfig<Row>[];
    fill?: FillHandleConfig<Row>;
    externalHistory?: ExternalHistoryOwner;
  } = {},
) {
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  const selection = new SelectionPlugin({ mode: 'range' });
  const undo = new UndoRedoPlugin(options.externalHistory ? { externalHistory: options.externalHistory } : {});
  const fill = new FillHandlePlugin<Row>(options.fill);
  grid.gridConfig = {
    getRowId: (owner) => owner.id,
    columns: options.columns ?? [
      { field: 'n', type: 'number', editable: true },
      { field: 'd', type: 'date', editable: true },
      { field: 'text', type: 'string', editable: true },
    ],
    rowEditable: (owner) => !owner.locked,
    plugins: [selection, new EditingPlugin<Row>({ editOn: 'manual' }), undo, fill],
  };
  grid.rows = options.rows ?? [row('a', 1, '2024-01-31', 'x'), row('b', 2, '2024-02-29', 'y'), row('c'), row('d')];
  const reports: FillCompleteDetail<Row>[] = [];
  grid.addEventListener('fill-complete', (event) => reports.push(event.detail));
  document.body.append(grid);
  await customElements.whenDefined('tbw-grid');
  await grid.ready();
  await frame();
  return { grid, selection, undo, fill, reports };
}

const range = (fromRow: number, toRow: number, fromCol = 0, toCol = 0) => ({
  from: { row: fromRow, col: fromCol },
  to: { row: toRow, col: toCol },
});

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('FillHandlePlugin execution', () => {
  it('fills numbers, calendar months and repeated text downward as one undo step', async () => {
    const { grid, fill, undo, reports } = await setup();
    const commits = vi.fn();
    grid.addEventListener('cell-commit', commits);
    const detail = fill.fill({ source: range(0, 1, 0, 2), targetRow: 3 });
    expect(detail.direction).toBe('down');
    expect(detail.canceled).toBe(false);
    expect(detail.cells.map((cell) => cell.status)).toEqual(Array(6).fill('filled'));
    expect(grid.rows.map(({ n, d, text }) => [n, d, text])).toEqual([
      [1, '2024-01-31', 'x'],
      [2, '2024-02-29', 'y'],
      [3, '2024-03-31', 'x'],
      [4, '2024-04-30', 'y'],
    ]);
    expect(commits).toHaveBeenCalledTimes(6);
    expect(commits.mock.calls.every(([event]) => event.detail.source === 'fill')).toBe(true);
    expect(reports).toEqual([detail]);
    expect(undo.getUndoStack()).toHaveLength(1);
    undo.undo();
    expect(grid.rows.slice(2).map(({ n, d, text }) => [n, d, text])).toEqual([
      [0, '', ''],
      [0, '', ''],
    ]);
  });

  it('fills upward in nearest-first order with a reversed series', async () => {
    const { grid, fill } = await setup({
      rows: [row('a'), row('b'), row('c', 10), row('d', 12)],
    });
    const detail = fill.fill({ source: range(2, 3), targetRow: 0 });
    expect(detail.direction).toBe('up');
    expect(detail.cells.map((cell) => cell.rowIndex)).toEqual([1, 0]);
    expect(grid.rows.map((owner) => owner.n)).toEqual([6, 8, 10, 12]);
  });

  it('returns an empty result without events when the target lies inside the source', async () => {
    const { fill, reports } = await setup();
    const start = vi.fn();
    fill.gridElement.addEventListener('fill-start', start);
    expect(fill.fill({ source: range(0, 1), targetRow: 1 })).toMatchObject({ cells: [], canceled: false });
    expect(start).not.toHaveBeenCalled();
    expect(reports).toHaveLength(0);
  });

  it('honors fill-start cancellation without writing', async () => {
    const { grid, fill, undo, reports } = await setup();
    grid.addEventListener('fill-start', (event) => event.preventDefault());
    const detail = fill.fill({ source: range(0, 1), targetRow: 3 });
    expect(detail.canceled).toBe(true);
    expect(reports).toEqual([detail]);
    expect(grid.rows[2].n).toBe(0);
    expect(undo.getUndoStack()).toHaveLength(0);
  });

  it('reports readonly, rule and validation rejections while accepting the rest', async () => {
    const { grid, fill, undo } = await setup({
      rows: [row('a', 1), row('b', 2), { ...row('c'), locked: true }, row('d'), row('e'), row('f')],
      fill: { fillValue: (ctx) => (ctx.offset === 3 ? { reject: 'no fours' } : { value: ctx.proposedValue }) },
    });
    grid.addEventListener('cell-commit', (event) => {
      if (event.detail.value === 6) event.preventDefault();
    });
    const detail = fill.fill({ source: range(0, 1), targetRow: 5 });
    expect(detail.cells.map(({ status, reason, message }) => [status, reason, message])).toEqual([
      ['skipped', 'readonly', undefined],
      ['filled', undefined, undefined],
      ['rejected', 'rule', 'no fours'],
      ['rejected', 'validation', undefined],
    ]);
    expect(grid.rows.map((owner) => owner.n)).toEqual([1, 2, 0, 4, 0, 0]);
    expect(undo.getUndoStack()).toHaveLength(1);
  });

  it('treats targets changed after planning as conflicts', async () => {
    const { grid, fill } = await setup({
      fill: {
        fillValue: (ctx) => {
          if (ctx.offset === 1) grid.rows[3].n = 99;
          return { value: ctx.proposedValue };
        },
      },
    });
    const detail = fill.fill({ source: range(0, 1), targetRow: 3 });
    expect(detail.cells.map((cell) => cell.reason ?? cell.status)).toEqual(['filled', 'conflict']);
    expect(grid.rows[3].n).toBe(99);
  });

  it('skips loading placeholders and fills rows beyond the rendered window', async () => {
    const rows = Array.from({ length: 600 }, (_, index) => row(String(index), index === 0 ? 5 : 0));
    rows[3].__loading = true;
    const { grid, fill, undo } = await setup({ rows });
    const detail = fill.fill({ source: range(0, 0), targetRow: 599 });
    expect(detail.cells).toHaveLength(598);
    expect(detail.cells.some((cell) => cell.rowIndex === 3)).toBe(false);
    expect(grid.rows.filter((owner) => !owner.__loading).every((owner) => owner.n === 5)).toBe(true);
    expect(grid.rows[3].n).toBe(0);
    expect(undo.getUndoStack()).toHaveLength(1);
  });

  it('rejects oversized fills before writing', async () => {
    const rows = Array.from({ length: FILL_CELL_LIMIT / 2 + 2 }, (_, index) => row(String(index)));
    const { grid, fill, undo } = await setup({
      rows,
      columns: [
        { field: 'n', type: 'number', editable: true },
        { field: 'text', type: 'string', editable: true },
      ],
    });
    const commits = vi.fn();
    grid.addEventListener('cell-commit', commits);
    const detail = fill.fill({ source: range(0, 0, 0, 1), targetRow: FILL_CELL_LIMIT / 2 + 1 });
    expect(detail.limitExceeded).toBe(true);
    expect(detail.cells).toEqual([]);
    expect(commits).not.toHaveBeenCalled();
    expect(undo.getUndoStack()).toHaveLength(0);
    expect(grid.rows[FILL_CELL_LIMIT / 2 + 1].n).toBe(0);
  });

  it('groups accepted writes once with external history and keeps native history empty', async () => {
    const owner: ExternalHistoryOwner = {
      request: vi.fn(),
      getState: () => ({ canUndo: false, canRedo: false }),
      subscribe: () => () => undefined,
      beginGroup: vi.fn(),
      endGroup: vi.fn(),
    };
    const { grid, fill } = await setup({ externalHistory: owner });
    fill.fill({ source: range(0, 1, 0, 2), targetRow: 3 });
    expect(grid.rows[3].n).toBe(4);
    expect(owner.beginGroup).toHaveBeenCalledTimes(1);
    expect(owner.endGroup).toHaveBeenCalledWith(vi.mocked(owner.beginGroup).mock.calls[0][0], 'complete');
    expect(owner.endGroup).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid configuration and missing range selection at attach', () => {
    const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
    const plugin = new FillHandlePlugin({ mode: 'series' as never });
    expect(() => plugin.attach(grid as never)).toThrow();
  });
});

describe('FillHandlePlugin interaction', () => {
  it('renders a labeled corner handle for a single range only', async () => {
    const { grid, selection } = await setup();
    selection.setRanges([range(0, 1)]);
    await frame();
    const handle = grid.querySelector<HTMLElement>('.tbw-fill-handle');
    expect(handle?.getAttribute('role')).toBe('button');
    expect(handle?.getAttribute('aria-label')).toMatch(/fill/i);
    expect(handle?.hidden).toBe(false);
    selection.setRanges([range(0, 0), range(2, 2)]);
    await frame();
    expect(handle?.hidden).toBe(true);
  });

  it('fills with Alt+ArrowDown, arrows and Enter, then selects the filled range', async () => {
    const { grid, selection, reports } = await setup();
    selection.setRanges([range(0, 1)]);
    await frame();
    expect(press(grid, 'ArrowDown', { altKey: true }).defaultPrevented).toBe(true);
    const handle = grid.querySelector<HTMLElement>('.tbw-fill-handle')!;
    expect(grid.querySelector<HTMLElement>('.tbw-fill-preview')?.hidden).toBe(false);
    press(handle, 'ArrowDown');
    press(handle, 'Enter');
    expect(grid.rows.map((owner) => owner.n)).toEqual([1, 2, 3, 4]);
    expect(reports).toHaveLength(1);
    expect(selection.getSelection().ranges).toEqual([range(0, 3)]);
  });

  it('cancels a keyboard session with Escape and a changed target as a conflict', async () => {
    const { grid, selection, reports } = await setup();
    selection.setRanges([range(0, 1)]);
    await frame();
    press(grid, 'ArrowDown', { altKey: true });
    const handle = grid.querySelector<HTMLElement>('.tbw-fill-handle')!;
    press(handle, 'Escape');
    expect(reports).toHaveLength(0);
    expect(grid.rows[2].n).toBe(0);

    press(grid, 'ArrowDown', { altKey: true });
    grid.rows[2].n = 42;
    press(handle, 'Enter');
    expect(reports[0].cells.map((cell) => cell.reason)).toEqual(['conflict']);
    expect(grid.rows[2].n).toBe(42);
  });

  it('fills upward with Alt+ArrowUp and ignores other modifiers', async () => {
    const { grid, selection } = await setup({ rows: [row('a'), row('b', 7)] });
    selection.setRanges([range(1, 1)]);
    await frame();
    press(grid, 'ArrowUp', { altKey: true, ctrlKey: true });
    expect(grid.querySelector<HTMLElement>('.tbw-fill-preview')?.hidden ?? true).toBe(true);
    selection.setRanges([range(1, 1)]);
    press(grid, 'ArrowUp', { altKey: true });
    press(grid.querySelector('.tbw-fill-handle')!, 'Enter');
    expect(grid.rows[0].n).toBe(7);
  });

  it('arms on a handle tap and applies on the next target-cell click', async () => {
    const { grid, selection } = await setup();
    selection.setRanges([range(0, 1)]);
    await frame();
    const handle = grid.querySelector<HTMLElement>('.tbw-fill-handle')!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);
    handle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, pointerType: 'touch' }),
    );
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch' }));
    expect(handle.getAttribute('aria-pressed')).toBe('true');
    grid.querySelector<HTMLElement>('.cell[data-row="3"][data-col="0"]')!.click();
    expect(grid.rows.map((owner) => owner.n)).toEqual([1, 2, 3, 4]);
    expect(handle.getAttribute('aria-pressed')).toBe('false');
  });
});
