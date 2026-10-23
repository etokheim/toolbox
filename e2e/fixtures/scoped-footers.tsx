import type { DataGridElement } from '@toolbox-web/grid';
import { DataGrid, type GridConfig } from '@toolbox-web/grid-react';
import type { FooterContext, PinnedRowsConfig } from '@toolbox-web/grid-react/features/pinned-rows';
import '@toolbox-web/grid-react/features/pinned-rows';
import '@toolbox-web/grid-react/features/grouping-rows';
import '@toolbox-web/grid-react/features/tree';
import '@toolbox-web/grid-react/features/sticky-rows';
import '@toolbox-web/grid-react/features/editing';
import '@toolbox-web/grid-react/features/undo-redo';
import '@toolbox-web/grid-react/features/selection';
import '@toolbox-web/grid-react/features/clipboard';
import React, { createContext, useCallback, useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

type Row = { id: string; occurrenceId?: string; category?: string; children?: Row[]; value: number };
export type Options = {
  external: boolean;
  compact: boolean;
  canonical: boolean;
  flat?: boolean;
  empty?: boolean;
  nested?: boolean;
  repeated?: boolean;
  customEditor?: boolean;
  boundedReveal?: boolean;
  stableGrouping?: boolean;
  rowCount?: number;
  boundary?: boolean;
};
const Provider = createContext('missing');
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const getRowId = (row: Row) => row.occurrenceId ?? row.id;
const groupOn = (row: unknown, context: { parent: unknown }) =>
  context.parent && row && typeof row === 'object' && 'category' in row && typeof row.category === 'string'
    ? row.category
    : null;
const emptyGroups = ({ parent }: { parent: unknown }) => (parent ? [['A'], ['B']] : []);
const hasChildren = (row: unknown) =>
  !!row && typeof row === 'object' && 'children' in row && Array.isArray(row.children);

export async function mount(options: Options) {
  const { DataGridElement } = await import('@toolbox-web/grid');
  const style = document.createElement('style');
  style.textContent = `
    body { margin:0; font:14px system-ui }
    #owner { width:600px; height:320px; overflow:auto }
    tbw-grid { display:block; width:600px; border:0; --tbw-color-bg:white; --tbw-color-panel-bg:white }
    tbw-grid .data-grid-row { border-bottom:0 }
    tbw-grid .cell { padding-block:0; min-height:var(--tbw-row-height); font:12px/1 system-ui }
    tbw-grid .header, tbw-grid .header-row { height:40px; min-height:40px }
    tbw-grid button { font:12px/1 system-ui; padding:0 }
    tbw-grid .rows-viewport { overflow:clip }
    ${options.boundedReveal ? 'tbw-grid [data-status] { display:block; height:48px }' : ''}
  `;
  document.head.append(style);
  const owner = document.createElement('div');
  owner.id = 'owner';
  document.body.append(owner);
  const root = createRoot(owner);
  const boundaryWrapper: Row = { id: 'wrapper', value: 0, children: [] };
  const initial: Row[] = options.empty
    ? []
    : options.boundary
      ? [
          ...Array.from({ length: 3 }, (_, i) => ({
            id: `root-${i}`,
            value: i,
            children: [
              {
                id: `branch-${i}`,
                value: i,
                category: 'Contents',
                children: [
                  {
                    id: `movement-${i}`,
                    value: i,
                    children: Array.from({ length: 13 }, (_, j) => ({ id: `leaf-${i}-${j}`, value: j })),
                  },
                ],
              },
            ],
          })),
          boundaryWrapper,
        ]
      : options.flat
        ? Array.from({ length: options.boundedReveal ? 5 : (options.rowCount ?? 80) }, (_, i) => ({
            id: `item-${i}`,
            value: i,
          }))
        : Array.from({ length: 12 }, (_, i) => ({
            id: `parent-${i}`,
            value: i,
            children:
              i === 1
                ? []
                : Array.from({ length: 20 }, (_, j) => ({
                    id: `item-${i}-${j}`,
                    category: j < 10 ? 'A' : 'B',
                    value: j,
                  })),
          }));
  if (options.repeated) {
    for (const row of initial.slice(0, 2)) {
      row.occurrenceId = row.id;
      row.id = 'shared-parent';
    }
  }
  let update: (revision: number) => void = () => undefined;
  let density: () => void = () => undefined;
  let replace: (rows: Row[]) => void = () => undefined;
  let setViewport: (external: boolean, topOffset?: number) => void = () => undefined;
  let external = options.external;
  let clicks = 0;
  let mounts = 0;
  let unmounts = 0;
  function RowControl({ row }: { row: Row }) {
    const [open, setOpen] = useState(false);
    return (
      <span>
        <button data-row-control={row.id} onClick={() => setOpen(!open)}>
          {row.id}
        </button>
        {open && <input data-row-note={row.id} />}
      </span>
    );
  }
  function Footer({ context, revision }: { context: FooterContext<Row>; revision: number }) {
    const { scope, depth, collapsible } = context;
    const provider = useContext(Provider);
    const [open, setOpen] = useState(false);
    React.useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    const label =
      scope.kind === 'group'
        ? `${scope.parent ? getRowId(scope.parent) : 'root'}/${scope.path.join('/')}`
        : scope.kind === 'row'
          ? `row:${getRowId(scope.row)}`
          : scope.kind;
    return (
      <div>
        <button
          data-scope-key={String(scope.key)}
          data-footer={label}
          data-owner-depth={depth}
          data-owner-collapsible={collapsible}
          aria-expanded={open}
          onClick={() => {
            clicks++;
            setOpen(!open);
          }}
        >
          {provider}:{label}:{revision}
        </button>
        {open && (
          <div role="menu" data-menu={label}>
            <button role="menuitem">Append</button>
          </div>
        )}
        {open && <input data-footer-input={label} aria-label="Footer note" />}
      </div>
    );
  }
  const columns: GridConfig<Row>['columns'] = [
    {
      field: 'id',
      ...(options.customEditor
        ? {
            renderer: ({ row }: { row: Row }) =>
              options.rowCount || options.boundary ? (
                <RowControl row={row} />
              ) : (
                <button data-row-control={row.id}>{row.id}</button>
              ),
          }
        : {}),
    },
    {
      field: 'value',
      editable: true,
      type: 'number',
      ...(options.customEditor
        ? {
            renderer: ({ value }: { value: unknown }) => <span data-value-display>{String(value)}</span>,
            editor: (context: import('@toolbox-web/grid').ColumnEditorContext<Row>) => (
              <input
                data-custom-editor
                defaultValue={String(context.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') context.cancel();
                  if (event.key === 'Enter') context.commit(Number(event.currentTarget.value));
                }}
              />
            ),
          }
        : {}),
    },
  ];
  if (options.boundary) for (const column of columns) column.width = 400;
  if (options.rowCount) {
    columns.push(
      {
        field: 'category',
        valueAccessor: ({ row }) => row.value * 2,
        renderer: ({ value }) => <span data-derived>{String(value)}</span>,
      },
      { field: 'occurrenceId', renderer: ({ row }) => <span data-dependent>{row.value + 1}</span> },
    );
  }
  const tree = { defaultExpanded: true, animation: false as const, hasChildren };
  const grouping = {
    groupOn: (row: unknown, context: { parent: unknown }) => {
      const category = groupOn(row, context);
      return options.nested && category ? [category, 'Inner'] : category;
    },
    childGroupsCollapsible: false,
    animation: false as const,
  };
  const sticky = {
    mode: 'ancestors' as const,
    isSticky: (row: unknown) => !!row && typeof row === 'object' && ('children' in row || '__isGroupRow' in row),
    scrollContainer: options.external ? owner : undefined,
  };
  function App() {
    const [viewport, updateViewport] = useState({ external: options.external, topOffset: 0 });
    external = viewport.external;
    setViewport = (external, topOffset = 0) => flushSync(() => updateViewport({ external, topOffset }));
    const [revision, setRevision] = useState(0);
    const [compact, setCompact] = useState(options.compact);
    const [rows, setRows] = useState(initial);
    update = setRevision;
    density = () => setCompact((value) => !value);
    replace = setRows;
    const rowHeight = useCallback(
      (row: Row) =>
        '__isGroupRow' in row
          ? options.boundary && compact
            ? 24
            : 32
          : options.boundary && !row.id.startsWith('root-')
            ? compact
              ? 24
              : 40
            : row.children
              ? compact
                ? 32
                : 56
              : compact
                ? 24
                : options.boundedReveal
                  ? 48
                  : 40,
      [compact],
    );
    const scopedFooters = useCallback<NonNullable<PinnedRowsConfig<Row>['scopedFooters']>>(
      (scope) =>
        revision >= 0 &&
        (options.boundary
          ? scope.kind === 'group' || (scope.kind === 'row' && scope.row.id.startsWith('branch-'))
          : options.nested || (options.flat || options.empty ? scope.kind === 'grid' : scope.kind === 'group'))
          ? { height: compact ? 24 : 40, render: (context) => <Footer context={context} revision={revision} /> }
          : null,
      [compact, revision],
    );
    const features = {
      tree: options.flat || options.empty ? false : tree,
      groupingRows:
        options.flat || options.empty
          ? undefined
          : {
              ...grouping,
              emptyGroups: options.boundary
                ? ({ parent }) =>
                    parent && typeof parent === 'object' && 'id' in parent && String(parent.id).startsWith('root-')
                      ? [['Contents'], ['Final']]
                      : []
                : options.stableGrouping
                  ? undefined
                  : (context) => (revision === 3 ? [] : emptyGroups(context)),
            },
      stickyRows: options.boundedReveal
        ? undefined
        : { ...sticky, scrollContainer: viewport.external ? owner : undefined, topOffset: viewport.topOffset },
      pinnedRows: { slots: [{ id: 'status', render: () => <span data-status>Summary</span> }], scopedFooters },
      editing: true,
      undoRedo: true,
      selection: 'row' as const,
      clipboard: true,
    } satisfies NonNullable<GridConfig<Row>['features']>;
    const config: GridConfig<Row> = { columns, getRowId, rowHeight };
    return (
      <Provider.Provider value="provider">
        <DataGrid<Row>
          rows={rows}
          style={{ height: viewport.external ? 'auto' : options.boundedReveal ? '300px' : '320px' }}
          gridConfig={options.canonical ? { ...config, features } : config}
          {...(options.canonical ? {} : features)}
        />
      </Provider.Provider>
    );
  }
  root.render(<App />);
  for (let i = 0; i < 100 && !owner.querySelector(DataGridElement.activeTag); i++) await frame();
  const grid = owner.querySelector<DataGridElement<Row>>(DataGridElement.activeTag);
  if (!grid) throw new Error('Missing scoped-footer grid');
  await grid.ready();
  for (let i = 0; i < 5; i++) await frame();
  const scrollOwner = () => {
    const element = external ? owner : grid.querySelector<HTMLElement>('.faux-vscroll');
    if (!element) throw new Error('Missing native scroll owner');
    return element;
  };
  const pluginNames = ['pinnedRows', 'editing', 'undoRedo', 'tree', 'groupingRows', 'stickyRows'] as const;
  const plugins = pluginNames.map((name) => grid.getPluginByName(name));
  let detaches = 0;
  for (const plugin of plugins) {
    if (!plugin) continue;
    const detach = plugin.detach.bind(plugin);
    plugin.detach = () => {
      detaches++;
      detach();
    };
  }
  return {
    update,
    viewport: (external: boolean, topOffset = 0) => setViewport(external, topOffset),
    append: () => replace([...initial, ...Array.from({ length: 5 }, (_, i) => ({ id: `added-${i}`, value: i }))]),
    revealLast: () => grid.scrollToRowById('added-4', { align: 'end' }),
    addAndEdit: () => {
      const next = [...grid.sourceRows, ...Array.from({ length: 5 }, (_, i) => ({ id: `added-${i}`, value: i }))];
      requestAnimationFrame(() => {
        grid.focusCell(next.length - 1, 'value');
        requestAnimationFrame(() => grid.getPluginByName('editing')?.beginCellEdit(next.length - 1, 'value'));
      });
      flushSync(() => replace(next));
    },
    undo: () => grid.getPluginByName('undoRedo')?.undo(),
    redo: () => grid.getPluginByName('undoRedo')?.redo(),
    updateLast: () => grid.updateRow('added-4', { value: 15 }),
    shrinkAndFocus: () => {
      requestAnimationFrame(() => grid.focusCell(initial.length - 1, 'value'));
      flushSync(() => replace(initial));
    },
    density,
    wrapRoots: (wrapped: boolean) =>
      replace(wrapped ? [{ ...boundaryWrapper, children: initial.filter((row) => row !== boundaryWrapper) }] : initial),
    collapse: (key: string) => grid.getPluginByName('tree')?.collapse(key),
    expand: (key: string) => grid.getPluginByName('tree')?.expand(key),
    remove: () => replace(initial.slice(1)),
    immutable: () =>
      replace(initial.map((row) => ({ ...row, children: row.children?.map((child) => ({ ...child })) }))),
    filterA: () => {
      if (!options.stableGrouping) update(3);
      replace(initial.map((row) => ({ ...row, children: row.children?.filter((child) => child.category !== 'A') })));
    },
    reparent: () => {
      if (!options.stableGrouping) update(4);
      const current = grid.sourceRows;
      replace([{ ...current[1], children: current[0].children }, ...current.slice(2)]);
    },
    sort: () => grid.sort('id', 'desc'),
    async pasteIntoFooter() {
      grid.getPluginByName('selection')?.selectRows([0]);
      const before = grid.rows[0]?.value;
      const input = grid.querySelector<HTMLInputElement>('[data-footer-input]');
      if (!input) throw new Error('Missing footer input');
      input.focus();
      const data = new DataTransfer();
      data.setData('text/plain', '999');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      await frame();
      return { prevented: event.defaultPrevented, unchanged: grid.rows[0]?.value === before };
    },
    owners: () => ({ mounts, unmounts, clicks }),
    scroll: (top: number) => {
      scrollOwner().scrollTop = top;
    },
    reveal: (index: number) => grid.scrollToRow(index),
    focusLast: () => grid.focusCell(grid._rows.length - 1, 'value'),
    resize: async (height: number) => {
      owner.style.height = `${height}px`;
      if (!external) grid.style.height = `${height}px`;
      await grid.forceLayout();
    },
    measure() {
      const viewportElement = grid.querySelector('.rows-viewport');
      if (!viewportElement) throw new Error('Missing rows viewport');
      const viewport = viewportElement.getBoundingClientRect();
      const focused = grid.querySelector('.cell[tabindex="0"]');
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height };
      };
      return {
        footer: Array.from(grid.querySelectorAll('.tbw-scoped-footer')).map((element) => ({
          ...rect(element),
          text: element.textContent,
          stuck: (element as HTMLElement).dataset.stuck,
        })),
        viewport: { top: viewport.top, bottom: viewport.bottom },
        owner: {
          ...rect(scrollOwner()),
          scrollTop: scrollOwner().scrollTop,
          max: scrollOwner().scrollHeight - scrollOwner().clientHeight,
        },
        rows: grid.rows.length,
        pool: grid._rowPool.length,
        window: [grid._virtualization.start, grid._virtualization.end],
        total: grid._virtualization.scrollMapping.rawContentHeight,
        bottomOcclusion: grid.getPluginByName('pinnedRows')?.getVerticalScrollOffsets()?.bottom ?? 0,
        ancestors: grid.querySelectorAll('.tbw-ancestor-live').length,
        focused: focused ? rect(focused) : null,
        flowErrors: grid._rowPool.flatMap((row, i) => {
          if (row.classList.contains('tbw-ancestor-retained')) return [];
          const index = Number(row.querySelector('.cell[data-row]')?.getAttribute('data-row') ?? -1);
          const cache = grid._virtualization.positionCache;
          if (index < 0 || !cache?.[index]) return [];
          const shift = Number.parseFloat(row.style.getPropertyValue('--tbw-ancestor-shift')) || 0;
          const expected =
            grid._bodyEl.getBoundingClientRect().top +
            cache[index].offset -
            (cache[grid._virtualization.start]?.offset ?? 0);
          const difference = row.getBoundingClientRect().top - shift - expected;
          return Math.abs(difference) > 1 ? [{ index, difference, slot: i }] : [];
        }),
        clicks,
        mounts,
        unmounts,
        detaches,
        samePlugins: plugins.every((plugin, i) => plugin === grid.getPluginByName(pluginNames[i])),
      };
    },
    async dispose() {
      root.unmount();
      await frame();
      owner.remove();
      style.remove();
    },
  };
}

declare global {
  interface Window {
    scopedFixture: Awaited<ReturnType<typeof mount>>;
  }
}
