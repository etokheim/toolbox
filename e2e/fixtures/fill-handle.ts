/* eslint @nx/enforce-module-boundaries: "off" -- Built-package fixture imports recurse through Nx's dist-pointing aliases. */
import { createGrid } from '@toolbox-web/grid';
import '@toolbox-web/grid/features/editing';
import '@toolbox-web/grid/features/fill-handle';
import '@toolbox-web/grid/features/selection';
import '@toolbox-web/grid/features/undo-redo';
import type { FillCompleteDetail } from '@toolbox-web/grid/plugins/fill-handle';

type Row = { id: string; qty: number; due: string };

export async function mount() {
  const rows: Row[] = [
    { id: 'a', qty: 1, due: '2024-01-31' },
    { id: 'b', qty: 2, due: '2024-02-29' },
    ...['c', 'd', 'e', 'f'].map((id) => ({ id, qty: 0, due: '' })),
  ];
  const reports: FillCompleteDetail<Row>[] = [];
  const grid = createGrid<Row>({
    columns: [
      { field: 'qty', type: 'number', editable: true },
      { field: 'due', type: 'date', editable: true },
    ],
    features: {
      selection: { mode: 'range', clearOnOutsideClick: true },
      editing: { editOn: 'dblclick' },
      undoRedo: true,
      fillHandle: true,
    },
  });
  grid.style.cssText = 'height:320px;width:500px';
  grid.rows = rows;
  grid.addEventListener('fill-complete', (event) => reports.push(event.detail));
  const outside = document.createElement('button');
  outside.id = 'outside';
  outside.textContent = 'Outside';
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  overlay.setAttribute('data-tbw-overlay', '');
  overlay.textContent = 'Portal overlay';
  document.body.append(grid, outside, overlay);
  await grid.ready();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return { grid, rows, reports };
}

declare global {
  interface Window {
    fillFixture: Awaited<ReturnType<typeof mount>>;
  }
}
