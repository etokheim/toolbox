/**
 * @vitest-environment happy-dom
 *
 * Composition of TreePlugin + GroupingRowsPlugin through the HierarchyPlugin (#504).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeaderClickEvent } from '../../core/plugin/types';
import { GroupingRowsPlugin } from '../grouping-rows/grouping-rows-plugin';
import type { GroupingRowsConfig } from '../grouping-rows/types';
import { TreePlugin } from '../tree/tree-plugin';
import { HierarchyPlugin } from './hierarchy-plugin';
import { MultiSortPlugin } from '../multi-sort/multi-sort-plugin';
import { invalidateAccessorCache } from '../../core/internal/value-accessor';

import '../../../index';
import type { ColumnConfig, GridElement } from '../../../public';
import { nextFrame, waitUpgrade } from '../../../../test/helpers';

/** Delivery plans (tree) whose children are grouped by kind. */
function plans() {
  return [
    {
      id: 'p1',
      name: 'Plan 1',
      children: [
        { id: 'p1-a', name: 'Cargo A', kind: 'Cargo' },
        { id: 'p1-b', name: 'Deal B', kind: 'Deal' },
        { id: 'p1-c', name: 'Cargo C', kind: 'Cargo' },
      ],
    },
    { id: 'p2', name: 'Plan 2', children: [{ id: 'p2-a', name: 'Deal A', kind: 'Deal' }] },
  ];
}

async function setup(
  grouping: GroupingRowsConfig,
  rows: unknown[] = plans(),
  columns: ColumnConfig[] = [{ field: 'name', header: 'Name' }],
  reversePlugins = false,
) {
  const grid = document.createElement('tbw-grid') as GridElement;
  document.body.appendChild(grid);
  const plugins = [new TreePlugin({ defaultExpanded: true }), new GroupingRowsPlugin(grouping)];
  grid.gridConfig = {
    columns,
    plugins: reversePlugins ? plugins.reverse() : plugins,
  };
  grid.rows = rows;
  await waitUpgrade(grid);
  return grid;
}

/** `name` of data rows, `[group value]` of group rows, in render order. */
function labels(grid: GridElement): string[] {
  return (grid.rows as Array<Record<string, unknown>>).map((r) =>
    r.__isGroupRow ? `[${String(r.__groupValue)}]` : String(r.name),
  );
}

const groupKey = (parent: string, ...path: string[]) => JSON.stringify([parent, path]);

describe('hierarchy: Tree + GroupingRows', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('auto-attaches one HierarchyPlugin and warns about no incompatibility', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const grid = await setup({ groupOn: (row, { depth }) => (depth > 0 ? row.kind : null) });

    const names = (grid._pluginManager?.getPlugins() ?? []).map((p) => p.name);
    expect(names.filter((n) => n === 'hierarchy')).toHaveLength(1);
    expect(names.indexOf('hierarchy')).toBeLessThan(names.indexOf('tree'));
    expect(grid.getPluginByName('hierarchy')).toBeInstanceOf(HierarchyPlugin);
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/incompatible/i);
  });

  it('groups the children of each tree node, leaving the root level ungrouped', async () => {
    const grid = await setup({
      groupOn: (row, { depth }) => (depth > 0 ? row.kind : null),
      defaultExpanded: true,
    });

    expect(labels(grid)).toEqual([
      'Plan 1',
      '[Cargo]',
      'Cargo A',
      'Cargo C',
      '[Deal]',
      'Deal B',
      'Plan 2',
      '[Deal]',
      'Deal A',
    ]);
  });

  it.each([false, true])(
    'resolves keyboard Tree toggles after structural rows (reversed: %s)',
    async (reversePlugins) => {
      const grid = await setup(
        { groupOn: (row, { depth }) => (depth > 0 ? row.kind : null), defaultExpanded: true },
        plans(),
        [{ field: 'name', header: 'Name' }],
        reversePlugins,
      );
      const tree = grid.getPluginByName('tree')!;
      const space = () => new KeyboardEvent('keydown', { key: ' ', cancelable: true });

      for (const label of ['[Cargo]', 'Cargo A']) {
        grid._focusRow = labels(grid).indexOf(label);
        const event = space();
        expect(tree.onKeyDown(event)).toBeUndefined();
        expect(event.defaultPrevented).toBe(false);
      }

      grid._focusRow = labels(grid).indexOf('Plan 2');
      expect(grid._focusRow).toBe(6);
      expect(tree.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBeUndefined();
      const collapse = space();
      expect(tree.onKeyDown(collapse)).toBe(true);
      expect(collapse.defaultPrevented).toBe(true);
      expect(tree.isExpanded('p2')).toBe(false);
      expect(tree.isExpanded('p1')).toBe(true);
      await vi.waitFor(() => expect(labels(grid)).not.toContain('Deal A'));

      grid._focusRow = labels(grid).indexOf('Plan 2');
      const expand = space();
      expect(tree.onKeyDown(expand)).toBe(true);
      expect(expand.defaultPrevented).toBe(true);
      expect(tree.isExpanded('p2')).toBe(true);
      await vi.waitFor(() => expect(labels(grid)).toContain('Deal A'));
    },
  );

  it('passes the tree parent and depth to groupOn and keys nested groups per parent', async () => {
    const calls: Array<[string | null, number]> = [];
    const grid = await setup({
      groupOn: (row, { parent, depth }) => {
        calls.push([parent && typeof parent === 'object' && 'id' in parent ? String(parent.id) : null, depth]);
        return depth > 0 ? row.kind : null;
      },
      defaultExpanded: true,
    });

    expect(calls).toContainEqual([null, 0]);
    expect(calls).toContainEqual(['p1', 1]);
    expect(calls).toContainEqual(['p2', 1]);
    const groupKeys = (grid.rows as Array<Record<string, unknown>>)
      .filter((r) => r.__isGroupRow)
      .map((r) => r.__groupKey);
    expect(groupKeys).toEqual([groupKey('p1', 'Cargo'), groupKey('p1', 'Deal'), groupKey('p2', 'Deal')]);
  });

  it('announces structural depth through aria-level on tree, group and grouped rows', async () => {
    const grid = await setup({
      groupOn: (row, { depth }) => (depth > 0 ? row.kind : null),
      defaultExpanded: true,
    });

    const levels = Array.from(grid.querySelectorAll('.rows .data-grid-row')).map((el) => el.getAttribute('aria-level'));
    // Plan 1, [Cargo], Cargo A, Cargo C, [Deal], Deal B, Plan 2, [Deal], Deal A
    expect(levels).toEqual(['1', '2', '3', '3', '2', '3', '1', '2', '3']);
    expect(grid.querySelector('.rows-body')?.getAttribute('role')).toBe('treegrid');

    const tree = grid.getPluginByName('tree');
    // Tree indents grouped children by their structural depth.
    expect(tree?.getRowMeta(grid.rows[2] as Record<string, unknown>)?.depth).toBe(2);
  });

  it('collapses a nested group without touching the tree expansion', async () => {
    const grid = await setup({
      groupOn: (row, { depth }) => (depth > 0 ? row.kind : null),
      defaultExpanded: true,
    });

    grid.getPluginByName('groupingRows')?.toggle(groupKey('p1', 'Cargo'));
    await nextFrame();

    expect(labels(grid)).toEqual(['Plan 1', '[Cargo]', '[Deal]', 'Deal B', 'Plan 2', '[Deal]', 'Deal A']);
    expect(grid.getPluginByName('tree')?.isExpanded('p1')).toBe(true);
  });

  it('applies setGroupOn(fn, true) to nested groups seen in an earlier grouping', async () => {
    const byKind = (row: Record<string, unknown>, { depth }: { depth: number }) => (depth > 0 ? row.kind : null);
    const grid = await setup({ groupOn: byKind, defaultExpanded: true });
    const grouping = grid.getPluginByName('groupingRows');
    const expanded = labels(grid);

    grouping?.setGroupOn(() => null, true);
    await nextFrame();
    grouping?.setGroupOn(byKind, true);
    await nextFrame();

    expect(labels(grid)).toEqual(expanded);
  });

  it('applies accordion only at the depths the predicate selects', async () => {
    const grid = await setup({
      groupOn: (row, { depth }) => (depth > 0 ? row.kind : null),
      accordion: (depth) => depth === 1,
    });
    const grouping = grid.getPluginByName('groupingRows');

    grouping?.toggle(groupKey('p1', 'Cargo'));
    await nextFrame();
    grouping?.toggle(groupKey('p1', 'Deal'));
    await nextFrame();

    expect(grouping?.getExpandedGroups()).toEqual([groupKey('p1', 'Deal')]);
  });

  it('keeps accordion expansion local to the real parent, including equal labels', async () => {
    const grid = await setup({
      groupOn: (row, { parent }) => (parent === null ? null : row.kind),
      accordion: true,
    });
    const grouping = grid.getPluginByName('groupingRows')!;
    grouping.toggle(groupKey('p2', 'Deal'));
    await nextFrame();
    grouping.toggle(groupKey('p1', 'Cargo'));
    await nextFrame();
    grouping.toggle(groupKey('p1', 'Deal'));
    await nextFrame();
    expect(grouping.getExpandedGroups()).toEqual([groupKey('p2', 'Deal'), groupKey('p1', 'Deal')]);
    expect(labels(grid)).toContain('Deal A');
    expect(labels(grid)).toContain('Deal B');
    expect(labels(grid)).not.toContain('Cargo A');
  });

  it('keeps delimiter-bearing parent and group paths collision-free', async () => {
    const grid = await setup(
      { groupOn: (row, { parent }) => (parent === null ? null : row.kind), defaultExpanded: true },
      [
        { id: 'a::b', name: 'Alpha', children: [{ id: 'a/x', name: 'Alpha item', kind: 'c' }] },
        { id: 'a', name: 'Beta', children: [{ id: 'b/x', name: 'Beta item', kind: 'b::c' }] },
      ],
    );
    const grouping = grid.getPluginByName('groupingRows')!;
    expect(grouping.getExpandedGroups()).toHaveLength(2);
    grouping.toggle(groupKey('a::b', 'c'));
    await nextFrame();
    expect(labels(grid)).not.toContain('Alpha item');
    expect(labels(grid)).toContain('Beta item');
  });

  it('keeps equal labels and repeated canonical entities under separate real roots in either plugin order', async () => {
    for (const reverse of [false, true]) {
      const source = [
        {
          id: 'Alpha',
          name: 'Alpha',
          children: [{ id: 'Alpha/X', entityId: 'X', name: 'Alpha item', kind: 'Shared' }],
        },
        { id: 'Beta', name: 'Beta', children: [{ id: 'Beta/X', entityId: 'X', name: 'Beta item', kind: 'Shared' }] },
        { id: 'Empty', name: 'Empty', children: [] },
      ];
      const grid = document.createElement('tbw-grid') as GridElement;
      document.body.appendChild(grid);
      const plugins = [
        new TreePlugin({ defaultExpanded: true }),
        new GroupingRowsPlugin({
          groupOn: (row, { parent }) => (parent === null ? null : row.kind),
          defaultExpanded: true,
        }),
      ];
      grid.gridConfig = { columns: [{ field: 'name' }], plugins: reverse ? plugins.reverse() : plugins };
      grid.rows = source;
      await waitUpgrade(grid);
      expect(labels(grid)).toEqual(['Alpha', '[Shared]', 'Alpha item', 'Beta', '[Shared]', 'Beta item', 'Empty']);
      const groups = grid.rows.filter((row) => row.__isGroupRow);
      expect(groups.map((row) => row.__groupRowCount)).toEqual([1, 1]);
      expect(grid.rows[0]).toBe(source[0]);
      expect(grid.rows[2]).toBe(source[0].children[0]);
      expect(grid.rows[5]).toBe(source[1].children[0]);
      expect(grid.getPluginByName('tree')?.getRowMeta(source[2])?.hasChildren).toBe(false);
      grid.remove();
    }
  });

  it('separates root labels from serialized child keys and delimiter-bearing nested paths', async () => {
    const nestedKey = groupKey('parent', 'a||b', 'c');
    const grid = await setup({ groupOn: (row) => row.path, defaultExpanded: true }, [
      {
        id: 'parent',
        name: 'Parent',
        path: nestedKey,
        children: [
          { id: 'x', name: 'First', path: ['a||b', 'c'] },
          { id: 'y', name: 'Second', path: ['a', 'b||c'] },
        ],
      },
    ]);
    const grouping = grid.getPluginByName('groupingRows')!;
    grouping.expand(nestedKey);
    grouping.expand(groupKey('parent', 'a', 'b||c'));
    await nextFrame();
    expect(new Set(grouping.getExpandedGroups()).size).toBe(5);
    grouping.toggle(nestedKey);
    await nextFrame();
    expect(labels(grid)).toContain('Parent');
    expect(labels(grid)).not.toContain('First');
    expect(labels(grid)).toContain('Second');
    expect(grouping.isExpanded(JSON.stringify([null, [nestedKey]]))).toBe(true);
  });

  it('removes only grouping while keeping Tree and shared hierarchy positions active', async () => {
    const source = plans();
    const grid = await setup(
      {
        groupOn: (row, { parent }) => (parent === null ? null : row.kind),
        defaultExpanded: true,
      },
      source,
    );
    grid.gridConfig = {
      columns: [{ field: 'name' }],
      plugins: [new TreePlugin({ defaultExpanded: true })],
    };
    await vi.waitFor(() => expect(grid.getPluginByName('groupingRows')).toBeUndefined());
    await nextFrame();
    expect(labels(grid)).toEqual(['Plan 1', 'Cargo A', 'Deal B', 'Cargo C', 'Plan 2', 'Deal A']);
    expect(grid.getPluginByName('hierarchy')).toBeDefined();
    expect(grid.querySelector('.rows-body')?.getAttribute('role')).toBe('treegrid');
    expect(grid.getPluginByName('hierarchy')!.getRowMeta(source[0].children![0])?.level).toBe(2);
    expect(grid.querySelectorAll('.group-row')).toHaveLength(0);
  });

  it.each([false, true])(
    'retains root expansion through data activation and releases config in either order (%s)',
    async (reverse) => {
      const grid = document.createElement('tbw-grid') as GridElement;
      const grouping = new GroupingRowsPlugin({ groupOn: (row) => row.kind });
      const source = [
        {
          id: 'root',
          name: 'Root',
          kind: 'Root group',
          children: [{ id: 'leaf', name: 'Leaf', kind: 'Child group' }],
        },
      ];
      const configure = (tree?: TreePlugin) => {
        const plugins = tree ? [grouping, tree] : [grouping];
        grid.gridConfig = { columns: [{ field: 'name' }], plugins: reverse ? plugins.reverse() : plugins };
      };
      const flat = [{ id: 'root', name: 'Root', kind: 'Root group' }];
      configure(new TreePlugin({ defaultExpanded: true }));
      grid.rows = flat;
      document.body.append(grid);
      await waitUpgrade(grid);
      grouping.expand('Root group');
      await nextFrame();
      expect(labels(grid)).toEqual(['[Root group]', 'Root']);
      const scoped = JSON.stringify([null, ['Root group']]);
      grid.rows = source;
      await vi.waitFor(() => expect(grid.rows[0].__groupKey).toBe(scoped));
      expect(grouping.isExpanded(scoped)).toBe(true);
      expect(labels(grid)).toEqual(['[Root group]', 'Root', '[Child group]']);
      grouping.collapse(scoped);
      await nextFrame();
      grid.rows = flat;
      await vi.waitFor(() => expect(grid.rows[0].__groupKey).toBe('Root group'));
      expect(grouping.isExpanded('Root group')).toBe(false);
      configure();
      await vi.waitFor(() => expect(grid.getPluginByName('tree')).toBeUndefined());
      await nextFrame();
      expect(grouping.isExpanded('Root group')).toBe(false);
      expect(labels(grid)).toEqual(['[Root group]']);
      expect(grid.querySelector('.rows-body')?.getAttribute('role')).toBe('treegrid');
      grid.gridConfig = { columns: [{ field: 'name' }], plugins: [] };
      await vi.waitFor(() => expect(grid.getPluginByName('hierarchy')).toBeUndefined());
      expect(grid.querySelector('[aria-level]')).toBeNull();
    },
  );

  it('releases hierarchy ARIA on config removal without overwriting later consumer attributes', async () => {
    const grid = await setup({
      groupOn: (row, { parent }) => (parent === null ? null : row.kind),
      defaultExpanded: true,
    });
    const row = grid.querySelector<HTMLElement>('.rows > .data-grid-row')!;
    row.setAttribute('aria-posinset', '99');
    const hierarchy = grid.getPluginByName('hierarchy')!;
    hierarchy.detach();
    expect(row.getAttribute('aria-level')).toBeNull();
    expect(row.getAttribute('aria-setsize')).toBeNull();
    expect(row.getAttribute('aria-posinset')).toBe('99');
    expect(grid.querySelector('.rows-body')?.getAttribute('role')).toBe('grid');
    grid.gridConfig = { columns: [{ field: 'name' }], plugins: [] };
    await nextFrame();
    expect(grid.getPluginByName('hierarchy')).toBeUndefined();
    expect(grid.querySelector('[aria-level]')).toBeNull();
  });

  it.each([false, true])(
    'preserves Tree expansion and identity across sort and grouping activation (%s)',
    async (reverse) => {
      const grid = document.createElement('tbw-grid') as GridElement;
      const tree = new TreePlugin({ defaultExpanded: true });
      const grouping = new GroupingRowsPlugin();
      const plugins = [tree, grouping];
      const source = plans();
      grid.gridConfig = {
        columns: [{ field: 'name', sortable: true }],
        plugins: reverse ? plugins.reverse() : plugins,
      };
      grid.rows = source;
      document.body.append(grid);
      await waitUpgrade(grid);
      const original = [...grid.rows];
      tree.collapse(source[1].id);
      await nextFrame();
      const collapsed = [...grid.rows];
      const header = grid.querySelector<HTMLElement>('[role="columnheader"][data-field="name"]')!;
      header.click();
      await nextFrame();
      header.click();
      await nextFrame();
      expect(tree.isExpanded(source[0].id)).toBe(true);
      expect(tree.isExpanded(source[1].id)).toBe(false);
      expect(grid.rows).toEqual([
        source[1],
        source[0],
        source[0].children![1],
        source[0].children![2],
        source[0].children![0],
      ]);
      expect(grid.rows.every((row) => original.includes(row))).toBe(true);
      header.click();
      await nextFrame();
      expect(grid.rows).toEqual(collapsed);
      grouping.setGroupOn((row, { parent }) => (parent === null ? null : row.kind), true);
      await nextFrame();
      expect(grid.rows.some((row) => row.__isGroupRow)).toBe(true);
      expect(tree.isExpanded(source[1].id)).toBe(false);
      grouping.setGroupOn(undefined);
      await nextFrame();
      expect(grid.rows).toEqual(collapsed);
      expect(grid.rows.every((row) => original.includes(row))).toBe(true);
      expect(grid.getPluginByName('tree')).toBe(tree);
      expect(grid.getPluginByName('groupingRows')).toBe(grouping);
    },
  );

  it('keeps standalone Tree output unchanged when grouping is inactive', async () => {
    const grid = await setup({ groupOn: () => null });

    expect(labels(grid)).toEqual(['Plan 1', 'Cargo A', 'Deal B', 'Cargo C', 'Plan 2', 'Deal A']);
    expect(grid.getPluginByName('groupingRows')?.isGroupingActive()).toBe(false);
  });

  it.each(['tree', 'grouping'] as const)('does not bypass overridden %s contributor hooks', async (kind) => {
    const plugin =
      kind === 'tree'
        ? new TreePlugin({ defaultExpanded: true })
        : new GroupingRowsPlugin({ groupOn: (row) => row.name, defaultExpanded: true });
    const siblings = vi.spyOn(plugin, 'processSiblings');
    const end = vi.spyOn(plugin, 'endHierarchy');
    const grid = document.createElement('tbw-grid') as GridElement;
    grid.gridConfig = { columns: [{ field: 'name' }], plugins: [plugin] };
    grid.rows = plans();
    document.body.append(grid);
    await waitUpgrade(grid);
    expect(siblings).toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
    expect(grid.getPluginByName('hierarchy')).toBeDefined();
  });

  it('uses configured occurrence IDs for grouping, expandAll and expandToKey', async () => {
    const source = [
      {
        id: 'same',
        occurrence: 'left',
        name: 'Left',
        children: [{ id: 'leaf', occurrence: 'left/x', name: 'X', kind: 'Shared' }],
      },
      {
        id: 'same',
        occurrence: 'right',
        name: 'Right',
        children: [{ id: 'leaf', occurrence: 'right/x', name: 'X', kind: 'Shared' }],
      },
    ];
    const grid = document.createElement('tbw-grid') as GridElement;
    document.body.appendChild(grid);
    grid.gridConfig = {
      columns: [{ field: 'name' }],
      getRowId: (row) => row.occurrence,
      plugins: [
        new TreePlugin(),
        new GroupingRowsPlugin({
          groupOn: (row, { parent }) => (parent === null ? null : row.kind),
          defaultExpanded: true,
        }),
      ],
    };
    grid.rows = source;
    await waitUpgrade(grid);
    const tree = grid.getPluginByName('tree')!;
    tree.expandToKey('right/x');
    await nextFrame();
    expect(tree.isExpanded('right')).toBe(true);
    expect(tree.isExpanded('left')).toBe(false);
    expect(grid.getPluginByName('groupingRows')!.getExpandedGroups()).toContain(groupKey('right', 'Shared'));
    tree.expandAll();
    await nextFrame();
    expect(tree.isExpanded('left')).toBe(true);
    expect(tree.getRowMeta(source[0].children[0])?.key).toBe('left/x');
    expect(tree.getRowMeta(source[1].children[0])?.key).toBe('right/x');
    expect(grid.getPluginByName('groupingRows')!.getExpandedGroups()).toHaveLength(2);
  });

  it('applies all MultiSort keys within parent-local groups and freezes sibling order during row editing', async () => {
    const low = { id: 'low', name: 'Low', kind: 'Shared', first: 1, score: 10 };
    const high = { id: 'high', name: 'High', kind: 'Shared', first: 1, score: 20 };
    const source = [{ id: 'root', name: 'Root', children: [low, high] }];
    const grid = document.createElement('tbw-grid') as GridElement;
    document.body.appendChild(grid);
    const multiSort = new MultiSortPlugin();
    grid.gridConfig = {
      columns: [
        { field: 'name' },
        { field: 'first' },
        { field: 'rank', valueAccessor: ({ row }) => row.score, sortComparator: (a, b) => Number(a) - Number(b) },
      ],
      plugins: [
        new TreePlugin({ defaultExpanded: true }),
        new GroupingRowsPlugin({
          groupOn: (row, { parent }) => (parent === null ? null : row.kind),
          defaultExpanded: true,
        }),
        multiSort,
      ],
    };
    grid.rows = source;
    await waitUpgrade(grid);
    multiSort.handleQuery({
      type: 'sort:set-model',
      context: [
        { field: 'first', direction: 'asc' },
        { field: 'rank', direction: 'desc' },
      ],
    });
    await nextFrame();
    expect(labels(grid)).toEqual(['Root', '[Shared]', 'High', 'Low']);
    expect(source[0].children).toEqual([low, high]);
    grid._activeEditRows = 2;
    low.score = 30;
    invalidateAccessorCache(low);
    grid.requestRender();
    await nextFrame();
    expect(labels(grid)).toEqual(['Root', '[Shared]', 'High', 'Low']);
    grid._activeEditRows = -1;
    grid.requestRender();
    await nextFrame();
    expect(labels(grid)).toEqual(['Root', '[Shared]', 'Low', 'High']);
  });

  it('maps viewport rows to tree roots across interleaved group headers', async () => {
    const grid = await setup({ groupOn: (row, { depth }) => (depth > 0 ? row.kind : null), defaultExpanded: true });
    // Plan 1, [Cargo], Cargo A, Cargo C, [Deal], Deal B, Plan 2, [Deal], Deal A
    const map = (viewportStart: number, viewportEnd: number) =>
      grid
        .getPluginByName('tree')
        ?.handleQuery({ type: 'datasource:viewport-mapping', context: { viewportStart, viewportEnd } });

    expect(map(4, 5)).toEqual({ startNode: 0, endNode: 1, totalLoadedNodes: 2 });
    expect(map(4, 7)).toEqual({ startNode: 0, endNode: 2, totalLoadedNodes: 2 });
  });

  it('sorts nested groups from a header click when only child levels are grouped', async () => {
    const grid = await setup(
      { groupOn: (row, { depth }) => (depth > 0 ? row.kind : null), defaultExpanded: true },
      plans(),
      [
        { field: 'name', header: 'Name' },
        { field: 'kind', header: 'Kind', sortable: true },
      ],
    );
    const grouping = grid.getPluginByName('groupingRows');
    expect(grouping?.handleQuery({ type: 'grouping:get-grouped-fields', context: null })).toEqual(['kind']);

    const column = { field: 'kind', sortable: true };
    expect(grouping?.onHeaderClick({ field: 'kind', column } as HeaderClickEvent)).toBe(true);
    await nextFrame();

    expect(labels(grid).slice(0, 6)).toEqual(['Plan 1', '[Deal]', 'Deal B', '[Cargo]', 'Cargo A', 'Cargo C']);
  });
});

describe('hierarchy: ARIA when nothing is hierarchical', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const items = () => [
    { id: 1, name: 'A', kind: 'Cargo' },
    { id: 2, name: 'B', kind: 'Deal' },
  ];

  async function groupingGrid(groupOn: GroupingRowsConfig['groupOn']) {
    const grid = document.createElement('tbw-grid') as GridElement;
    document.body.appendChild(grid);
    grid.gridConfig = {
      columns: [{ field: 'name', header: 'Name' }],
      plugins: [new GroupingRowsPlugin({ groupOn, defaultExpanded: true })],
    };
    grid.rows = items();
    await waitUpgrade(grid);
    return grid;
  }

  const rowEls = (grid: GridElement) => Array.from(grid.querySelectorAll('.rows .data-grid-row'));
  const hasPosition = (el: Element) =>
    el.hasAttribute('aria-level') || el.hasAttribute('aria-setsize') || el.hasAttribute('aria-posinset');

  it('announces a flat grid when groupOn groups no row', async () => {
    const grid = await groupingGrid(() => null);

    expect(grid.querySelector('.rows-body')?.getAttribute('role')).toBe('grid');
    expect(rowEls(grid).some(hasPosition)).toBe(false);
    expect(grid.getPluginByName('hierarchy')?.getRowMeta(grid.rows[0])).toBeUndefined();
  });

  it('clears pooled row positions when grouping turns off', async () => {
    const grid = await groupingGrid((row) => row.kind);
    expect(rowEls(grid).every(hasPosition)).toBe(true);

    grid.getPluginByName('groupingRows')?.setGroupOn(() => null);
    await nextFrame();
    await nextFrame();

    expect(rowEls(grid).length).toBeGreaterThan(0);
    expect(rowEls(grid).some(hasPosition)).toBe(false);
    expect(grid.querySelector('.rows-body')?.getAttribute('role')).toBe('grid');
  });
});
