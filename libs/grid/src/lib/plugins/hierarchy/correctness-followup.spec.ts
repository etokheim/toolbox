import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { EditingPlugin } from '../editing/editing-plugin';
import { GroupingRowsPlugin } from '../grouping-rows/grouping-rows-plugin';
import { TreePlugin } from '../tree/tree-plugin';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe.each([false, true])('edit-freeze invalidation (composed: %s)', (composed) => {
  it.each(['replacement', 'reparent', 'cardinality'] as const)(
    're-sorts changed %s membership without holes',
    async (change) => {
      const lowA = { id: 'a/low', score: 10, kind: 'Shared' };
      const highA = { id: 'a/high', score: 20, kind: 'Shared' };
      const lowB = { id: 'b/low', score: 30, kind: 'Shared' };
      const highB = { id: 'b/high', score: 40, kind: 'Shared' };
      const source = [
        { id: 'a', score: 0, children: [highA, lowA] },
        { id: 'b', score: 100, children: [highB, lowB] },
      ];
      const tree = new TreePlugin({ defaultExpanded: true, treeColumn: 'id' });
      const grouping = new GroupingRowsPlugin({
        groupOn: (row, { parent }) => (parent === null ? null : row.kind),
        defaultExpanded: true,
      });
      const editing = new EditingPlugin({ mode: 'row' });
      const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
      grid.gridConfig = {
        columns: [{ field: 'id' }, { field: 'score', type: 'number', sortable: true, editable: true }],
        plugins: composed ? [tree, grouping, editing] : [tree, editing],
      };
      grid.rows = source;
      document.body.append(grid);
      await grid.ready();
      await nextFrame();
      grid.querySelector<HTMLElement>('[role="columnheader"][data-field="score"]')!.click();
      await vi.waitFor(() => expect(grid.rows.indexOf(lowA)).toBeLessThan(grid.rows.indexOf(highA)));
      editing.beginBulkEdit(0);
      expect(editing.activeEditRow).toBe(0);
      if (change === 'replacement') source[0].children = [highA, { ...lowA, score: 25 }];
      if (change === 'reparent') {
        source[0].children = [highA, lowB];
        source[1].children = [highB, lowA];
      }
      if (change === 'cardinality') source[0].children.push({ id: 'a/new', score: 5, kind: 'Shared' });
      grid.requestRender();
      await vi.waitFor(() => {
        for (const parent of source) {
          const expected = [...parent.children].sort((a, b) => a.score - b.score);
          const actual = grid.rows.filter((row) => parent.children.includes(row));
          expect(actual).toEqual(expected);
          expected.forEach((row, index) => {
            expect(actual[index]).toBe(row);
            expect(tree.getRowMeta(row)).toMatchObject({
              parentKey: parent.id,
              posInSet: index + 1,
              setSize: expected.length,
            });
          });
          expect(tree.isExpanded(parent.id)).toBe(true);
        }
      });
      expect(grid.rows.every((row) => row !== undefined)).toBe(true);
      expect(editing.activeEditRow).toBe(0);
    },
  );
});

it.each([false, true])('releases retained ARIA leases with no contributors (external values: %s)', async (external) => {
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  grid.gridConfig = {
    columns: [{ field: 'id' }],
    plugins: [new TreePlugin({ defaultExpanded: true })],
  };
  grid.rows = [{ id: 'parent', children: [{ id: 'child' }] }];
  document.body.append(grid);
  await grid.ready();
  await nextFrame();
  const hierarchy = grid.getPluginByName('hierarchy')!;
  const row = grid.querySelector<HTMLElement>('.rows > .data-grid-row')!;
  const body = grid.querySelector<HTMLElement>('.rows-body')!;
  expect(row.getAttribute('aria-level')).toBe('1');
  expect(body.getAttribute('role')).toBe('treegrid');
  if (external) {
    row.setAttribute('aria-level', '99');
    body.setAttribute('role', 'region');
  }
  // Defensive hook coverage: normal config replacement detaches the engine first.
  const registry = vi.spyOn(grid._pluginManager!, 'getPlugins').mockReturnValue([hierarchy]);
  hierarchy.afterRender();
  expect(row.getAttribute('aria-level')).toBe(external ? '99' : null);
  expect(row.hasAttribute('aria-setsize')).toBe(false);
  expect(row.hasAttribute('aria-posinset')).toBe(false);
  expect(body.getAttribute('role')).toBe(external ? 'region' : 'grid');
  registry.mockRestore();
  const rows = grid.querySelector<HTMLElement>('.rows')!;
  const container = rows.parentElement!;
  rows.remove();
  expect(() => hierarchy.afterRender()).not.toThrow();
  container.append(rows);
  body.classList.remove('rows-body');
  expect(() => hierarchy.onScrollRender()).not.toThrow();
});
