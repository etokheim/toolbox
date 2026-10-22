/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import type { GroupingRowsConfig } from '../lib/feature-props';
import type { GridConfig } from '../lib/react-column-config';
import './grouping-rows';
import './selection';
import './tree';

interface Row {
  id: string;
  category: string;
  children?: Row[];
}
const rows: Row[] = [
  {
    id: 'root',
    category: 'Root',
    children: ['A', 'B', 'C'].map((category) => ({ id: `root/${category}`, category })),
  },
];
const columns: GridConfig<Row>['columns'] = [{ field: 'id' }];
const getRowId = (row: Row) => row.id;
const groupOn: NonNullable<GroupingRowsConfig['groupOn']> = (row: Row, { parent }) => (parent ? row.category : null);
const treeConfig = { defaultExpanded: true, animation: false as const };
const selectionConfig = { mode: 'row' as const };
const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  vi.restoreAllMocks();
});

describe.each([false, true])('React live groupOrder (canonical: %s)', (canonical) => {
  it('replaces and clears ordering without recreating plugins or losing selection/expansion', async () => {
    const first: GroupingRowsConfig['groupOrder'] = () => ['B', 'A'];
    const second: GroupingRowsConfig['groupOrder'] = () => ['C', 'A'];
    const app = (groupOrder: GroupingRowsConfig['groupOrder'], revision: string) => {
      const groupingRows: GroupingRowsConfig = {
        groupOn,
        defaultExpanded: true,
        childDefaultExpanded: false,
        animation: false,
        ...(groupOrder ? { groupOrder } : {}),
      };
      return (
        <div data-revision={revision}>
          {canonical ? (
            <DataGrid
              rows={rows}
              columns={columns}
              gridConfig={{ getRowId, features: { tree: treeConfig, selection: selectionConfig, groupingRows } }}
            />
          ) : (
            <DataGrid
              rows={rows}
              columns={columns}
              gridConfig={baseConfig}
              tree={treeConfig}
              selection={selectionConfig}
              groupingRows={groupingRows}
            />
          )}
        </div>
      );
    };
    const baseConfig: GridConfig<Row> = { getRowId };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    root.render(app(first, 'first'));
    await vi.waitFor(() => expect(container.querySelector('.group-row')).not.toBeNull());
    const grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
    await grid.ready();
    const grouping = grid.getPluginByName('groupingRows')!;
    const tree = grid.getPluginByName('tree')!;
    const selection = grid.getPluginByName('selection')!;
    const groups = () => grouping.getFlattenedRows().filter((row) => row.kind === 'group');
    expect(groups().map((row) => row.value)).toEqual(['B', 'A', 'C']);
    expect(groups().every((row) => !row.expanded)).toBe(true);
    const bKey = groups()[0].key;
    const keys = new Set(groups().map((row) => row.key));
    grouping.expand(bKey);
    selection.selectRows([0]);
    await vi.waitFor(() => expect(grid.rows).toContain(rows[0].children![1]));
    const retained = () => {
      expect(grid.getPluginByName('groupingRows')).toBe(grouping);
      expect(grid.getPluginByName('tree')).toBe(tree);
      expect(grid.getPluginByName('selection')).toBe(selection);
      expect(tree.isExpanded('root')).toBe(true);
      expect(grouping.isExpanded(bKey)).toBe(true);
      expect(selection.getSelectedRows()).toEqual([rows[0]]);
      expect(new Set(groups().map((row) => row.key))).toEqual(keys);
    };
    root.render(app(second, 'second'));
    await vi.waitFor(() => {
      expect(
        grid
          .getPluginByName('groupingRows')!
          .getFlattenedRows()
          .filter((row) => row.kind === 'group')
          .map((row) => row.value),
      ).toEqual(['C', 'A', 'B']);
      retained();
    });
    const render = vi.spyOn(grid, 'requestRender');
    render.mockClear();
    root.render(app(second, 'same'));
    await vi.waitFor(() => expect(container.querySelector('[data-revision="same"]')).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(render).not.toHaveBeenCalled();
    retained();
    root.render(app(undefined, 'cleared'));
    await vi.waitFor(() => expect(groups().map((row) => row.value)).toEqual(['A', 'B', 'C']));
    retained();
  });
});
