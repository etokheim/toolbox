import { afterAll, beforeAll, bench, describe } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { GroupingRowsPlugin } from '../grouping-rows/grouping-rows-plugin';
import { TreePlugin } from '../tree/tree-plugin';

interface Row {
  id: string;
  name: string;
  kind?: string;
  children?: Row[];
}

const sorted = process.env.TBW_BENCH_TREE_SORT === '1';
const modes = sorted ? (['tree-sorted'] as const) : (['tree', 'grouping', 'composed'] as const);
const fixtures = [10, 100, 1000].flatMap((parents) => {
  const roots = Array.from({ length: parents }, (_, parent) => ({
    id: `parent-${parent}`,
    name: `Parent ${sorted ? String(parent).padStart(4, '0') : parent}`,
    children: Array.from({ length: 100 }, (_, child) => ({
      id: `${parent}/${child}`,
      name: `Child ${sorted ? String(child).padStart(4, '0') : child}`,
      kind: `Kind ${child % 10}`,
    })),
  })) satisfies Row[];
  return modes.map((mode) => ({
    parents,
    mode,
    rows: mode === 'grouping' ? roots.flatMap((row) => row.children) : roots,
    expected: parents * 100 + (mode === 'grouping' ? 10 : parents * (mode === 'composed' ? 11 : 1)),
    last: roots[sorted ? 0 : parents - 1].children[sorted ? 0 : 99],
    sortedOrder: sorted ? roots.toReversed().flatMap((root) => [root, ...root.children.toReversed()]) : undefined,
    grid: document.createElement(DataGridElement.activeTag) as DataGridElement,
  }));
});

beforeAll(async () => {
  for (const fixture of fixtures) {
    if (fixture.mode === 'composed' && process.env.TBW_BENCH_COMPOSITION !== '1') continue;
    fixture.grid.gridConfig = {
      columns: [{ field: 'name', sortable: true }],
      plugins: [
        ...(fixture.mode === 'grouping' ? [] : [new TreePlugin({ defaultExpanded: true })]),
        ...(fixture.mode === 'tree' || fixture.mode === 'tree-sorted'
          ? []
          : [
              new GroupingRowsPlugin({
                groupOn: (row) => row.kind ?? null,
                defaultExpanded: true,
                animation: false,
              }),
            ]),
      ],
    };
    fixture.grid.rows = fixture.rows;
    document.body.append(fixture.grid);
    await fixture.grid.ready();
    if (sorted) {
      const header = fixture.grid.querySelector<HTMLElement>('[role="columnheader"][data-field="name"]');
      if (!header) throw new Error('Missing Tree sort header');
      header.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      header.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const model = fixture.grid._pluginManager?.processRows(fixture.rows);
    if (!model) throw new Error('Missing plugin pipeline for benchmark fixture');
    const expectedGroups =
      fixture.mode === 'tree' || fixture.mode === 'tree-sorted'
        ? 0
        : fixture.mode === 'grouping'
          ? 10
          : fixture.parents * 10;
    if (
      model.filter((row) => row.__isGroupRow).length !== expectedGroups ||
      model.some((row) => row.__isGroupRow && !row.__groupExpanded)
    ) {
      throw new Error(`Invalid ${fixture.mode} group count or expansion state`);
    }
    const sortedOrder = fixture.sortedOrder;
    const byKind = (a: Row, b: Row) => String(a.kind).localeCompare(String(b.kind));
    const expectedRows =
      sortedOrder ??
      (fixture.mode === 'grouping'
        ? fixture.rows.toSorted(byKind)
        : fixture.rows.flatMap((row) => {
            const children = 'children' in row ? row.children : [];
            return [row, ...(fixture.mode === 'composed' ? children.toSorted(byKind) : children)];
          }));
    const realRows = model.filter((row) => !row.__isGroupRow);
    if (realRows.length !== expectedRows.length || realRows.some((row, index) => row !== expectedRows[index])) {
      throw new Error(`${fixture.mode} output differs from the complete expected occurrence order`);
    }
  }
});

afterAll(() => {
  for (const fixture of fixtures) fixture.grid.remove();
});

describe('row-model rebuild (no DOM rendering)', () => {
  for (const fixture of fixtures) {
    const enabled = fixture.mode !== 'composed' || process.env.TBW_BENCH_COMPOSITION === '1';
    let previous: unknown[] | undefined;
    bench.skipIf(!enabled)(
      `${fixture.mode}: ${fixture.parents * 100} children`,
      () => {
        const result = fixture.grid._pluginManager?.processRows(fixture.rows);
        if (!result) throw new Error('Missing plugin pipeline for benchmark fixture');
        if (result === previous || result.length !== fixture.expected || result.at(-1) !== fixture.last) {
          throw new Error(`Expected fresh ${fixture.expected}-row ${fixture.mode} model, received ${result.length}`);
        }
        previous = result;
      },
      { time: 500, iterations: 20 },
    );
  }
});
