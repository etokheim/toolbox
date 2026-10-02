/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import { createPluginFromFeature } from '@toolbox-web/grid/features/registry';
import type { TreeDisclosureContext } from '@toolbox-web/grid/plugins/tree';
import { MasterDetailPlugin, type MasterDetailDisclosureContext } from '@toolbox-web/grid/plugins/master-detail';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import { GridDetailPanel } from '../lib/grid-detail-panel';
import { GridElementContext } from '../lib/grid-element-context';
import type { TreeConfig, MasterDetailConfig } from '../lib/feature-props';
import type { GridConfig } from '../lib/react-column-config';
import { getPortalManager } from '../lib/portal-bridge';
import './tree';
import './master-detail';

vi.mock('react-dom/client', { spy: true });
vi.mock('react-dom', { spy: true });

type Row = { id: string; name: string; children?: Row[] };
const rows: Row[] = [{ id: 'p', name: 'Parent', children: [{ id: 'c', name: 'Child' }] }];
const Provider = createContext('missing');
const roots: Root[] = [];
const mounts = vi.fn();
const unmounts = vi.fn();
const contexts = new Map<string, TreeDisclosureContext<Row> | MasterDetailDisclosureContext<Row>>();
const liveControls = new Set<HTMLElement>();

function Name({ name }: { name: string }) {
  const provider = useContext(Provider);
  useEffect(() => {
    mounts(name);
    return () => {
      unmounts(name);
    };
  }, [name]);
  return (
    <a href={`#${name}`} data-name={name} data-provider={provider}>
      {name}
    </a>
  );
}

function Disclosure({
  context,
  kind,
  version,
}: {
  context: TreeDisclosureContext<Row> | MasterDetailDisclosureContext<Row>;
  kind: string;
  version: string;
}) {
  const provider = useContext(Provider);
  const owner = useContext(GridElementContext);
  useEffect(() => {
    liveControls.add(context.host);
    return () => {
      liveControls.delete(context.host);
    };
  }, [context.host]);
  contexts.set(`${kind}-${context.row.id}`, context);
  return (
    <button
      type="button"
      data-control={kind}
      data-version={version}
      data-provider={provider}
      data-owned={owner?.current === context.grid}
      aria-label={'ariaLabel' in context ? context.ariaLabel : `Children of ${context.row.name}`}
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

const columns: GridConfig<Row>['columns'] = [{ field: 'name', renderer: ({ row }) => <Name name={row.name} /> }];
const detailRenderer = () => <Detail />;
function Detail() {
  return <section data-detail={useContext(Provider)}>Details</section>;
}
function config(version: string): { tree: TreeConfig<Row>; masterDetail: MasterDetailConfig<Row> } {
  return {
    tree: {
      animation: false,
      treeColumn: 'name',
      disclosureRenderer: (context) => <Disclosure context={context} kind="tree" version={version} />,
    },
    masterDetail: {
      animation: false,
      detailRenderer,
      expandOnRowClick: true,
      disclosureRenderer: (context) => <Disclosure context={context} kind="detail" version={version} />,
    },
  };
}

async function mount(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // Deliberately outside act: normal layout/passive effect ordering caught the prerequisite regression.
  root.render(node);
  await vi.waitFor(() => expect(container.innerHTML).toContain('data-control="tree"'));
  const grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
  await grid.ready();
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  return { root, grid };
}

afterEach(async () => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = '';
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  mounts.mockClear();
  unmounts.mockClear();
  contexts.clear();
  liveControls.clear();
  vi.restoreAllMocks();
  vi.mocked(createRoot).mockClear();
  vi.mocked(flushSync).mockClear();
});

describe('React disclosure controls', () => {
  it('preserves unscoped disclosure actions through same-callback JSX/DOM transitions', async () => {
    let dom = false;
    const renderer = (kind: string) => (context: TreeDisclosureContext<Row> | MasterDetailDisclosureContext<Row>) => {
      if (!dom) return <Disclosure context={context} kind={kind} version="mixed" />;
      const button = document.createElement('button');
      button.dataset['disclosureDom'] = `${kind}-${context.row.id}`;
      button.onclick = () => context.setExpanded(!context.expanded);
      return button;
    };
    const { grid } = await mount(
      <DataGrid
        rows={rows}
        gridConfig={{ columns }}
        tree={{ animation: false, treeColumn: 'name', disclosureRenderer: renderer('tree') }}
        masterDetail={{ animation: false, detailRenderer, disclosureRenderer: renderer('detail') }}
      />,
    );
    const tree = grid.getPluginByName('tree');
    const detail = grid.getPluginByName('masterDetail');
    if (!tree || !detail) throw new Error('Missing disclosure plugins');
    dom = true;
    tree.afterRender();
    detail.afterRender();
    grid.querySelector<HTMLButtonElement>('[data-disclosure-dom="tree-p"]')?.click();
    await vi.waitFor(() => expect(grid.querySelector('[data-name="Child"]')).not.toBeNull());
    grid.querySelector<HTMLButtonElement>('[data-disclosure-dom="detail-p"]')?.click();
    await vi.waitFor(() => expect(grid.querySelector('[data-detail]')).not.toBeNull());
    dom = false;
    tree.afterRender();
    detail.afterRender();
    await vi.waitFor(() =>
      expect(grid.querySelector('[data-control="tree"]')?.getAttribute('aria-expanded')).toBe('true'),
    );
    expect(grid.querySelector('[data-control="detail"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it.each(['props', 'config'] as const)(
    'preserves independent slots and latest callbacks outside act (%s)',
    async (surface) => {
      const app = (features: ReturnType<typeof config>, sortable = false) => (
        <Provider.Provider value="app">
          <DataGrid<Row>
            rows={rows}
            sortable={sortable}
            {...(surface === 'props'
              ? { ...features, gridConfig: { columns } }
              : { gridConfig: { columns, features } })}
          />
        </Provider.Provider>
      );
      const initial = config('A');
      const { root, grid } = await mount(app(initial));
      const tree = grid.getPluginByName('tree')!;
      const detail = grid.getPluginByName('masterDetail')!;
      const name = grid.querySelector('[data-name="Parent"]');
      const parentUnmounts = unmounts.mock.calls.filter(([value]) => value === 'Parent').length;
      const button = grid.querySelector<HTMLButtonElement>('[data-control="tree"]')!;
      const treeEvent = vi.fn();
      const detailEvent = vi.fn();
      const activate = vi.fn();
      grid.addEventListener('tree-expand', treeEvent);
      grid.addEventListener('detail-expand', detailEvent);
      grid.addEventListener('cell-activate', activate);
      expect(button.dataset['owned']).toBe('true');
      button.focus();
      button.querySelector('path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.waitFor(() => expect(grid.querySelector('[data-name="Child"]')).not.toBeNull());
      expect(document.activeElement).toBe(button);
      expect(grid.querySelector('[data-name="Parent"]')).toBe(name);
      expect(treeEvent).toHaveBeenCalledTimes(1);
      expect(detailEvent).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
      expect(unmounts.mock.calls.filter(([value]) => value === 'Parent')).toHaveLength(parentUnmounts);
      const stale = contexts.get('tree-p')!;
      const next = config('B');
      root.render(app(next));
      await vi.waitFor(() =>
        expect(grid.querySelector('[data-control="tree"]')?.getAttribute('data-version')).toBe('B'),
      );
      expect(grid.getPluginByName('tree')).toBe(tree);
      expect(grid.getPluginByName('masterDetail')).toBe(detail);
      expect(tree.isExpanded((stale as TreeDisclosureContext<Row>).key)).toBe(true);
      stale.setExpanded(false);
      expect(tree.isExpanded((stale as TreeDisclosureContext<Row>).key)).toBe(true);
      expect(grid.querySelector('[data-name="Parent"]')).toBe(name);
      root.render(app(next, true));
      await vi.waitFor(() => expect(grid.effectiveConfig.sortable).toBe(true));
      await vi.waitFor(() =>
        expect(grid.querySelector('[data-control="tree"]')?.getAttribute('data-version')).toBe('B'),
      );
      grid.querySelector<HTMLButtonElement>('[data-control="detail"]')!.click();
      await vi.waitFor(() => expect(grid.querySelector('[data-detail]')?.getAttribute('data-detail')).toBe('app'));
    },
  );

  it('isolates two owners and releases detail portals on collapse and detach', async () => {
    const vanilla = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    vanilla.gridConfig = { columns: [{ field: 'name' }] };
    vanilla.rows = [{ id: 'v', name: 'Vanilla' }];
    document.body.append(vanilla);
    const app = (label: string) => (
      <Provider.Provider value={label}>
        <DataGrid rows={rows} gridConfig={{ columns }} {...config('A')} />
      </Provider.Provider>
    );
    const a = await mount(app('first'));
    const b = await mount(app('second'));
    const rootCount = vi.mocked(createRoot).mock.calls.length;
    expect(rootCount).toBe(2);
    for (const [grid, label] of [
      [a.grid, 'first'],
      [b.grid, 'second'],
    ] as const) {
      grid.rows = [{ id: 'recycled', name: 'Recycled', children: [{ id: 'fresh', name: 'Fresh' }] }];
      await vi.waitFor(() =>
        expect(grid.querySelector('[data-name="Recycled"]')?.getAttribute('data-provider')).toBe(label),
      );
      grid.querySelector<HTMLButtonElement>('[data-control="tree"]')!.click();
      await vi.waitFor(() =>
        expect(grid.querySelector('[data-name="Fresh"]')?.getAttribute('data-provider')).toBe(label),
      );
    }
    expect(createRoot).toHaveBeenCalledTimes(rootCount);
    a.root.render(app('replacement'));
    await vi.waitFor(() =>
      expect(a.grid.querySelector('[data-control="tree"]')?.getAttribute('data-provider')).toBe('replacement'),
    );
    for (const [grid, label] of [
      [a.grid, 'replacement'],
      [b.grid, 'second'],
    ] as const) {
      grid.querySelector<HTMLButtonElement>('[data-control="detail"]')!.click();
      await vi.waitFor(() => expect(grid.querySelector('[data-detail]')?.getAttribute('data-detail')).toBe(label));
    }
    const pm = getPortalManager(a.grid)!;
    const remove = vi.spyOn(pm, 'removePortal');
    a.grid.querySelector<HTMLButtonElement>('[data-control="detail"]')!.click();
    await vi.waitFor(() => expect(a.grid.querySelector('[data-detail]')).toBeNull());
    expect(remove).toHaveBeenCalled();
    a.grid.querySelector<HTMLButtonElement>('[data-control="detail"]')!.click();
    await vi.waitFor(() => expect(a.grid.querySelector('[data-detail]')).not.toBeNull());
    remove.mockClear();
    a.root.unmount();
    roots.splice(roots.indexOf(a.root), 1);
    expect(getPortalManager(a.grid)).toBeNull();
    expect(b.grid.querySelector('[data-detail]')?.getAttribute('data-detail')).toBe('second');
    expect(b.grid.querySelector('[data-name="Recycled"]')?.getAttribute('data-provider')).toBe('second');
    expect(createRoot).toHaveBeenCalledTimes(rootCount);
  });

  it('preserves light-DOM detail precedence and leaves the core factory DOM-only', async () => {
    const vanilla = () => document.createElement('article');
    const plugin = createPluginFromFeature('masterDetail', { detailRenderer: vanilla }) as MasterDetailPlugin;
    expect(plugin.resolvedConfig.detailRenderer).toBe(vanilla);
    const { grid } = await mount(
      <DataGrid rows={rows} gridConfig={{ columns }} {...config('A')}>
        <GridDetailPanel>{() => <section data-child-detail>Child wins</section>}</GridDetailPanel>
      </DataGrid>,
    );
    grid.querySelector<HTMLButtonElement>('[data-control="detail"]')!.click();
    await vi.waitFor(() => expect(grid.querySelector('[data-child-detail]')).not.toBeNull());
    expect(grid.querySelector('[data-detail]')).toBeNull();
  });

  it('bounds mounted slots across repeated expand/collapse with a React Name renderer', async () => {
    const { grid } = await mount(<DataGrid rows={rows} gridConfig={{ columns }} {...config('A')} />);
    const parent = grid.querySelector('[data-name="Parent"]');
    const parentUnmounts = unmounts.mock.calls.filter(([value]) => value === 'Parent').length;
    const button = grid.querySelector<HTMLButtonElement>('[data-control="tree"]')!;
    const columnsPass = vi.spyOn(grid.getPluginByName('tree')!, 'processColumns');
    for (let i = 0; i < 100; i++) {
      button.click();
      await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
      button.click();
      await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
    }
    await vi.waitFor(() => expect(mounts.mock.calls.length - unmounts.mock.calls.length).toBe(1));
    expect(grid.querySelectorAll('[data-control]')).toHaveLength(2);
    expect(grid.querySelector('[data-name="Parent"]')).toBe(parent);
    expect(unmounts.mock.calls.filter(([value]) => value === 'Parent')).toHaveLength(parentUnmounts);
    expect(liveControls.size).toBe(2);
    expect(columnsPass).not.toHaveBeenCalled();
  }, 30000);

  it('batches portal teardown rather than synchronously flushing per child cell', async () => {
    const { grid } = await mount(<DataGrid rows={rows} gridConfig={{ columns }} {...config('A')} />);
    grid._virtualization.bypassThreshold = 100;
    grid.rows = [
      {
        id: 'many',
        name: 'Many',
        children: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, name: `Child ${i}` })),
      },
    ];
    await vi.waitFor(() => expect(grid.querySelector('[data-name="Many"]')).not.toBeNull());
    const button = grid.querySelector<HTMLButtonElement>('[data-control="tree"]')!;
    button.click();
    await vi.waitFor(() => expect(grid.querySelectorAll('[data-name]')).toHaveLength(31));
    vi.mocked(flushSync).mockClear();
    button.click();
    await vi.waitFor(() => expect(grid.querySelectorAll('[data-name]')).toHaveLength(1));
    expect(vi.mocked(flushSync).mock.calls.length).toBeLessThan(10);
    expect(liveControls.size).toBe(2);
  });
});
