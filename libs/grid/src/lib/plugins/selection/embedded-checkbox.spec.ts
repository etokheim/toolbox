import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { isControlEvent, markControlBoundary, releaseControl } from '../../core/internal/control-lifecycle';
import type { CellRenderContext, GridConfig } from '../../core/types';
import { SelectionPlugin } from './selection-plugin';
import type { SelectionConfig, SelectionRowCheckboxBinding, SelectionRowCheckboxContext } from './types';

type Row = { id: string; name: string; locked?: boolean };
const rows: Row[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob', locked: true },
  { id: 'c', name: 'Carol' },
];
type Entry = {
  host: HTMLElement;
  renderContext: CellRenderContext<Row>;
  binding: SelectionRowCheckboxBinding<Row>;
  contexts: (SelectionRowCheckboxContext<Row> | null)[];
};

async function setup(
  config: Partial<SelectionConfig<Row>> = {},
  renderer?: (context: CellRenderContext<Row>, plugin: SelectionPlugin<Row>) => HTMLElement | null,
  overrides: Partial<GridConfig<Row>> = {},
  tag = DataGridElement.activeTag,
  parent: HTMLElement = document.body,
) {
  const entries: Entry[] = [];
  const plugin = new SelectionPlugin<Row>({ mode: 'row', checkbox: false, ...config });
  const grid = document.createElement(tag) as DataGridElement<Row>;
  grid.gridConfig = {
    columns: [
      {
        field: 'name',
        renderer: (context) => {
          if (renderer) return renderer(context, plugin);
          const content = document.createElement('span');
          const host = document.createElement('span');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.disabled = true;
          host.append(input);
          const link = document.createElement('a');
          link.href = '#name';
          link.textContent = context.row.name;
          content.append(host, link);
          const contexts: Entry['contexts'] = [];
          let state: SelectionRowCheckboxContext<Row> | null = null;
          input.onclick = (event) => state?.setChecked(input.checked, event);
          const binding = plugin.bindRowCheckbox(context, host, (next) => {
            state = next;
            contexts.push(next);
            input.disabled = !next || next.disabled;
            input.checked = next?.checked ?? false;
            if (next) input.setAttribute('aria-label', next.ariaLabel);
          });
          entries.push({ host, renderContext: context, binding, contexts });
          return content;
        },
      },
    ],
    plugins: [plugin],
    ...overrides,
  };
  grid.rows = rows.slice();
  parent.append(grid);
  await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
  await grid.ready();
  await Promise.resolve();
  return { grid, plugin, entries };
}

function latest(entry: Entry): SelectionRowCheckboxContext<Row> {
  const context = entry.contexts.at(-1);
  if (!context) throw new Error('Expected active checkbox');
  return context;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('embedded Selection checkbox lifecycle', () => {
  it('reconciles only the acting native checkbox when Shift retains an already selected row', async () => {
    const { grid, plugin, entries } = await setup();
    const first = entries[0];
    const input = first.host.firstElementChild as HTMLInputElement;
    latest(first).setChecked(true);
    plugin.afterRender();
    await Promise.resolve();
    expect(input.checked).toBe(true);
    const siblingNotifications = entries[2].contexts.length;
    const change = vi.fn();
    grid.addEventListener('selection-change', change);
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    plugin.afterRender();
    await Promise.resolve();
    expect(plugin.getSelectedRowIndices()).toEqual([0]);
    expect(input.checked).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    expect(entries[2].contexts).toHaveLength(siblingNotifications);
  });

  it('reconciles single-selection no-ops and newly rejected eligibility without emitting changes', async () => {
    let eligible = true;
    const { grid, plugin, entries } = await setup({ multiSelect: false, isSelectable: () => eligible });
    const input = entries[0].host.firstElementChild as HTMLInputElement;
    input.click();
    await Promise.resolve();
    expect(input.checked).toBe(true);
    const change = vi.fn();
    grid.addEventListener('selection-change', change);
    input.click();
    await Promise.resolve();
    expect(input.checked).toBe(true);
    expect(change).not.toHaveBeenCalled();
    eligible = false;
    input.click();
    await Promise.resolve();
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
    expect(plugin.getSelectedRowIndices()).toEqual([0]);
    expect(change).not.toHaveBeenCalled();
  });

  it('keeps the in-flight click classified as a control after synchronous disposal', async () => {
    const { grid, plugin, entries } = await setup();
    latest(entries[0]).setChecked(true);
    plugin.afterRender();
    await Promise.resolve();
    const change = vi.fn();
    const click = vi.fn();
    const pluginClick = vi.spyOn(plugin, 'onCellClick');
    grid.addEventListener('selection-change', change);
    grid.addEventListener('cell-click', click);
    grid.addEventListener('selection-change', () => entries[2].binding.dispose(), { once: true });
    (entries[2].host.firstElementChild as HTMLInputElement).click();
    await Promise.resolve();
    expect(plugin.getSelectedRowIndices()).toEqual([0, 2]);
    expect(change).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(pluginClick).not.toHaveBeenCalled();
    entries[2].host.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(plugin.getSelectedRowIndices()).toEqual([2]);
  });

  it('preserves a synchronously installed successor without reviving predecessor actions', async () => {
    const { grid, plugin, entries } = await setup();
    const entry = entries[2];
    const input = entry.host.firstElementChild as HTMLInputElement;
    const old = latest(entry);
    let successor: SelectionRowCheckboxBinding<Row> | undefined;
    let current: SelectionRowCheckboxContext<Row> | null = null;
    const changes = vi.fn();
    const pluginClick = vi.spyOn(plugin, 'onCellClick');
    latest(entries[0]).setChecked(true);
    await Promise.resolve();
    grid.addEventListener('selection-change', changes);
    grid.addEventListener(
      'selection-change',
      () => {
        entry.binding.dispose();
        successor = plugin.bindRowCheckbox(entry.renderContext, entry.host, (next) => {
          current = next;
          input.disabled = !next || next.disabled;
          input.checked = next?.checked ?? false;
          input.onclick = (event) => current?.setChecked(input.checked, event);
        });
      },
      { once: true },
    );
    input.click();
    await Promise.resolve();
    expect(plugin.getSelectedRowIndices()).toEqual([0, 2]);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(pluginClick).not.toHaveBeenCalled();
    old.setChecked(false);
    entry.binding.dispose();
    expect(plugin.getSelectedRowIndices()).toEqual([0, 2]);
    input.click();
    await Promise.resolve();
    expect(plugin.getSelectedRowIndices()).toEqual([0]);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(pluginClick).not.toHaveBeenCalled();
    successor!.dispose();
    entry.host.click();
    expect(pluginClick).toHaveBeenCalledTimes(1);
  });

  it('uses actual custom-tag and nested-grid ownership, not containment alone', async () => {
    class CustomGrid extends DataGridElement<Row> {}
    customElements.define('embedded-selection-custom-grid', CustomGrid);
    const outer = await setup();
    const inner = await setup(
      {},
      undefined,
      {},
      'embedded-selection-custom-grid',
      outer.entries[0].renderContext.cellEl!,
    );
    expect(() =>
      outer.plugin.bindRowCheckbox(
        { ...inner.entries[0].renderContext, grid: outer.grid },
        document.createElement('span'),
        vi.fn(),
      ),
    ).toThrow('TBW065');
    expect(() => outer.plugin.bindRowCheckbox(outer.entries[0].renderContext, inner.entries[0].host, vi.fn())).toThrow(
      'TBW065',
    );
    latest(inner.entries[0]).setChecked(true);
    expect(inner.plugin.getSelectedRowIndices()).toEqual([0]);
    expect(outer.plugin.getSelectedRowIndices()).toEqual([]);
    const stale = latest(outer.entries[0]);
    inner.entries[0].renderContext.cellEl!.append(outer.entries[0].host);
    stale.setChecked(true);
    outer.plugin.afterRender();
    await Promise.resolve();
    expect(outer.entries[0].contexts.at(-1)).toBeNull();
    expect(outer.plugin.getSelectedRowIndices()).toEqual([]);
  });

  it('uses getRowId and object fallback without scanning all source rows during STYLE', async () => {
    const getRowId = vi.fn((row: Row) => row.name);
    const keyed = await setup({}, undefined, { getRowId });
    expect(latest(keyed.entries[0]).rowId).toBe('Alice');
    keyed.grid._rows.push(...Array.from({ length: 1000 }, (_, index) => ({ id: `extra:${index}`, name: `${index}` })));
    getRowId.mockClear();
    keyed.plugin.afterRender();
    await Promise.resolve();
    expect(getRowId.mock.calls.length).toBeLessThanOrEqual(keyed.entries.length * 2);
    const entry = keyed.entries[0];
    const old = latest(entry);
    keyed.grid._rows[0] = { id: 'different-id', name: 'Alice' };
    keyed.plugin.afterRender();
    await Promise.resolve();
    expect(latest(entry).row.id).toBe('different-id');
    old.setChecked(true);
    expect(keyed.plugin.getSelectedRowIndices()).toEqual([]);

    const fallback = await setup();
    const unkeyed = { name: 'No ID' } as Row;
    const first = fallback.entries[0];
    fallback.grid._rows[0] = unkeyed;
    first.binding.update({ ...first.renderContext, row: unkeyed });
    await Promise.resolve();
    expect(latest(first).rowId).toBeUndefined();
    const action = latest(first);
    fallback.grid._rows[0] = { ...unkeyed };
    action.setChecked(true);
    fallback.plugin.afterRender();
    await Promise.resolve();
    expect(first.contexts.at(-1)).toBeNull();
    expect(fallback.plugin.getSelectedRowIndices()).toEqual([]);
  });

  it('keeps multiple hosts in one cell independent and preserves a successor boundary', async () => {
    const { plugin, entries, grid } = await setup();
    const first = entries[0];
    const sibling = document.createElement('span');
    first.renderContext.cellEl!.append(sibling);
    const values: (SelectionRowCheckboxContext<Row> | null)[] = [];
    const binding = plugin.bindRowCheckbox(first.renderContext, sibling, (value) => values.push(value));
    await Promise.resolve();
    expect(values.at(-1)?.rowId).toBe('a');
    first.binding.dispose();
    const successor = plugin.bindRowCheckbox(first.renderContext, first.host, vi.fn());
    await Promise.resolve();
    first.binding.dispose();
    expect(isControlEvent({ composedPath: () => [first.host, grid] } as Event, grid)).toBe(true);
    expect(values.at(-1)).not.toBeNull();
    releaseControl(first.renderContext.cellEl!);
    await Promise.resolve();
    expect(values.at(-1)).toBeNull();
    expect(binding.update(first.renderContext)).toBe(false);
    expect(successor.update(first.renderContext)).toBe(false);
  });

  it('keeps Name content without a utility column, forwards native modifiers exactly once and refreshes STYLE', async () => {
    const { grid, plugin, entries } = await setup({ isSelectable: (row) => !row.locked });
    expect(grid.querySelector('[data-field="__tbw_checkbox"]')).toBeNull();
    expect(entries).toHaveLength(3);
    const [first, locked, last] = entries;
    expect(latest(locked).disabled).toBe(true);
    const input = first.host.firstElementChild as HTMLInputElement;
    const change = vi.fn();
    grid.addEventListener('selection-change', change);
    input.focus();
    input.click();
    await vi.waitFor(() => expect(input.checked).toBe(true));
    expect(change).toHaveBeenCalledTimes(1);
    expect(plugin.getSelectedRowIndices()).toEqual([0]);
    const columns = grid._columns;
    latest(last).setChecked(true, { shiftKey: true });
    plugin.afterRender();
    await Promise.resolve();
    expect(plugin.getSelectedRowIndices()).toEqual([0, 2]);
    expect(grid._columns).toBe(columns);
    expect(document.activeElement).toBe(input);
    expect(grid.querySelector('a')?.textContent).toBe('Alice');
    plugin.clearSelection();
    plugin.afterRender();
    await Promise.resolve();
    expect(latest(first).checked).toBe(false);
  });

  it('invalidates actions on update, same-ID fresh data, eligibility changes and different-ID recycling', async () => {
    const { grid, plugin, entries } = await setup({ isSelectable: (row) => !row.locked });
    const entry = entries[0];
    const old = latest(entry);
    entry.binding.update(entry.renderContext);
    old.setChecked(true);
    expect(plugin.getSelectedRowIndices()).toEqual([]);
    await Promise.resolve();
    const beforeRefresh = latest(entry);
    grid._rows[0] = { id: 'a', name: 'Fresh' };
    plugin.afterRender();
    await Promise.resolve();
    expect(latest(entry).row.name).toBe('Fresh');
    beforeRefresh.setChecked(true);
    expect(plugin.getSelectedRowIndices()).toEqual([]);
    const current = latest(entry);
    grid._rows[0].locked = true;
    current.setChecked(true);
    expect(plugin.getSelectedRowIndices()).toEqual([]);
    grid._rows[0] = { id: 'different', name: 'Other' };
    current.setChecked(true);
    plugin.onScrollRender();
    await Promise.resolve();
    expect(entry.contexts.at(-1)).toBeNull();
    expect(plugin.getSelectedRowIndices()).toEqual([]);
    entry.binding.update(entry.renderContext);
    expect(entry.contexts.at(-1)).toBeNull();
  });

  it('settles discarded pending outputs once without registering old-cell cleanup', async () => {
    const notifications: (SelectionRowCheckboxContext<Row> | null)[] = [];
    let binding: SelectionRowCheckboxBinding<Row> | undefined;
    await setup({}, (context, plugin) => {
      const host = document.createElement('span');
      binding = plugin.bindRowCheckbox(context, host, (value) => notifications.push(value));
      expect(host.inert).toBe(true);
      releaseControl(context.cellEl!);
      expect(notifications).toEqual([]);
      return null;
    });
    expect(notifications).toEqual([null, null, null]);
    binding?.dispose();
    await Promise.resolve();
    expect(notifications).toHaveLength(3);
  });

  it('sweeps abandoned pending hosts when renderers throw', async () => {
    const { plugin, entries } = await setup();
    const notified = vi.fn();
    const renderer = () => {
      plugin.bindRowCheckbox(entries[0].renderContext, document.createElement('span'), notified);
      throw new Error('Consumer renderer failed');
    };
    expect(renderer).toThrow('Consumer renderer failed');
    await Promise.resolve();
    expect(notified).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('isolates a throwing listener and permits reentrant update/dispose with one terminal null', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const good: (SelectionRowCheckboxContext<Row> | null)[] = [];
    const bad = vi.fn(() => {
      throw new Error('Broken listener');
    });
    let handle!: SelectionRowCheckboxBinding<Row>;
    const { plugin } = await setup({}, (context, selection) => {
      const host = document.createElement('span');
      let updated = false;
      const current = selection.bindRowCheckbox(
        context,
        host,
        context.row.id === 'b'
          ? bad
          : (value) => {
              good.push(value);
              if (context.row.id !== 'a' || !value) return;
              if (!updated) {
                updated = true;
                handle.update(context);
                value.setChecked(true);
              } else handle.dispose();
            },
      );
      if (context.row.id === 'a') handle = current;
      return host;
    });
    await Promise.resolve();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls.some(([message]) => String(message).includes('TBW065'))).toBe(true);
    expect(good.filter((value) => value === null)).toHaveLength(1);
    expect(plugin.getSelectedRowIndices()).toEqual([]);
    expect(good.some((value) => value?.rowId === 'c')).toBe(true);
  });

  it('removes only owned metadata, preserves sibling interactions and never steals Name-link focus', async () => {
    const { grid, entries } = await setup();
    const first = entries[0];
    const sibling = entries[1];
    const eventFor = (host: HTMLElement) => ({ composedPath: () => [host, grid] }) as Event;
    expect(isControlEvent(eventFor(first.host), grid)).toBe(true);
    const link = grid.querySelector<HTMLAnchorElement>('a')!;
    link.focus();
    first.binding.dispose();
    await Promise.resolve();
    expect(isControlEvent(eventFor(first.host), grid)).toBe(false);
    expect(isControlEvent(eventFor(sibling.host), grid)).toBe(true);
    expect(document.activeElement).toBe(link);
    markControlBoundary(sibling.host, grid);
    sibling.binding.dispose();
    expect(isControlEvent(eventFor(sibling.host), grid)).toBe(true);
  });

  it('rejects wrong-grid ownership and cell-wide hosts but accepts detached pending hosts', async () => {
    const first = await setup();
    const second = await setup();
    expect(() =>
      first.plugin.bindRowCheckbox(second.entries[0].renderContext, document.createElement('span'), vi.fn()),
    ).toThrow('TBW065');
    expect(() =>
      first.plugin.bindRowCheckbox(first.entries[0].renderContext, first.entries[0].renderContext.cellEl!, vi.fn()),
    ).toThrow('TBW065');
    const callback = vi.fn();
    expect(() =>
      first.plugin.bindRowCheckbox(first.entries[0].renderContext, document.createElement('span'), callback),
    ).not.toThrow();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('publishes disabled state and terminal null on detach, rejecting subsequent binding', async () => {
    const { grid, plugin, entries } = await setup();
    grid.effectiveConfig.selectable = false;
    plugin.afterRender();
    await Promise.resolve();
    expect(latest(entries[0]).disabled).toBe(true);
    const old = latest(entries[0]);
    plugin.detach();
    old.setChecked(true);
    await Promise.resolve();
    expect(entries.every((entry) => entry.contexts.at(-1) === null)).toBe(true);
    expect(() => plugin.bindRowCheckbox(entries[0].renderContext, document.createElement('span'), vi.fn())).toThrow(
      'TBW065',
    );
  });

  it('uses captured identity even if the same row object changes its id', async () => {
    const { grid, plugin, entries } = await setup();
    const previous = latest(entries[0]);
    const row = grid._rows[0];
    const id = row.id;
    try {
      row.id = 'reassigned';
      previous.setChecked(true);
      plugin.afterRender();
      await Promise.resolve();
      expect(plugin.getSelectedRowIndices()).toEqual([]);
      expect(entries[0].contexts.at(-1)).toBeNull();
    } finally {
      row.id = id;
    }
  });

  it('does not expand checkbox binding to cell or range mode', async () => {
    for (const mode of ['cell', 'range'] as const) {
      const { plugin, grid } = await setup({ mode }, () => null);
      const cell = grid.querySelector<HTMLElement>('.rows .cell')!;
      expect(() =>
        plugin.bindRowCheckbox(
          { row: rows[0], value: 'Alice', field: 'name', column: { field: 'name' }, grid, cellEl: cell },
          document.createElement('span'),
          vi.fn(),
        ),
      ).toThrow('row-mode');
    }
  });

  it('defers publication through new-cell commit and invalidates only the released cell bucket', async () => {
    const { entries, grid, plugin } = await setup();
    const snapshots = entries.map((entry) => latest(entry));
    releaseControl(entries[0].renderContext.cellEl!);
    await Promise.resolve();
    expect(entries[0].contexts.at(-1)).toBeNull();
    snapshots[0].setChecked(true);
    snapshots[2].setChecked(true);
    expect(plugin.getSelectedRowIndices()).toEqual([2]);
    grid._clearRowPool();
    await Promise.resolve();
    expect(entries.every((entry) => entry.contexts.at(-1) === null)).toBe(true);
    expect(entries.every((entry) => entry.contexts.filter((value) => value === null).length === 1)).toBe(true);
  });
});
