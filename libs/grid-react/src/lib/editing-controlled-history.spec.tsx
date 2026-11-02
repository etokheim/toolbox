/** @vitest-environment happy-dom */
import type { CellChangeDetail, DataGridElement } from '@toolbox-web/grid';
import { CellEntryPlugin } from '@toolbox-web/grid/plugins/cell-entry';
import { EditingPlugin } from '@toolbox-web/grid/plugins/editing';
import { SelectionPlugin } from '@toolbox-web/grid/plugins/selection';
import { UndoRedoPlugin, type ExternalHistoryOwner } from '@toolbox-web/grid/plugins/undo-redo';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from './data-grid';
import type { GridConfig } from './react-column-config';
import '../features/editing';

type Row = { id: string; label: string; quantity: number };

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => vi.unstubAllGlobals());

describe('controlled row editing acceptance', () => {
  it.each([false, true])(
    'retains exactly-once acceptance across immutable feedback (external=%s)',
    async (external) => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const accepted: CellChangeDetail<Row>[] = [];
      const order: string[] = [];
      const unsubscribe = vi.fn();
      let group: object | undefined;
      const owner: ExternalHistoryOwner = {
        request: vi.fn(),
        getState: () => ({ canUndo: accepted.length > 0, canRedo: false }),
        subscribe: () => unsubscribe,
        beginGroup: (token) => {
          expect(group).toBeUndefined();
          group = token;
          order.push('begin');
        },
        endGroup: (token, reason) => {
          expect(token).toBe(group);
          group = undefined;
          order.push(`end:${reason}`);
        },
      };
      const editing = new EditingPlugin<Row>({ editOn: 'manual' });
      const history = new UndoRedoPlugin(external ? { externalHistory: owner } : {});
      const config: GridConfig<Row> = {
        // Conventional IDs deliberately exercise React's full rows replacement path.
        columns: [
          { field: 'label', editable: true, type: 'string' },
          {
            field: 'quantity',
            editable: true,
            type: 'number',
            editor: ({ value, commit }) => (
              <input
                type="number"
                defaultValue={Number(value)}
                onBlur={(event) => commit(Number(event.currentTarget.value))}
              />
            ),
          },
        ],
        plugins: [
          editing,
          history,
          new SelectionPlugin({ mode: 'range' }),
          new CellEntryPlugin({ clearOnDelete: true }),
        ],
      };
      const proposals = new WeakMap<object, { row: Row; source: Row; old: unknown }>();
      const original: Row = { id: 'a', label: 'before', quantity: 100 };
      function App() {
        const [rows, setRows] = useState([original]);
        return (
          <DataGrid<Row>
            rows={rows}
            gridConfig={config}
            onCellCommit={(detail) => {
              expect(detail.operationId).toBeDefined();
              proposals.set(detail.operationId!, {
                row: detail.row,
                source: rows[0],
                old: detail.oldValue,
              });
            }}
            onCellChange={(detail) => {
              if (detail.source === 'history' || detail.source === 'sync') return;
              const proposal = proposals.get(detail.operationId!);
              expect(proposal?.row).toBe(detail.row);
              expect(proposal?.old).toBe(detail.oldValue);
              if (detail.field === 'quantity') expect(proposal?.source).not.toBe(detail.row);
              proposals.delete(detail.operationId!);
              accepted.push(detail);
              order.push('accepted');
              setRows((current) =>
                current.map((row) => ({
                  ...row,
                  label: detail.field === 'label' ? String(detail.newValue) : row.label,
                  quantity: detail.field === 'quantity' ? Number(detail.newValue) : row.quantity,
                })),
              );
            }}
          />
        );
      }
      try {
        await act(async () => root.render(<App />));
        const grid = container.querySelector<DataGridElement<Row>>('tbw-grid')!;
        await act(async () => grid.ready());
        await act(async () => editing.beginBulkEdit(0));
        await vi.waitFor(() => expect(grid.querySelector('input[type="number"]')).not.toBeNull());
        await act(async () => {
          const input = grid.querySelector<HTMLInputElement>('.cell[data-col="0"] input')!;
          input.value = 'after';
          input.dispatchEvent(new Event('blur'));
        });
        await act(async () => vi.waitFor(() => expect(grid._pendingSourceUpdate).toBeUndefined()));
        expect(grid.rows[0]).toBe(original);
        expect(grid.sourceRows[0]).not.toBe(original);
        await act(async () => {
          const input = grid.querySelector<HTMLInputElement>('input[type="number"]')!;
          input.value = '321';
          input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        });
        await act(async () => vi.waitFor(() => expect(grid._pendingSourceUpdate).toBeUndefined()));
        expect(grid.sourceRows[0]).toMatchObject({ label: 'after', quantity: 321 });
        expect(accepted.map((detail) => [detail.field, detail.newValue])).toEqual([
          ['label', 'after'],
          ['quantity', 321],
        ]);
        expect(accepted[0].operationId).not.toBe(accepted[1].operationId);

        await act(async () => {
          grid
            .querySelector('input[type="number"]')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(grid.querySelector('.cell.editing')).toBeNull();
        order.length = 0;
        await act(async () => {
          grid.getPluginByName('selection')!.setRanges([{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }]);
          grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        });
        expect(accepted).toHaveLength(3);
        expect(accepted[2]).toMatchObject({ source: 'clear', newValue: '' });
        expect(order).toEqual(external ? ['begin', 'accepted', 'end:complete'] : ['accepted']);
        if (external) {
          history.requestUndo();
          expect(owner.request).toHaveBeenCalledExactlyOnceWith('undo');
          expect(() => history.getUndoStack()).toThrow();
        } else expect(history.getUndoStack()).toHaveLength(3);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
      expect(unsubscribe).toHaveBeenCalledTimes(external ? 1 : 0);
      expect(accepted).toHaveLength(3);
    },
  );
});
