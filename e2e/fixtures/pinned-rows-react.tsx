import type { DataGridElement } from '@toolbox-web/grid';
import { DataGrid, type GridConfig } from '@toolbox-web/grid-react';
import '@toolbox-web/grid-react/features/clipboard';
import '@toolbox-web/grid-react/features/editing';
import '@toolbox-web/grid-react/features/pinned-rows';
import '@toolbox-web/grid-react/features/selection';
import '@toolbox-web/grid-react/features/undo-redo';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

type Row = { id: string; quantity: number; label: string };
export async function mount(surface: 'props' | 'canonical') {
  const { DataGridElement } = await import('@toolbox-web/grid');
  const rows: Row[] = [{ id: 'one', quantity: 10, label: 'One' }];
  const config: GridConfig<Row> = {
    getRowId: (row) => row.id,
    columns: [{ field: 'quantity', editable: true, type: 'number' }, { field: 'label' }],
  };
  let rerender: () => void = () => {
    throw new Error('Fixture has not mounted');
  };
  function Panel({ revision }: { revision: number }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button id="panel" onClick={() => setOpen(!open)}>
          Actions {revision}
        </button>
        {open && (
          <div role="menu">
            <button role="menuitem">Current {revision}</button>
          </div>
        )}
      </>
    );
  }
  function App() {
    const [revision, setRevision] = useState(0);
    rerender = () => setRevision((value) => value + 1);
    const features = {
      editing: true,
      undoRedo: true,
      selection: { mode: 'cell' as const },
      clipboard: true,
      pinnedRows: {
        slots: [
          { id: 'panel', render: () => <Panel revision={revision} /> },
          {
            id: 'total',
            aggregators: {
              quantity: { aggFunc: 'sum' as const, formatter: (value: unknown) => `Total ${revision}: ${value}` },
            },
            cells: { label: () => `Label ${revision}` },
          },
        ],
      },
    };
    return surface === 'canonical' ? (
      <DataGrid rows={rows} gridConfig={{ ...config, features }} style={{ height: 360, width: 600 }} />
    ) : (
      <DataGrid rows={rows} gridConfig={config} {...features} style={{ height: 360, width: 600 }} />
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(<App />);
  let grid: DataGridElement<Row> | null = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    grid = host.querySelector<DataGridElement<Row>>(DataGridElement.activeTag);
    if (grid && grid.querySelector('#panel')) break;
  }
  if (!grid) throw new Error('Missing mounted grid');
  const element = grid;
  await element.ready();
  const names = ['editing', 'undoRedo', 'selection', 'clipboard', 'pinnedRows'] as const;
  const originals = names.map((name) => {
    const plugin = element.getPluginByName(name);
    if (!plugin) throw new Error(`Missing ${name} plugin`);
    return plugin;
  });
  let detaches = 0;
  for (const plugin of originals) {
    const original = plugin.detach.bind(plugin);
    plugin.detach = () => {
      detaches++;
      original();
    };
  }
  element.addEventListener('cell-commit', rerender);
  let editor: Element | null = null;
  return {
    rerender,
    rememberEditor() {
      editor = element.querySelector('.cell.editing input');
    },
    measure() {
      const undo = element.getPluginByName('undoRedo');
      if (!undo) throw new Error('Missing UndoRedo plugin');
      return {
        samePlugins: names.every((name, index) => element.getPluginByName(name) === originals[index]),
        detaches,
        undo: undo.getUndoStack().length,
        redo: undo.getRedoStack().length,
        value: String(rows[0].quantity),
        sameEditor: editor !== null && editor === element.querySelector('.cell.editing input'),
        focusedEditor: editor !== null && editor === document.activeElement,
      };
    },
    dispose() {
      element.removeEventListener('cell-commit', rerender);
      root.unmount();
    },
  };
}

declare global {
  interface Window {
    pinnedReact: Awaited<ReturnType<typeof mount>>;
  }
}
