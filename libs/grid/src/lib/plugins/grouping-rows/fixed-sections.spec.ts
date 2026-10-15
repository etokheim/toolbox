// #region Fixture
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { SelectionPlugin } from '../selection/selection-plugin';
import { StickyRowsPlugin } from '../sticky-rows/sticky-rows-plugin';
import { MultiSortPlugin } from '../multi-sort/multi-sort-plugin';
import { TreePlugin } from '../tree/tree-plugin';
import { GroupingRowsPlugin } from './grouping-rows-plugin';
import type { GroupingRowsConfig } from './types';

interface Row {
  id: string;
  category: string;
  children?: Row[];
}
afterEach(() => document.body.replaceChildren());

async function fixture(reverse: boolean, extra: Partial<GroupingRowsConfig> = {}) {
  const rows: Row[] = ['alpha', 'beta'].map((id) => ({
    id,
    category: id === 'alpha' ? 'Global A' : 'Global B',
    children: ['Primary', 'Secondary', 'Tertiary'].map((category) => ({ id: `${id}/${category}`, category })),
  }));
  const groupOn = (row: Row) => row.category;
  const grouping = new GroupingRowsPlugin({
    groupOn,
    defaultExpanded: true,
    childDefaultExpanded: false,
    childGroupsCollapsible: false,
    animation: false,
    groupOrder: ({ parent }) => (parent ? ['Primary', 'Tertiary', 'Secondary'] : undefined),
    ...extra,
  });
  const tree = new TreePlugin({ defaultExpanded: false, animation: false });
  const selection = new SelectionPlugin({ mode: 'row' });
  const sticky = new StickyRowsPlugin({
    mode: 'push',
    isSticky: (_row, index) => {
      const item = grouping.getFlattenedRows()[index];
      return item?.kind === 'group' && item.collapsible === false;
    },
  });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  const sort = new MultiSortPlugin();
  grid.gridConfig = {
    columns: [{ field: 'id' }, { field: 'category', sortable: true }],
    getRowId: (row: Row) => row.id,
    plugins: [...(reverse ? [grouping, tree] : [tree, grouping]), selection, sticky, sort],
  };
  grid.rows = rows;
  document.body.append(grid);
  await grid.ready();
  const groups = () => grouping.getFlattenedRows().filter((row) => row.kind === 'group');
  tree.expand('alpha');
  tree.expand('beta');
  await vi.waitFor(() => expect(groups()).toHaveLength(8));
  const sections = () => groups().filter((row) => row.depth > 0);
  return { grid, rows, grouping, tree, selection, sticky, sort, groups, sections, groupOn };
}
// #endregion

// #region Fixed section lifecycle

describe.each([false, true])('fixed child sections, reversed=%s', (reverse) => {
  it.each([false, true, 0, 1])(
    'overrides child default %s without changing root or Tree ownership',
    async (childDefaultExpanded) => {
      const f = await fixture(reverse, { childDefaultExpanded });
      expect(f.sections().map((g) => g.value)).toEqual([
        'Primary',
        'Tertiary',
        'Secondary',
        'Primary',
        'Tertiary',
        'Secondary',
      ]);
      expect(f.sections().every((g) => g.expanded && g.collapsible === false && g.rows.length === 1)).toBe(true);
      expect(f.grid.rows).toContain(f.rows[0].children![0]);
      const key = f.sections()[0].key;
      f.selection.selectRows([f.grid.rows.indexOf(f.rows[0])]);
      const changed = vi.fn();
      f.grid.addEventListener('group-toggle', changed);
      const render = vi.spyOn(f.grid, 'requestRender');
      f.grouping.collapse(key);
      f.grouping.toggle(key);
      f.grouping.expand(key);
      expect(f.grouping.isExpanded(key)).toBe(true);
      expect(changed).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      expect(f.selection.getSelectedRows()).toContain(f.rows[0]);
      f.tree.collapse('alpha');
      await vi.waitFor(() => expect(f.grid.rows).not.toContain(f.rows[0].children![0]));
      f.grouping.collapse(key);
      f.tree.expand('alpha');
      await vi.waitFor(() => expect(f.grid.rows).toContain(f.rows[0].children![0]));
      expect(f.sections()[0].key).toBe(key);
      f.grouping.collapse(f.groups()[0].key);
      await vi.waitFor(() => expect(f.grid.rows).not.toContain(f.rows[0]));
      expect(f.tree.isExpanded('alpha')).toBe(true);
    },
  );

  it('preserves fixed keys through bulk, pending, nested paths, accordion and row replacement', async () => {
    const f = await fixture(reverse, { accordion: true });
    const keys = f.sections().map((g) => g.key);
    f.selection.selectRows([f.grid.rows.indexOf(f.rows[0])]);
    f.grouping.collapseAll();
    expect(keys.every((key) => f.grouping.isExpanded(key))).toBe(true);
    await vi.waitFor(() => expect(f.groups()).toHaveLength(2));
    f.grouping.expandAll();
    await vi.waitFor(() => expect(f.sections()).toHaveLength(6));
    expect(f.sections().every((g) => g.expanded)).toBe(true);
    f.grouping.setGroupOn((row: Row, { parent }) => (parent ? [row.category, 'Nested'] : row.category), false);
    f.grouping.collapseAll();
    await vi.waitFor(() => expect(f.groups()).toHaveLength(2));
    f.grouping.expandAll();
    await vi.waitFor(() => expect(f.sections()).toHaveLength(12));
    expect(f.sections().every((g) => g.expanded && g.collapsible === false)).toBe(true);
    f.grid.rows = f.rows.map((row) => ({ ...row, children: row.children?.map((child) => ({ ...child })) }));
    await vi.waitFor(() => expect(f.grid.rows).not.toContain(f.rows[0]));
    expect(f.sections().every((g) => g.expanded && g.collapsible === false)).toBe(true);
    const root = f.groups().find((g) => g.depth === 0)!;
    f.grouping.toggle(root.key);
    await vi.waitFor(() => expect(f.grouping.isExpanded(root.key)).toBe(false));
    f.grouping.toggle(root.key);
    await vi.waitFor(() => expect(f.grouping.isExpanded(root.key)).toBe(true));
    await vi.waitFor(() => expect(f.groups().filter((g) => g.depth === 0 && g.expanded)).toHaveLength(1));
    expect(f.sections().every((g) => g.expanded)).toBe(true);
  });

  it.each([true, false])(
    'omits native expansion affordances for fullWidth=%s and ignores Space/header activation',
    async (fullWidth) => {
      const f = await fixture(reverse, { fullWidth });
      const section = f.sections()[0];
      const index = f.grouping.getFlattenedRows().findIndex((g) => g.kind === 'group' && g.key === section.key);
      const row = [...f.grid.querySelectorAll('.rows .group-row')].find((row) => row.textContent?.includes('Primary'))!;
      const cell = row.querySelector<HTMLElement>('.cell')!;
      expect(row.hasAttribute('aria-expanded')).toBe(false);
      expect(row.querySelector('button, [aria-expanded], [role="button"]')).toBeNull();
      await f.grid.focusCell(index, 0);
      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      f.grid.dispatchEvent(event);
      cell.click();
      expect(f.grouping.isExpanded(section.key)).toBe(true);
      expect(row.getAttribute('aria-level')).not.toBeNull();
      const global = f.grid.querySelector('.rows .group-row')!;
      expect(global.getAttribute('aria-expanded')).toBe('true');
      expect(global.querySelector('button')).not.toBeNull();
    },
  );

  it('does not invoke custom disclosure renderers for sections', async () => {
    const disclosureRenderer = vi.fn<NonNullable<GroupingRowsConfig['disclosureRenderer']>>(() =>
      document.createElement('button'),
    );
    const f = await fixture(reverse, { disclosureRenderer });
    expect(disclosureRenderer).toHaveBeenCalled();
    expect(disclosureRenderer.mock.calls.every(([context]) => context.depth === 0)).toBe(true);
    expect(f.sections().every((g) => g.collapsible === false)).toBe(true);
  });

  it('makes native structural rows available to existing sticky push through the public flattened model', async () => {
    const f = await fixture(reverse);
    const index = f.grouping.getFlattenedRows().findIndex((g) => g.kind === 'group' && g.collapsible === false);
    const cell = f.grid.querySelector(`.rows .group-row .cell[data-row="${index}"]`);
    expect(cell).not.toBeNull();
    f.sticky.afterRender();
    f.sticky.onScroll({
      scrollTop: (index + 1) * f.grid._virtualization.rowHeight,
      scrollLeft: 0,
      scrollHeight: 1000,
      scrollWidth: 500,
      clientHeight: 100,
      clientWidth: 500,
    });
    const clone = f.grid.querySelector('.tbw-sticky-rows .tbw-sticky-row');
    expect(clone?.textContent).toContain('Primary');
    expect(clone?.getAttribute('data-sticky-row')).toBe(String(index));
    expect(clone?.querySelector('button, [aria-expanded]')).toBeNull();
    expect(clone?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('keeps whole-header renderer policy and guarded toggle action consistent', async () => {
    const render = vi.fn<NonNullable<GroupingRowsConfig['groupRowRenderer']>>((context) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.textContent = String(context.value);
      return cell;
    });
    const f = await fixture(reverse, { groupRowRenderer: render });
    const context = render.mock.calls.map(([context]) => context).find((context) => context.collapsible === false)!;
    expect(context).toBeDefined();
    context.toggleExpand();
    expect(f.grouping.isExpanded(context.key)).toBe(true);
    expect(render.mock.calls.some(([context]) => context.depth === 0 && context.collapsible !== false)).toBe(true);
  });

  it.each(['full', 'column', 'element', 'html'])(
    'stamps current processed indexes through recycling and regrouping, header=%s',
    async (header) => {
      const f = await fixture(
        reverse,
        header === 'element' || header === 'html'
          ? {
              groupRowRenderer: (context) => {
                if (header === 'html') return `<div class="cell" data-col="0">${context.value}</div>`;
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.setAttribute('data-col', '0');
                cell.textContent = String(context.value);
                return cell;
              },
            }
          : { fullWidth: header === 'full' },
      );
      const checkIndexes = () => {
        const rendered = [...f.grid.querySelectorAll('.rows > .group-row')];
        expect(rendered.length).toBeGreaterThan(0);
        for (const row of rendered) {
          const cell = row.querySelector('.cell')!;
          const index = Number(cell.getAttribute('data-row'));
          expect(cell.hasAttribute('data-row')).toBe(true);
          const item = f.grouping.getFlattenedRows()[index];
          expect(item.kind).toBe('group');
          if (item.kind === 'group') expect(cell.textContent).toContain(String(item.value));
          expect(Number(row.getAttribute('aria-rowindex'))).toBe(index + 2);
        }
      };
      checkIndexes();
      const pooled = [...f.grid.querySelectorAll('.rows > .data-grid-row')].map((row) => ({
        row,
        text: row.textContent,
      }));
      f.tree.collapse('alpha');
      await vi.waitFor(() => expect(f.grid.rows).not.toContain(f.rows[0].children![0]));
      checkIndexes();
      expect(pooled.some(({ row, text }) => row.isConnected && row.textContent !== text)).toBe(true);
      f.tree.expand('alpha');
      await vi.waitFor(() => expect(f.grid.rows).toContain(f.rows[0].children![0]));
      checkIndexes();
      f.sort.setSortModel([{ field: 'category', direction: 'desc' }]);
      await vi.waitFor(() => expect(f.groups()[0].value).toBe('Global B'));
      checkIndexes();
      f.sort.setSortModel([{ field: 'category', direction: 'asc' }]);
      await vi.waitFor(() => expect(f.groups()[0].value).toBe('Global A'));
      checkIndexes();
      f.grouping.setGroupOrder(({ parent }) => (parent ? ['Secondary', 'Primary'] : ['Global B', 'Global A']));
      await vi.waitFor(() => expect(f.groups()[0].value).toBe('Global B'));
      checkIndexes();
      f.grouping.setGroupOn((row: Row, { parent }) => (parent ? `Section ${row.category}` : row.category), true);
      await vi.waitFor(() => expect(f.sections()[0].value).toContain('Section '));
      checkIndexes();
      const index = f.grouping.getFlattenedRows().findIndex((g) => g.kind === 'group' && g.collapsible === false);
      f.sticky.afterRender();
      f.sticky.onScroll({
        scrollTop: (index + 1) * f.grid._virtualization.rowHeight,
        scrollLeft: 0,
        scrollHeight: 1000,
        scrollWidth: 500,
        clientHeight: 100,
        clientWidth: 500,
      });
      expect(f.grid.querySelector('.tbw-sticky-row')?.textContent).toContain(String(f.sections()[0].value));
    },
  );

  it('preserves a real nested grid owner while indexing reused custom group headers', async () => {
    const nested = document.createElement(DataGridElement.activeTag) as DataGridElement<{ id: string }>;
    nested.gridConfig = { columns: [{ field: 'id' }], getRowId: (row) => row.id };
    nested.rows = [{ id: 'nested-first' }, { id: 'nested-second' }];
    document.body.append(nested);
    await nested.ready();
    const nestedCells = [...nested.querySelectorAll('.rows > .data-grid-row > .cell')];
    expect(nestedCells).toHaveLength(2);
    const writes = nestedCells.map((cell) => vi.spyOn(cell, 'setAttribute'));
    const f = await fixture(reverse, {
      groupRowRenderer: (context) => {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.append(String(context.value));
        if (context.value === 'Global B') cell.append(nested);
        return cell;
      },
    });
    const checkOwners = () => {
      expect(nested.isConnected).toBe(true);
      expect([...nested.querySelectorAll('.rows > .data-grid-row > .cell')]).toEqual(nestedCells);
      nestedCells.forEach((cell, index) => {
        expect(cell.getAttribute('data-row')).toBe(String(index));
        expect(writes[index].mock.calls.every(([name, value]) => name !== 'data-row' || value === String(index))).toBe(
          true,
        );
      });
      const headers = [...f.grid.querySelectorAll('.rows > .group-row')];
      expect(headers.length).toBeGreaterThan(0);
      for (const row of headers) {
        const cell = row.querySelector(':scope > .cell')!;
        const index = Number(cell.getAttribute('data-row'));
        expect(cell.hasAttribute('data-row')).toBe(true);
        const item = f.grouping.getFlattenedRows()[index];
        expect(item.kind).toBe('group');
        if (item.kind === 'group') expect(cell.firstChild?.textContent).toBe(String(item.value));
        expect(Number(row.getAttribute('aria-rowindex'))).toBe(index + 2);
      }
    };
    checkOwners();
    const pooled = [...f.grid.querySelectorAll('.rows > .group-row')].map((row) => ({
      row,
      text: row.textContent,
    }));
    f.tree.collapse('alpha');
    await vi.waitFor(() => expect(f.grid.rows).not.toContain(f.rows[0].children![0]));
    checkOwners();
    expect(pooled.some(({ row, text }) => row.isConnected && row.textContent !== text)).toBe(true);
    f.tree.expand('alpha');
    await vi.waitFor(() => expect(f.grid.rows).toContain(f.rows[0].children![0]));
    checkOwners();
    f.sort.setSortModel([{ field: 'category', direction: 'desc' }]);
    await vi.waitFor(() => expect(f.groups()[0].value).toBe('Global B'));
    checkOwners();
    f.grid.rows = f.rows.map((row) => ({ ...row, children: row.children?.map((child) => ({ ...child })) }));
    await vi.waitFor(() => expect(f.grid.rows).not.toContain(f.rows[0]));
    checkOwners();
  });

  it('retires custom controls on policy replacement and restores collapsibility on removal/re-add', async () => {
    const contexts: Parameters<NonNullable<GroupingRowsConfig['disclosureRenderer']>>[0][] = [];
    const f = await fixture(reverse, {
      childGroupsCollapsible: true,
      childDefaultExpanded: true,
      disclosureRenderer: (context) => {
        contexts.push(context);
        return document.createElement('button');
      },
    });
    const stale = contexts.find((context) => context.depth > 0)!;
    expect(stale).toBeDefined();
    const oldKey = stale.key;
    const replacement = new GroupingRowsPlugin({
      groupOn: f.groupOn,
      defaultExpanded: true,
      childGroupsCollapsible: false,
      animation: false,
    });
    const config = f.grid.gridConfig;
    f.grid.gridConfig = { ...config, plugins: [f.tree, replacement] };
    await vi.waitFor(() => expect(f.grid.getPluginByName('groupingRows')).toBe(replacement));
    f.tree.expand('alpha');
    await vi.waitFor(() => expect(f.grid.rows).toContain(f.rows[0].children![0]));
    stale.setExpanded(false);
    expect(replacement.isExpanded(oldKey)).toBe(true);
    f.grid.gridConfig = { ...config, plugins: [] };
    await vi.waitFor(() => expect(f.grid.getPluginByName('groupingRows')).toBeUndefined());
    f.grid.gridConfig = config;
    await vi.waitFor(() => expect(f.grid.getPluginByName('groupingRows')).toBe(f.grouping));
    f.tree.expand('alpha');
    await vi.waitFor(() => expect(f.sections().length).toBeGreaterThan(0));
    f.grouping.collapse(oldKey);
    await vi.waitFor(() => expect(f.grid.rows).not.toContain(f.rows[0].children![0]));
  });
});
// #endregion

// #region Compatibility
it.each([undefined, true, false])(
  'leaves standalone and predefined groups collapsible, policy=%s',
  async (childGroupsCollapsible) => {
    for (const predefined of [false, true]) {
      const grouping = new GroupingRowsPlugin({
        childGroupsCollapsible,
        defaultExpanded: true,
        ...(predefined ? { groups: [{ key: 'A', value: 'A', rowCount: 1 }] } : { groupOn: () => 'A' }),
      });
      const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
      grid.gridConfig = { columns: [{ field: 'id' }], plugins: [grouping] };
      grid.rows = [{ id: 'a' }];
      document.body.append(grid);
      await grid.ready();
      const group = grouping.getFlattenedRows()[0];
      expect(group.kind).toBe('group');
      if (group.kind !== 'group') throw new Error('Missing group');
      expect(group.collapsible).not.toBe(false);
      grouping.collapse(group.key);
      expect(grouping.isExpanded(group.key)).toBe(false);
      grid.remove();
    }
  },
);
// #endregion
