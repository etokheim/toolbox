import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { TreePlugin } from '../tree/tree-plugin';
import { GroupingRowsPlugin } from './grouping-rows-plugin';
import { buildGroupedRowModel } from './grouping-rows';

afterEach(() => document.body.replaceChildren());

describe('explicit empty group admission', () => {
  it('does not infer absent groups from groupOrder', () => {
    expect(
      buildGroupedRowModel({
        rows: [],
        config: { groupOn: () => 'A', groupOrder: () => ['A'] },
        expanded: new Set(),
      }),
    ).toEqual([]);
  });

  it('admits parent-local fixed empty groups and omits excluded categories', () => {
    const parent = { id: 'p', children: [] };
    const flat = buildGroupedRowModel({
      rows: [],
      config: {
        groupOn: () => null,
        emptyGroups: ({ parent: owner }) => (owner === parent ? [['Visible']] : []),
        groupOrder: () => ['Excluded', 'Visible'],
        childGroupsCollapsible: false,
      },
      context: { parent, depth: 1 },
      scope: 'p',
      expanded: new Set(),
    });
    expect(flat).toMatchObject([{ kind: 'group', value: 'Visible', rows: [], expanded: true, collapsible: false }]);
  });

  it('visits an explicitly expanded empty parent but not collapsed parents or arbitrary leaves', async () => {
    const parent = { id: 'p', children: [] };
    const leaf = { id: 'leaf', children: [] };
    const tree = new TreePlugin({ hasChildren: (row) => row === parent });
    const grouping = new GroupingRowsPlugin({
      groupOn: () => null,
      emptyGroups: ({ parent: owner }) => (owner === parent ? [['Empty']] : []),
      childGroupsCollapsible: false,
    });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<typeof parent>;
    grid.gridConfig = { columns: [{ field: 'id' }], plugins: [tree, grouping], getRowId: (row) => row.id };
    grid.rows = [parent, leaf];
    document.body.append(grid);
    await grid.ready();
    expect(grid.rows).toEqual([parent, leaf]);
    tree.expand('p');
    await vi.waitFor(() => expect(grid.rows).toHaveLength(3));
    expect(grid.rows[1]).toMatchObject({ __isGroupRow: true, __groupValue: 'Empty', __groupExpanded: true });
    grid.rows = [leaf];
    await vi.waitFor(() => expect(grid.rows).toEqual([leaf]));
  });

  it('default-expands only explicitly admitted empty parents without loading', async () => {
    const parent = { id: 'p', children: [] };
    const leaf = { id: 'leaf', children: [] };
    const emptyGroups = vi.fn(({ parent: owner }) => (owner === parent ? [['Visible']] : []));
    const tree = new TreePlugin({ defaultExpanded: true, hasChildren: (row) => row === parent });
    const grouping = new GroupingRowsPlugin({ groupOn: () => null, emptyGroups, childGroupsCollapsible: false });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<typeof parent>;
    grid.gridConfig = { columns: [{ field: 'id' }], plugins: [tree, grouping], getRowId: (row) => row.id };
    grid.rows = [parent, leaf];
    document.body.append(grid);
    await grid.ready();
    expect(grid.rows).toHaveLength(3);
    expect(tree.getRowMeta(parent)).toMatchObject({ hasChildren: true, isExpanded: true });
    expect(tree.getRowMeta(leaf)).toMatchObject({ hasChildren: false, isExpanded: false });
    expect(emptyGroups).not.toHaveBeenCalledWith(expect.objectContaining({ parent: leaf }));
    expect(grid.querySelector('.tbw-row-loading-overlay')).toBeNull();
    grouping.setEmptyGroups(() => []);
    await vi.waitFor(() => expect(grid.rows).toEqual([parent, leaf]));
  });
});
