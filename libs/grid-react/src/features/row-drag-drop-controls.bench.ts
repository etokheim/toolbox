/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, bench, describe } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import './row-drag-drop';

const rows = Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: `Row ${index}` }));
const container = document.createElement('div');
const root = createRoot(container);
let grid: DataGridElement;
beforeAll(async () => {
  document.body.append(container);
  root.render(
    createElement(DataGrid, {
      rows,
      gridConfig: { columns: [{ field: 'name' }] },
      rowDragDrop: {
        dragHandleRenderer: (ctx) =>
          createElement('button', { ref: ctx.bindHandle, 'data-bench': true }, ctx.ariaLabel),
      },
    }),
  );
  while (!container.querySelector('[data-bench]')) await new Promise(requestAnimationFrame);
  grid = container.querySelector(DataGridElement.activeTag) as DataGridElement;
  await grid.ready();
  grid._virtualization.bypassThreshold = 100;
  grid.refreshVirtualWindow(true);
  await new Promise(requestAnimationFrame);
});
afterAll(() => {
  root.unmount();
  container.remove();
});
describe('row drag controls', () => {
  bench(
    'refresh 20 persistent React controls',
    async () => {
      const plugin = grid.getPluginByName('rowDragDrop');
      if (!plugin) throw new Error('Missing drag plugin');
      plugin.afterRender();
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      if (container.querySelectorAll('[data-bench]').length !== 20) throw new Error('Missing live controls');
    },
    { iterations: 10, time: 500 },
  );
});
