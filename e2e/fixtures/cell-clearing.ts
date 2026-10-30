/* eslint @nx/enforce-module-boundaries: "off" -- Built-package fixture imports recurse through Nx's dist-pointing aliases. */
import { createGrid } from '@toolbox-web/grid';
import '@toolbox-web/grid/features/cell-entry';
import '@toolbox-web/grid/features/editing';
import '@toolbox-web/grid/features/selection';
import '@toolbox-web/grid/features/undo-redo';
import type { CellClearDetail } from '@toolbox-web/grid/plugins/cell-entry';

type Row = { id?: string; text: string; amount: number | null; controls: string; derived?: string };

export async function mount(options: { noId?: boolean } = {}) {
  const rows: Row[] = [
    { id: 'a', text: 'Alpha', amount: 5, controls: 'Controls' },
    { id: 'b', text: 'Beta', amount: 8, controls: 'Controls' },
  ];
  const reports: CellClearDetail<Row>[] = [];
  if (options.noId) rows.forEach((row) => delete row.id);
  const grid = createGrid<Row>({
    columns: [
      { field: 'text', type: 'string', editable: true },
      { field: 'amount', type: 'number', nullable: true, editable: true },
      {
        field: 'controls',
        width: 300,
        renderer: () => {
          const container = document.createElement('div');
          const input = document.createElement('input');
          input.dataset['native'] = '';
          input.value = 'Native';
          const text = document.createElement('span');
          text.contentEditable = 'true';
          text.dataset['editable'] = '';
          text.textContent = 'Content';
          container.append(input, text);
          return container;
        },
      },
      { field: 'derived', valueAccessor: ({ row }) => `${row.text}-derived` },
    ],
    features: {
      selection: 'range',
      editing: { editOn: 'manual' },
      undoRedo: true,
      cellEntry: { clearOnDelete: true },
    },
  });
  grid.style.cssText = 'height:300px;width:800px';
  grid.rows = rows;
  grid.addEventListener('cell-clear', (event) => reports.push(event.detail));
  document.body.append(grid);
  await grid.ready();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return { grid, rows, reports };
}

declare global {
  interface Window {
    clearFixture: Awaited<ReturnType<typeof mount>>;
  }
}
