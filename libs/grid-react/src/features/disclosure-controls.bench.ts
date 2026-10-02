/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, bench, describe } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import type { GridConfig } from '../lib/react-column-config';
import './tree';

type Row = { id: string; name: string; children?: Row[] };
const rows: Row[] = [
  {
    id: 'parent',
    name: 'Parent',
    children: Array.from({ length: 30 }, (_, i) => ({ id: `child-${i}`, name: `Child ${i}` })),
  },
];
const gridConfig: GridConfig<Row> = {
  columns: [{ field: 'name', renderer: ({ row }) => createElement('a', { href: `#${row.id}` }, row.name) }],
};
const container = document.createElement('div');
const root = createRoot(container);
let grid: DataGridElement<Row>;

beforeAll(async () => {
  document.body.append(container);
  root.render(
    createElement(DataGrid<Row>, {
      rows,
      gridConfig,
      tree: { treeColumn: 'name', animation: false },
    }),
  );
  while (!container.querySelector('.react-cell-renderer a')) await new Promise(requestAnimationFrame);
  grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
  await grid.ready();
  grid._virtualization.bypassThreshold = 100;
});
afterAll(() => {
  root.unmount();
  container.remove();
});

describe('Tree with React Name renderer', () => {
  bench(
    'expand and collapse 30 children with mounted Name portals',
    async () => {
      const tree = grid.getPluginByName('tree')!;
      tree.expandAll();
      await grid.ready();
      await new Promise(requestAnimationFrame);
      if (grid.querySelectorAll('.react-cell-renderer a').length !== 31)
        throw new Error('Expansion did not render all 30 child portals');
      tree.collapseAll();
      await grid.ready();
      await new Promise(requestAnimationFrame);
      if (grid.querySelectorAll('.react-cell-renderer a').length !== 1)
        throw new Error('Collapse did not release child portals');
    },
    { iterations: 10, time: 500 },
  );
});
