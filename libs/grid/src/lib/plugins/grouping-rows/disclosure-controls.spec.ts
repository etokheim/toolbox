import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { ownControlBoundary, releaseCell } from '../../core/internal/control-lifecycle';
import type { ControlView } from '../../core/types';
import { MasterDetailPlugin } from '../master-detail/master-detail-plugin';
import { SelectionPlugin } from '../selection/selection-plugin';
import { TreePlugin } from '../tree/tree-plugin';
import { GroupingRowsPlugin } from './grouping-rows-plugin';
import type { GroupingRowsConfig, GroupingRowsDisclosureContext as Context } from './types';

type Row = { id: string; name: string; category: string; team: string };
const rows: Row[] = [
  { id: '1', name: 'One', category: 'A', team: 'X' },
  { id: '2', name: 'Two', category: 'A', team: 'Y' },
  { id: '3', name: 'Three', category: 'B', team: 'X' },
];

function control(contexts: Context[], dispose = vi.fn()) {
  return vi.fn((initial: Context): ControlView<Context> => {
    const element = document.createElement('button');
    element.type = 'button';
    element.dataset['customGroup'] = initial.key;
    let current = initial;
    const update = (context: Context) => {
      current = context;
      contexts.push(context);
      element.setAttribute('aria-label', context.ariaLabel);
      element.setAttribute('aria-expanded', String(context.expanded));
      element.disabled = context.disabled;
    };
    element.onclick = () => current.setExpanded(!current.expanded);
    update(initial);
    return { element, update, dispose };
  });
}

async function setup(config: GroupingRowsConfig = {}, singleColumn = false, withExpander = false) {
  const plugin = new GroupingRowsPlugin({ groupOn: (row: Row) => row.category, animation: false, ...config });
  const selection = new SelectionPlugin({ mode: 'row' });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  grid.gridConfig = {
    columns: singleColumn ? [{ field: 'name' }] : [{ field: 'name' }, { field: 'category' }],
    plugins: [
      plugin,
      selection,
      ...(withExpander ? [new MasterDetailPlugin({ detailRenderer: () => document.createElement('div') })] : []),
    ],
  };
  grid.rows = rows;
  document.body.append(grid);
  await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
  await grid.ready();
  await vi.waitFor(() => expect(grid.querySelectorAll('.group-row').length).toBeGreaterThan(0));
  return { grid, plugin, selection };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('GroupingRows disclosure controls', () => {
  // #region Active leases and cleanup
  it('rejects an active old-renderer action before the scheduled replacement refresh', async () => {
    const contexts: Context[] = [];
    const dispose = vi.fn();
    const { grid, plugin } = await setup({
      groups: [
        { key: 'A', value: 'A' },
        { key: 'B', value: 'B' },
      ],
      disclosureRenderer: control(contexts, dispose),
    });
    const old = contexts.find((context) => context.key === 'A')!;
    const replacements: Context[] = [];
    const renderer = control(replacements);
    const toggles = vi.fn();
    const expands = vi.fn();
    grid.addEventListener('group-toggle', toggles);
    grid.addEventListener('group-expand', expands);

    plugin.setDisclosureRenderer(renderer);
    // No await: the old view is still mounted and has not been disposed.
    expect(renderer).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(old.host.isConnected).toBe(true);
    expect(old.host.querySelector('button')).not.toBeNull();
    old.setExpanded(true);
    expect(plugin.getExpandedGroups()).toEqual([]);
    expect(toggles).not.toHaveBeenCalled();
    expect(expands).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(renderer).toHaveBeenCalledTimes(2));
    expect(dispose).toHaveBeenCalledTimes(2);
    const current = replacements.find((context) => context.key === 'A')!;
    expect(current.host).toBe(old.host);
    current.setExpanded(true);
    expect(plugin.isExpanded('A')).toBe(true);
    expect(toggles).toHaveBeenCalledTimes(1);
    expect(expands).toHaveBeenCalledTimes(1);
  });

  it('suppresses active same-state actions against live state, including before context refresh', async () => {
    const contexts: Context[] = [];
    const dispose = vi.fn();
    const { grid, plugin } = await setup({
      groups: [{ key: 'A', value: 'A' }],
      disclosureRenderer: control(contexts, dispose),
    });
    const context = contexts.find((value) => value.key === 'A')!;
    const toggles = vi.fn();
    const expands = vi.fn();
    const collapses = vi.fn();
    grid.addEventListener('group-toggle', toggles);
    grid.addEventListener('group-expand', expands);
    grid.addEventListener('group-collapse', collapses);
    context.setExpanded(false);
    expect(plugin.isExpanded('A')).toBe(false);
    expect(toggles).not.toHaveBeenCalled();
    expect(expands).not.toHaveBeenCalled();
    expect(collapses).not.toHaveBeenCalled();

    context.setExpanded(true);
    context.setExpanded(true);
    expect(context.expanded).toBe(false);
    expect(plugin.isExpanded('A')).toBe(true);
    expect(toggles).toHaveBeenCalledTimes(1);
    expect(expands).toHaveBeenCalledTimes(1);
    expect(collapses).not.toHaveBeenCalled();
    context.setExpanded(false);
    context.setExpanded(false);
    expect(plugin.isExpanded('A')).toBe(false);
    expect(toggles).toHaveBeenCalledTimes(2);
    expect(expands).toHaveBeenCalledTimes(1);
    expect(collapses).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it.each(['host', 'row'] as const)(
    'rejects a detached %s before refresh and cleans up exactly once',
    async (target) => {
      const contexts: Context[] = [];
      const dispose = vi.fn();
      const { grid, plugin } = await setup({ disclosureRenderer: control(contexts, dispose) });
      const context = contexts.find((value) => value.key === 'A')!;
      const cell = context.host.closest<HTMLElement>('.cell')!;
      const row = cell.parentElement!;
      const toggles = vi.fn();
      const expands = vi.fn();
      grid.addEventListener('group-toggle', toggles);
      grid.addEventListener('group-expand', expands);
      (target === 'host' ? context.host : row).remove();
      expect(grid.isConnected).toBe(true);
      expect(grid.contains(row)).toBe(target === 'host');
      expect(cell.contains(context.host)).toBe(target === 'row');
      expect(dispose).not.toHaveBeenCalled();

      context.setExpanded(true);
      expect(plugin.getExpandedGroups()).toEqual([]);
      expect(toggles).not.toHaveBeenCalled();
      expect(expands).not.toHaveBeenCalled();
      plugin.afterRender();
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(context.host.children).toHaveLength(0);
      plugin.afterRender();
      releaseCell(grid, cell);
      expect(dispose).toHaveBeenCalledTimes(1);
      grid.remove();
      expect(dispose).toHaveBeenCalledTimes(2);
    },
  );
  // #endregion

  // #region Generated header composition and recycling
  it('preserves generated expander cell order, control identity and focus in per-column headers', async () => {
    const contexts: Context[] = [];
    const dispose = vi.fn();
    const renderA = control(contexts, dispose);
    const renderOther = control(contexts);
    const renderer = vi.fn((context: Context) => (context.key === 'A' ? renderA : renderOther)(context));
    const { grid, plugin } = await setup({ disclosureRenderer: renderer, fullWidth: false }, false, true);
    const context = contexts.find((value) => value.key === 'A')!;
    const button = context.host.querySelector<HTMLButtonElement>('button')!;
    const row = context.host.closest<HTMLElement>('.group-row')!;
    const cells = Array.from(row.children);
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute('data-field')).toBe('__tbw_expander');
    expect(cells[0].children).toHaveLength(0);
    expect(context.host.parentElement).toBe(cells[1]);
    expect(cells.map((cell) => cell.getAttribute('data-col'))).toEqual(['0', '1', '2']);
    expect(cells[1].textContent).toContain('A');
    expect(cells[1].textContent).toContain('(2)');
    button.focus();

    plugin.expand('A');
    await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
    plugin.collapse('A');
    await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
    expect(Array.from(row.children)).toEqual(cells);
    expect(context.host.parentElement).toBe(cells[1]);
    expect(cells[0].children).toHaveLength(0);
    expect(cells[1].querySelector('button')).toBe(button);
    expect(grid.contains(row)).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(renderer.mock.calls.filter(([value]) => value.key === 'A')).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('disposes a header recycled into a model-produced loading row and recovers focus', async () => {
    const contexts: Context[] = [];
    const dispose = vi.fn();
    const { grid, plugin } = await setup({
      groups: [{ key: 'A', value: 'A', rowCount: 2 }],
      disclosureRenderer: control(contexts, dispose),
    });
    const context = contexts.find((value) => value.key === 'A')!;
    const cell = context.host.closest<HTMLElement>('.cell')!;
    const row = cell.parentElement!;
    context.host.querySelector<HTMLButtonElement>('button')!.focus();
    plugin.expand('A');
    plugin.setGroupLoading('A', true);
    const model = plugin.processRows([]);
    const index = model.findIndex((value) => value.__loading === true);
    expect(index).toBeGreaterThan(0);
    expect(plugin.renderRow(model[index], row, index)).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(context.host.isConnected).toBe(false);
    expect(row.classList.contains('group-row')).toBe(false);
    expect(row.querySelectorAll(':scope > .cell')).toHaveLength(1);
    expect(row.querySelectorAll('.tbw-row-loading-overlay')).toHaveLength(1);
    expect(row.getAttribute('aria-busy')).toBe('true');
    expect(row.firstElementChild?.getAttribute('role')).toBe('gridcell');
    expect(document.activeElement).toBe(grid);
    const toggles = vi.fn();
    grid.addEventListener('group-toggle', toggles);
    context.setExpanded(false);
    expect(plugin.isExpanded('A')).toBe(true);
    expect(toggles).not.toHaveBeenCalled();
    plugin.renderRow(model[index], row, index);
    releaseCell(grid, cell);
    grid.remove();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  // #endregion

  describe.each(['disable', 'remove'] as const)('grouping teardown: %s', (operation) => {
    it.each([false, true])('removes group metadata and controls from reused data rows (custom=%s)', async (custom) => {
      const contexts: Context[] = [];
      const dispose = vi.fn();
      const renderer = control(contexts, dispose);
      const { grid, plugin, selection } = await setup(
        { defaultExpanded: true, disclosureRenderer: custom ? renderer : undefined },
        true,
      );
      const context = contexts.find((value) => value.key === 'A');
      context?.host.querySelector<HTMLButtonElement>('button')!.focus();
      if (operation === 'disable') plugin.setGroupOn(undefined);
      else grid.gridConfig = { ...grid.gridConfig, plugins: [selection] };
      await vi.waitFor(() => expect(grid.querySelectorAll('.data-grid-row')).toHaveLength(rows.length));
      expect(grid.querySelector('.group-toggle')).toBeNull();
      expect(grid.querySelector('[data-custom-group]')).toBeNull();
      if (custom) {
        expect(dispose).toHaveBeenCalledTimes(renderer.mock.calls.length);
        const toggles = vi.fn();
        grid.addEventListener('group-toggle', toggles);
        context!.setExpanded(false);
        expect(toggles).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(grid);
      }
      const groupAttributes = ['aria-expanded', 'aria-level', 'aria-setsize', 'aria-posinset', 'data-group-depth'];
      const metadata = Array.from(grid.querySelectorAll<HTMLElement>('.data-grid-row'), (row) => ({
        text: row.textContent,
        attributes: Array.from(row.attributes)
          .filter((attribute) => groupAttributes.includes(attribute.name))
          .map((attribute) => [attribute.name, attribute.value]),
        expandedClass: row.classList.contains('tbw-row-expanded'),
        depthStyle: row.style.getPropertyValue('--tbw-group-depth'),
      }));
      expect(metadata).toEqual(
        rows.map((row) => ({ text: row.name, attributes: [], expandedClass: false, depthStyle: '' })),
      );
    });
  });

  it('leaves a successor Tree plugin and ordinary row semantics intact after grouping teardown', async () => {
    const { grid, plugin, selection } = await setup({ defaultExpanded: true, disclosureRenderer: control([]) }, true);
    const tree = new TreePlugin({ defaultExpanded: true });
    const treeRows = [{ ...rows[0], children: [rows[1]] }, rows[2]];
    grid.rows = treeRows;
    grid.gridConfig = { ...grid.gridConfig, plugins: [tree, selection] };
    await vi.waitFor(() => {
      expect(grid.querySelector('.rows-body')?.getAttribute('role')).toBe('treegrid');
      expect(grid.querySelectorAll('.data-grid-row')).toHaveLength(3);
      expect(grid.querySelector('.data-grid-row')?.getAttribute('aria-expanded')).toBe('true');
    });
    expect(grid.getPluginByName('tree')).toBe(tree);
    const metadata = () =>
      Array.from(grid.querySelectorAll('.data-grid-row'), (row) =>
        ['role', 'aria-expanded', 'aria-level', 'aria-setsize', 'aria-posinset', 'aria-selected'].map((name) =>
          row.getAttribute(name),
        ),
      );
    const expected = metadata();
    plugin.detach();
    expect(metadata()).toEqual(expected);
    expect(grid.querySelector('.rows-body')?.getAttribute('role')).toBe('treegrid');
    expect(grid.querySelectorAll('.data-grid-row')).toHaveLength(3);
  });

  // #region Defensive hook coverage (not user-route reproductions)
  it.each(['missing', 'data'] as const)('rejects an active action when its projected row is %s', async (kind) => {
    const contexts: Context[] = [];
    const dispose = vi.fn();
    const { grid, plugin } = await setup({ disclosureRenderer: control(contexts, dispose) });
    const context = contexts.find((value) => value.key === 'B')!;
    if (kind === 'data') plugin.expand('A');
    plugin.processRows(kind === 'missing' ? rows.filter((row) => row.category === 'A') : rows);
    const toggles = vi.fn();
    grid.addEventListener('group-toggle', toggles);
    expect(context.host.isConnected).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    context.setExpanded(true);
    expect(plugin.isExpanded('B')).toBe(false);
    expect(toggles).not.toHaveBeenCalled();
    plugin.afterRender();
    expect(dispose).toHaveBeenCalledTimes(1);
    releaseCell(grid, context.host.closest<HTMLElement>('.cell')!);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('directly tests onCellClick boundary rejection and unowned toggle, label and data paths', async () => {
    const { grid, plugin } = await setup();
    let row: unknown = plugin.processRows(rows)[0];
    const host = document.createElement('div');
    const button = document.createElement('button');
    button.className = 'group-toggle';
    host.append(button);
    document.body.append(host);
    const release = ownControlBoundary(host, grid);
    const toggles = vi.fn();
    grid.addEventListener('group-toggle', toggles);
    const handle = vi.fn((originalEvent: MouseEvent) =>
      plugin.onCellClick({
        rowIndex: 0,
        colIndex: 0,
        column: { field: 'name' },
        field: 'name',
        value: 'A',
        row,
        cellEl: host,
        originalEvent,
      }),
    );
    button.addEventListener('click', handle);
    button.click();
    expect(handle).toHaveReturnedWith(undefined);
    expect(plugin.isExpanded('A')).toBe(false);
    expect(toggles).not.toHaveBeenCalled();
    release();
    button.click();
    expect(handle.mock.results.at(-1)?.value).toBe(true);
    expect(plugin.isExpanded('A')).toBe(true);
    expect(toggles).toHaveBeenCalledTimes(1);
    button.className = 'group-label';
    button.click();
    expect(handle.mock.results.at(-1)?.value).toBeUndefined();
    button.className = 'group-toggle';
    row = rows[0];
    button.click();
    expect(handle.mock.results.at(-1)?.value).toBeUndefined();
    expect(plugin.isExpanded('A')).toBe(true);
    expect(toggles).toHaveBeenCalledTimes(1);
  });
  // #endregion

  // #region Existing disclosure contract
  it.each([false, true])('resets a one-column header recycled into a data row (custom=%s)', async (custom) => {
    const { grid, plugin } = await setup(
      {
        defaultExpanded: true,
        disclosureRenderer: custom ? control([]) : undefined,
      },
      true,
    );
    plugin.collapse('A');
    await vi.waitFor(() => expect(grid.querySelectorAll('.data-grid-row:not(.group-row)')).toHaveLength(1));
    const dataRow = grid.querySelector('.data-grid-row:not(.group-row)')!;
    expect(dataRow.textContent).toBe('Three');
    expect(dataRow.hasAttribute('aria-expanded')).toBe(false);
    expect(dataRow.hasAttribute('data-group-depth')).toBe(false);
    expect(dataRow.getAttribute('aria-level')).toBe('2');
  });

  it('retains default button, generated content, localization and Space shortcut', async () => {
    const { grid, plugin } = await setup({ disclosureLabel: (expanded) => (expanded ? 'Close' : 'Open') });
    const button = grid.querySelector<HTMLButtonElement>('.group-toggle')!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toBe('Open');
    expect(grid.querySelector('.group-label')?.textContent).toBe('A');
    expect(grid.querySelector('.group-count')?.textContent).toBe('(2)');
    grid._focusRow = 0;
    plugin.onKeyDown(new KeyboardEvent('keydown', { key: ' ' }));
    expect(plugin.isExpanded('A')).toBe(true);
  });

  it.each([true, false])(
    'preserves mounted controls and focus during same-key refresh (fullWidth=%s)',
    async (fullWidth) => {
      const contexts: Context[] = [];
      const dispose = vi.fn();
      const renderer = control(contexts, dispose);
      const { grid, plugin } = await setup({ disclosureRenderer: renderer, fullWidth });
      const button = grid.querySelector<HTMLButtonElement>('[data-custom-group="A"]')!;
      const host = contexts.find((context) => context.key === 'A')!.host;
      button.focus();
      const events = vi.fn();
      grid.addEventListener('group-toggle', events);
      button.click();
      await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
      expect(events).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(button);
      expect(button.isConnected).toBe(true);
      expect(contexts.filter((context) => context.key === 'A').every((context) => context.host === host)).toBe(true);
      plugin.collapseAll();
      await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
      plugin.expandAll();
      await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
      plugin.collapse('A');
      await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
      plugin.expand('A');
      await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
      expect(renderer.mock.calls.filter(([context]) => context.key === 'A')).toHaveLength(1);
      grid.remove();
      expect(dispose).toHaveBeenCalledTimes(renderer.mock.calls.length);
    },
  );

  it('supports null, replaceable DOM, renderer removal and stale action revocation', async () => {
    const { grid, plugin } = await setup({ disclosureRenderer: () => null });
    expect(grid.querySelector('.group-toggle')).toBeNull();
    expect(grid.querySelector('.group-label')?.textContent).toBe('A');
    const contexts: Context[] = [];
    plugin.setDisclosureRenderer((context) => {
      contexts.push(context);
      const button = document.createElement('button');
      button.dataset['domGroup'] = context.key;
      return button;
    });
    await vi.waitFor(() => expect(grid.querySelector('[data-dom-group]')).not.toBeNull());
    const first = grid.querySelector('[data-dom-group]');
    plugin.afterRender();
    expect(grid.querySelector('[data-dom-group]')).not.toBe(first);
    const stale = contexts[0];
    plugin.setDisclosureRenderer(undefined);
    await vi.waitFor(() => expect(grid.querySelector('.group-toggle')).not.toBeNull());
    stale.setExpanded(true);
    expect(plugin.isExpanded('A')).toBe(false);
  });

  it('revokes recycled, regrouped, removed and explicitly released headers', async () => {
    const contexts: Context[] = [];
    const dispose = vi.fn();
    const { grid, plugin } = await setup({ disclosureRenderer: control(contexts, dispose) });
    const stale = contexts.find((context) => context.key === 'A')!;
    const rowEl = stale.host.closest<HTMLElement>('.group-row')!;
    const replacement = plugin.processRows(rows).find((row) => row.__groupKey === 'B');
    plugin.renderRow(replacement, rowEl, 1);
    stale.setExpanded(true);
    expect(plugin.isExpanded('A')).toBe(false);
    const live = contexts.at(-1)!;
    releaseCell(grid, live.host.closest<HTMLElement>('.cell')!);
    live.setExpanded(true);
    expect(plugin.getExpandedGroups()).toEqual([]);
    plugin.setGroupOn((row: Row) => [row.category, row.team], true);
    await vi.waitFor(() => expect(grid.querySelector('[data-custom-group="A||X"]')).not.toBeNull());
    const nested = contexts.find((context) => context.key === 'A||X')!;
    expect(nested.depth).toBe(1);
    plugin.setGroupOn(undefined);
    nested.setExpanded(false);
    await vi.waitFor(() => expect(grid.querySelector('.group-row')).toBeNull());
    expect(dispose).toHaveBeenCalled();
  });

  it('releases pre-defined identities when their parent path changes and preserves server counts', async () => {
    const contexts: Context[] = [];
    const { grid, plugin } = await setup({
      groups: [{ key: 'root', value: 'Root', children: [{ key: 'leaf', value: 'Leaf', rowCount: 90 }] }],
      defaultExpanded: true,
      disclosureRenderer: control(contexts),
    });
    const leaf = contexts.find((context) => context.key === 'leaf')!;
    expect(leaf.rowCount).toBe(90);
    expect(leaf.rows).toEqual([]);
    const events = vi.fn();
    grid.addEventListener('group-collapse', events);
    leaf.setExpanded(false);
    expect(events.mock.calls[0][0].detail.groupPath).toEqual(['root', 'leaf']);
    plugin.setGroups([{ key: 'other', value: 'Other', children: [{ key: 'leaf', value: 'Leaf' }] }]);
    leaf.setExpanded(true);
    expect(plugin.isExpanded('leaf')).toBe(false);
  });

  it('leaves control click and Space to native handlers without invoking selection or group shortcuts', async () => {
    const contexts: Context[] = [];
    const { grid, plugin } = await setup({ disclosureRenderer: control(contexts) });
    const button = grid.querySelector<HTMLButtonElement>('[data-custom-group="A"]')!;
    const toggles = vi.fn();
    const selections = vi.fn();
    grid.addEventListener('group-toggle', toggles);
    grid.addEventListener('selection-change', selections);
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(toggles).not.toHaveBeenCalled();
    button.click();
    expect(plugin.isExpanded('A')).toBe(true);
    expect(toggles).toHaveBeenCalledTimes(1);
    expect(selections).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps native and ordinary row focus selection while exempting only focused disclosures (custom=%s)',
    async (custom) => {
      const { grid, plugin, selection } = await setup({ disclosureRenderer: custom ? control([]) : undefined });
      const button = grid.querySelector<HTMLButtonElement>('.group-row button')!;
      button.focus();
      button.click();
      await vi.waitFor(() => expect(grid.querySelectorAll('.data-grid-row:not(.group-row)')).toHaveLength(2));
      selection.afterRender();
      expect(selection.getSelectedRowIndices()).toEqual(custom ? [] : [0]);
      grid.focusCell(1, 0);
      selection.afterRender();
      expect(selection.getSelectedRowIndices()).toEqual([1]);
      plugin.collapseAll();
    },
  );

  it.each(['undefined', 'string', 'throw'] as const)(
    'diagnoses invalid renderer output (%s) without native fallback',
    async (kind) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      // @ts-expect-error Deliberately exercise invalid JavaScript renderer returns.
      const invalid: GroupingRowsConfig['disclosureRenderer'] = () => {
        if (kind === 'throw') throw new Error('renderer failed');
        return kind === 'string' ? 'bad' : undefined;
      };
      const { grid } = await setup({ disclosureRenderer: invalid });
      expect(warning.mock.calls.flat().join(' ')).toContain('TBW');
      expect(grid.querySelector('.group-toggle')).toBeNull();
      expect(grid.querySelector('.group-label')?.textContent).toBe('A');
    },
  );

  it('retains whole-row renderer precedence', async () => {
    const disclosureRenderer = vi.fn(() => null);
    const { grid } = await setup({ disclosureRenderer, groupRowRenderer: () => '<strong>Header</strong>' });
    expect(grid.querySelector('.group-row strong')?.textContent).toBe('Header');
    expect(disclosureRenderer).not.toHaveBeenCalled();
  });
  // #endregion
});
