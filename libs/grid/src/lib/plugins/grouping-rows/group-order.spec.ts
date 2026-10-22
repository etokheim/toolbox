import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { MultiSortPlugin } from '../multi-sort/multi-sort-plugin';
import { TreePlugin } from '../tree/tree-plugin';
import { GroupingRowsPlugin } from './grouping-rows-plugin';
import { buildGroupedRowModel } from './grouping-rows';
import type { GroupingRowsConfig, RenderRow } from './types';

const groupRows = (rows: RenderRow[]) => rows.filter((row) => row.kind === 'group');

afterEach(() => document.body.replaceChildren());

describe('groupOrder category ranking', () => {
  it('uses first duplicate positions, omits absent categories and sorts unlisted values normally', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((category) => ({ category }));
    const groupOrder = vi.fn(() => ['C', 'C', 'C', 'Missing', 'B']);
    const flat = buildGroupedRowModel({
      rows,
      config: { groupOn: (row) => row.category, groupOrder },
      expanded: new Set(),
      groupSortDirections: new Map([[0, -1]]),
    });
    expect(groupOrder).toHaveBeenCalledExactlyOnceWith({ parent: null, depth: 0 });
    expect(groupRows(flat).map((row) => row.value)).toEqual(['C', 'B', 'E', 'D', 'A']);
    expect(groupRows(flat).map((row) => row.key)).toEqual(['C', 'B', 'E', 'D', 'A']);
    expect(groupRows(flat).every((row) => row.rows.length === 1)).toBe(true);
  });

  it.each([undefined, () => undefined, () => []])(
    'retains direction and raw-value ordering for omitted/empty ranking',
    (groupOrder) => {
      const flat = buildGroupedRowModel({
        rows: [2, 10, 1, null].map((category) => ({ category })),
        config: { groupOn: (row) => [row.category], groupOrder },
        expanded: new Set(),
        groupSortDirections: new Map([[0, -1]]),
      });
      expect(groupRows(flat).map((row) => row.value)).toEqual([null, 10, 2, 1]);
    },
  );

  it('matches normalized segments without changing raw values or keys', () => {
    const flat = buildGroupedRowModel({
      rows: [2, 10, null].map((category) => ({ category })),
      config: { groupOn: (row) => [row.category], groupOrder: () => ['∅', '10'] },
      expanded: new Set(),
    });
    expect(groupRows(flat).map((row) => [row.key, row.value])).toEqual([
      ['∅', null],
      ['10', 10],
      ['2', 2],
    ]);
  });

  it('resolves one ranking per natural sibling build and reuses it across nested group levels', () => {
    const parent = { id: 'parent' };
    const context = { parent, depth: 3 };
    const rows = [
      { id: 'aa', path: ['A', 'A'] },
      { id: 'ab', path: ['A', 'B'] },
      { id: 'ba', path: ['B', 'A'] },
      { id: 'bb', path: ['B', 'B'] },
    ];
    const groupOrder = vi.fn(() => ['B']);
    const config: GroupingRowsConfig = { groupOn: (row) => row.path, groupOrder };
    const flat = buildGroupedRowModel({
      rows,
      config,
      expanded: new Set(['A', 'B', 'A||A', 'A||B', 'B||A', 'B||B']),
      context,
    });
    expect(groupOrder).toHaveBeenCalledExactlyOnceWith(context);
    expect(groupRows(flat).map((row) => [row.key, row.rows.length])).toEqual([
      ['B', 2],
      ['B||B', 1],
      ['B||A', 1],
      ['A', 2],
      ['A||B', 1],
      ['A||A', 1],
    ]);
    expect(flat.filter((row) => row.kind === 'data').map((row) => row.row)).toEqual([
      rows[3],
      rows[2],
      rows[1],
      rows[0],
    ]);
  });
});

interface Row {
  id: string;
  category: string;
  score: number;
  children?: Row[];
}

describe.each([false, true])('parent-scoped groupOrder (reversed: %s)', (reversed) => {
  it('keeps the prefix independent of MultiSort, root ordering unchanged and counts/identity/expansion intact', async () => {
    const rows: Row[] = ['A', 'Z'].map((category) => ({
      id: `root/${category}`,
      category,
      score: 0,
      children: ['A', 'B', 'C', 'D'].flatMap((value) =>
        [2, 1].map((score) => ({ id: `${category}/${value}/${score}`, category: value, score })),
      ),
    }));
    const tree = new TreePlugin({ defaultExpanded: true, animation: false });
    const grouping = new GroupingRowsPlugin({
      groupOn: (row: Row) => row.category,
      groupOrder: ({ parent }) => (parent === null ? undefined : ['B', 'A']),
      defaultExpanded: true,
      animation: false,
    });
    const sort = new MultiSortPlugin();
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    grid.gridConfig = {
      getRowId: (row) => row.id,
      columns: [
        { field: 'id' },
        { field: 'category', sortable: true },
        { field: 'score', type: 'number', sortable: true },
      ],
      plugins: [...(reversed ? [grouping, tree] : [tree, grouping]), sort],
    };
    grid.rows = rows;
    document.body.append(grid);
    await grid.ready();
    sort.setSortModel([
      { field: 'category', direction: 'desc' },
      { field: 'score', direction: 'asc' },
    ]);
    const groups = () => groupRows(grouping.getFlattenedRows());
    await vi.waitFor(() => {
      expect(groups()).toHaveLength(10);
      expect(groups()[0].value).toBe('Z');
    });
    const keys = new Set(groups().map((row) => row.key));
    expect(groups().map((row) => row.value)).toEqual(['Z', 'B', 'A', 'D', 'C', 'A', 'B', 'A', 'D', 'C']);
    for (const parent of rows) {
      expect(grid.rows).toContain(parent);
      for (const category of ['A', 'B', 'C', 'D']) {
        const children = parent.children!.filter((row) => row.category === category);
        expect(grid.rows.indexOf(children[1])).toBeLessThan(grid.rows.indexOf(children[0]));
      }
    }
    const child = groups()[1];
    expect(child.rows).toHaveLength(2);
    grouping.collapse(child.key);
    sort.setSortModel([
      { field: 'category', direction: 'asc' },
      { field: 'score', direction: 'desc' },
    ]);
    await vi.waitFor(() =>
      expect(groups().map((row) => row.value)).toEqual(['A', 'B', 'A', 'C', 'D', 'Z', 'B', 'A', 'C', 'D']),
    );
    expect(new Set(groups().map((row) => row.key))).toEqual(keys);
    expect(grouping.isExpanded(child.key)).toBe(false);
    expect(
      groups()
        .filter((row) => row.depth > 0)
        .every((row) => row.rows.length === 2),
    ).toBe(true);
    expect(tree.isExpanded('root/A')).toBe(true);
    expect(tree.isExpanded('root/Z')).toBe(true);
    const order: GroupingRowsConfig['groupOrder'] = ({ parent }) => (parent ? ['D'] : undefined);
    grouping.setGroupOrder(order);
    await vi.waitFor(() =>
      expect(groups().map((row) => row.value)).toEqual(['A', 'D', 'A', 'B', 'C', 'Z', 'D', 'A', 'B', 'C']),
    );
    const render = vi.spyOn(grid, 'requestRender');
    grouping.setGroupOrder(order);
    expect(render).not.toHaveBeenCalled();
    grouping.setGroupOrder(undefined);
    await vi.waitFor(() =>
      expect(groups().map((row) => row.value)).toEqual(['A', 'A', 'B', 'C', 'D', 'Z', 'A', 'B', 'C', 'D']),
    );
    expect(new Set(groups().map((row) => row.key))).toEqual(keys);
    expect(grouping.isExpanded(child.key)).toBe(false);
    render.mockRestore();
  });
});
