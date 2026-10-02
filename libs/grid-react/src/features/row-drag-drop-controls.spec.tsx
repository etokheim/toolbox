/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import type { RowDragHandleContext } from '@toolbox-web/grid/plugins/row-drag-drop';
import { createContext, useContext, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import { GridElementContext } from '../lib/grid-element-context';
import type { RowDragDropConfig } from '../lib/feature-props';
import type { GridConfig } from '../lib/react-column-config';
import './row-drag-drop';

vi.mock('react-dom/client', { spy: true });
vi.mock('react-dom', { spy: true });
type Row = { id: string; name: string };
const rows: Row[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
];
const columns: GridConfig<Row>['columns'] = [{ field: 'name' }];
const baseConfig: GridConfig<Row> = { columns };
const Provider = createContext('missing');
const roots: Root[] = [];
const live = new Set<HTMLElement>();
const contexts: RowDragHandleContext<Row>[] = [];
function Handle({ context, version }: { context: RowDragHandleContext<Row>; version: string }) {
  const provider = useContext(Provider);
  const owner = useContext(GridElementContext);
  contexts.push(context);
  useEffect(() => {
    live.add(context.host);
    return () => {
      live.delete(context.host);
    };
  }, [context.host]);
  return (
    <button
      ref={context.bindHandle}
      data-version={version}
      data-provider={provider}
      data-owned={owner?.current === context.grid}
      aria-label={context.ariaLabel}
    >
      <svg>
        <path d="M0 0L4 4" />
      </svg>
    </button>
  );
}
function config(version: string): RowDragDropConfig<Row> {
  return { animation: false, dragHandleRenderer: (context) => <Handle context={context} version={version} /> };
}
afterEach(async () => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = '';
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  contexts.length = 0;
  live.clear();
  vi.restoreAllMocks();
});

describe('React row drag controls', () => {
  it.each(['props', 'config'] as const)(
    'releases and reacquires a same-node binding when the renderer factory removes its ref (%s)',
    async (surface) => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      let enabled = true;
      let disabled = false;
      let role = 'button';
      let revision = 0;
      const renderer = (context: RowDragHandleContext<Row>) => {
        contexts.push(context);
        return (
          <button
            ref={enabled ? context.bindHandle : undefined}
            data-ref-owner={context.row.id}
            data-revision={revision}
            disabled={disabled}
            role={role}
          >
            Action
          </button>
        );
      };
      const drag = { dragHandleRenderer: renderer };
      root.render(
        <DataGrid<Row>
          rows={rows}
          {...(surface === 'props'
            ? { gridConfig: baseConfig, rowDragDrop: drag }
            : { gridConfig: { columns, features: { rowDragDrop: drag } } })}
        />,
      );
      await vi.waitFor(() => expect(container.querySelectorAll('[data-ref-owner]')).toHaveLength(2));
      const grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
      await grid.ready();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const plugin = grid.getPluginByName('rowDragDrop');
      if (!plugin) throw new Error('Missing drag plugin');
      const button = container.querySelector<HTMLButtonElement>('[data-ref-owner="a"]');
      const binding = () => {
        const context = contexts.filter((context) => context.row.id === 'a').at(-1);
        if (!context) throw new Error('Missing drag context');
        return context.bindHandle;
      };
      const refresh = async () => {
        revision++;
        plugin.afterRender();
        await vi.waitFor(() => expect(button?.dataset['revision']).toBe(String(revision)));
        expect(container.querySelector('[data-ref-owner="a"]')).toBe(button);
      };
      const first = binding();
      expect(button?.getAttribute('draggable')).toBe('true');
      enabled = false;
      role = 'switch';
      await refresh();
      expect(button?.hasAttribute('draggable')).toBe(false);
      expect(button?.hasAttribute('aria-label')).toBe(false);
      expect(button?.getAttribute('role')).toBe('switch');
      first(button);
      expect(button?.hasAttribute('draggable')).toBe(false);
      button?.click();
      expect(grid.querySelector('.tbw-row-move-menu')).toBeNull();

      enabled = true;
      disabled = true;
      role = 'button';
      await refresh();
      const disabledBinding = binding();
      expect(button?.disabled).toBe(true);
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(grid.querySelector('.tbw-row-move-menu')).toBeNull();

      disabled = false;
      role = 'switch';
      await refresh();
      first(null);
      disabledBinding(null);
      disabledBinding(button);
      expect(button?.getAttribute('draggable')).toBe('true');
      expect(button?.getAttribute('role')).toBe('switch');
      button?.click();
      expect(grid.querySelectorAll('.tbw-row-move-menu')).toHaveLength(1);
      binding()(null);
      expect(button?.hasAttribute('draggable')).toBe(false);
      expect(grid.querySelector<HTMLElement>('.tbw-row-move-menu')?.hidden).toBe(true);
      binding()(button);
      expect(button?.getAttribute('draggable')).toBe('true');
      if (!button) throw new Error('Missing drag button');
      button.click();
      const writes = vi.spyOn(button, 'setAttribute');
      const removals = vi.spyOn(button, 'removeAttribute');
      await refresh();
      const nativeAttributes = ['draggable', 'aria-label', 'type'];
      expect(writes.mock.calls.filter(([name]) => nativeAttributes.includes(name))).toEqual([]);
      expect(removals.mock.calls.filter(([name]) => nativeAttributes.includes(name))).toEqual([]);
      expect(grid.querySelector<HTMLElement>('.tbw-row-move-menu')?.hidden).toBe(false);
      binding()(null);
      expect(button.hasAttribute('draggable')).toBe(false);
      expect(grid.querySelector<HTMLElement>('.tbw-row-move-menu')?.hidden).toBe(true);
    },
  );

  it.each(['props', 'config'] as const)(
    'keeps synchronous ControlView binding through deferred JSX retirement (%s)',
    async (surface) => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      const retired = vi.fn();
      const domContexts: RowDragHandleContext<Row>[] = [];
      const updates = vi.fn();
      let dom = false;
      function Retiring({ context }: { context: RowDragHandleContext<Row> }) {
        useEffect(() => () => retired(), []);
        return <button ref={context.bindHandle} data-retiring={context.row.id} />;
      }
      const renderer = vi.fn((context: RowDragHandleContext<Row>) => {
        if (!dom) {
          contexts.push(context);
          return <Retiring context={context} />;
        }
        const element = document.createElement('button');
        element.dataset['successor'] = context.row.id;
        context.bindHandle(element);
        domContexts.push(context);
        return { element, update: updates };
      });
      const drag = { dragHandleRenderer: renderer };
      root.render(
        <DataGrid<Row>
          rows={rows}
          {...(surface === 'props'
            ? { gridConfig: baseConfig, rowDragDrop: drag }
            : { gridConfig: { columns, features: { rowDragDrop: drag } } })}
        />,
      );
      await vi.waitFor(() => expect(container.querySelectorAll('[data-retiring]')).toHaveLength(2));
      const grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
      await grid.ready();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const plugin = grid.getPluginByName('rowDragDrop');
      if (!plugin) throw new Error('Missing drag plugin');
      const oldContexts = [...contexts];
      const oldButton = container.querySelector<HTMLButtonElement>('[data-retiring="a"]');
      retired.mockClear();
      dom = true;
      const flushBefore = vi.mocked(flushSync).mock.calls.length;
      const rootsBefore = vi.mocked(createRoot).mock.calls.length;
      plugin.afterRender();
      expect(vi.mocked(flushSync).mock.calls.length).toBe(flushBefore);
      const successor = container.querySelector<HTMLButtonElement>('[data-successor="a"]');
      expect(successor?.getAttribute('draggable')).toBe('true');
      await vi.waitFor(() => expect(retired).toHaveBeenCalledTimes(2));
      expect(container.querySelector('[data-successor="a"]')).toBe(successor);
      expect(successor?.getAttribute('draggable')).toBe('true');
      const calls = renderer.mock.calls.length;
      plugin.afterRender();
      expect(renderer).toHaveBeenCalledTimes(calls);
      expect(updates.mock.calls.some(([context]) => context.bindHandle === domContexts[0].bindHandle)).toBe(true);
      for (const old of oldContexts) old.bindHandle(null);
      oldContexts[0].bindHandle(oldButton);
      expect(successor?.getAttribute('draggable')).toBe('true');
      successor?.click();
      expect(grid.querySelectorAll('.tbw-row-move-menu')).toHaveLength(1);
      domContexts[0].bindHandle(null);
      expect(successor?.hasAttribute('draggable')).toBe(false);
      domContexts[0].bindHandle(successor);
      expect(successor?.getAttribute('draggable')).toBe('true');
      expect(vi.mocked(createRoot).mock.calls.length).toBe(rootsBefore);
    },
  );

  it.each(['props', 'config'] as const)(
    'keeps JSX state across DOM-to-JSX updates and honors current ref removal (%s)',
    async (surface) => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      const mounted = vi.fn();
      const removed = vi.fn();
      const domContexts: RowDragHandleContext<Row>[] = [];
      const jsxBindings: RowDragHandleContext<Row>['bindHandle'][] = [];
      let jsx = false;
      function Stateful({ context }: { context: RowDragHandleContext<Row> }) {
        if (context.row.id === 'a') jsxBindings.push(context.bindHandle);
        const [count, setCount] = useState(0);
        const [visible, setVisible] = useState(true);
        useEffect(() => {
          mounted();
          return () => removed();
        }, []);
        return (
          <>
            {visible && (
              <button ref={context.bindHandle} data-live={context.row.id} onClick={() => setCount(count + 1)}>
                {count}
              </button>
            )}
            <button data-remove={context.row.id} onClick={() => setVisible(false)} />
          </>
        );
      }
      const renderer = (context: RowDragHandleContext<Row>) => {
        if (jsx) return <Stateful context={context} />;
        const element = document.createElement('button');
        element.dataset['previous'] = context.row.id;
        context.bindHandle(element);
        domContexts.push(context);
        return element;
      };
      const drag = { dragHandleRenderer: renderer };
      root.render(
        <DataGrid<Row>
          rows={rows}
          {...(surface === 'props'
            ? { gridConfig: baseConfig, rowDragDrop: drag }
            : { gridConfig: { columns, features: { rowDragDrop: drag } } })}
        />,
      );
      await vi.waitFor(() => expect(container.querySelectorAll('[data-previous]')).toHaveLength(2));
      const grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
      await grid.ready();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const plugin = grid.getPluginByName('rowDragDrop');
      if (!plugin) throw new Error('Missing drag plugin');
      jsx = true;
      plugin.afterRender();
      await vi.waitFor(() => expect(mounted).toHaveBeenCalledTimes(2));
      const button = container.querySelector<HTMLButtonElement>('[data-live="a"]');
      for (const old of domContexts) old.bindHandle(null);
      expect(button?.getAttribute('draggable')).toBe('true');
      const stateBinding = jsxBindings.at(-1);
      button?.click();
      await vi.waitFor(() => expect(button?.textContent).toBe('1'));
      expect(jsxBindings.at(-1)).toBe(stateBinding);
      const renders = jsxBindings.length;
      plugin.afterRender();
      await vi.waitFor(() => expect(jsxBindings.length).toBeGreaterThan(renders));
      expect(container.querySelector('[data-live="a"]')).toBe(button);
      expect(button?.textContent).toBe('1');
      expect(mounted).toHaveBeenCalledTimes(2);
      expect(removed).not.toHaveBeenCalled();
      container.querySelector<HTMLButtonElement>('[data-remove="a"]')?.click();
      await vi.waitFor(() => expect(button?.isConnected).toBe(false));
      expect(button?.hasAttribute('draggable')).toBe(false);
    },
  );

  it.each(['props', 'config'] as const)('retains latest callback, owner and stable portals (%s)', async (surface) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const app = (drag: RowDragDropConfig<Row> | false, sortable = false) => (
      <Provider.Provider value="owner">
        <DataGrid<Row>
          rows={rows}
          sortable={sortable}
          {...(surface === 'props'
            ? { rowDragDrop: drag, gridConfig: baseConfig }
            : { gridConfig: { columns, features: { rowDragDrop: drag } } })}
        />
      </Provider.Provider>
    );
    root.render(app(config('A')));
    await vi.waitFor(() => expect(container.querySelectorAll('[data-version="A"]')).toHaveLength(2));
    const grid = container.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
    await grid.ready();
    const plugin = grid.getPluginByName('rowDragDrop');
    if (!plugin) throw new Error('Missing plugin');
    const process = vi.spyOn(plugin, 'processColumns');
    const old = contexts[0];
    const rootsBefore = vi.mocked(createRoot).mock.calls.length;
    const flushBefore = vi.mocked(flushSync).mock.calls.length;
    plugin.afterRender();
    expect(vi.mocked(flushSync).mock.calls.length).toBe(flushBefore);
    await vi.waitFor(() => expect(live.size).toBe(2));
    expect(vi.mocked(createRoot).mock.calls.length).toBe(rootsBefore);
    expect(vi.mocked(flushSync).mock.calls.length - flushBefore).toBeLessThanOrEqual(1);
    const next = config('B');
    root.render(app(next));
    await vi.waitFor(() => expect(container.querySelectorAll('[data-version="B"]')).toHaveLength(2));
    old.bindHandle(null);
    expect(grid.getPluginByName('rowDragDrop')).toBe(plugin);
    expect(process).not.toHaveBeenCalled();
    root.render(app(next, true));
    await vi.waitFor(() => expect(grid.effectiveConfig.sortable).toBe(true));
    await vi.waitFor(() => expect(container.querySelectorAll('[data-version="B"]')).toHaveLength(2));
    expect(container.querySelector('[data-owned="false"]')).toBeNull();
    const button = container.querySelector<HTMLButtonElement>('button[data-version="B"]');
    expect(button?.getAttribute('draggable')).toBe('true');
    button?.click();
    expect(grid.querySelectorAll('.tbw-row-move-menu')).toHaveLength(1);
    root.render(app(false));
    await vi.waitFor(() => expect(container.querySelectorAll('button[data-version]')).toHaveLength(0));
    await vi.waitFor(() => expect(live.size).toBe(0));
    expect(button?.hasAttribute('draggable')).toBe(false);
    old.bindHandle(button);
    expect(button?.hasAttribute('draggable')).toBe(false);
    root.unmount();
    roots.splice(roots.indexOf(root), 1);
    await vi.waitFor(() => expect(live.size).toBe(0));
    expect(button?.hasAttribute('draggable')).toBe(false);
  });

  it('isolates two provider owners and a vanilla grid', async () => {
    const vanilla = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    vanilla.gridConfig = { columns: [{ field: 'name' }], features: { rowDragDrop: true } };
    vanilla.rows = rows;
    document.body.append(vanilla);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    root.render(
      <>
        {['one', 'two'].map((provider) => (
          <Provider.Provider key={provider} value={provider}>
            <DataGrid<Row> rows={rows} gridConfig={{ columns }} rowDragDrop={config(provider)} />
          </Provider.Provider>
        ))}
      </>,
    );
    await vi.waitFor(() => expect(container.querySelectorAll('[data-owned="true"]')).toHaveLength(4));
    expect(container.querySelectorAll('[data-provider="one"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-provider="two"]')).toHaveLength(2);
    expect(vanilla.querySelectorAll('.dg-row-drag-handle')).toHaveLength(2);
  });
});
