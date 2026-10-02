import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../core/grid';
import type { DataGridElement } from '../../core/grid';
import type { ColumnConfig } from '../../core/types';
import { validatePluginConfigRules } from '../../core/internal/validate-config';
import '../../features/cell-entry';
import { createPluginFromFeature } from '../../features/registry';
import { EditingPlugin, type EditingConfig } from '../editing';
import { SelectionPlugin, type SelectionConfig } from '../selection';
import { CellEntryPlugin } from './cell-entry-plugin';

type Row = { id: string; first: string; last: string; locked?: boolean; __loading?: boolean };
const columns: ColumnConfig<Row>[] = [
  { field: 'first', editable: (row) => !row.locked },
  { field: 'last', editable: (row) => !row.locked },
];
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function setup(
  options: {
    tab?: boolean;
    click?: boolean;
    enabled?: boolean;
    columns?: ColumnConfig<Row>[];
    editing?: EditingConfig;
    selection?: SelectionConfig;
    selectable?: boolean;
    rowEditable?: (row: Row) => boolean;
  } = {},
) {
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  const editing = new EditingPlugin<Row>({ editOn: 'manual', tabToEdit: options.tab ?? true, ...options.editing });
  grid.gridConfig = {
    columns: options.columns ?? columns,
    getRowId: (row) => row.id,
    selectable: options.selectable,
    rowEditable: options.rowEditable,
    plugins: [
      new SelectionPlugin({ mode: 'range', ...options.selection }),
      editing,
      ...(options.enabled === false ? [] : [new CellEntryPlugin({ singleClick: options.click ?? true })]),
    ],
  };
  grid.rows = [
    { id: 'a', first: 'A', last: 'one' },
    { id: 'b', first: 'B', last: 'two', locked: true },
    { id: 'c', first: 'C', last: 'three' },
  ];
  document.body.append(grid);
  await customElements.whenDefined('tbw-grid');
  await grid.ready();
  await frame();
  return { grid, editing };
}

function cell(grid: HTMLElement, row = 0, col = 0): HTMLElement {
  return grid.querySelector<HTMLElement>(`.cell[data-row="${row}"][data-col="${col}"]`)!;
}
function key(target: Element, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}
function click(target: Element, options: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...options }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('CellEntry', () => {
  it('registers boolean and object feature forms', () => {
    expect(createPluginFromFeature('cellEntry', true)).toBeInstanceOf(CellEntryPlugin);
    expect(createPluginFromFeature('cellEntry', { singleClick: true })).toBeInstanceOf(CellEntryPlugin);
    expect(() => createPluginFromFeature('cellEntry', 'click')).toThrow(/TBW003/);
  });

  it('selects and opens only the clicked cell, then commits and replaces its same-row editor', async () => {
    const { grid } = await setup();
    click(cell(grid));
    await frame();
    const input = grid.querySelector('input')!;
    expect(input.value).toBe('A');
    input.value = 'edited';
    click(cell(grid, 0, 1));
    await frame();
    expect(grid.rows[0].first).toBe('edited');
    expect(grid.querySelectorAll('.cell.editing')).toHaveLength(1);
    expect(cell(grid, 0, 1).querySelector('input')?.value).toBe('one');
  });

  it('continues Tab in both directions and skips entirely read-only rows', async () => {
    const { grid } = await setup();
    click(cell(grid, 0, 1));
    await frame();
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(cell(grid, 2, 0).querySelector('input')).not.toBeNull();
    key(grid.querySelector('input')!, 'Tab', { shiftKey: true });
    await frame();
    expect(cell(grid, 0, 1).querySelector('input')).not.toBeNull();
    expect(grid.querySelectorAll('.cell.editing')).toHaveLength(1);
  });

  it.each(['Enter', 'F2'])('emits one cancelable keyboard activation for %s', async (entryKey) => {
    const { grid } = await setup();
    grid.focusCell(0, 0);
    const activate = vi.fn((event: Event) => event.preventDefault());
    grid.addEventListener('cell-activate', activate);
    key(grid, entryKey);
    await frame();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(grid.querySelector('input')).toBeNull();
  });

  it('retains Escape rollback and cell-commit veto behavior', async () => {
    const { grid } = await setup();
    click(cell(grid));
    await frame();
    grid.querySelector('input')!.value = 'discard';
    key(grid.querySelector('input')!, 'Escape');
    await frame();
    expect(grid.rows[0].first).toBe('A');
    grid.addEventListener('cell-commit', (event) => event.preventDefault());
    click(cell(grid));
    await frame();
    grid.querySelector('input')!.value = 'rejected';
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(grid.rows[0].first).toBe('A');
    expect(cell(grid, 0, 1).querySelector('input')).not.toBeNull();
  });

  it.each([{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }])(
    'keeps modified clicks selection-only: %o',
    async (modifier) => {
      const { grid } = await setup();
      click(cell(grid), modifier);
      expect(grid.querySelector('input')).toBeNull();
    },
  );

  it('suppresses the click following a promoted pointer selection gesture', async () => {
    const { grid } = await setup();
    grid.dispatchEvent(new Event('gotpointercapture', { bubbles: true }));
    click(cell(grid));
    expect(grid.querySelector('input')).toBeNull();
    cell(grid).dispatchEvent(new Event('pointerdown', { bubbles: true }));
    click(cell(grid));
    expect(grid.querySelector('input')).not.toBeNull();
  });

  it('does not activate links, nested controls, composing or prevented keys', async () => {
    const { grid } = await setup();
    const button = document.createElement('button');
    const nested = document.createElement('span');
    button.append(nested);
    cell(grid).append(button);
    click(nested);
    key(button, 'Enter');
    grid.focusCell(0, 0);
    key(grid, 'Enter', { isComposing: true });
    expect(grid.querySelector('input')).toBeNull();
  });

  it('leaves printable and clear keys untouched', async () => {
    const { grid } = await setup();
    grid.focusCell(0, 0);
    for (const value of ['x', 'Delete', 'Backspace']) expect(key(grid, value).defaultPrevented).toBe(false);
    expect(grid.rows[0].first).toBe('A');
    expect(grid.querySelector('input')).toBeNull();
  });

  it.each(['link', 'checkbox', 'disclosure', 'shadow-input'])(
    'does not compete with a %s control or its composed descendants',
    async (kind) => {
      const { grid } = await setup();
      grid.focusCell(0, 0);
      const control = document.createElement(kind === 'link' ? 'a' : 'div');
      if (kind === 'link') control.setAttribute('href', '#example');
      else if (kind !== 'shadow-input') {
        control.setAttribute('role', kind === 'checkbox' ? 'checkbox' : 'button');
        control.tabIndex = 0;
      }
      const target =
        kind === 'shadow-input'
          ? document.createElement('input')
          : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      if (kind === 'shadow-input') control.attachShadow({ mode: 'open' }).append(target);
      else control.append(target);
      cell(grid).append(control);
      key(target, 'Enter');
      key(target, ' ');
      click(target);
      expect(grid.querySelector('.cell.editing')).toBeNull();
    },
  );

  it('preserves F2 close-only Tab when continuation is off', async () => {
    const { grid, editing } = await setup({ tab: false, enabled: false });
    editing.beginCellEdit(0, 'first');
    await frame();
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(grid.querySelector('input')).toBeNull();
    expect(grid.focusedCell?.field).toBe('first');
  });

  it('keeps single-click off unless requested', async () => {
    const { grid } = await setup({ click: false });
    click(cell(grid));
    expect(grid.querySelector('input')).toBeNull();
    grid.focusCell(0, 0);
    key(grid, 'Enter');
    await frame();
    expect(grid.querySelector('input')).not.toBeNull();
  });

  it.each([
    { editing: { editOn: 'click' as const } },
    { editing: { mode: 'grid' as const } },
    { selection: { mode: 'row' as const } },
    { selection: { triggerOn: 'dblclick' as const } },
  ])('diagnoses conflicting configuration %o', async (options) => {
    const { grid } = await setup({ ...options, enabled: false });
    expect(() => new CellEntryPlugin().attach(grid)).toThrow(/TBW003/);
  });

  it('diagnoses missing dependencies and invalid plugin options', async () => {
    const { grid } = await setup({ enabled: false });
    const invalid = new EditingPlugin({ tabToEdit: 'yes' as never });
    invalid.attach(document.createElement('tbw-grid') as DataGridElement);
    try {
      expect(() => validatePluginConfigRules([invalid])).toThrow(/TBW003/);
    } finally {
      invalid.detach();
    }
    expect(() => new CellEntryPlugin({ singleClick: 'yes' as never }).attach(grid)).toThrow(/TBW003/);
    grid.gridConfig = { columns: [{ field: 'first' }] };
    await frame();
    expect(() => new CellEntryPlugin().attach(grid)).toThrow(/TBW003/);
  });

  it.each([{ editing: { editOn: false as const } }, { selection: { enabled: false } }, { selectable: false }])(
    'does not bypass disabled entry/selection %o',
    async (options) => {
      const { grid } = await setup(options);
      click(cell(grid));
      grid.focusCell(0, 0);
      key(grid, 'Enter');
      key(grid, 'F2');
      expect(grid.querySelector('input')).toBeNull();
    },
  );

  it('honours a close veto once without losing the current editor', async () => {
    const veto = vi.fn(() => false);
    const { grid } = await setup({ editing: { onBeforeEditClose: veto } });
    click(cell(grid));
    await frame();
    const input = grid.querySelector('input')!;
    expect(key(input, 'Tab').defaultPrevented).toBe(true);
    expect(veto).toHaveBeenCalledTimes(1);
    expect(grid.querySelector('input')).toBe(input);
    click(cell(grid, 0, 1));
    expect(grid.querySelector('input')).toBe(input);
  });

  it('leaves composing Enter, Escape and Tab with the current editor', async () => {
    const { grid } = await setup();
    click(cell(grid));
    await frame();
    const input = grid.querySelector('input')!;
    for (const value of ['Enter', 'Escape', 'Tab']) {
      key(input, value, { isComposing: true });
      expect(grid.querySelector('input')).toBe(input);
    }
  });

  it('retains native select descendant Enter and canceled editor Tab', async () => {
    const { grid } = await setup({
      columns: [
        {
          field: 'first',
          editable: true,
          editor: () => {
            const select = document.createElement('select');
            for (const value of ['A', 'B']) {
              const option = document.createElement('option');
              option.value = option.textContent = value;
              select.append(option);
            }
            return select;
          },
        },
        columns[1],
      ],
    });
    click(cell(grid));
    await frame();
    const select = grid.querySelector('select')!;
    expect(key(select.options[1], 'Enter').defaultPrevented).toBe(false);
    expect(select.isConnected).toBe(true);
    select.addEventListener('keydown', (event) => event.preventDefault());
    key(select, 'Tab');
    expect(grid.querySelector('select')).toBe(select);
  });

  it('re-resolves the clicked row after selection listeners reorder the displayed rows', async () => {
    const { grid } = await setup();
    grid.addEventListener('selection-change', () => grid._rows.reverse(), { once: true });
    click(cell(grid));
    await frame();
    expect(grid.querySelector('input')).toBeNull();
  });

  it('cancels entry if an activation listener removes its target', async () => {
    const { grid } = await setup();
    grid.focusCell(0, 0);
    grid.addEventListener(
      'cell-activate',
      () => {
        grid._rows.splice(0, 1);
      },
      { once: true },
    );
    key(grid, 'Enter');
    expect(grid.querySelector('input')).toBeNull();
  });

  it('keeps the pending target identity when a row-commit listener reorders rows', async () => {
    const { grid } = await setup();
    click(cell(grid, 0, 1));
    await frame();
    grid.addEventListener('row-commit', () => grid._rows.reverse(), { once: true });
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(grid.querySelector('input')?.value).toBe('C');
    expect(grid.querySelectorAll('.cell.editing')).toHaveLength(1);
    expect(grid.focusedCell?.rowIndex).toBe(0);
  });

  it('skips utility columns and loading rows in displayed column order', async () => {
    const { grid } = await setup({ columns: [columns[1], { field: 'id', utility: true, editable: true }, columns[0]] });
    grid._rows[1].__loading = true;
    grid._rows[1].locked = false;
    click(cell(grid, 0, 0));
    await frame();
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(cell(grid, 0, 2).querySelector('input')?.value).toBe('A');
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(cell(grid, 2, 0).querySelector('input')?.value).toBe('three');
  });

  it('respects rowEditable for entry and continuation', async () => {
    const { grid } = await setup({ rowEditable: (row) => row.id !== 'c' });
    click(cell(grid, 2, 0));
    expect(grid.querySelector('input')).toBeNull();
    click(cell(grid, 0, 1));
    await frame();
    expect(key(grid.querySelector('input')!, 'Tab').defaultPrevented).toBe(false);
    expect(grid.querySelector('input')).toBeNull();
  });

  it('retains row-commit veto semantics during continuation', async () => {
    const { grid } = await setup();
    grid.addEventListener('row-commit', (event) => event.preventDefault());
    click(cell(grid));
    await frame();
    grid.querySelector('input')!.value = 'rejected';
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(grid.rows[0].first).toBe('A');
    expect(cell(grid, 0, 1).querySelector('input')?.value).toBe('one');
  });

  it('does not enter a replacement when a row-commit listener removes the pending target', async () => {
    const { grid } = await setup();
    click(cell(grid, 0, 1));
    await frame();
    grid.addEventListener('row-commit', () => grid._rows.splice(2, 1), { once: true });
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(grid.querySelector('input')).toBeNull();
  });

  it('does not reopen an editor after an edit-close listener disconnects the grid', async () => {
    const { grid } = await setup();
    click(cell(grid));
    await frame();
    grid.addEventListener('edit-close', () => grid.remove(), { once: true });
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(grid.querySelector('.cell.editing')).toBeNull();
  });

  it('flushes a managed editor before teardown and emits one close/open transition', async () => {
    let flush: (() => void) | undefined;
    const { grid } = await setup({
      columns: [
        {
          field: 'first',
          editable: true,
          editor: (context) => {
            const host = document.createElement('div');
            const input = document.createElement('input');
            input.value = String(context.value);
            host.append(input);
            flush = () => context.commit(input.value);
            return host;
          },
        },
        columns[1],
      ],
    });
    grid.addEventListener('before-edit-close', () => flush?.());
    const open = vi.fn();
    const close = vi.fn();
    grid.addEventListener('edit-open', open);
    grid.addEventListener('edit-close', close);
    click(cell(grid));
    await frame();
    grid.querySelector('input')!.value = 'managed';
    key(grid.querySelector('input')!, 'Tab');
    await frame();
    expect(grid.rows[0].first).toBe('managed');
    expect(open).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(grid.querySelectorAll('.cell.editing')).toHaveLength(1);
  });
});
