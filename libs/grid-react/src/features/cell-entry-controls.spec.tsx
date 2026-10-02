/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import type { MasterDetailDisclosureContext } from '@toolbox-web/grid/plugins/master-detail';
import type { SelectionHeaderCheckboxContext, SelectionRowCheckboxContext } from '@toolbox-web/grid/plugins/selection';
import type { TreeDisclosureContext } from '@toolbox-web/grid/plugins/tree';
import { act, createContext, useContext, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import type { FeatureProps, SelectionConfig } from '../lib/feature-props';
import { GridElementContext } from '../lib/grid-element-context';
import type { GridConfig } from '../lib/react-column-config';
import './cell-entry';
import './editing';
import './master-detail';
import './selection';
import './tree';

type Row = { id: string; name: string; value: string; children?: Row[] };
type Context =
  | TreeDisclosureContext<Row>
  | MasterDetailDisclosureContext<Row>
  | SelectionRowCheckboxContext<Row>
  | SelectionHeaderCheckboxContext<Row>;
const Provider = createContext('missing');
const live = new Set<HTMLElement>();
const handled = vi.fn();
const nameUnmount = vi.fn();
let root: Root | undefined;
const rows: Row[] = [
  { id: 'p', name: 'Parent', value: 'one', children: [{ id: 'c', name: 'Child', value: 'two' }] },
  { id: 's', name: 'Sibling', value: 'three' },
];

function Control({ context, kind, version }: { context: Context; kind: string; version: string }) {
  const provider = useContext(Provider);
  const owner = useContext(GridElementContext);
  useEffect(() => {
    live.add(context.host);
    return () => {
      live.delete(context.host);
    };
  }, [context.host]);
  const activate = () => {
    handled(kind);
    if ('setChecked' in context) context.setChecked(!context.checked);
    else context.setExpanded(!context.expanded);
  };
  return (
    <span
      data-control={kind}
      data-provider={provider}
      data-owned={owner?.current === context.grid}
      data-version={version}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activate();
      }}
    >
      <svg>
        <path d="M0 0L4 4" />
      </svg>
    </span>
  );
}

function Name({ name }: { name: string }) {
  const provider = useContext(Provider);
  useEffect(() => () => nameUnmount(name), [name]);
  return (
    <span data-name={name} data-provider={provider}>
      {name}
    </span>
  );
}
function Detail() {
  return <section data-detail={useContext(Provider)}>Details</section>;
}
const columns: GridConfig<Row>['columns'] = [
  { field: 'name', renderer: ({ row }) => <Name name={row.name} /> },
  { field: 'value', editable: true },
];
const detailRenderer = () => <Detail />;

function features(
  version: string,
): Pick<FeatureProps<Row>, 'selection' | 'editing' | 'cellEntry' | 'tree' | 'masterDetail'> {
  return {
    selection: 'range',
    editing: { editOn: 'manual', tabToEdit: true },
    cellEntry: { singleClick: true },
    tree: {
      treeColumn: 'name',
      animation: false,
      disclosureRenderer: (context) => <Control context={context} kind="tree" version={version} />,
    },
    masterDetail: {
      animation: false,
      expandOnRowClick: false,
      detailRenderer,
      disclosureRenderer: (context) => <Control context={context} kind="detail" version={version} />,
    },
  };
}

function dispatch(target: Element, action: string) {
  target.dispatchEvent(
    action === 'click'
      ? new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
      : new KeyboardEvent('keydown', { key: action, bubbles: true, composed: true, cancelable: true }),
  );
}

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  live.clear();
  handled.mockClear();
  nameUnmount.mockClear();
  vi.restoreAllMocks();
});

describe('CellEntry controls and adjacent row-checkbox owner', () => {
  it.each(['props', 'config'] as const)(
    'preserves providers, headers, handlers and independent slots on %s surfaces',
    async (surface) => {
      const container = document.createElement('div');
      document.body.append(container);
      root = createRoot(container);
      const app = (version: string, sortable = false) => {
        const config = features(version);
        const selection: SelectionConfig<Row> = {
          mode: 'row',
          checkbox: true,
          rowCheckboxRenderer: (context) => <Control context={context} kind="checkbox" version={version} />,
          headerCheckboxRenderer: (context) => <Control context={context} kind="header" version={version} />,
        };
        return (
          <>
            <Provider.Provider value="entry-owner">
              <DataGrid<Row>
                rows={rows}
                sortable={sortable}
                {...(surface === 'props'
                  ? { ...config, gridConfig: { columns } }
                  : { gridConfig: { columns, features: config } })}
              />
            </Provider.Provider>
            <Provider.Provider value="checkbox-owner">
              <DataGrid<Row>
                rows={rows}
                sortable={sortable}
                {...(surface === 'props'
                  ? { selection, editing: 'manual' as const, gridConfig: { columns } }
                  : { gridConfig: { columns, features: { selection, editing: 'manual' } } })}
              />
            </Provider.Provider>
          </>
        );
      };
      await act(async () => root!.render(app('A')));
      const [grid, adjacent] = container.querySelectorAll<DataGridElement<Row>>(DataGridElement.activeTag);
      await act(async () => {
        await Promise.all([grid.ready(), adjacent.ready()]);
        await vi.waitFor(() => expect(grid.querySelector('[data-control="tree"]')).not.toBeNull());
        await vi.waitFor(() => expect(adjacent.querySelector('[data-control="header"]')).not.toBeNull());
      });
      expect(grid.getPluginByName('cellEntry')).toBeDefined();
      expect(adjacent.getPluginByName('cellEntry')).toBeUndefined();
      const entry = grid.getPluginByName('cellEntry');
      const tree = grid.getPluginByName('tree');
      const selection = adjacent.getPluginByName('selection');
      const name = grid.querySelector('[data-name="Parent"]');
      nameUnmount.mockClear();
      const activate = vi.fn();
      const keys = vi.spyOn(grid, '_dispatchKeyDown');
      grid.addEventListener('cell-activate', activate);
      adjacent.addEventListener('cell-activate', activate);
      grid.addEventListener('cell-click', activate);
      adjacent.addEventListener('cell-click', activate);
      for (const kind of ['tree', 'detail', 'checkbox', 'header']) {
        const owner = kind === 'tree' || kind === 'detail' ? grid : adjacent;
        for (const nested of [false, true]) {
          for (const action of ['click', 'Enter', ' ']) {
            const host = owner.querySelector<HTMLElement>(`[data-control="${kind}"]`)!;
            expect(host.dataset['provider']).toBe(owner === grid ? 'entry-owner' : 'checkbox-owner');
            expect(host.dataset['owned']).toBe('true');
            expect(host.matches('button,input,[role],[tabindex]')).toBe(false);
            handled.mockClear();
            await act(async () => dispatch(nested ? host.querySelector('path')! : host, action));
            expect(handled).toHaveBeenCalledExactlyOnceWith(kind);
            expect(container.querySelector('.cell.editing')).toBeNull();
            expect(activate).not.toHaveBeenCalled();
          }
        }
      }
      expect(keys).not.toHaveBeenCalled();
      expect(grid.querySelector('[data-name="Parent"]')).toBe(name);
      expect(nameUnmount.mock.calls.filter(([value]) => value === 'Parent')).toHaveLength(0);
      for (const kind of ['tree', 'detail']) {
        const host = grid.querySelector<HTMLElement>(`[data-control="${kind}"]`)!;
        const col = Number(host.closest<HTMLElement>('.cell')!.dataset['col']);
        await act(async () => {
          grid.focusCell(1, 'value');
          dispatch(host.querySelector('path')!, 'ArrowRight');
        });
        expect(grid._focusRow).toBe(0);
        expect(grid._focusCol).toBe(col + 1);
      }
      expect(keys).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
      await act(async () => root!.render(app('B')));
      await act(async () => root!.render(app('B', true)));
      await act(async () => {
        await vi.waitFor(() => expect(grid.effectiveConfig.sortable).toBe(true));
        await vi.waitFor(() =>
          expect(adjacent.querySelector('[data-control="header"]')?.getAttribute('data-version')).toBe('B'),
        );
      });
      expect(grid.getPluginByName('cellEntry')).toBe(entry);
      expect(grid.getPluginByName('tree')).toBe(tree);
      expect(adjacent.getPluginByName('selection')).toBe(selection);
      expect(grid.querySelector('[data-control="tree"]')?.getAttribute('data-version')).toBe('B');
      for (const action of ['click', 'Enter', 'F2']) {
        await act(async () => {
          grid.focusCell(0, 'value');
          dispatch(grid.querySelector('.cell[data-row="0"][data-field="value"]')!, action);
        });
        expect(grid.querySelectorAll('.cell.editing')).toHaveLength(1);
        expect(adjacent.querySelector('.cell.editing')).toBeNull();
        await act(async () => dispatch(grid.querySelector('.cell.editing input')!, 'Escape'));
      }
      await act(async () => root!.unmount());
      root = undefined;
      expect(live.size).toBe(0);
    },
  );
});
