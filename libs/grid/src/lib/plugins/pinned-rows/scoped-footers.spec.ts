import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { getRowFlow } from '../../core/internal/row-flow';
import { getTotalHeight } from '../../core/internal/virtualization';
import { GroupingRowsPlugin } from '../grouping-rows/grouping-rows-plugin';
import { TreePlugin } from '../tree/tree-plugin';
import { PinnedRowsPlugin } from './pinned-rows-plugin';
import type { FooterContext, FooterScope } from './types';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function viewport(grid: DataGridElement, height: number): void {
  Object.defineProperty(grid._virtualization.viewportEl, 'clientHeight', { value: height, configurable: true });
}

describe('scoped non-data footers', () => {
  it.each([false, true])(
    'refreshes owner presentation depth in retained controls (collapsible=%s)',
    async (collapsible) => {
      type Row = { id: string; children?: Row[] };
      const parent: Row = { id: 'owner', children: [{ id: 'member' }] };
      const contexts = new Map<string | object, FooterContext<Row>>();
      const mounts = new Map<string | object, HTMLElement>();
      const dispose = vi.fn();
      const render = (context: FooterContext<Row>) => {
        const element = document.createElement('button');
        mounts.set(context.scope.key, element);
        contexts.set(context.scope.key, context);
        return { element, update: (next: FooterContext<Row>) => contexts.set(next.scope.key, next), dispose };
      };
      const tree = new TreePlugin({ defaultExpanded: true, animation: false });
      const grouping = new GroupingRowsPlugin({
        groupOn: (_row, context) => (context.parent === parent ? 'Members' : null),
        childGroupsCollapsible: collapsible,
        defaultExpanded: true,
        animation: false,
      });
      const pinned = new PinnedRowsPlugin<Row>({ slots: [], scopedFooters: () => ({ height: 24, render }) });
      const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
      grid.gridConfig = {
        columns: [{ field: 'id' }],
        rowHeight: 24,
        getRowId: (row) => row.id,
        plugins: [tree, grouping, pinned],
      };
      grid.rows = [{ id: 'wrapper', children: [parent] }];
      document.body.append(grid);
      await grid.ready();
      viewport(grid, 1000);
      getRowFlow(grid)!.layout();
      const group = [...contexts.values()].find((context) => context.scope.kind === 'group')!;
      const parentContext = [...contexts.values()].find(
        (context) => context.scope.kind === 'row' && context.scope.row === parent,
      )!;
      expect(group.depth).toBe(2);
      expect(group.collapsible).toBe(collapsible);
      expect(parentContext.depth).toBe(tree.getRowMeta(parent)?.depth);
      expect(contexts.get('grid')).toMatchObject({ depth: 0, collapsible: undefined });
      const groupOwner = mounts.get(group.scope.key)!;
      const parentOwner = mounts.get(parentContext.scope.key)!;
      // Replay a native presentation generation with unchanged scope/content
      // identities; a retained ControlView must receive changed metadata.
      const groupRow = grid.rows.find((row) => '__groupCollapsible' in row)!;
      if (!('__groupCollapsible' in groupRow)) throw new Error('Missing native group occurrence');
      groupRow.__groupCollapsible = !collapsible;
      grid.__rowRenderEpoch++;
      getRowFlow(grid)!.prepare();
      getRowFlow(grid)!.layout();
      expect(contexts.get(group.scope.key)?.collapsible).toBe(!collapsible);
      expect(mounts.get(group.scope.key)).toBe(groupOwner);
      grid.rows = [parent];
      await vi.waitFor(() => expect(contexts.get(group.scope.key)?.depth).toBe(1));
      expect(contexts.get(parentContext.scope.key)?.depth).toBe(0);
      expect(contexts.get(group.scope.key)?.collapsible).toBe(collapsible);
      expect(groupOwner.isConnected).toBe(true);
      expect(parentOwner.isConnected).toBe(true);
      expect(mounts.get(group.scope.key)).toBe(groupOwner);
      expect(mounts.get(parentContext.scope.key)).toBe(parentOwner);
      // Only the removed wrapper scope retires.
      expect(dispose).toHaveBeenCalledOnce();
    },
  );

  it.each([24, 40])('accounts %ipx in flow without changing data identities or surface heights', async (height) => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const button = document.createElement('button');
    button.textContent = 'Append';
    const pinned = new PinnedRowsPlugin({
      slots: [],
      scopedFooters: (scope) => (scope.kind === 'grid' ? { height, render: () => button } : null),
    });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
    grid.gridConfig = { columns: [{ field: 'id' }], rowHeight: 24, plugins: [pinned] };
    grid.rows = rows;
    document.body.append(grid);
    await grid.ready();
    viewport(grid, 70);
    getRowFlow(grid)?.layout();
    expect(grid.rows).toEqual(rows);
    expect(grid._virtualization.positionCache?.map((entry) => entry.height)).toEqual([24, 24, 24]);
    expect(getTotalHeight(grid._virtualization.positionCache!)).toBe(72 + height);
    expect(grid.querySelectorAll('.tbw-scoped-footer')).toHaveLength(1);
    expect(pinned.getVerticalScrollOffsets()).toEqual({ top: 0, bottom: height });
    expect(button.closest('.data-grid-row')).toBeNull();
    expect(button.isConnected).toBe(true);
    pinned.setScopedFooters(undefined);
    await vi.waitFor(() => expect(grid.querySelector('.tbw-scoped-footer')).toBeNull());
    expect(grid.rows).toEqual(rows);
  });

  it('invokes the whole-grid callback for empty input and replaces live eligibility/height', async () => {
    const callback = vi.fn((_scope: FooterScope) => ({ height: 40, render: () => document.createElement('button') }));
    const pinned = new PinnedRowsPlugin({ slots: [], scopedFooters: callback });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
    grid.gridConfig = { columns: [{ field: 'id' }], plugins: [pinned] };
    document.body.append(grid);
    await grid.ready();
    viewport(grid, 100);
    getRowFlow(grid)?.layout();
    expect(callback).toHaveBeenCalledWith({ kind: 'grid', key: 'grid' });
    expect(getRowFlow(grid)?.emptyHeight()).toBe(40);
    expect(grid.querySelector<HTMLElement>('.tbw-scoped-footer')?.style.top).toBe('0px');
    pinned.setScopedFooters(() => ({ height: 24, render: () => document.createElement('button') }));
    await vi.waitFor(() => expect(getRowFlow(grid)?.emptyHeight()).toBe(24));
  });

  it('reports insufficient capacity, keeps natural extent and restores sticky occlusion', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pinned = new PinnedRowsPlugin({
      slots: [],
      scopedFooters: () => ({ height: 40, render: () => document.createElement('button') }),
    });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
    grid.gridConfig = { columns: [{ field: 'id' }], rowHeight: 24, plugins: [pinned] };
    grid.rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    document.body.append(grid);
    await grid.ready();
    viewport(grid, 40);
    getRowFlow(grid)?.layout();
    expect(getRowFlow(grid)?.exhausted?.()).toBe(true);
    expect(pinned.getVerticalScrollOffsets()?.bottom).toBe(0);
    expect(getTotalHeight(grid._virtualization.positionCache!)).toBe(112);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Insufficient space'));
    viewport(grid, 70);
    getRowFlow(grid)?.layout();
    expect(getRowFlow(grid)?.exhausted?.()).toBe(false);
    expect(pinned.getVerticalScrollOffsets()?.bottom).toBe(40);
  });

  it('provides parent occurrence and group path, retires collapse/removal, and disposes owners', async () => {
    const parent = { id: 'one', children: [{ id: 'child' }] };
    const contexts: FooterContext[] = [];
    const dispose = vi.fn();
    const render = (context: FooterContext) => {
      contexts.push(context);
      return {
        element: document.createElement('button'),
        update: (next: FooterContext) => contexts.push(next),
        dispose,
      };
    };
    const tree = new TreePlugin({ defaultExpanded: true, animation: false });
    const grouping = new GroupingRowsPlugin({
      groupOn: (_row, context) => (context.parent ? 'Members' : null),
      childGroupsCollapsible: false,
      animation: false,
    });
    const pinned = new PinnedRowsPlugin({
      slots: [],
      scopedFooters: (scope) => (scope.kind === 'group' ? { height: 24, render } : null),
    });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
    grid.gridConfig = { columns: [{ field: 'id' }], rowHeight: 24, plugins: [tree, grouping, pinned] };
    grid.rows = [parent];
    document.body.append(grid);
    await grid.ready();
    viewport(grid, 100);
    getRowFlow(grid)?.layout();
    expect(contexts.at(-1)?.scope).toMatchObject({ kind: 'group', parent, path: ['Members'] });
    expect(grid.rows).toHaveLength(3);
    tree.collapse('one');
    await vi.waitFor(() => expect(grid.rows).toHaveLength(1));
    expect(grid.querySelector('.tbw-scoped-footer')).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('orders overlapping extents innermost first and sticks only one live owner', async () => {
    const tree = new TreePlugin({ defaultExpanded: true, animation: false });
    const grouping = new GroupingRowsPlugin({
      groupOn: (_row, context) => (context.parent ? 'Members' : null),
      childGroupsCollapsible: false,
    });
    const render = ({ scope }: FooterContext) => {
      const element = document.createElement('button');
      element.textContent = scope.kind;
      return element;
    };
    const pinned = new PinnedRowsPlugin({ slots: [], scopedFooters: () => ({ height: 24, render }) });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
    grid.gridConfig = { columns: [{ field: 'id' }], rowHeight: 24, plugins: [tree, grouping, pinned] };
    grid.rows = [{ id: 'parent', children: [{ id: 'a' }, { id: 'b' }] }];
    document.body.append(grid);
    await grid.ready();
    viewport(grid, 60);
    getRowFlow(grid)?.layout();
    expect(grid.rows).toHaveLength(4);
    expect(getTotalHeight(grid._virtualization.positionCache!)).toBe(168);
    expect(grid._virtualization.positionCache!.at(-1)!.after).toBe(72);
    expect(grid.querySelectorAll('.tbw-scoped-footer[data-stuck="true"]')).toHaveLength(1);
    expect(grid.querySelector('.tbw-scoped-footer[data-stuck="true"]')!.textContent).toBe('group');
    expect(grid.querySelector<HTMLElement>('.group-row')!.style.getPropertyValue('--tbw-row-height')).toBe('');
  });

  it('keeps distinct repeated parents and refreshes immutable occurrence contexts without remounting', async () => {
    type Row = { id: string; occurrence: string; children: Row[] };
    const makeRows = (): Row[] => ['first', 'second'].map((occurrence) => ({ id: 'same', occurrence, children: [] }));
    const tree = new TreePlugin({ defaultExpanded: true, hasChildren: () => true });
    const grouping = new GroupingRowsPlugin({
      groupOn: () => null,
      emptyGroups: ({ parent }) => (parent ? [['Members']] : []),
      childGroupsCollapsible: false,
    });
    const contexts: FooterContext[] = [];
    const dispose = vi.fn();
    const render = (context: FooterContext) => {
      contexts.push(context);
      return {
        element: document.createElement('button'),
        update: (next: FooterContext) => contexts.push(next),
        dispose,
      };
    };
    const pinned = new PinnedRowsPlugin({
      slots: [],
      scopedFooters: (scope) => (scope.kind === 'group' ? { height: 24, render } : null),
    });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    const config = {
      columns: [{ field: 'id' }],
      rowHeight: () => 32,
      getRowId: (row: Row) => row.occurrence,
      plugins: [tree, grouping, pinned],
    };
    const rows = makeRows();
    grid.gridConfig = config;
    grid.rows = rows;
    document.body.append(grid);
    await grid.ready();
    viewport(grid, 500);
    getRowFlow(grid)?.layout();
    const keys = new Set(contexts.map(({ scope }) => scope.key));
    expect(keys.size).toBe(2);
    expect(grid.querySelector<HTMLElement>('.group-row')!.style.getPropertyValue('--tbw-row-height')).toBe('32px');
    const replacement = makeRows();
    grid.rows = replacement;
    await vi.waitFor(() =>
      expect(contexts.some(({ scope }) => scope.kind === 'group' && scope.parent === replacement[0])).toBe(true),
    );
    expect(new Set(contexts.map(({ scope }) => scope.key))).toEqual(keys);
    expect(dispose).not.toHaveBeenCalled();
    grid.rows = replacement.slice(1);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    grid.gridConfig = { ...config, getRowId: (row: Row) => row.occurrence };
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(2));
  });
});
