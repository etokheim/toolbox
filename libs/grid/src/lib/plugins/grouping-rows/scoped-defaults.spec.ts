import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { TreePlugin } from '../tree/tree-plugin';
import { GroupingRowsPlugin } from './grouping-rows-plugin';
import type { GroupingRowsConfig } from './types';

interface Row {
  id: string;
  category: string;
  children?: Row[];
}

afterEach(() => document.body.replaceChildren());

async function fixture(reversed: boolean, config: Partial<GroupingRowsConfig>, empty = false, withTree = true) {
  const rows: Row[] = ['alpha', 'beta'].map((id) => ({
    id,
    category: 'Global',
    children:
      empty && id === 'alpha'
        ? []
        : [
            { id: `${id}/a`, category: 'A' },
            { id: `${id}/b`, category: 'B' },
          ],
  }));
  const groupOn: NonNullable<GroupingRowsConfig['groupOn']> = (row: Row) => row.category;
  const grouping = new GroupingRowsPlugin({ groupOn, animation: false, ...config });
  const tree = new TreePlugin({ defaultExpanded: false, animation: false });
  const plugins = withTree ? [tree, grouping] : [grouping];
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  const gridConfig = {
    columns: [{ field: 'id' }],
    getRowId: (row: Row) => row.id,
    plugins: reversed ? plugins.reverse() : plugins,
  };
  grid.gridConfig = gridConfig;
  grid.rows = rows;
  document.body.append(grid);
  await grid.ready();
  const groups = () => grouping.getFlattenedRows().filter((item) => item.kind === 'group');
  const state = () => groups().map((item) => [item.value, item.expanded]);
  await vi.waitFor(() => expect(groups()).toHaveLength(1));
  return { rows, groupOn, grouping, tree, grid, gridConfig, groups, state };
}

describe.each([false, true])('scoped grouping defaults (reversed: %s)', (reversed) => {
  it('opens global groups and leaves Tree parents and their sections closed without initialization calls', async () => {
    const f = await fixture(reversed, { defaultExpanded: true, childDefaultExpanded: false });
    expect(f.state()).toEqual([['Global', true]]);
    expect(f.tree.isExpanded('alpha')).toBe(false);
    expect(f.tree.isExpanded('beta')).toBe(false);
    expect(f.grid.rows.slice(1)).toEqual(f.rows);
    f.tree.expand('alpha');
    f.tree.expand('beta');
    await vi.waitFor(() =>
      expect(f.state()).toEqual([
        ['Global', true],
        ['A', false],
        ['B', false],
        ['A', false],
        ['B', false],
      ]),
    );
    const alpha = f.groups()[1];
    f.grouping.expand(alpha.key);
    await vi.waitFor(() => expect(f.grid.rows).toContain(f.rows[0].children![0]));
    f.grid.rows = f.rows.map((row) => ({ ...row, children: row.children?.map((child) => ({ ...child })) }));
    await vi.waitFor(() => expect(f.grid.rows).not.toContain(f.rows[0]));
    expect(f.grouping.isExpanded(alpha.key)).toBe(true);
    const rootKey = f.groups()[0].key;
    f.grouping.collapse(rootKey);
    f.grid.rows = [...f.rows];
    await vi.waitFor(() => expect(f.state()).toEqual([['Global', false]]));
    f.grouping.expand(rootKey);
    await vi.waitFor(() => expect(f.groups()).toHaveLength(5));
    expect(f.grouping.isExpanded(alpha.key)).toBe(true);
    expect(
      f
        .groups()
        .slice(2)
        .every((group) => !group.expanded),
    ).toBe(true);
    f.grid.gridConfig = { columns: [{ field: 'id' }] };
    await vi.waitFor(() => expect(f.grid.getPluginByName('groupingRows')).toBeUndefined());
    f.grid.gridConfig = f.gridConfig;
    await vi.waitFor(() => expect(f.state()).toEqual([['Global', true]]));
    f.tree.expand('alpha');
    await vi.waitFor(() =>
      expect(f.state()).toEqual([
        ['Global', true],
        ['A', false],
        ['B', false],
      ]),
    );
  });

  it.each([0, 1])(
    'applies child numeric %s once, including first nonempty data and explicit pending actions',
    async (index) => {
      const f = await fixture(reversed, { defaultExpanded: true, childDefaultExpanded: index }, true);
      f.tree.expand('beta');
      await vi.waitFor(() =>
        expect(f.state()).toEqual([
          ['Global', true],
          ['A', index === 0],
          ['B', index === 1],
        ]),
      );
      const betaKey = f.groups().find((item) => item.depth > 0 && item.expanded)!.key;
      f.grouping.collapse(betaKey);
      f.rows[0].children = [
        { id: 'alpha/a', category: 'A' },
        { id: 'alpha/b', category: 'B' },
      ];
      f.grid.rows = [...f.rows];
      f.tree.expand('alpha');
      await vi.waitFor(() =>
        expect(f.state()).toEqual([
          ['Global', true],
          ['A', index === 0],
          ['B', index === 1],
          ['A', false],
          ['B', false],
        ]),
      );
      f.grouping.setGroupOn(f.groupOn, false);
      await vi.waitFor(() => expect(f.state()).toEqual([['Global', false]]));
      f.grouping.expand(f.groups()[0].key);
      await vi.waitFor(() => expect(f.groups()).toHaveLength(5));
      expect(
        f
          .groups()
          .slice(1)
          .every((group) => !group.expanded),
      ).toBe(true);
      f.grouping.setGroupOn(f.groupOn, true);
      await vi.waitFor(() => expect(f.groups().every((group) => group.expanded)).toBe(true));
    },
  );

  it('keeps root false while opening new child groups and preserving a later explicit child collapse', async () => {
    const f = await fixture(reversed, { defaultExpanded: false, childDefaultExpanded: true });
    expect(f.state()).toEqual([['Global', false]]);
    f.grouping.expand(f.groups()[0].key);
    f.tree.expand('alpha');
    await vi.waitFor(() =>
      expect(f.state()).toEqual([
        ['Global', true],
        ['A', true],
        ['B', true],
      ]),
    );
    f.grouping.collapse(f.groups()[1].key);
    f.rows[0].children!.push({ id: 'alpha/c', category: 'C' });
    f.grid.rows = [...f.rows];
    await vi.waitFor(() =>
      expect(f.state()).toEqual([
        ['Global', true],
        ['A', false],
        ['B', true],
        ['C', true],
      ]),
    );
    f.grouping.setGroupOn(f.groupOn, false);
    await vi.waitFor(() => expect(f.state()).toEqual([['Global', false]]));
    f.grouping.expand(f.groups()[0].key);
    await vi.waitFor(() => expect(f.groups()).toHaveLength(4));
    expect(
      f
        .groups()
        .slice(1)
        .every((group) => !group.expanded),
    ).toBe(true);
  });

  it('does not apply the child override to standalone groups', async () => {
    const f = await fixture(reversed, { defaultExpanded: false, childDefaultExpanded: true }, false, false);
    expect(f.state()).toEqual([['Global', false]]);
    f.grouping.expand(f.groups()[0].key);
    await vi.waitFor(() => expect(f.grid.rows).toHaveLength(3));
    expect(f.state()).toEqual([['Global', true]]);
  });

  it('does not apply child defaults or category ranking to predefined groups', async () => {
    const groupOrder = vi.fn(() => ['A', 'B']);
    const f = await fixture(
      reversed,
      {
        groups: [
          {
            key: 'Global',
            value: 'Global',
            children: [
              { key: 'B', value: 'B', rowCount: 7 },
              { key: 'A', value: 'A', rowCount: 9 },
            ],
          },
        ],
        defaultExpanded: false,
        childDefaultExpanded: true,
        groupOrder,
      },
      false,
      false,
    );
    f.grouping.expand('Global');
    await vi.waitFor(() =>
      expect(f.state()).toEqual([
        ['Global', true],
        ['B', false],
        ['A', false],
      ]),
    );
    expect(groupOrder).not.toHaveBeenCalled();
  });
});
