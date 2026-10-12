import { afterEach, expect, it, vi } from 'vitest';
import '../../../index';
import type { GridElement } from '../../../public';
import { GroupingRowsPlugin } from '../grouping-rows/grouping-rows-plugin';
import { TreePlugin } from '../tree/tree-plugin';
import { buildHierarchy, buildHierarchyModel } from './hierarchy';
import type { HierarchyPlugin } from './hierarchy-plugin';
import type { HierarchyRowMeta } from './types';

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const rows = () => [
  {
    id: 'entity',
    occurrence: 'root',
    name: 'Root',
    children: [
      { id: 'entity', occurrence: 'root/b', name: 'Beta', kind: 'Shared' },
      { id: 'entity', occurrence: 'root/a', name: 'Alpha', kind: 'Shared' },
    ],
  },
];

afterEach(() => document.body.replaceChildren());

async function setup(reverse = false, observe?: () => void) {
  const tree = new TreePlugin({
    defaultExpanded: true,
    hasChildren: () => {
      observe?.();
      return false;
    },
  });
  const grouping = new GroupingRowsPlugin();
  const plugins = reverse ? [grouping, tree] : [tree, grouping];
  const grid = document.createElement('tbw-grid') as GridElement;
  const config = {
    columns: [{ field: 'name', sortable: true }],
    getRowId: (row: Record<string, unknown>) => String(row.occurrence),
    plugins,
  };
  grid.gridConfig = config;
  grid.rows = rows();
  document.body.append(grid);
  await grid.ready();
  await frame();
  const hierarchy = grid.getPluginByName('hierarchy');
  if (!hierarchy) throw new Error('Missing hierarchy dependency');
  return { grid, tree, grouping, hierarchy, config };
}

it('borrows only a completed generation and retires it on replacement or detach', async () => {
  const { tree } = await setup();
  const first = rows();
  const a = buildHierarchyModel(first, [tree]);
  expect(a.positions).not.toBeInstanceOf(WeakMap);
  expect(a.positions.get(first[0])).toBe(tree.getRowMeta(first[0]));
  expect(a.positions.get(first[0].children[0])?.level).toBe(2);
  const second = rows();
  const b = buildHierarchyModel(second, [tree]);
  expect(a.positions.get(first[0])).toBeUndefined();
  expect(b.positions.get(first[0])).toBeUndefined();
  expect(b.positions.get(second[0].children[0])?.posInSet).toBe(1);
  tree.detach();
  expect(b.positions.get(second[0])).toBeUndefined();
});

it('fully materializes caller-owned maps without retiring or clearing unrelated entries', async () => {
  const { tree } = await setup();
  const source = rows();
  const unrelated = {};
  const sentinel = { level: 99, posInSet: 1, setSize: 1 };
  const map = new WeakMap<object, HierarchyRowMeta>([[unrelated, sentinel]]);
  expect(buildHierarchy(source, [tree], map)).toEqual([source[0], ...source[0].children]);
  const childPosition = map.get(source[0].children[0]);
  expect(childPosition).toBe(tree.getRowMeta(source[0].children[0]));
  tree.collapse('root');
  expect(buildHierarchy(source, [tree], map)).toEqual(source);
  expect(map.get(unrelated)).toBe(sentinel);
  // The public contract asks callers to pass a fresh map: non-emitted entries remain caller-owned.
  expect(map.get(source[0].children[0])).toBe(childPosition);
  const rootPosition = map.get(source[0]);
  tree.detach();
  expect(map.get(source[0])).toBe(rootPosition);
});

it.each([false, true])(
  'keeps positions coherent through sort, composition, replacement and config retirement (%s)',
  async (reverse) => {
    const { grid, tree, grouping, hierarchy, config } = await setup(reverse);
    const first = grid.rows[0];
    const child = grid.rows[1];
    const header = grid.querySelector<HTMLElement>('[role="columnheader"][data-field="name"]');
    if (!header) throw new Error('Missing sort header');
    header.click();
    await frame();
    expect(tree.isExpanded('root')).toBe(true);
    expect(hierarchy.getRowMeta(child)?.posInSet).toBe(2);
    header.click();
    await frame();
    header.click();
    await frame();
    expect(hierarchy.getRowMeta(child)?.posInSet).toBe(1);
    grouping.setGroupOn((row, { parent }) => (parent === null ? null : row.kind), true);
    await frame();
    expect(hierarchy.getRowMeta(child)?.level).toBe(3);
    grouping.setGroupOn(undefined);
    await frame();
    expect(hierarchy.getRowMeta(child)?.level).toBe(2);
    tree.collapse('root');
    await frame();
    expect(hierarchy.getRowMeta(child)).toBeUndefined();
    tree.expand('root');
    await frame();
    const second = rows();
    grid.rows = second;
    await vi.waitFor(() => expect(grid.rows[0]).toBe(second[0]));
    expect(hierarchy.getRowMeta(first)).toBeUndefined();
    expect(hierarchy.getRowMeta(second[0])?.level).toBe(1);
    grid.rows = [];
    await vi.waitFor(() => expect(grid.rows).toHaveLength(0));
    expect(hierarchy.getRowMeta(second[0])).toBeUndefined();
    grid.rows = second;
    await vi.waitFor(() => expect(grid.rows[0]).toBe(second[0]));
    grid.gridConfig = { columns: config.columns, plugins: [] };
    await vi.waitFor(() => expect(grid.getPluginByName('hierarchy')).toBeUndefined());
    expect(hierarchy.getRowMeta(second[0])).toBeUndefined();
    expect(grid.querySelector('[aria-level]')).toBeNull();
    grid.gridConfig = config;
    await vi.waitFor(() => expect(grid.getPluginByName('hierarchy')?.getRowMeta(second[0].children[0])?.level).toBe(2));
  },
);

it('publishes no old or partial positions inside callbacks and rejects re-entrant processing', async () => {
  let action: (() => void) | undefined;
  const { grid, grouping, hierarchy } = await setup(false, () => action?.());
  const source = rows();
  const observed: Array<HierarchyRowMeta | undefined> = [];
  action = () => observed.push(hierarchy.getRowMeta(source[0]));
  hierarchy.process(source, grouping);
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((position) => position === undefined)).toBe(true);
  expect(hierarchy.getRowMeta(source[0])?.level).toBe(1);
  action = () => hierarchy.process(source, grouping);
  expect(() => hierarchy.process(source, grouping)).toThrow('re-entrantly');
  expect(hierarchy.getRowMeta(source[0])).toBeUndefined();
  action = undefined;
  expect(hierarchy.process(source, grouping)).toEqual([source[0], ...source[0].children]);
  expect(hierarchy.getRowMeta(source[0])?.level).toBe(1);
  grid.remove();
});

it.each(['tree', 'hierarchy'] as const)('does not publish a generation retired by a %s callback', async (owner) => {
  let action: (() => void) | undefined;
  const { tree, grouping, hierarchy } = await setup(false, () => action?.());
  action = () => {
    action = undefined;
    const plugin: TreePlugin | HierarchyPlugin = owner === 'tree' ? tree : hierarchy;
    plugin.detach();
  };
  const source = rows();
  expect(() => hierarchy.process(source, grouping)).toThrow('generation changed');
  expect(hierarchy.getRowMeta(source[0])).toBeUndefined();
});
