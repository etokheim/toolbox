import { afterAll, beforeAll, bench, describe } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { MultiSortPlugin } from '../multi-sort/multi-sort-plugin';
import { TreePlugin } from '../tree/tree-plugin';

const fixtures = [10, 100, 1000].map((parents) => {
  const roots = Array.from({ length: parents }, (_, parent) => ({
    id: `parent-${parent}`,
    name: `Parent ${String(parent).padStart(4, '0')}`,
    children: Array.from({ length: 100 }, (_, child) => ({
      id: `${parent}/${child}`,
      name: `Child ${String(child).padStart(4, '0')}`,
      kind: `Kind ${child % 10}`,
    })),
  }));
  const expected = roots
    .toReversed()
    .flatMap((root) => [
      root,
      ...root.children.toSorted((a, b) => a.kind.localeCompare(b.kind) || b.name.localeCompare(a.name)),
    ]);
  return {
    roots,
    expected,
    parents,
    grid: document.createElement(DataGridElement.activeTag) as DataGridElement,
    sort: new MultiSortPlugin(),
  };
});

beforeAll(async () => {
  for (const { grid, roots, expected, sort } of fixtures) {
    grid.gridConfig = {
      columns: [
        { field: 'name', sortable: true },
        { field: 'kind', sortable: true },
      ],
      plugins: [new TreePlugin({ defaultExpanded: true }), sort],
    };
    grid.rows = roots;
    document.body.append(grid);
    await grid.ready();
    sort.handleQuery({
      type: 'sort:set-model',
      context: [
        { field: 'kind', direction: 'asc' },
        { field: 'name', direction: 'desc' },
      ],
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const output = grid._pluginManager?.processRows(roots);
    if (!output || output.length !== expected.length || output.some((row, index) => row !== expected[index])) {
      throw new Error('Full MultiSort sibling ordering or occurrence identity differs from the expected model');
    }
  }
});

afterAll(() => {
  for (const { grid } of fixtures) grid.remove();
});

describe('new full sibling MultiSort semantics (no equivalent db9 baseline)', () => {
  for (const { grid, roots, expected, parents } of fixtures) {
    bench(
      `two sort keys: ${parents * 100} children`,
      () => {
        const output = grid._pluginManager?.processRows(roots);
        if (!output || output.length !== expected.length || output.at(-1) !== expected.at(-1)) {
          throw new Error('MultiSort rebuild changed row count or final occurrence');
        }
      },
      { time: 500, iterations: 20 },
    );
  }
});
