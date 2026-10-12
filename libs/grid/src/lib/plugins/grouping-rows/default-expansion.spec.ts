import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { TreePlugin } from '../tree/tree-plugin';
import { GroupingRowsPlugin } from './grouping-rows-plugin';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

afterEach(() => {
  document.body.innerHTML = '';
});

describe.each([false, true])('initial grouping defaults (Tree root scope: %s)', (withTree) => {
  it.each([false, true, 0, 1])(
    'resolves defaultExpanded=%s once and preserves explicit collapse',
    async (defaultExpanded) => {
      const grouping = new GroupingRowsPlugin({
        groupOn: (row, { parent }) => (parent === null ? row.kind : null),
        defaultExpanded,
      });
      const tree = new TreePlugin({ defaultExpanded: true });
      const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
      grid.gridConfig = {
        columns: [{ field: 'id' }],
        plugins: withTree ? [tree, grouping] : [grouping],
      };
      const source = [
        { id: 'a', kind: 'A', children: [{ id: 'a/leaf', kind: 'A' }] },
        { id: 'b', kind: 'B', children: [{ id: 'b/leaf', kind: 'B' }] },
      ];
      grid.rows = source;
      document.body.append(grid);
      await grid.ready();
      await nextFrame();
      const groups = () =>
        (grid.rows as Record<string, unknown>[])
          .filter((row) => row.__isGroupRow)
          .map((row) => [row.__groupValue, row.__groupExpanded]);
      expect(groups()).toEqual([
        ['A', defaultExpanded === true || defaultExpanded === 0],
        ['B', defaultExpanded === true || defaultExpanded === 1],
      ]);

      for (const key of grouping.getExpandedGroups()) grouping.toggle(key);
      await nextFrame();
      expect(grouping.getExpandedGroups()).toEqual([]);
      grid.rows = [...source];
      await vi.waitFor(() =>
        expect(groups()).toEqual([
          ['A', false],
          ['B', false],
        ]),
      );
      expect(grouping.getExpandedGroups()).toEqual([]);
    },
  );
});

interface ParentRow {
  id: string;
  children: { id: string; kind?: string }[];
}

const parentKeys = (id: string) => ['A', 'B'].map((kind) => JSON.stringify([id, [kind]]));

async function nestedFixture(
  defaultExpanded: boolean | number,
  reversed: boolean,
  source: ParentRow[] = ['alpha', 'beta'].map((id) => ({
    id,
    children: [
      { id: `${id}/a`, kind: 'A' },
      { id: `${id}/b`, kind: 'B' },
    ],
  })),
) {
  const grouping = new GroupingRowsPlugin({
    groupOn: (row, { parent }) => (parent === null ? null : (row.kind ?? null)),
    defaultExpanded,
    animation: false,
  });
  const tree = new TreePlugin({ defaultExpanded: true, animation: false });
  const plugins = [tree, grouping];
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  const config = {
    columns: [{ field: 'id' }],
    getRowId: (row: { id: string }) => row.id,
    plugins: reversed ? plugins.reverse() : plugins,
  };
  grid.gridConfig = config;
  grid.rows = source;
  document.body.append(grid);
  await grid.ready();
  const groups = () =>
    (grid.rows as Record<string, unknown>[])
      .filter((row) => row.__isGroupRow)
      .map((row) => [row.__groupKey, row.__groupExpanded, row.__groupRowCount]);
  return { source, grid, tree, grouping, groups, config };
}

describe.each([false, true])('initial grouping defaults beneath real parents (reversed: %s)', (reversed) => {
  it.each([false, true, 0, 1])('preserves explicit collapse with defaultExpanded=%s', async (defaultExpanded) => {
    const { source, grid, tree, grouping, groups, config } = await nestedFixture(defaultExpanded, reversed);
    const keys = source.flatMap((parent) => parentKeys(parent.id));
    const initial = keys.map((key, index) => [key, defaultExpanded === true || defaultExpanded === index % 2, 1]);
    await vi.waitFor(() => expect(groups()).toEqual(initial));
    for (const parent of source) {
      expect(grid.rows).toContain(parent);
      for (const [index, child] of parent.children.entries()) {
        expect(grid.rows.includes(child)).toBe(defaultExpanded === true || defaultExpanded === index);
      }
    }

    for (const key of grouping.getExpandedGroups()) grouping.toggle(key);
    const expectClosed = () => expect(groups()).toEqual(keys.map((key) => [key, false, 1]));
    await vi.waitFor(expectClosed);
    tree.collapse('alpha');
    await vi.waitFor(() => expect(groups()).toEqual(keys.slice(2).map((key) => [key, false, 1])));
    tree.expand('alpha');
    await vi.waitFor(expectClosed);
    grid.rows = [...source];
    await vi.waitFor(expectClosed);
    expect(grouping.getExpandedGroups()).toEqual([]);
    expect(tree.isExpanded('alpha')).toBe(true);
    expect(tree.isExpanded('beta')).toBe(true);

    grid.gridConfig = { ...config, plugins: [] };
    await vi.waitFor(() => expect(groups()).toEqual([]));
    grid.gridConfig = config;
    await vi.waitFor(() => expect(groups()).toEqual(initial));
  });

  it.each([0, 1])('waits for each parent to have groups with defaultExpanded=%s', async (value) => {
    const source: ParentRow[] = [
      { id: 'alpha', children: [] },
      {
        id: 'beta',
        children: [
          { id: 'beta/a', kind: 'A' },
          { id: 'beta/b', kind: 'B' },
        ],
      },
    ];
    const { grid, tree, grouping, groups } = await nestedFixture(value, reversed, source);
    const beta = parentKeys('beta');
    await vi.waitFor(() => expect(groups()).toEqual(beta.map((key, index) => [key, index === value, 1])));
    expect(grid.rows).toContain(source[0]);
    grouping.toggle(beta[value]);
    await vi.waitFor(() => expect(grouping.getExpandedGroups()).toEqual([]));

    const ungrouped = { id: 'alpha/ungrouped' };
    source[0].children = [ungrouped];
    grid.rows = [...source];
    await vi.waitFor(() => expect(groups()).toHaveLength(2));
    tree.expand('alpha');
    await vi.waitFor(() => expect(grid.rows).toContain(ungrouped));
    expect(groups()).toEqual(beta.map((key) => [key, false, 1]));

    source[0].children = [
      { id: 'alpha/a', kind: 'A' },
      { id: 'alpha/b', kind: 'B' },
    ];
    grid.rows = [...source];
    const alpha = parentKeys('alpha');
    await vi.waitFor(() =>
      expect(groups()).toEqual([
        ...alpha.map((key, index) => [key, index === value, 1]),
        ...beta.map((key) => [key, false, 1]),
      ]),
    );
    grouping.toggle(alpha[value]);
    await vi.waitFor(() => expect(grouping.getExpandedGroups()).toEqual([]));
    grid.rows = source.map((parent) => ({ ...parent }));
    await vi.waitFor(() => expect(groups()).toEqual([...alpha, ...beta].map((key) => [key, false, 1])));
  });

  it('consumes an absent index once the parent has a nonempty group list', async () => {
    const source: ParentRow[] = [{ id: 'alpha', children: [{ id: 'alpha/a', kind: 'A' }] }];
    const { grid, groups } = await nestedFixture(1, reversed, source);
    const keys = parentKeys('alpha');
    await vi.waitFor(() => expect(groups()).toEqual([[keys[0], false, 1]]));
    source[0].children.push({ id: 'alpha/b', kind: 'B' });
    grid.rows = [...source];
    await vi.waitFor(() => expect(groups()).toEqual(keys.map((key) => [key, false, 1])));
  });

  it('does not override an explicit deferred collapse on the next rebuild', async () => {
    const { grid, source, grouping, groups } = await nestedFixture(0, reversed);
    const keys = source.flatMap((parent) => parentKeys(parent.id));
    grouping.setGroupOn((row, { parent }) => (parent === null ? null : row.kind), false);
    await vi.waitFor(() => expect(groups()).toEqual(keys.map((key) => [key, false, 1])));
    grid.rows = [...source];
    await vi.waitFor(() => expect(groups()).toEqual(keys.map((key) => [key, false, 1])));
  });
});
