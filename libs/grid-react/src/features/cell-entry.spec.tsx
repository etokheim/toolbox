// @vitest-environment happy-dom
import type { DataGridElement } from '@toolbox-web/grid';
import { act, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import { GridColumn } from '../lib/grid-column';
import type { GridConfig } from '../lib/react-column-config';
import { useGridOverlay } from '../lib/use-grid-overlay';
import './cell-entry';
import './editing';
import './selection';

type Row = { id: number; first: string; last: string };
let root: Root | undefined;
beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function ControlledEditor({
  value,
  commit,
  grid,
}: {
  value: string;
  commit: (value: string) => void;
  grid?: DataGridElement;
}) {
  const [current, setCurrent] = useState(value);
  const [vetoNextTab, setVetoNextTab] = useState(true);
  const panel = useRef<HTMLDivElement>(null);
  useGridOverlay(panel, { gridElement: grid });
  return (
    <>
      <input
        value={current}
        onInput={(event) => {
          setCurrent(event.currentTarget.value);
          commit(event.currentTarget.value);
        }}
        onChange={() => undefined}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && vetoNextTab) {
            event.preventDefault();
            setVetoNextTab(false);
          }
        }}
      />
      {createPortal(
        <div ref={panel} data-testid="editor-overlay">
          Editor overlay
        </div>,
        document.body,
      )}
    </>
  );
}

describe('React cellEntry feature', () => {
  it.each(['config', 'child'])('replaces %s-based portal editors without losing a controlled value', async (source) => {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const rows: Row[] = [{ id: 1, first: 'Alice', last: 'Example' }];
    const config: GridConfig<Row> = {
      columns: [
        {
          field: 'first',
          editable: true,
          editor:
            source === 'config'
              ? ({ value, commit }) => <ControlledEditor value={String(value)} commit={commit} grid={grid} />
              : undefined,
        },
        { field: 'last', editable: true },
      ],
    };
    await act(async () => {
      root!.render(
        <DataGrid
          rows={rows}
          gridConfig={config}
          selection="range"
          editing={{ editOn: 'manual', tabToEdit: true }}
          cellEntry={{ singleClick: true }}
        >
          {source === 'child' && (
            <>
              <GridColumn<Row, string>
                field="first"
                editable
                editor={({ value, commit }) => <ControlledEditor value={value} commit={commit} grid={grid} />}
              />
              <GridColumn field="last" editable />
            </>
          )}
        </DataGrid>,
      );
    });
    const grid = container.querySelector('tbw-grid') as DataGridElement<Row>;
    await grid.ready();
    await act(async () => {
      await vi.waitFor(() =>
        expect(grid.effectiveConfig.columns?.find((column) => column.field === 'first')?.editable).toBe(true),
      );
    });
    expect(grid.getPluginByName('cellEntry')).toBeDefined();
    const unregisterOverlay = vi.spyOn(grid, 'unregisterExternalFocusContainer');
    await act(async () => {
      grid.querySelector<HTMLElement>('[data-row="0"][data-field="first"]')!.click();
    });
    const input = grid.querySelector<HTMLInputElement>('.cell.editing input')!;
    expect(input).not.toBeNull();
    expect(input.closest('.cell')?.hasAttribute('data-editor-managed')).toBe(true);
    const panel = document.querySelector('[data-testid="editor-overlay"]');
    expect(panel).not.toBeNull();
    await act(async () => {
      input.value = 'Alicia';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(input.isConnected).toBe(true);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(rows[0].first).toBe('Alicia');
    expect(grid.querySelectorAll('.cell.editing')).toHaveLength(1);
    expect(grid.querySelector('.cell.editing')?.getAttribute('data-field')).toBe('last');
    expect(input.isConnected).toBe(false);
    expect(panel!.isConnected).toBe(false);
    expect(unregisterOverlay).toHaveBeenCalledWith(panel);
  });
});
