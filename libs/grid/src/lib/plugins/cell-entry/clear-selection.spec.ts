import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import '../../core/grid';
import type { DataGridElement } from '../../core/grid';
import type { ColumnConfig } from '../../core/types';
import { EditingPlugin } from '../editing';
import { SelectionPlugin } from '../selection';
import { UndoRedoPlugin } from '../undo-redo';
import { CellEntryPlugin } from './cell-entry-plugin';
import { selectedCoordinates } from './clear-selection';
import type { CellClearDetail } from './types';

type Row = {
  id?: string;
  text: string;
  count: number;
  maybe: number | null;
  other: string;
  locked?: boolean;
  __loading?: boolean;
};
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const row = (id?: string): Row => ({ id, text: `text-${id}`, count: 8, maybe: 4, other: 'kept' });

async function setup(options: { columns?: ColumnConfig<Row>[]; rows?: Row[]; clear?: boolean; undo?: boolean } = {}) {
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  const selection = new SelectionPlugin({ mode: 'range' });
  const editing = new EditingPlugin<Row>({ editOn: 'manual' });
  const undo = new UndoRedoPlugin();
  grid.gridConfig = {
    columns: options.columns ?? [
      { field: 'text', type: 'string', editable: true },
      { field: 'count', type: 'number', editable: true },
      { field: 'maybe', type: 'number', nullable: true, editable: true },
      { field: 'other', editable: false },
    ],
    rowEditable: (owner) => !owner.locked,
    plugins: [
      selection,
      editing,
      ...(options.undo === false ? [] : [undo]),
      new CellEntryPlugin({ clearOnDelete: options.clear ?? true }),
    ],
  };
  grid.rows = options.rows ?? [row('a'), row('b')];
  const reports: CellClearDetail<Row>[] = [];
  grid.addEventListener('cell-clear', (event) => reports.push(event.detail));
  document.body.append(grid);
  await customElements.whenDefined('tbw-grid');
  await grid.ready();
  await frame();
  return { grid, selection, editing, undo, reports };
}

function press(target: Element, key = 'Delete', init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('selected-cell clearing', () => {
  it('deduplicates reversed/gapped overlaps and enforces the exact 10,000-cell bound', () => {
    const whole = { from: { row: 0, col: 0 }, to: { row: 99, col: 99 } };
    expect(selectedCoordinates([whole, whole], 100, 100)).toHaveLength(10_000);
    expect(
      selectedCoordinates([whole, { from: { row: 100, col: 0 }, to: { row: 100, col: 0 } }], 101, 100),
    ).toBeUndefined();
    expect(
      selectedCoordinates(
        [
          { from: { row: 1, col: 1 }, to: { row: 0, col: 0 } },
          { from: { row: 0, col: 1 }, to: { row: 0, col: 1 } },
          { from: { row: 3, col: 1 }, to: { row: 3, col: 1 } },
        ],
        4,
        2,
      ),
    ).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 3, col: 1 },
    ]);
  });

  it.each(['Delete', 'Backspace'])(
    'applies type-aware defaults, reports skips and groups accepted edits for %s',
    async (key) => {
      const { grid, selection, undo, reports } = await setup();
      selection.setRanges([
        { from: { row: 0, col: 0 }, to: { row: 0, col: 3 } },
        { from: { row: 0, col: 0 }, to: { row: 0, col: 0 } },
      ]);
      const commits = vi.fn();
      grid.addEventListener('cell-commit', commits);
      expect(press(grid, key).defaultPrevented).toBe(true);
      expect(grid.rows[0]).toMatchObject({ text: '', count: 8, maybe: null, other: 'kept' });
      expect(commits).toHaveBeenCalledTimes(2);
      expect(reports[0].cells.map(({ status, reason }) => [status, reason])).toEqual([
        ['cleared', undefined],
        ['skipped', 'unsupported-type'],
        ['cleared', undefined],
        ['skipped', 'readonly'],
      ]);
      expect(undo.getUndoStack()).toHaveLength(1);
      undo.undo();
      expect(grid.rows[0]).toMatchObject({ text: 'text-a', maybe: 4 });
      undo.redo();
      expect(grid.rows[0]).toMatchObject({ text: '', maybe: null });
    },
  );

  it('applies column overrides before nullable defaults and preserves typed rule/event rows', async () => {
    const columns: ColumnConfig<Row>[] = [
      {
        field: 'maybe',
        type: 'number',
        nullable: true,
        editable: true,
        clearValue: ({ row: owner }) => {
          expectTypeOf(owner).toEqualTypeOf<Row>();
          return { value: owner.count + 1 };
        },
      },
      { field: 'text', type: 'string', editable: true, clearValue: () => ({ reject: 'Required by application' }) },
    ];
    const { grid, selection, reports, undo } = await setup({ columns });
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }]);
    press(grid);
    expect(grid.rows[0]).toMatchObject({ maybe: 9, text: 'text-a' });
    expect(reports[0].cells[1]).toMatchObject({
      status: 'rejected',
      reason: 'rule',
      message: 'Required by application',
    });
    expectTypeOf(reports[0].cells[0].row).toEqualTypeOf<Row>();
    expect(undo.getUndoStack()).toHaveLength(1);
  });

  it.each([false, true])('honors validation/vetoes and nested Undo with ID-less owners: %s', async (noId) => {
    const { grid, selection, undo, reports } = await setup({
      rows: noId ? [row(), row()] : undefined,
      columns: [
        { field: 'text', type: 'string', editable: true },
        { field: 'other', type: 'string', editable: true },
      ],
    });
    const [first, second] = grid.rows;
    const originalText = grid.rows.map((owner) => owner.text);
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 1, col: 1 } }]);
    grid.addEventListener('cell-commit', (event) => {
      if (event.detail.row === first && event.detail.field === 'text') event.preventDefault();
      if (event.detail.row === second && event.detail.field === 'other') event.detail.setInvalid('Cannot clear');
    });
    undo.beginTransaction();
    press(grid);
    expect(undo.getUndoStack()).toHaveLength(0);
    undo.endTransaction();
    expect(undo.getUndoStack()).toHaveLength(1);
    expect(reports[0].cells.map((cell) => cell.status)).toEqual(['rejected', 'cleared', 'cleared', 'rejected']);
    expect(grid.rows[0].text).toBe(originalText[0]);
    expect(grid.rows[1].other).toBe('kept');
    undo.undo();
    expect(grid.rows.map((owner) => owner.text)).toEqual(originalText);
    expect(grid.rows.map((owner) => owner.other)).toEqual(['kept', 'kept']);
  });

  it('clears exactly 10,000 unique cells despite overlap and restores all in one Undo', async () => {
    const fields = Array.from({ length: 100 }, (_, index) => `cell${index}`);
    const originalValues = Object.fromEntries(fields.map((field) => [field, 'original']));
    const rows = Array.from({ length: 100 }, (_, index) => ({ ...row(String(index)), ...originalValues }));
    const originals = rows.map((owner) => ({ ...owner }));
    const { grid, selection, undo, reports } = await setup({
      rows,
      columns: fields.map((field) => ({ field, type: 'string', editable: true })),
    });
    const commit = vi.fn();
    grid.addEventListener('cell-commit', commit);
    const range = { from: { row: 0, col: 0 }, to: { row: 99, col: 99 } };
    selection.setRanges([range, range]);
    press(grid);
    expect(reports[0].limitExceeded).toBe(false);
    expect(reports[0].cells).toHaveLength(10_000);
    expect(reports[0].cells.every((cell) => cell.status === 'cleared')).toBe(true);
    expect(commit).toHaveBeenCalledTimes(10_000);
    expect(undo.getUndoStack()).toHaveLength(1);
    const cleared = Object.fromEntries(fields.map((field) => [field, '']));
    expect(grid.rows).toEqual(originals.map((owner) => ({ ...owner, ...cleared })));
    undo.undo();
    expect(grid.rows).toEqual(originals);
  });

  it('rejects an oversized action before calling rules, emitting commits or writing history', async () => {
    const rule = vi.fn(() => ({ value: '' }));
    const { grid, selection, undo, reports } = await setup({
      rows: Array.from({ length: 10_001 }, (_, index) => row(String(index))),
      columns: [{ field: 'text', editable: true, clearValue: rule }],
    });
    const commit = vi.fn();
    grid.addEventListener('cell-commit', commit);
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 10_000, col: 0 } }]);
    press(grid);
    expect(rule).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(reports).toEqual([{ cells: [], limitExceeded: true }]);
    expect(grid.rows.every((owner) => owner.text === `text-${owner.id}`)).toBe(true);
    expect(undo.getUndoStack()).toHaveLength(0);
  });

  it('skips later cells during a queued replacement, then follows the settled immutable owner', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = row('a');
    const b = row('b');
    const replacement = { ...b, text: 'replacement' };
    const { grid, selection, undo, reports } = await setup({
      rows: [a, b],
      columns: [{ field: 'text', type: 'string', editable: true }],
    });
    grid.addEventListener('cell-change', (event) => {
      if (event.detail.source === 'clear' && event.detail.row === a) grid.rows = [replacement, a];
    });
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 1, col: 0 } }]);
    press(grid);
    expect(a.text).toBe('');
    expect(replacement.text).toBe('replacement');
    expect(b.text).toBe('text-b');
    expect(reports[0].cells.map((cell) => cell.status)).toEqual(['cleared', 'skipped']);
    await frame();
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }]);
    press(grid);
    expect(replacement.text).toBe('');
    undo.undo();
    expect(replacement.text).toBe('replacement');
    undo.undo();
    expect(a.text).toBe('text-a');
  });

  it.each(['rule', 'commit'])('does not mutate a detached current owner after a %s callback', async (callback) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const original = row('a');
    const replacement = row('a');
    const { grid, selection, undo, reports } = await setup({
      rows: [original],
      columns: [
        {
          field: 'text',
          type: 'string',
          editable: true,
          clearValue:
            callback === 'rule'
              ? () => {
                  grid.rows = [replacement];
                  return { value: '' };
                }
              : undefined,
        },
      ],
    });
    if (callback === 'commit')
      grid.addEventListener('cell-commit', () => {
        grid.rows = [replacement];
      });
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }]);
    press(grid);
    expect(original.text).toBe('text-a');
    expect(replacement.text).toBe('text-a');
    expect(reports[0].cells[0].status).not.toBe('cleared');
    expect(undo.getUndoStack()).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it('clears ID-less live objects through Editing and supports one-step Undo', async () => {
    const owner = row();
    const { grid, selection, undo } = await setup({
      rows: [owner],
      columns: [{ field: 'text', type: 'string', editable: true }],
    });
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }]);
    press(grid);
    expect(owner.text).toBe('');
    undo.undo();
    expect(owner.text).toBe('text-undefined');
  });

  it('warns and skips ambiguous owners without changing either duplicate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { grid, selection, undo, reports } = await setup({
      rows: [row('same'), row('same')],
      columns: [{ field: 'text', type: 'string', editable: true }],
    });
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 1, col: 0 } }]);
    press(grid);
    expect(grid.rows.every((owner) => owner.text === 'text-same')).toBe(true);
    expect(reports[0].cells.every((cell) => cell.reason === 'unavailable')).toBe(true);
    expect(undo.getUndoStack()).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it('keeps fields attached to their owners when a rule reorders visible columns', async () => {
    const { grid, selection, reports, undo } = await setup({
      columns: [
        {
          field: 'text',
          type: 'string',
          editable: true,
          clearValue: () => {
            grid.setColumnOrder(['other', 'text']);
            return { value: '' };
          },
        },
        { field: 'other', type: 'string', editable: true },
      ],
    });
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }]);
    press(grid);
    expect(grid.rows[0]).toMatchObject({ text: '', other: '' });
    expect(grid.rows[1]).toMatchObject({ text: 'text-b', other: 'kept' });
    expect(reports[0].cells.map((cell) => cell.field)).toEqual(['text', 'other']);
    expect(reports[0].cells.map((cell) => cell.status)).toEqual(['cleared', 'cleared']);
    undo.undo();
    expect(grid.rows[0]).toMatchObject({ text: 'text-a', other: 'kept' });
  });

  it('skips locked rows, utility columns and loading placeholders while clearing an eligible neighbor', async () => {
    const { grid, selection, undo, reports } = await setup({
      rows: [{ ...row('a'), locked: true }, row('b'), { ...row('c'), __loading: true }],
      columns: [
        { field: 'text', type: 'string', editable: true },
        { field: 'other', utility: true, editable: true },
      ],
    });
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 2, col: 1 } }]);
    press(grid);
    expect(reports[0].cells.map((cell) => cell.status)).toEqual([
      'skipped',
      'skipped',
      'cleared',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(undo.getUndoStack()).toHaveLength(1);
    expect(grid.rows[0].text).toBe('text-a');
    expect(grid.rows[1].text).toBe('');
    expect(grid.rows[2].text).toBe('text-c');
  });

  it('is off by default and leaves native controls, IME, repeats and modified keys alone', async () => {
    const disabled = await setup({ clear: false, undo: false });
    expect(() => new CellEntryPlugin({ clearOnDelete: true }).attach(disabled.grid)).toThrow(/TBW003.*UndoRedo/);
    disabled.selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }]);
    press(disabled.grid);
    expect(disabled.grid.rows[0].text).toBe('text-a');
    const { grid, selection, reports } = await setup();
    selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }]);
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      press(grid, 'Delete', init);
    }
    for (const tag of ['input', 'textarea', 'select', 'button', 'div']) {
      const control = document.createElement(tag);
      if (tag === 'div') control.contentEditable = 'true';
      grid.append(control);
      press(control);
      press(control, 'Backspace');
    }
    const prevented = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    prevented.preventDefault();
    grid.dispatchEvent(prevented);
    expect(reports).toHaveLength(0);
    expect(grid.rows[0].text).toBe('text-a');
    press(grid);
    expect(grid.rows[0].text).toBe('');
  });
});
