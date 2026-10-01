/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import type { SelectionHeaderCheckboxContext, SelectionRowCheckboxContext } from '@toolbox-web/grid/plugins/selection';
import { act, createContext, useContext, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import { GridElementContext } from '../lib/grid-element-context';
import type { SelectionConfig } from '../lib/feature-props';
import type { GridConfig } from '../lib/react-column-config';
import './selection';

type Row = { id: string; name: string; locked?: boolean };
const rows: Row[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob', locked: true },
];
const columns: GridConfig<Row>['columns'] = [{ field: 'name' }];
const Provider = createContext('missing');
const roots: Root[] = [];
const unmounts = vi.fn();

function Checkbox({ context }: { context: SelectionRowCheckboxContext<Row> | SelectionHeaderCheckboxContext<Row> }) {
  const label = useContext(Provider);
  const owner = useContext(GridElementContext);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => () => unmounts(), []);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = 'indeterminate' in context && context.indeterminate;
  }, [context]);
  return (
    <input
      ref={ref}
      type="checkbox"
      data-provider={label}
      data-owned={owner?.current === context.grid}
      aria-label={context.ariaLabel}
      checked={context.checked}
      disabled={context.disabled}
      onChange={(event) => context.setChecked(event.currentTarget.checked)}
    />
  );
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  unmounts.mockClear();
});

async function mount(node: React.ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  const grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
  await act(async () => {
    await grid.ready();
    await vi.waitFor(() => expect(grid.querySelectorAll('[data-provider]')).toHaveLength(3));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  return { root, grid, container };
}

describe('React selection checkbox controls', () => {
  it.each(['prop', 'config'] as const)(
    'preserves providers, focus and selection on callback-only %s replacements',
    async (surface) => {
      const config: SelectionConfig<Row> = {
        mode: 'row',
        checkbox: true,
        isSelectable: (row) => !row.locked,
        rowCheckboxRenderer: (context) => <Checkbox context={context} />,
        headerCheckboxRenderer: (context) => <Checkbox context={context} />,
      };
      const app = (selection: SelectionConfig<Row>) => (
        <Provider.Provider value="scoped">
          <DataGrid<Row>
            rows={rows}
            columns={columns}
            {...(surface === 'prop' ? { selection } : { gridConfig: { features: { selection } } })}
          />
        </Provider.Provider>
      );
      const { root, grid } = await mount(app(config));
      unmounts.mockClear();
      const input = grid.querySelector<HTMLInputElement>('.rows [data-provider]')!;
      expect(input.dataset.provider).toBe('scoped');
      expect(input.dataset.owned).toBe('true');
      expect(grid.querySelectorAll<HTMLInputElement>('.rows [data-provider]')[1].disabled).toBe(true);
      const plugin = grid.getPluginByName('selection')!;
      const onChange = vi.fn();
      grid.addEventListener('selection-change', onChange);
      await act(async () => {
        input.focus();
        input.click();
        await vi.waitFor(() => expect(input.checked).toBe(true));
      });
      expect(plugin.getSelectedRowIndices()).toEqual([0]);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input);
      expect(unmounts).not.toHaveBeenCalled();

      await act(async () => {
        root.render(
          app({
            ...config,
            rowCheckboxRenderer: (context) => <button aria-label={`New ${context.ariaLabel}`}>New</button>,
          }),
        );
      });
      await act(async () => {
        await vi.waitFor(() => expect(grid.querySelector('.rows button')?.textContent).toBe('New'));
      });
      expect(grid.getPluginByName('selection')).toBe(plugin);
      expect(plugin.getSelectedRowIndices()).toEqual([0]);
      expect(unmounts).toHaveBeenCalledTimes(2);
    },
  );

  it('isolates two React owners and explicitly cleans up rebuilt headers', async () => {
    const config: SelectionConfig<Row> = {
      mode: 'row',
      checkbox: true,
      rowCheckboxRenderer: (context) => <Checkbox context={context} />,
      headerCheckboxRenderer: (context) => <Checkbox context={context} />,
    };
    const first = await mount(
      <Provider.Provider value="first">
        <DataGrid rows={rows} columns={columns} selection={config} />
      </Provider.Provider>,
    );
    const second = await mount(
      <Provider.Provider value="second">
        <DataGrid rows={rows} columns={columns} selection={config} />
      </Provider.Provider>,
    );
    expect(
      Array.from(first.grid.querySelectorAll<HTMLElement>('[data-provider]')).every(
        (el) => el.dataset.provider === 'first',
      ),
    ).toBe(true);
    expect(
      Array.from(second.grid.querySelectorAll<HTMLElement>('[data-provider]')).every(
        (el) => el.dataset.provider === 'second',
      ),
    ).toBe(true);
    unmounts.mockClear();
    await act(async () => first.grid._schedulerRenderHeader());
    expect(unmounts).toHaveBeenCalledTimes(1);
    expect(first.grid.querySelectorAll('.header-row [data-provider]')).toHaveLength(1);
    await act(async () => first.root.unmount());
    roots.splice(roots.indexOf(first.root), 1);
    expect(unmounts).toHaveBeenCalledTimes(4);
    expect(second.grid.querySelectorAll('[data-provider]')).toHaveLength(3);
  });
});
