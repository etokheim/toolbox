/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import {
  GroupingRowsPlugin,
  type GroupingRowsDisclosureContext as Context,
} from '@toolbox-web/grid/plugins/grouping-rows';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import { GridColumn } from '../lib/grid-column';
import { GridElementContext } from '../lib/grid-element-context';
import type { GroupingRowsConfig } from '../lib/feature-props';
import type { GridConfig } from '../lib/react-column-config';
import { getPortalManager } from '../lib/portal-bridge';
import './grouping-rows';
import './selection';

type Row = { id: string; name: string; category: string };
const rows: Row[] = [
  { id: 'one', name: 'One', category: 'A' },
  { id: 'two', name: 'Two', category: 'B' },
];
const columns: GridConfig<Row>['columns'] = [{ field: 'name' }];
const groupOn = (row: Row) => row.category;
const Provider = createContext('missing');
const roots: Root[] = [];
const mounts = vi.fn();
const unmounts = vi.fn();
const contexts: Context[] = [];

function Disclosure({ context, version }: { context: Context; version: string }) {
  const provider = useContext(Provider);
  const grid = useContext(GridElementContext);
  contexts.push(context);
  useEffect(() => {
    mounts(context.key);
    return () => {
      unmounts(context.key);
    };
  }, [context.key]);
  return (
    <button
      type="button"
      data-group={context.key}
      data-version={version}
      data-provider={provider}
      data-owner={grid?.current === context.grid}
      aria-label={context.ariaLabel}
      aria-expanded={context.expanded}
      disabled={context.disabled}
      onClick={() => context.setExpanded(!context.expanded)}
    >
      <svg aria-hidden="true">
        <path d="M0 0L4 4" />
      </svg>
    </button>
  );
}

function config(version: string): GroupingRowsConfig {
  return {
    groupOn,
    animation: false,
    disclosureRenderer: (context) => <Disclosure context={context} version={version} />,
  };
}

async function mount(node: ReactNode, selector = '[data-group]') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  root.render(node);
  await vi.waitFor(() => expect(container.querySelector(selector)).not.toBeNull());
  const grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
  await grid.ready();
  return { root, grid, container };
}

afterEach(async () => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  mounts.mockClear();
  unmounts.mockClear();
  contexts.length = 0;
  vi.restoreAllMocks();
});

describe('React GroupingRows disclosure', () => {
  it.each([false, true])('removes the last feature prop (explicit empty gridConfig=%s)', async (withConfig) => {
    const groupingRows = config('removal');
    const emptyConfig: GridConfig<Row> = { emptyRenderer: null };
    const app = (enabled: boolean) => (
      <DataGrid
        rows={rows}
        columns={columns}
        groupingRows={enabled ? groupingRows : undefined}
        gridConfig={withConfig ? emptyConfig : undefined}
      />
    );
    const { root, grid } = await mount(app(true));
    root.render(app(false));
    await vi.waitFor(() => expect(grid.getPluginByName('groupingRows') === undefined).toBe(true));
    expect(grid.querySelector('[data-group]')).toBeNull();
    expect(unmounts).toHaveBeenCalledTimes(mounts.mock.calls.length);
  });

  it('clears an explicit gridConfig when it becomes undefined while preserving direct columns and rows', async () => {
    const initial: GridConfig<Row> = { features: { groupingRows: config('config') }, rowHeight: 41 };
    const app = (gridConfig?: GridConfig<Row>) => <DataGrid rows={rows} columns={columns} gridConfig={gridConfig} />;
    const { root, grid } = await mount(app(initial));
    root.render(app());
    await vi.waitFor(() => {
      expect(grid.getPluginByName('groupingRows')).toBeUndefined();
      expect(grid.querySelectorAll('.data-grid-row')).toHaveLength(2);
    });
    expect(grid._sourceConfig).toBeUndefined();
    expect(grid.columns.map((column) => column.field)).toEqual(['name']);
    expect(grid.rows).toBe(rows);
    expect(grid.querySelector('.rows-body')?.textContent).toContain('One');
    expect(grid.querySelector('.rows-body')?.textContent).toContain('Two');
    expect(unmounts).toHaveBeenCalledTimes(mounts.mock.calls.length);
  });

  it('preserves another configured feature when grouping is removed', async () => {
    const groupingRows = config('retained');
    const app = (enabled: boolean) => (
      <DataGrid rows={rows} columns={columns} groupingRows={enabled ? groupingRows : undefined} selection="row" />
    );
    const { root, grid } = await mount(app(true));
    root.render(app(false));
    await vi.waitFor(() => {
      expect(grid.getPluginByName('groupingRows')).toBeUndefined();
      expect(grid.querySelectorAll('.data-grid-row')).toHaveLength(2);
    });
    const selection = grid.getPluginByName('selection')!;
    expect(selection).toBeDefined();
    selection.selectRows([0]);
    expect(selection.getSelectedRows()).toEqual([rows[0]]);
    expect(grid.querySelector('[data-group]')).toBeNull();
  });

  it('leaves an initially unconfigured grid and declarative columns untouched', async () => {
    const { grid } = await mount(
      <DataGrid rows={rows}>
        <GridColumn<Row> field="name" header="Name" />
      </DataGrid>,
      '.data-grid-row',
    );
    expect(grid._sourceConfig).toBeUndefined();
    expect(grid.columns.map((column) => column.field)).toEqual(['name']);
    expect(grid.querySelectorAll('.data-grid-row')).toHaveLength(2);
    expect(grid.querySelector('.rows-body')?.textContent).toContain('One');
  });

  it('does not clear a later imperative config replacement on the same grid', async () => {
    const groupingRows = config('imperative');
    const rendered = vi.fn();
    function App({ enabled }: { enabled: boolean }) {
      useEffect(() => rendered(enabled), [enabled]);
      return <DataGrid rows={rows} columns={columns} groupingRows={enabled ? groupingRows : undefined} />;
    }
    const { root, grid } = await mount(<App enabled />);
    grid.gridConfig = { rowHeight: 41, sortable: true };
    const imperative = grid._sourceConfig;
    await vi.waitFor(() => expect(grid.getPluginByName('groupingRows')).toBeUndefined());
    root.render(<App enabled={false} />);
    await vi.waitFor(() => expect(rendered).toHaveBeenCalledWith(false));
    expect(grid._sourceConfig).toBe(imperative);
    expect(grid.gridConfig.rowHeight).toBe(41);
    expect(grid.gridConfig.sortable).toBe(true);
  });

  it('releases old portals/actions on removal and mounts usable controls when re-added', async () => {
    const app = (groupingRows?: GroupingRowsConfig) => (
      <Provider.Provider value="re-added">
        <DataGrid rows={rows} columns={columns} groupingRows={groupingRows} />
      </Provider.Provider>
    );
    const { root, grid } = await mount(app(config('first')));
    const original = grid.getPluginByName('groupingRows')!;
    const stale = contexts.find((context) => context.key === 'A')!;
    const toggles = vi.fn();
    grid.addEventListener('group-toggle', toggles);
    root.render(app());
    await vi.waitFor(() => expect(grid.getPluginByName('groupingRows')).toBeUndefined());
    const oldMounts = mounts.mock.calls.length;
    expect(unmounts).toHaveBeenCalledTimes(oldMounts);
    expect(grid.querySelector('[data-group]')).toBeNull();
    stale.setExpanded(true);
    expect(original.isExpanded('A')).toBe(false);
    expect(toggles).not.toHaveBeenCalled();
    root.render(app(config('second')));
    await vi.waitFor(() => expect(grid.querySelector('[data-version="second"]')).not.toBeNull());
    const successor = grid.getPluginByName('groupingRows')!;
    expect(successor).not.toBe(original);
    const button = grid.querySelector<HTMLButtonElement>('[data-group="A"]')!;
    expect(button.dataset['provider']).toBe('re-added');
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
    expect(successor.isExpanded('A')).toBe(true);
    expect(toggles).toHaveBeenCalledTimes(1);
    expect(unmounts.mock.calls.filter(([key]) => key === 'A')).toHaveLength(1);
    root.unmount();
    roots.splice(roots.indexOf(root), 1);
    expect(getPortalManager(grid)).toBeNull();
    expect(unmounts).toHaveBeenCalledTimes(mounts.mock.calls.length);
  });

  it.each(['props', 'config'] as const)(
    'normalizes and refreshes callbacks without resetting groups (%s)',
    async (surface) => {
      const app = (groupingRows: GroupingRowsConfig, sortable = false) => (
        <Provider.Provider value="app">
          <DataGrid<Row>
            rows={rows}
            sortable={sortable}
            selection="row"
            {...(surface === 'props'
              ? { groupingRows, gridConfig: { columns } }
              : { gridConfig: { columns, features: { groupingRows } } })}
          />
        </Provider.Provider>
      );
      const { root, grid } = await mount(app(config('a')));
      const plugin = grid.getPluginByName('groupingRows')!;
      const button = grid.querySelector<HTMLButtonElement>('[data-group="A"]')!;
      expect(button.dataset['provider']).toBe('app');
      expect(button.dataset['owner']).toBe('true');
      const toggles = vi.fn();
      const selections = vi.fn();
      grid.addEventListener('group-toggle', toggles);
      grid.addEventListener('selection-change', selections);
      button.focus();
      selections.mockClear();
      button.querySelector('path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
      expect(toggles).toHaveBeenCalledTimes(1);
      expect(selections).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(button);
      expect(mounts.mock.calls.filter(([key]) => key === 'A')).toHaveLength(1);
      const next = config('b');
      root.render(app(next));
      await vi.waitFor(() => expect(grid.querySelector('[data-group="A"]')?.getAttribute('data-version')).toBe('b'));
      expect(grid.getPluginByName('groupingRows')).toBe(plugin);
      expect(plugin.isExpanded('A')).toBe(true);
      root.render(app(next, true));
      await vi.waitFor(() => expect(grid.querySelector('[data-group="A"]')?.getAttribute('data-version')).toBe('b'));
      plugin.collapseAll();
      await vi.waitFor(() =>
        expect(grid.querySelector('[data-group="A"]')?.getAttribute('aria-expanded')).toBe('false'),
      );
      const stale = contexts.at(-1)!;
      root.unmount();
      roots.splice(roots.indexOf(root), 1);
      expect(getPortalManager(grid)).toBeNull();
      stale.setExpanded(true);
      expect(plugin.isExpanded(stale.key)).toBe(false);
      expect(unmounts).toHaveBeenCalledTimes(mounts.mock.calls.length);
    },
  );

  it('keeps provider/owner isolation with two React grids and a manually constructed DOM plugin', async () => {
    const { container } = await mount(
      <>
        <Provider.Provider value="first">
          <DataGrid rows={rows} gridConfig={{ columns }} groupingRows={config('first')} />
        </Provider.Provider>
        <Provider.Provider value="second">
          <DataGrid rows={rows} gridConfig={{ columns }} groupingRows={config('second')} />
        </Provider.Provider>
      </>,
    );
    await vi.waitFor(() => expect(container.querySelector('[data-provider="second"]')).not.toBeNull());
    const grids = container.querySelectorAll<DataGridElement>(DataGridElement.activeTag);
    expect(grids[0].querySelector('[data-group]')?.getAttribute('data-provider')).toBe('first');
    expect(grids[1].querySelector('[data-group]')?.getAttribute('data-provider')).toBe('second');
    const renderer = (context: Context) => {
      const button = document.createElement('button');
      button.textContent = context.key;
      return button;
    };
    const plugin = new GroupingRowsPlugin({ groupOn, disclosureRenderer: renderer });
    const native = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    native.gridConfig = { columns: [{ field: 'name' }], plugins: [plugin] };
    native.rows = rows;
    document.body.append(native);
    await native.ready();
    await vi.waitFor(() => expect(native.querySelector('.group-row button')?.textContent).toBe('A'));
    expect(getPortalManager(native)).toBeNull();
  });

  it('supports JSX, DOM, persistent views and deliberate null through the same callback', async () => {
    let mode: 'jsx' | 'dom' | 'view' | 'null' = 'jsx';
    const dispose = vi.fn();
    const renderer: NonNullable<GroupingRowsConfig['disclosureRenderer']> = (context) => {
      if (mode === 'null') return null;
      if (mode === 'jsx') return <Disclosure context={context} version="mixed" />;
      const element = document.createElement('button');
      element.dataset['native'] = context.key;
      const update = (next: Context) => {
        element.setAttribute('aria-expanded', String(next.expanded));
        element.onclick = () => next.setExpanded(!next.expanded);
      };
      update(context);
      return mode === 'dom' ? element : { element, update, dispose };
    };
    const { root, grid } = await mount(
      <DataGrid rows={rows} gridConfig={{ columns }} groupingRows={{ groupOn, disclosureRenderer: renderer }} />,
    );
    const plugin = grid.getPluginByName('groupingRows')!;
    mode = 'dom';
    plugin.afterRender();
    grid.querySelector<HTMLButtonElement>('[data-native="A"]')!.click();
    expect(plugin.isExpanded('A')).toBe(true);
    mode = 'null';
    plugin.afterRender();
    expect(grid.querySelector('.group-row button')).toBeNull();
    mode = 'view';
    plugin.afterRender();
    const button = grid.querySelector('[data-native="A"]')!;
    plugin.collapseAll();
    await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
    root.unmount();
    roots.splice(roots.indexOf(root), 1);
    expect(dispose).toHaveBeenCalled();
  });

  it('preserves JSX whole-header rendering with explicit owner and cleanup', async () => {
    function Header() {
      return <strong data-header={useContext(Provider)}>Header</strong>;
    }
    const { root, grid } = await mount(
      <Provider.Provider value="headers">
        <DataGrid rows={rows} gridConfig={{ columns }} groupingRows={config('temporary')} />
      </Provider.Provider>,
    );
    root.render(
      <Provider.Provider value="headers">
        <DataGrid
          rows={rows}
          gridConfig={{ columns, features: { groupingRows: { groupOn, groupRowRenderer: () => <Header /> } } }}
        />
      </Provider.Provider>,
    );
    await vi.waitFor(() => expect(grid.querySelector('[data-header]')?.getAttribute('data-header')).toBe('headers'));
    expect(grid.querySelector('[data-group]')).toBeNull();
  });
});
