/** @vitest-environment happy-dom */
import type { ColumnConfig, DataGridElement } from '@toolbox-web/grid';
import { PinnedColumnsPlugin } from '@toolbox-web/grid/plugins/pinned-columns';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from './data-grid';
import { GridColumn } from './grid-column';
import type { GridConfig } from './react-column-config';

interface Row {
  id: string;
  name: string;
  __actions?: never;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('mixed DOM columns and JSX GridColumn', () => {
  it('preserves inline callback types and rejects unsupported renderer results', () => {
    const inline = (
      <DataGrid<Row> rows={[]} columns={[{ field: 'name', renderer: ({ row }) => <span>{row.name}</span> }]} />
    );
    const native = (
      <DataGrid<Row>
        rows={[]}
        columns={[{ field: 'name', renderer: ({ row }) => document.createTextNode(row.name).textContent ?? '' }]}
      />
    );
    // @ts-expect-error Arbitrary objects are neither React nodes nor native renderer results.
    const invalid = <DataGrid<Row> rows={[]} columns={[{ field: 'name', renderer: () => ({ unsupported: true }) }]} />;
    expect(inline.props.columns).toHaveLength(1);
    expect(native.props.columns).toHaveLength(1);
    expect(invalid).toBeDefined();
  });

  it('needs no Editing plugin and preserves action state and lease on immutable occurrence updates', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const pinned = new PinnedColumnsPlugin();
    const config: GridConfig<Row> = { getRowId: (row) => row.id, plugins: [pinned] };
    const columns: ColumnConfig<Row>[] = [
      {
        field: 'name',
        renderer: ({ row }) => {
          const node = document.createElement('span');
          node.dataset.nativeCell = '';
          node.textContent = row.name;
          return node;
        },
        headerRenderer: () => {
          const node = document.createElement('span');
          node.dataset.nativeHeader = '';
          node.textContent = 'Native header';
          return node;
        },
      },
      { field: '__actions', utility: true, pinned: 'right', width: 88, expandedCellWidth: 240 },
    ];
    function Actions({ row }: { row: Row }) {
      const [count, setCount] = useState(0);
      return (
        <button onClick={() => setCount(count + 1)}>
          {row.name}:{count}
        </button>
      );
    }
    const renderer = ({ row }: { row: Row }) => <Actions row={row} />;
    const render = (name: string) => (
      <DataGrid rows={[{ id: 'parent/one', name }]} columns={columns} gridConfig={config}>
        <GridColumn<Row> field="__actions">{renderer}</GridColumn>
      </DataGrid>
    );
    try {
      await act(async () => root.render(render('Original')));
      await vi.waitFor(() => expect(container.querySelector('.rows button')?.textContent).toBe('Original:0'));
      const grid = container.querySelector<DataGridElement<Row>>('tbw-grid')!;
      const button = container.querySelector<HTMLButtonElement>('.rows button')!;
      const cell = button.closest<HTMLElement>('.cell')!;
      expect(grid.effectiveConfig.columns?.find((column) => column.field === '__actions')?.editor).toBeUndefined();
      expect(grid.getPluginByName('editing')).toBeUndefined();
      expect(container.querySelector('[data-native-header]')?.textContent).toBe('Native header');
      await act(async () => button.click());
      const release = pinned.retainCellExpansion('parent/one', '__actions');
      await act(async () => root.render(render('Updated')));
      await vi.waitFor(() => expect(button.textContent).toBe('Updated:1'));
      expect(container.querySelector('.rows button')).toBe(button);
      expect(container.querySelector('[data-native-cell]')?.textContent).toBe('Updated');
      expect(cell.hasAttribute('data-tbw-cell-expanded')).toBe(true);
      release();
      expect(cell.hasAttribute('data-tbw-cell-expanded')).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
