import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { markControlBoundary } from '../../core/internal/control-lifecycle';
import type { ControlView } from '../../core/types';
import { EditingPlugin } from '../editing';
import { MasterDetailPlugin, type MasterDetailDisclosureContext } from '../master-detail';
import { SelectionPlugin, type SelectionRowCheckboxContext } from '../selection';
import { TreePlugin, type TreeDisclosureContext } from '../tree';
import { CellEntryPlugin } from './cell-entry-plugin';

type Row = { id: string; name: string; value: string; children?: Row[] };
type Context = TreeDisclosureContext<Row> | MasterDetailDisclosureContext<Row> | SelectionRowCheckboxContext<Row>;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function control<C extends Context>(kind: string, handled: (kind: string) => void) {
  return (initial: C): ControlView<C> => {
    const element = document.createElement('span');
    element.dataset.control = kind;
    element.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    let current = initial;
    const activate = () => {
      handled(kind);
      if ('setChecked' in current) current.setChecked(!current.checked);
      else current.setExpanded(!current.expanded);
    };
    element.addEventListener('click', activate);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate();
    });
    return { element, update: (context) => (current = context) };
  };
}

async function setup(checkbox = false, reverse = false, implicitTreeColumn = false) {
  const handled = vi.fn();
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  const entry = new CellEntryPlugin({ singleClick: true });
  const selection = new SelectionPlugin<Row>({
    mode: checkbox ? 'row' : 'range',
    checkbox,
    rowCheckboxRenderer: control('checkbox', handled),
  });
  const editing = new EditingPlugin<Row>({ editOn: 'manual', tabToEdit: true });
  const tree = new TreePlugin<Row>({
    treeColumn: implicitTreeColumn ? undefined : 'name',
    animation: false,
    disclosureRenderer: control('tree', handled),
  });
  const detail = new MasterDetailPlugin<Row>({
    animation: false,
    expandOnRowClick: false,
    detailRenderer: () => 'Details',
    disclosureRenderer: control('detail', handled),
  });
  grid.gridConfig = {
    getRowId: (row) => row.id,
    columns: [
      { field: 'name', editable: true },
      { field: 'value', editable: true },
      {
        field: 'metadata',
        editable: true,
        renderer: () => {
          const element = document.createElement('span');
          element.dataset.control = 'metadata';
          element.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
          markControlBoundary(element, grid);
          element.addEventListener('click', () => handled('metadata'));
          element.addEventListener('keydown', () => handled('metadata'));
          return element;
        },
      },
    ],
    plugins: [selection, editing, ...(reverse ? [detail, tree] : [tree, detail]), ...(checkbox ? [] : [entry])],
  };
  grid.rows = [
    { id: 'p', name: 'Parent', value: 'one', children: [{ id: 'c', name: 'Child', value: 'two' }] },
    { id: 's', name: 'Sibling', value: 'three' },
  ];
  document.body.append(grid);
  await customElements.whenDefined(DataGridElement.activeTag);
  await grid.ready();
  await vi.waitFor(() => expect(grid.querySelector('[data-control="tree"]')).not.toBeNull());
  await frame();
  return { grid, entry, handled };
}

function dispatch(target: Element, action: string) {
  const event =
    action === 'click'
      ? new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
      : new KeyboardEvent('keydown', { key: action, bubbles: true, composed: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('CellEntry shared control boundaries', () => {
  it.each(['metadata', 'tree', 'detail', 'checkbox'])(
    'leaves selector-free %s host and SVG activation to the control exactly once',
    async (kind) => {
      const { grid, entry, handled } = await setup(kind === 'checkbox');
      const activate = vi.fn();
      const cellClick = vi.fn();
      const pluginKeys = vi.spyOn(grid, '_dispatchKeyDown');
      grid.addEventListener('cell-activate', activate);
      grid.addEventListener('cell-click', cellClick);
      grid.focusCell(0, 'value');
      for (const nested of [false, true]) {
        for (const action of ['click', 'Enter', ' ']) {
          const host = grid.querySelector<HTMLElement>(`.rows [data-control="${kind}"]`)!;
          expect(host.matches('button,input,[role],[tabindex]')).toBe(false);
          expect(host.querySelector('button,input,[role],[tabindex]')).toBeNull();
          handled.mockClear();
          dispatch(nested ? host.querySelector('svg')! : host, action);
          await frame();
          expect(handled).toHaveBeenCalledExactlyOnceWith(kind);
          expect(grid.querySelector('.cell.editing')).toBeNull();
          expect(activate).not.toHaveBeenCalled();
          expect(cellClick).not.toHaveBeenCalled();
          expect(pluginKeys).not.toHaveBeenCalled();
        }
      }
      if (kind === 'checkbox') {
        // Checkbox UI is row-selection-only; CellEntry deliberately rejects that mode.
        const listeners = vi.spyOn(grid, 'addEventListener');
        expect(() => entry.attach(grid)).toThrow(/CellEntry requires/);
        expect(listeners).not.toHaveBeenCalled();
        expect(grid.querySelector('.cell.editing')).toBeNull();
        expect(grid.getPluginByName('cellEntry')).toBeUndefined();
        entry.detach();
      }
    },
  );

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'navigates from the actual disclosure cell without plugin dispatch (reverse %s, implicit %s)',
    async (reverse, implicit) => {
      const { grid } = await setup(false, reverse, implicit);
      const pluginKeys = vi.spyOn(grid, '_dispatchKeyDown');
      const activate = vi.fn();
      grid.addEventListener('cell-activate', activate);
      for (const kind of ['tree', 'detail']) {
        for (const nested of [false, true]) {
          const host = grid.querySelector<HTMLElement>(`[data-control="${kind}"]`)!;
          const origin = host.closest<HTMLElement>('.cell[data-col]')!;
          const col = Number(origin.dataset.col);
          grid.focusCell(1, 'metadata');
          const event = dispatch(nested ? host.querySelector('svg')! : host, 'ArrowRight');
          expect(event.defaultPrevented).toBe(true);
          expect(grid._focusRow).toBe(0);
          expect(grid._focusCol).toBe(Math.min(col + 1, grid._visibleColumns.length - 1));
          expect(grid.querySelector('.cell.editing')).toBeNull();
        }
      }
      expect(pluginKeys).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
    },
  );

  it.each(['click', 'Enter', 'F2'])('still opens one ordinary data-cell editor with %s', async (action) => {
    const { grid } = await setup();
    const activate = vi.fn();
    grid.addEventListener('cell-activate', activate);
    grid.focusCell(0, 'value');
    dispatch(grid.querySelector('.cell[data-row="0"][data-field="value"]')!, action);
    await frame();
    expect(grid.querySelectorAll('.cell.editing')).toHaveLength(1);
    expect(grid.querySelector<HTMLInputElement>('.cell.editing input')?.value).toBe('one');
    expect(activate).toHaveBeenCalledTimes(1);
  });
});
