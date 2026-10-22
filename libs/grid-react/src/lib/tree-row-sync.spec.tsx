/** @vitest-environment happy-dom */
import type { DataGridElement } from '@toolbox-web/grid';
import { TreePlugin } from '@toolbox-web/grid/plugins/tree';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../features/editing';
import '../features/tree';
import '../features/undo-redo';
import { DataGrid } from './data-grid';
import type { GridConfig } from './react-column-config';

type Row = { id: string; value: number; children?: Row[]; nodes?: Row[] };
const getRowId = (row: Row) => row.id;

afterEach(() => {
  document.body.replaceChildren();
});

describe('Tree rows prop synchronization', () => {
  for (const surface of ['props', 'canonical', 'manual'] as const) {
    for (const field of ['children', 'nodes'] as const) {
      it(`${surface} preserves child replacements and plugin owners using ${field}`, async () => {
        const leaf = (id: string, value = 0): Row => ({ id, value });
        const branch = (id: string, children: Row[]): Row => ({ id, value: 0, [field]: children });
        let current = [branch('p', [branch('c', [leaf('g')]), leaf('d')]), branch('q', [leaf('e')])];
        const tree = { childrenField: field, defaultExpanded: true, animation: false as const };
        const config: GridConfig<Row> = {
          columns: [{ field: 'id' }, { field: 'value', editable: true }],
          getRowId,
          ...(surface === 'canonical' ? { features: { tree } } : {}),
          ...(surface === 'manual' ? { plugins: [new TreePlugin(tree)] } : {}),
        };
        let setRows!: (rows: Row[]) => void;
        function App() {
          const [rows, updateRows] = useState(current);
          setRows = updateRows;
          return (
            <DataGrid rows={rows} gridConfig={config} tree={surface === 'props' ? tree : undefined} editing undoRedo />
          );
        }
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        try {
          await act(() => root.render(<App />));
          const grid = container.querySelector<DataGridElement<Row>>('tbw-grid');
          if (!grid) throw new Error('Missing grid');
          await grid.ready();
          const ids = () => grid.rows.map((row) => row.id);
          await vi.waitFor(() => expect(ids()).toEqual(['p', 'c', 'g', 'd', 'q', 'e']));
          const treeOwner = grid.getPluginByName('tree');
          const editingOwner = grid.getPluginByName('editing');
          const undoOwner = grid.getPluginByName('undoRedo');
          const updates = vi.spyOn(grid, 'updateRows');
          const assignments = vi.spyOn(grid, 'rows', 'set');
          const replace = async (rows: Row[], expectedIds: string[]) => {
            current = rows;
            await act(() => setRows(rows));
            await vi.waitFor(() => expect(ids()).toEqual(expectedIds));
            expect(grid.getPluginByName('tree')).toBe(treeOwner);
            expect(grid.getPluginByName('editing')).toBe(editingOwner);
            expect(grid.getPluginByName('undoRedo')).toBe(undoOwner);
          };

          await replace([{ ...current[0], value: 1 }, current[1]], ['p', 'c', 'g', 'd', 'q', 'e']);
          expect(updates).toHaveBeenCalledWith(expect.any(Array), 'sync');
          expect(assignments).not.toHaveBeenCalled();
          updates.mockClear();

          const children = current[0][field]!;
          await replace(
            [{ ...current[0], [field]: [{ ...children[0], value: 2 }, children[1]] }, current[1]],
            ['p', 'c', 'g', 'd', 'q', 'e'],
          );
          expect(assignments).toHaveBeenCalledTimes(1);
          expect(grid.rows.find((row) => row.id === 'c')?.value).toBe(2);
          const child = current[0][field]![0];
          await replace(
            [{ ...current[0], [field]: [{ ...child, [field]: [leaf('g', 3)] }, current[0][field]![1]] }, current[1]],
            ['p', 'c', 'g', 'd', 'q', 'e'],
          );
          expect(grid.rows.find((row) => row.id === 'g')?.value).toBe(3);
          await replace(
            [{ ...current[0], [field]: [...current[0][field]!].reverse() }, current[1]],
            ['p', 'd', 'c', 'g', 'q', 'e'],
          );
          await replace(
            [{ ...current[0], [field]: current[0][field]!.slice(1) }, current[1]],
            ['p', 'c', 'g', 'q', 'e'],
          );

          treeOwner?.collapse('q');
          await vi.waitFor(() => expect(ids()).toEqual(['p', 'c', 'g', 'q']));
          const moved = current[0][field]![0];
          await replace(
            [
              { ...current[0], [field]: [] },
              { ...current[1], [field]: [...current[1][field]!, moved] },
            ],
            ['p', 'q'],
          );
          treeOwner?.expand('q');
          await vi.waitFor(() => expect(ids()).toEqual(['p', 'q', 'e', 'c', 'g']));
          expect(updates).not.toHaveBeenCalled();
          expect(assignments).toHaveBeenCalledTimes(5);
        } finally {
          await act(() => root.unmount());
        }
      });
    }
  }
});
