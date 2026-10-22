/** @vitest-environment happy-dom */
import { BaseGridPlugin, DataGridElement } from '@toolbox-web/grid';
import { SelectionPlugin } from '@toolbox-web/grid/plugins/selection';
import { StickyRowsPlugin } from '@toolbox-web/grid/plugins/sticky-rows';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import type { GridConfig } from '../lib/react-column-config';
import './selection';
import './sticky-rows';

type Row = { id: string };
const rows: Row[] = [{ id: 'one' }, { id: 'two' }];
const baseConfig: GridConfig<Row> = { columns: [{ field: 'id' }], getRowId: (row) => row.id };
const roots: Root[] = [];
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

afterEach(async () => {
  for (const root of roots.splice(0)) root.unmount();
  await frame();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('compares serializable feature options during SSR without a global Node constructor', () => {
  vi.stubGlobal('Node', undefined);
  try {
    expect(
      renderToString(
        <DataGrid rows={rows} gridConfig={baseConfig} stickyRows={{ isSticky: 'id' }} selection={{ mode: 'row' }} />,
      ),
    ).toContain(DataGridElement.activeTag);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe.each([false, true])('StickyRows external owner (canonical: %s)', (canonical) => {
  it.each(canonical ? ['config'] : ['props', 'plugins'])(
    'retains unchanged %s lifetimes and state on a rowHeight-only config replacement',
    async (surface) => {
      class UtilityPlugin extends BaseGridPlugin {
        readonly name = 'testUtility';
      }
      const utility = new UtilityPlugin();
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      const features = {
        stickyRows: { mode: 'ancestors' as const, isSticky: 'id', scrollContainer: host },
        selection: { mode: 'row' as const },
      };
      const comfortable = () => 32;
      const compact = () => 24;
      const explicit = [utility, new StickyRowsPlugin(features.stickyRows), new SelectionPlugin(features.selection)];
      const app = (rowHeight: () => number) => {
        const config = { ...baseConfig, rowHeight, plugins: [utility] };
        if (surface === 'plugins') return <DataGrid rows={rows} gridConfig={{ ...config, plugins: [...explicit] }} />;
        return canonical ? (
          <DataGrid rows={rows} gridConfig={{ ...config, features }} />
        ) : (
          <DataGrid rows={rows} gridConfig={config} {...features} />
        );
      };
      root.render(app(comfortable));
      await vi.waitFor(() =>
        expect(host.querySelector<DataGridElement>(DataGridElement.activeTag)?.effectiveConfig.rowHeight).toBe(
          comfortable,
        ),
      );
      const grid = host.querySelector<DataGridElement<Row>>(DataGridElement.activeTag)!;
      const sticky = grid.getPluginByName('stickyRows')!;
      const selection = grid.getPluginByName('selection')!;
      selection.selectRows([0]);
      const selected = selection.getSelectedRows();
      const detach = vi.spyOn(sticky, 'detach');
      const utilityDetach = vi.spyOn(utility, 'detach');

      root.render(app(compact));
      await vi.waitFor(() => expect(grid.effectiveConfig.rowHeight).toBe(compact));
      await frame();
      await frame();
      expect.soft(grid.getPluginByName('stickyRows')).toBe(sticky);
      expect.soft(grid.getPluginByName('selection')).toBe(selection);
      expect.soft(selection.getSelectedRows()).toEqual(selected);
      expect.soft(detach).not.toHaveBeenCalled();
      expect.soft(utilityDetach).not.toHaveBeenCalled();
      roots.splice(roots.indexOf(root), 1);
      root.unmount();
      await frame();
      expect(detach).toHaveBeenCalledTimes(1);
      expect(utilityDetach).toHaveBeenCalledTimes(1);
    },
  );

  it('applies replacement semantic callbacks rather than treating them as renderer-only changes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const app = (isSticky: () => boolean) =>
      canonical ? (
        <DataGrid rows={rows} gridConfig={{ ...baseConfig, features: { stickyRows: { isSticky } } }} />
      ) : (
        <DataGrid rows={rows} gridConfig={baseConfig} stickyRows={{ isSticky }} />
      );
    root.render(app(first));
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    root.render(app(second));
    await vi.waitFor(() => expect(second).toHaveBeenCalled());
  });

  it.each([false, true])('preserves owner lifecycle and unchanged state (cyclic metadata: %s)', async (metadata) => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    // Attached framework metadata must not be traversed by feature option comparison.
    if (metadata) Object.assign(second, { frameworkMetadata: { owner: second } });
    document.body.append(first);
    first.append(second);
    const firstEvents = vi.spyOn(first, 'addEventListener');
    const secondEvents = vi.spyOn(second, 'addEventListener');
    const observe = vi.spyOn(ResizeObserver.prototype, 'observe');
    const host = document.createElement('div');
    second.append(host);
    const root = createRoot(host);
    roots.push(root);
    const app = (owner: HTMLElement, enabled = true) => {
      const stickyRows = enabled
        ? { mode: 'ancestors' as const, isSticky: 'id', scrollContainer: owner, topOffset: 12 }
        : undefined;
      const selection = { mode: 'row' as const };
      return canonical ? (
        <DataGrid rows={rows} gridConfig={{ ...baseConfig, features: { stickyRows, selection } }} />
      ) : (
        <DataGrid rows={rows} gridConfig={baseConfig} stickyRows={stickyRows} selection={selection} />
      );
    };
    root.render(app(first));
    await vi.waitFor(() =>
      expect(
        host.querySelector<DataGridElement>(DataGridElement.activeTag)?.getPluginByName('stickyRows'),
      ).toBeDefined(),
    );
    const grid = host.querySelector<DataGridElement<Row>>(DataGridElement.activeTag)!;
    await grid.ready();
    const sticky = grid.getPluginByName('stickyRows')!;
    const selection = grid.getPluginByName('selection')!;
    grid.sort('id', 'desc');
    await vi.waitFor(() => expect(grid.rows.map((row) => row.id)).toEqual(['two', 'one']));
    await frame();
    await frame();
    const selectedRow = grid.rows[0];
    selection.selectRows([0]);
    expect(selection.getSelectedRows()).toEqual([selectedRow]);
    const detach = vi.spyOn(sticky, 'detach');
    const signals = (events: typeof firstEvents) =>
      events.mock.calls
        .filter(([type]) => type === 'scroll')
        .map(([, , options]) => (typeof options === 'object' ? options.signal : undefined));
    expect(signals(firstEvents)).toHaveLength(1);
    expect(signals(firstEvents)[0]?.aborted).toBe(false);
    const observerIndex = observe.mock.calls.findIndex(([target]) => target === first);
    expect(observerIndex).toBeGreaterThanOrEqual(0);
    const observer = observe.mock.instances[observerIndex];
    if (!(observer instanceof ResizeObserver)) throw new Error('Missing owner ResizeObserver');
    const disconnect = vi.spyOn(observer, 'disconnect');

    root.render(app(first));
    await frame();
    await frame();
    expect(grid.getPluginByName('stickyRows')).toBe(sticky);
    expect(grid.getPluginByName('selection')).toBe(selection);
    expect(selection.getSelectedRows()).toEqual([selectedRow]);
    expect(grid.sortModel).toEqual({ field: 'id', direction: 'desc' });
    expect(grid.rows.map((row) => row.id)).toEqual(['two', 'one']);
    expect(detach).not.toHaveBeenCalled();
    expect(signals(firstEvents)).toHaveLength(1);

    root.render(app(second));
    await vi.waitFor(() => expect(signals(secondEvents)).toHaveLength(1));
    expect(signals(firstEvents).every((signal) => signal?.aborted)).toBe(true);
    expect(disconnect).toHaveBeenCalled();
    expect(observe.mock.calls.some(([target]) => target === second)).toBe(true);
    expect(signals(secondEvents)).toHaveLength(1);
    expect(signals(secondEvents)[0]?.aborted).toBe(false);
    await frame();
    await frame();
    const refresh = vi.spyOn(grid, 'refreshVirtualWindow');
    first.dispatchEvent(new Event('scroll'));
    await frame();
    await frame();
    expect(refresh).not.toHaveBeenCalled();
    second.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());

    root.render(app(second, false));
    await vi.waitFor(() => expect(signals(secondEvents).every((signal) => signal?.aborted)).toBe(true));
    await frame();
    await frame();
    refresh.mockClear();
    second.dispatchEvent(new Event('scroll'));
    await frame();
    await frame();
    expect(refresh).not.toHaveBeenCalled();
  });
});
