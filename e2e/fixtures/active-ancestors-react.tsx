import type { BaseGridPlugin, DataGridElement } from '@toolbox-web/grid';
import { DataGrid, GridColumn, type GridConfig } from '@toolbox-web/grid-react';
import '@toolbox-web/grid-react/features/selection';
import '@toolbox-web/grid-react/features/sticky-rows';
import '@toolbox-web/grid-react/features/tree';
import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

type Row = { id: string; children?: Row[]; revision?: number; __actions?: never };
export type Surface = 'props' | 'config' | 'mixed';
const rows: Row[] = Array.from({ length: 80 }, (_, index) => ({
  id: `root-${index}`,
  children: [{ id: `child-${index}-a` }, { id: `child-${index}-b` }],
}));
const getRowId = (row: Row) => row.id;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function mount(surface: Surface, external: boolean, utilityView = false) {
  const [{ BaseGridPlugin, DataGridElement }, { StickyRowsPlugin }, { PinnedColumnsPlugin }] = await Promise.all([
    import('@toolbox-web/grid'),
    import('@toolbox-web/grid/plugins/sticky-rows'),
    import('@toolbox-web/grid/plugins/pinned-columns'),
  ]);
  const style = document.createElement('style');
  style.textContent = `
    body { margin:0; font:14px system-ui }
    #owner { width:600px; height:320px; overflow:auto }
    .subject { display:block; width:600px; border:0 }
    .subject .data-grid-row { border-bottom:0 }
    .subject .cell { padding-block:0; min-height:0; font:12px/1 system-ui }
    .subject .header, .subject .header-row { height:40px; min-height:40px }
    .subject button { font:12px/1 system-ui; padding:0 }
    .subject .rows-viewport { overflow:clip }
  `;
  document.head.append(style);
  const host = document.createElement('div');
  document.body.append(host);
  const owner = document.createElement('div');
  const toolbar = document.createElement('div');
  owner.id = 'owner';
  host.append(toolbar, owner);
  class UtilityPlugin extends BaseGridPlugin {
    readonly name = 'fixtureUtility';
    attaches = 0;
    detaches = 0;
    override attach(grid: Parameters<BaseGridPlugin['attach']>[0]) {
      this.attaches++;
      super.attach(grid);
    }
    override detach() {
      this.detaches++;
      super.detach();
    }
  }
  const utility = new UtilityPlugin();
  const sticky = {
    mode: 'ancestors' as const,
    isSticky: 'children',
    topOffset: 0,
    scrollContainer: external ? owner : undefined,
  };
  const features = {
    stickyRows: sticky,
    tree: { treeColumn: 'id', defaultExpanded: true, animation: false },
    selection: { mode: 'row' as const, checkbox: true },
  } satisfies NonNullable<GridConfig<Row>['features']>;
  const explicitSticky = new StickyRowsPlugin(sticky);
  const pinned = new PinnedColumnsPlugin();
  let actions = 0;
  let replaceRows: () => void = () => {
    throw new Error('React fixture has not rendered');
  };
  function UtilityActions({ row }: { row: Row }) {
    const [open, setOpen] = useState(false);
    useLayoutEffect(() => (open ? pinned.retainCellExpansion(row.id, '__actions') : undefined), [open, row.id]);
    return (
      <React.Fragment>
        <button data-action={row.id} aria-expanded={open} onClick={() => setOpen(!open)}>
          More
        </button>
        {open && (
          <div role="menu" data-menu={row.id}>
            <button role="menuitem" onClick={() => actions++}>
              Revision {row.revision ?? 0}
            </button>
          </div>
        )}
      </React.Fragment>
    );
  }
  const utilityRenderer = ({ row }: { row: Row }) => <UtilityActions row={row} />;
  const child = utilityView ? <GridColumn<Row> field="__actions">{utilityRenderer}</GridColumn> : undefined;
  const columns: GridConfig<Row>['columns'] = [
    {
      field: 'id',
      renderer: ({ row }) => (
        <button data-action={row.id} onClick={() => actions++}>
          {row.id}
        </button>
      ),
    },
  ];
  function App() {
    const [compact, setCompact] = useState(false);
    const [revision, setRevision] = useState(0);
    replaceRows = () => setRevision((value) => value + 1);
    const currentRows = useMemo<Row[]>(
      () =>
        rows.map((row) => {
          const children =
            utilityView && row.id === 'root-30'
              ? Array.from({ length: 10 }, (_, index) => ({ id: `child-30-${index}` }))
              : row.children;
          return { ...row, children: children?.map((child) => ({ ...child, revision })) };
        }),
      [revision],
    );
    const rowHeight = useCallback((row: Row) => (row.children ? (compact ? 40 : 56) : compact ? 16 : 32), [compact]);
    const config = useMemo<GridConfig<Row>>(
      () => ({
        columns: utilityView
          ? [
              { field: 'id', renderer: ({ row }) => `${row.id}:${revision}` },
              { field: '__actions', utility: true, pinned: 'right', width: 88, expandedCellWidth: 'content' },
            ]
          : columns,
        getRowId,
        rowHeight,
        plugins: [utility, ...(utilityView ? [pinned] : []), ...(surface === 'mixed' ? [explicitSticky] : [])],
        ...(surface === 'config' ? { features } : {}),
      }),
      [rowHeight, revision],
    );
    return (
      <React.Fragment>
        {createPortal(
          <button id="density" onClick={() => setCompact(!compact)}>
            {compact ? 'Comfortable' : 'Compact'}
          </button>,
          toolbar,
        )}
        <DataGrid
          rows={currentRows}
          gridConfig={config}
          className="subject"
          style={{ height: external ? 'auto' : 320, fontSize: compact ? 12 : 14 }}
          {...(surface === 'config' ? {} : { ...features, stickyRows: surface === 'mixed' ? undefined : sticky })}
        >
          {child}
        </DataGrid>
      </React.Fragment>
    );
  }
  const root = createRoot(owner);
  root.render(<App />);
  for (let attempt = 0; attempt < 120 && !owner.querySelector(DataGridElement.activeTag); attempt++) await frame();
  const grid = owner.querySelector<DataGridElement<Row>>(DataGridElement.activeTag);
  if (!grid) throw new Error('React grid did not mount');
  await grid.ready();
  const header = grid.querySelector<HTMLElement>('.header');
  const body = grid.querySelector<HTMLElement>('.rows');
  const viewport = grid.querySelector<HTMLElement>('.rows-viewport');
  if (!header || !body || !viewport) throw new Error('Missing native grid geometry');
  const footer = grid.querySelector<HTMLElement>('.tbw-footer');
  const horizontal = grid.querySelector<HTMLElement>('.tbw-scrollbar-horizontal');
  let pending = 0;
  const size = () => {
    pending = 0;
    const height =
      header.offsetHeight + body.offsetHeight + (footer?.offsetHeight ?? 0) + (horizontal?.offsetHeight ?? 0);
    if (Math.abs(grid.getBoundingClientRect().height - height) > 0.5) grid.style.height = `${height}px`;
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(size);
  };
  const resize = new ResizeObserver(schedule);
  const mutation = new MutationObserver(schedule);
  if (external) {
    resize.observe(body);
    resize.observe(header);
    mutation.observe(grid, { attributes: true, attributeFilter: ['style'] });
    await frame();
    schedule();
  }
  await frame();
  await frame();
  const initialPlugin = grid.getPluginByName('stickyRows');
  const initialSelection = grid.getPluginByName('selection');
  const initialSource = grid.sourceRows;
  const initialAttaches = utility.attaches;
  const initialDetaches = utility.detaches;
  const scroll = external ? owner : grid.querySelector<HTMLElement>('.faux-vscroll');
  if (!scroll) throw new Error('Missing native scroll owner');
  let originalControl: Element | null = null;
  let controlId = 'root-30';
  return {
    scrollTo(top: number) {
      scroll.scrollTop = top;
      scroll.dispatchEvent(new Event('scroll'));
    },
    remember(id = 'root-30') {
      controlId = id;
      originalControl = grid.querySelector(`[data-action="${id}"]`);
    },
    replaceRows() {
      replaceRows();
    },
    measure() {
      const control = grid.querySelector(`[data-action="${controlId}"]`);
      const row = control?.closest('.data-grid-row');
      const rowHeight = grid.effectiveConfig.rowHeight;
      return {
        owner: scroll.scrollTop,
        body: body.offsetHeight,
        host: grid.getBoundingClientRect().height,
        viewport: viewport.getBoundingClientRect().height,
        rootHeight: typeof rowHeight === 'function' ? rowHeight(rows[0], 0) : rowHeight,
        offset: row ? row.getBoundingClientRect().top - header.getBoundingClientRect().bottom : null,
        sameControl: control === originalControl,
        samePlugin: initialPlugin === grid.getPluginByName('stickyRows'),
        sameSelection: initialSelection === grid.getPluginByName('selection'),
        sameSource: initialSource === grid.sourceRows,
        attaches: utility.attaches - initialAttaches,
        detaches: utility.detaches - initialDetaches,
        selected: grid
          .getPluginByName('selection')
          ?.getSelectedRowIndices()
          .map((index) => grid.rows[index].id),
        actions,
        window: [grid._virtualization.start, grid._virtualization.end],
        pool: grid.querySelectorAll('.rows > .data-grid-row').length,
        retained: grid.querySelectorAll('.tbw-ancestor-retained').length,
      };
    },
    unmount() {
      resize.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(pending);
      root.unmount();
      host.remove();
      style.remove();
    },
  };
}

declare global {
  interface Window {
    ancestorReact: Awaited<ReturnType<typeof mount>>;
  }
}
