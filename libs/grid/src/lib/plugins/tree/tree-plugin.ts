/**
 * Tree Data Plugin
 *
 * Enables hierarchical tree data with expand/collapse, sorting, and auto-detection.
 */

import { GridClasses } from '../../core/constants';
import {
  markDisclosureBoundary,
  registerControlCleanup,
  releaseCell,
  unregisterControlCleanup,
} from '../../core/internal/control-lifecycle';
import { getRowIndexFromCell } from '../../core/internal/utils';
import { createDefaultSpinner } from '../../core/internal/loading';
import { setSanitizedHTML } from '../../core/internal/sanitize';
import type { GridElement } from '../../core/plugin/base-plugin';
import { ControlSlot } from '../../core/plugin/control-view';
import { RowMetadata } from '../../core/plugin/row-metadata';
import {
  BaseGridPlugin,
  CellClickEvent,
  HeaderClickEvent,
  type AfterCellRenderContext,
  type PluginManifest,
  type PluginQuery,
} from '../../core/plugin/base-plugin';
import type {
  CellRenderContext,
  ColumnConfig,
  ColumnViewRenderer,
  PublicGrid,
  RowElementInternal,
} from '../../core/types';
import type { HierarchyContributor, HierarchyNode, HierarchyRowMeta, HierarchySiblingContext } from '../hierarchy';
import { buildHierarchy, HierarchyPlugin } from '../hierarchy';
import { FLAT_HIERARCHY, hasDefaultHierarchyHooks, type HierarchyModel } from '../hierarchy/hierarchy';
import { TreeProjection } from './tree-projection';
import type { SortModel } from '../multi-sort/types';
import type {
  DataSourceChildrenDetail,
  DataSourceDataDetail,
  DataSourceErrorDetail,
  FetchChildrenQuery,
  Subscribable,
  ViewportMappingQuery,
} from '../server-side/datasource-types';
import { collapseAll, expandAll, expandToKey, toggleExpand } from './tree-data';
import { isFormFieldKeyTarget } from '../shared/form-field-target';
import { mapViewportToRoots } from './tree-datasource';
import { detectTreeStructure, inferChildrenField } from './tree-detect';
import styles from './tree.css?inline';
import { RevealAnimation } from '../hierarchy/reveal-animation';
import type {
  ExpandCollapseAnimation,
  FlattenedTreeRow,
  TreeConfig,
  TreeDisclosureContext,
  TreeExpandDetail,
  TreeLoadEndDetail,
  TreeLoadErrorDetail,
  TreeLoadStartDetail,
  TreeRow,
} from './types';

/** Narrow a `loadChildren` result to the Subscribable branch. */
function isSubscribable<T>(value: Promise<T> | Subscribable<T>): value is Subscribable<T> {
  return typeof (value as Subscribable<T>).subscribe === 'function';
}

/**
 * Tree Data Plugin for tbw-grid
 *
 * Transforms your flat grid into a hierarchical tree view with expandable parent-child
 * relationships. Ideal for file explorers, organizational charts, nested categories,
 * or any data with a natural hierarchy.
 *
 * ## Installation
 *
 * ```ts
 * import { TreePlugin } from '@toolbox-web/grid/plugins/tree';
 * ```
 *
 * ## CSS Custom Properties
 *
 * | Property | Default | Description |
 * |----------|---------|-------------|
 * | `--tbw-tree-toggle-size` | `1.25em` | Toggle icon width |
 * | `--tbw-tree-indent-width` | `var(--tbw-tree-toggle-size)` | Indentation per level |
 * | `--tbw-tree-accent` | `var(--tbw-color-accent)` | Toggle icon hover color |
 * | `--tbw-animation-duration` | `200ms` | Expand/collapse animation duration |
 * | `--tbw-animation-easing` | `ease-out` | Animation curve |
 *
 * @example Basic Tree with Nested Children
 * ```ts
 * import { queryGrid } from '@toolbox-web/grid';
 * import { TreePlugin } from '@toolbox-web/grid/plugins/tree';
 *
 * const grid = queryGrid('tbw-grid');
 * grid.gridConfig = {
 *   columns: [
 *     { field: 'name', header: 'Name' },
 *     { field: 'type', header: 'Type' },
 *     { field: 'size', header: 'Size' },
 *   ],
 *   plugins: [new TreePlugin({ childrenField: 'children', indentWidth: 24 })],
 * };
 * grid.rows = [
 *   {
 *     id: 1,
 *     name: 'Documents',
 *     type: 'folder',
 *     children: [
 *       { id: 2, name: 'Report.docx', type: 'file', size: '24 KB' },
 *     ],
 *   },
 * ];
 * ```
 *
 * @example Expanded by Default with Custom Animation
 * ```ts
 * new TreePlugin({
 *   defaultExpanded: true,
 *   animation: 'fade', // 'slide' | 'fade' | false
 *   indentWidth: 32,
 * })
 * ```
 *
 * @see {@link TreeConfig} for all configuration options
 * @see {@link FlattenedTreeRow} for the flattened row structure
 *
 * @internal Extends BaseGridPlugin
 * @since 0.1.1
 */
export class TreePlugin<TRow = unknown> extends BaseGridPlugin<TreeConfig<TRow>> implements HierarchyContributor {
  static override readonly manifest: PluginManifest = {
    modifiesRowStructure: true,
    hookPriority: {
      processRows: 10, // Run after ServerSide (-10) so we receive managedNodes[]
      // Claim toggle clicks before Editing/Selection, whatever the registration order (#565)
      onCellClick: -10,
    },
    incompatibleWith: [
      {
        name: 'pivot',
        reason:
          'PivotPlugin replaces the entire row and column structure with aggregated pivot data. ' +
          'Tree hierarchy cannot coexist with pivot aggregation.',
      },
    ],
    events: [
      {
        type: 'tree-expand',
        description:
          'Emitted when tree expansion state changes (toggle, expand all, collapse all). Broadcast to both DOM consumers and plugin bus.',
      },
      {
        type: 'tree-load-start',
        description: 'Emitted when lazy child loading starts for a node whose children are not yet loaded.',
      },
      {
        type: 'tree-load-end',
        description: 'Emitted when lazy child loading completes and children have been merged into the parent row.',
      },
      {
        type: 'tree-load-error',
        description: 'Emitted when lazy child loading fails. The node leaves its loading state and can be retried.',
      },
    ],
    queries: [
      {
        type: 'canMoveRow',
        description: 'Returns false for rows with children (parent nodes cannot be reordered)',
      },
      {
        type: 'datasource:viewport-mapping',
        description: 'Translates flat viewport row indices to top-level node indices for ServerSide pagination.',
      },
    ],
  };

  /**
   * Optional dependency on MultiSort for coordinated sorting.
   * When MultiSort is loaded, Tree defers header click sorting to it and queries the
   * sort model in processRows. When MultiSort is absent, Tree uses its own sort state.
   */
  static override readonly dependencies = [
    {
      name: 'hierarchy',
      required: true,
      reason: 'Builds the hierarchical row model',
      provide: () => new HierarchyPlugin(),
    },
    { name: 'multiSort', required: false, reason: 'Queries sort model for coordinated tree sorting' },
    { name: 'serverSide', required: false, reason: 'Consumes datasource events for lazy-loaded tree data' },
  ];

  /** @internal */
  readonly name = 'tree';
  /** @internal */
  readonly hierarchyStage = 'structure';
  /** @internal */
  override readonly styles = styles;

  /** @internal */
  protected override get defaultConfig(): Partial<TreeConfig<TRow>> {
    return {
      childrenField: 'children',
      autoDetect: true,
      defaultExpanded: false,
      indentWidth: 20,
      showExpandIcons: true,
      animation: 'slide',
    };
  }

  // #region State

  private expandedKeys = new Set<string>();
  private initialExpansionDone = false;
  private flattenedRows: Array<FlattenedTreeRow & HierarchyRowMeta> = [];
  private rowKeyMap = new Map<string, FlattenedTreeRow>();
  private previousVisibleKeys = new Set<string>();
  private keysToAnimate = new Set<string>();
  #reveal = new RevealAnimation();
  /** Root-node ordinal per row of the FINAL row list — group rows interleave with tree rows when composed. */
  #rootOwners: number[] = [];
  #rootCount = 0;
  private sortState: { field: string; direction: 1 | -1 } | null = null;
  /** Sort applied to every sibling list during the current rebuild. */
  #levelSort: { field: string; direction: 1 | -1 } | null = null;
  #multiSort: SortModel[] | undefined;
  #priorRowMeta?: WeakMap<object, FlattenedTreeRow>;
  #rootRows: readonly TreeRow[] | undefined;
  #resolveKey = (row: TreeRow, index: number, parent: string | null) => this.#projection.keyFor(row, index, parent);
  /**
   * In-flight lazy child loads, keyed by node key. `row` is the row OBJECT the
   * request is for — a ServerSide refetch can hand a new object for the same key
   * while the old request is still pending (#527). Both routes carry a
   * `controller`: local `loadChildren` gets its `signal`, ServerSide receives it
   * as `FetchChildrenQuery.signal` and links it to `getChildRows({ signal })`.
   */
  #loads = new Map<string, { row: TreeRow; depth: number; controller: AbortController }>();
  /**
   * Row objects whose children have already been fetched. Prevents a re-fetch on
   * collapse → re-expand, and prevents an infinite retry loop when a node
   * legitimately resolves to zero children but a custom `hasChildren`
   * predicate keeps reporting `true`.
   *
   * Keyed by row IDENTITY, not by node key: a ServerSide refetch (server
   * sort/filter change, `refresh()`) or a `grid.rows` reassignment delivers a
   * NEW object for the same key whose children are lazy again (#527).
   */
  #loadedRows = new WeakSet<object>();
  /**
   * Row objects with a child fetch that was started and NOT cancelled (in
   * flight, loaded, or failed). Limits the automatic re-request of
   * still-expanded lazy nodes (see {@link endHierarchy}) to one attempt per row
   * object, so a failing fetch can't retry on every render.
   */
  #requestedRows = new WeakSet<object>();
  /**
   * Row objects whose load was cancelled because a same-key row superseded it.
   * Kept apart from {@link #requestedRows} so a restored row (A → B → A) loads
   * again automatically, while a late response for the cancelled request is
   * still dropped.
   */
  #cancelledRows = new WeakSet<object>();
  /** Rendered nodes queued for load reconciliation (cancel / auto-request), flushed in one microtask. */
  #pendingReconcile: Array<{ meta: FlattenedTreeRow; flat: boolean }> = [];

  /**
   * Stable key cache keyed by row identity.
   * Persists across sort operations (object identity is preserved by sort);
   * replaces the previous `__stableKey` field-mutation approach so that
   * `_rows[i]` remains the user's original row reference and `updateRow(s)`
   * mutations survive the next `processRows` rebuild.
   *
   * INVARIANT: never mutate row objects to attach tree metadata — keep all
   * tree-specific state in this map and `#rowMeta` (see plugin-author rule
   * in `.github/knowledge/grid-plugins.md`).
   */
  #rowKeys = new WeakMap<object, string>();

  /**
   * Per-row tree metadata (depth, hasChildren, isExpanded, key) keyed by
   * row identity. Looked up by the column renderer via {@link getRowMeta}.
   * Reassigned to a fresh `WeakMap` at the start of each `processRows` call so
   * collapsed/hidden rows don't return stale metadata from a prior pass.
   */
  #rowMeta = new WeakMap<object, FlattenedTreeRow & HierarchyRowMeta>();
  #retirePositions?: () => void;
  #generation = 0;

  /** Cached original (unwrapped) renderer to prevent re-wrapping on repeated processColumns calls. */
  private originalTreeColumnRenderer: ColumnViewRenderer | undefined;
  #originalRendererAlias: ColumnViewRenderer | undefined;
  #installedTreeRenderer: ColumnViewRenderer | undefined;
  /** Field name of the column currently wrapped with tree decorations. */
  private wrappedTreeColumnField: string | undefined;
  /** True while `processColumns` has the tree renderer installed on the tree column. */
  #treeColumnWrapped = false;
  /** Guards `#syncTreeColumn` against queueing more than one microtask. */
  #treeColumnSyncScheduled = false;
  #rowMetadata = new RowMetadata();
  #cells = new Map<
    HTMLElement,
    {
      row: object;
      key: string | undefined;
      wrapper: HTMLElement;
      content: HTMLElement;
      slot?: ControlSlot<TreeDisclosureContext<TRow>>;
    }
  >();

  /** @internal */
  override detach(): void {
    this.#generation++;
    this.#retirePositions?.();
    this.#retirePositions = undefined;
    for (const cell of this.#cells.keys()) this.#releaseTreeCell(cell);
    this.#retireRowMetadata();
    this.expandedKeys.clear();
    this.initialExpansionDone = false;
    this.flattenedRows = [];
    this.#rootOwners = [];
    this.#rootCount = 0;
    this.rowKeyMap.clear();
    this.previousVisibleKeys.clear();
    this.keysToAnimate.clear();
    this.#reveal.clear();
    this.sortState = null;
    this.#levelSort = null;
    this.#multiSort = undefined;
    this.#rootRows = undefined;
    this.#priorRowMeta = undefined;
    this.#loadedRows = new WeakSet();
    this.#requestedRows = new WeakSet();
    this.#cancelledRows = new WeakSet();
    this.#pendingReconcile = [];
    // Silent on teardown — no `tree-load-end` for loads the detach aborts.
    for (const load of this.#loads.values()) load.controller.abort();
    this.#loads.clear();
    this.originalTreeColumnRenderer = undefined;
    this.#originalRendererAlias = undefined;
    this.#installedTreeRenderer = undefined;
    this.wrappedTreeColumnField = undefined;
    this.#treeColumnWrapped = false;
    // WeakMaps GC themselves once row references are dropped — nothing to clear.
  }

  /**
   * Handle plugin queries.
   * @internal
   */
  override handleQuery(query: PluginQuery): unknown {
    if (query.type === 'canMoveRow') {
      // Tree rows with children cannot be reordered
      const row = query.context as { [key: string]: unknown } | null | undefined;
      const childrenField = this.config.childrenField ?? 'children';
      const children = row?.[childrenField];
      if (Array.isArray(children) && children.length > 0) {
        return false;
      }
    }

    if (query.type === 'datasource:viewport-mapping') {
      // Translate visible flat row indices → top-level node indices for ServerSide pagination
      const { viewportStart, viewportEnd } = query.context as ViewportMappingQuery;
      if (this.flattenedRows.length === 0) return undefined;
      return mapViewportToRoots(this.#rootOwners, this.#rootCount, viewportStart, viewportEnd);
    }

    return undefined;
  }

  // #endregion

  // #region Lifecycle

  /** @internal */
  override attach(grid: GridElement): void {
    super.attach(grid);

    // Listen for datasource:data from ServerSidePlugin — claim data for tree processing
    this.on('datasource:data', (detail: unknown) => {
      const d = detail as DataSourceDataDetail;
      if (!d.claimed) {
        d.claimed = true;
      }
      // Data flows through processRows pipeline — Tree receives it via the rows parameter
      // since ServerSide's processRows (hookPriority -10) runs first and returns managedNodes[]
    });

    // Listen for datasource:children — consume child rows from ServerSide
    this.on('datasource:children', (detail: unknown) => {
      const d = detail as DataSourceChildrenDetail;
      if (d.context?.source !== 'tree') return;
      d.claimed = true;

      // Merge children into the parent node
      const parentRow = d.context.parentNode as TreeRow | undefined;
      if (parentRow) {
        const key = this.#projection.keyOf(parentRow);
        const load = this.#takeLoad(key, parentRow);
        // Requested by Tree but no longer active: superseded and already reported
        // as cancelled — never merge stale children into the replaced row.
        if (!load && (this.#requestedRows.has(parentRow as object) || this.#cancelledRows.has(parentRow as object))) {
          return;
        }
        this.#mergeChildren(parentRow, (d.rows ?? []) as TreeRow[]);
        this.broadcast<TreeLoadEndDetail>('tree-load-end', {
          key,
          row: parentRow,
          depth: load?.depth ?? this.rowKeyMap.get(key)?.depth ?? 0,
          childCount: d.rows?.length ?? 0,
        });
        this.requestRender();
      }
    });

    // Listen for datasource:error — release the node's loading state so the
    // user can retry by collapsing and re-expanding. Without this the load
    // stays in `#loads` forever and `requestLazyChildren` short-circuits.
    this.on('datasource:error', (detail: unknown) => {
      const d = detail as DataSourceErrorDetail;
      if (d.context?.source !== 'tree') return;
      const parentRow = d.context.parentNode as TreeRow | undefined;
      if (!parentRow) return;
      const key = this.#projection.keyOf(parentRow);
      const load = this.#takeLoad(key, parentRow);
      if (!load) return;
      this.broadcast<TreeLoadErrorDetail>('tree-load-error', {
        key,
        row: parentRow,
        depth: load.depth,
        error: d.error,
      });
      this.requestRender();
    });
  }

  // #endregion

  // #region Animation

  /**
   * Get expand/collapse animation style from plugin config.
   * Uses base class isAnimationEnabled to respect grid-level settings.
   */
  private get animationStyle(): ExpandCollapseAnimation {
    if (!this.isAnimationEnabled) return false;
    return this.config.animation ?? 'slide';
  }

  // #endregion

  // #region Auto-Detection

  detect(rows: readonly unknown[]): boolean {
    if (!this.config.autoDetect) return false;
    const treeRows = rows as readonly TreeRow[];
    const field = this.config.childrenField ?? inferChildrenField(treeRows) ?? 'children';
    return detectTreeStructure(treeRows, field);
  }

  // #endregion

  // #region Data Processing

  /** @internal */
  override processRows(rows: readonly unknown[]): TreeRow[] {
    const hierarchy = this.grid?.getPluginByName?.('hierarchy');
    return (hierarchy ? hierarchy.process(rows, this) : buildHierarchy(rows, [this])) as TreeRow[];
  }

  /** @internal Hierarchy contributor hook */
  beginHierarchy(rows: readonly unknown[]): boolean {
    this.#generation++;
    this.#retirePositions?.();
    this.#retirePositions = undefined;
    this.#processedRowCount = 0;
    this.#getRowId = this.grid?.effectiveConfig?.getRowId;
    this.#priorRowMeta = this.#rowMeta;
    this.#rowMeta = new WeakMap();
    const treeRows = rows as readonly TreeRow[];
    this.#rootRows = treeRows;
    if (
      treeRows.length === 0 ||
      !detectTreeStructure(treeRows, this.config.childrenField ?? 'children', this.config.hasChildren)
    ) {
      this.#priorRowMeta = undefined;
      this.flattenedRows = [];
      this.#rootOwners = [];
      this.#rootCount = 0;
      this.rowKeyMap.clear();
      this.previousVisibleKeys.clear();
      this.#reconcileFlatRows(treeRows);
      this.#syncTreeColumn();
      return false;
    }

    // A ServerSide data source in `sortMode: 'server'` already ordered the roots
    // (`getRows({ sortModel })`) and lazy children (`getChildRows({ sortModel })`)
    // — keep its order (#524). Otherwise prefer MultiSort's model over local sort
    // state so Tree and MultiSort don't fight over sort ownership.
    const serverSorts = this.grid?.query?.<'server' | 'local'>('datasource:sort-mode', null)?.[0] === 'server';
    this.#multiSort = undefined;
    this.#levelSort = serverSorts ? null : this.resolveEffectiveSortState();

    if (this.config.defaultExpanded && !this.initialExpansionDone) {
      this.expandedKeys = expandAll(treeRows, this.config, null, 0, this.#resolveKey);
      this.initialExpansionDone = true;
    }
    return true;
  }

  /**
   * Sort one sibling list and attach each expanded node's children, never
   * cloning row objects — `data` on each FlattenedTreeRow stays `===` the
   * user's source row.
   * @internal Hierarchy contributor hook
   */
  processSiblings(nodes: HierarchyNode[], context: HierarchySiblingContext): HierarchyNode[] {
    this.#processedRowCount += nodes.length;
    const { parentKey, depth } = context;
    const childrenField = this.config.childrenField ?? 'children';
    // Assign stable keys using the ORIGINAL (unsorted) index so that
    // path-based keys match those produced by `expandAll` (which walks the
    // tree in source order). `#keyFor` caches by row identity, so the
    // subsequent lookup in the post-sort loop returns the same key.
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].key = this.#projection.keyFor(nodes[i].row as TreeRow, i, parentKey);
    }
    const sort = this.#levelSort;
    const ordered = sort || this.#multiSort?.length ? this.#projection.sortNodes(nodes, parentKey) : nodes;

    for (let i = 0; i < ordered.length; i++) {
      const node = ordered[i];
      const row = node.row as TreeRow;
      const key = node.key ?? this.#projection.keyFor(row, i, parentKey);
      const meta = this.#describeRow(row, key, depth, parentKey, i, ordered.length);
      const children = row[childrenField];
      node.key = key;
      if (Array.isArray(children) && meta.hasChildren && meta.isExpanded) {
        node.expanded = true;
        node.children = (children as TreeRow[]).map((child) => ({ row: child }));
      }
    }
    return ordered;
  }

  /** @internal Single-contributor projection with generation-scoped positional ownership. */
  [FLAT_HIERARCHY](
    rows: readonly unknown[],
    positions?: WeakMap<object, HierarchyRowMeta>,
  ): HierarchyModel | undefined {
    if (!hasDefaultHierarchyHooks(this, TreePlugin.prototype)) return undefined;
    const generation = this.#generation;
    const out: TreeRow[] = [];
    const childrenField = this.config.childrenField ?? 'children';
    const visit = (siblings: readonly TreeRow[], parentKey: string | null, depth: number): void => {
      let ordered = siblings;
      if (this.#levelSort || this.#multiSort?.length) {
        for (let i = 0; i < siblings.length; i++) this.#projection.keyFor(siblings[i], i, parentKey);
        ordered = this.#projection.sortRows([...siblings], parentKey);
      }
      for (let i = 0; i < ordered.length; i++) {
        const row = ordered[i];
        const key = this.#projection.keyFor(row, i, parentKey);
        const meta = this.#describeRow(row, key, depth, parentKey, i, ordered.length);
        out.push(row);
        positions?.set(row, meta);
        const children = row[childrenField];
        if (meta.isExpanded && Array.isArray(children) && children.length > 0) {
          visit(children, key, depth + 1);
        }
      }
    };
    visit(rows as readonly TreeRow[], null, 0);
    this.#processedRowCount = out.length;
    this.endHierarchy(out, () => undefined);
    if (generation !== this.#generation) throw new Error('Tree generation changed during row processing');
    if (positions) return { rows: out, positions };
    let snapshot: WeakMap<object, FlattenedTreeRow & HierarchyRowMeta> | undefined = this.#rowMeta;
    this.#retirePositions = () => {
      snapshot = undefined;
    };
    return { rows: out, positions: { get: (row) => snapshot?.get(row) } };
  }

  #describeRow(
    row: TreeRow,
    key: string,
    depth: number,
    parentKey: string | null,
    index: number,
    setSize: number,
  ): FlattenedTreeRow & HierarchyRowMeta {
    const children = row[this.config.childrenField ?? 'children'];
    const embeddedChildren = Array.isArray(children) && children.length > 0;
    const meta = {
      key,
      data: row,
      depth,
      level: depth + 1,
      hasChildren:
        embeddedChildren ||
        (row.__loading !== true &&
          (this.config.hasChildren
            ? this.config.hasChildren(row)
            : children != null && !Array.isArray(children) && !!children)),
      isExpanded: this.expandedKeys.has(key),
      parentKey,
      posInSet: index + 1,
      setSize,
    };
    this.#rowMeta.set(row, meta);
    return meta;
  }

  /** @internal Hierarchy contributor hook */
  endHierarchy(rows: readonly unknown[], positionOf: (row: unknown) => HierarchyRowMeta | undefined): boolean {
    // Keep metadata for rendered rows only, so rows hidden by a collapsed
    // ancestor don't return stale entries via getRowMeta().
    const processed = this.#rowMeta;
    this.flattenedRows = [];
    this.rowKeyMap.clear();
    this.keysToAnimate.clear();
    const currentKeys = new Set<string>();
    const rootOwners = new Array<number>(rows.length);
    let rootOrdinal = -1;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const meta = processed.get(row as object);
      if (meta?.parentKey === null) rootOrdinal++;
      rootOwners[i] = rootOrdinal;
      if (!meta) continue;
      // Indent below any levels another contributor (e.g. grouping) inserted above this row.
      const level = positionOf(row)?.level;
      if (level !== undefined) meta.depth = level - 1;
      this.flattenedRows.push(meta);
      this.rowKeyMap.set(meta.key, meta);
      currentKeys.add(meta.key);
      if (!this.previousVisibleKeys.has(meta.key) && meta.depth > 0) {
        this.keysToAnimate.add(meta.key);
      }
      if (this.#needsReconcile(meta)) {
        this.#queueReconcile(meta);
      }
    }
    this.previousVisibleKeys = currentKeys;
    if (this.flattenedRows.length !== this.#processedRowCount) {
      this.#rowMeta = new WeakMap();
      for (const meta of this.flattenedRows) this.#rowMeta.set(meta.data, meta);
    }
    this.#rootOwners = rootOwners;
    this.#rootCount = rootOrdinal + 1;
    this.#priorRowMeta = undefined;

    this.#syncTreeColumn();
    return true;
  }

  #processedRowCount = 0;
  #getRowId?: (row: TreeRow) => string;

  /**
   * Keep the tree column decoration in sync with whether the current data is a
   * tree.
   *
   * `processColumns` bails out while `flattenedRows` is empty, and a ROWS-only
   * render (async `grid.rows` assignment, a ServerSide block landing) never
   * re-runs the COLUMNS phase — so without this the toggle/indent renderer is
   * never installed for data that arrives after the first render.
   *
   * The comparison is deferred to a microtask so that a COLUMNS-phase render —
   * whose `processColumns` runs later in the same synchronous scheduler flush —
   * settles the flag first and costs no extra frame.
   */
  #syncTreeColumn(): void {
    if (this.#treeColumnSyncScheduled) return;
    this.#treeColumnSyncScheduled = true;
    queueMicrotask(() => {
      this.#treeColumnSyncScheduled = false;
      if (!this.grid) return;
      if (this.#treeColumnWrapped !== this.flattenedRows.length > 0) {
        this.requestColumnsRender();
      }
    });
  }

  /**
   * Resolve the stable key for a row, caching by identity in {@link #rowKeys}.
   * Prefers configured occurrence IDs, then `row.id`, then any previously cached
   * key for this row reference, then falls back to a path-based key.
   */
  #projection = new TreeProjection({
    grid: () => this.grid,
    columns: () => this.columns,
    getRowId: () => this.#getRowId,
    rowKeys: this.#rowKeys,
    priorRowMeta: () => this.#priorRowMeta,
    multiSort: () => this.#multiSort,
    sort: () => this.#levelSort,
  });

  /** Write fetched children onto the parent row and mark the node as loaded. */
  #mergeChildren(row: TreeRow, children: TreeRow[]): void {
    (row as Record<string, unknown>)[this.config.childrenField ?? 'children'] = children;
    this.#loadedRows.add(row as object);
  }

  /**
   * Whether a node's children still need to be fetched — it reports having
   * children (via the lazy indicator or a custom `hasChildren` predicate) but
   * none are embedded yet, and no previous fetch for this row object has resolved.
   */
  #needsChildFetch(row: TreeRow): boolean {
    if (this.#loadedRows.has(row as object)) return false;
    const children = row[this.config.childrenField ?? 'children'];
    if (Array.isArray(children) && children.length > 0) return false;
    const custom = this.config.hasChildren;
    return custom ? custom(row) : children != null && !Array.isArray(children) && !!children;
  }

  /**
   * Whether a rendered node needs reconciling with `#loads`:
   * - a pending load belongs to a DIFFERENT row object under this key — the row
   *   was replaced, so that load is obsolete whether or not the replacement needs
   *   a fetch (it may embed its children, or the node may be collapsed);
   * - or the node is expanded with lazy children its row object never requested
   *   — e.g. a root replaced by a ServerSide refetch (#527), or a node passed to
   *   {@link expand} before its row existed.
   *
   * ServerSide placeholders never supersede a load: their path key can collide
   * with a real row's id.
   */
  #needsReconcile(meta: FlattenedTreeRow): boolean {
    if (meta.data.__loading === true) return false;
    const load = this.#loads.get(meta.key);
    if (load) return load.row !== meta.data;
    return (
      meta.isExpanded &&
      meta.hasChildren &&
      !this.#requestedRows.has(meta.data as object) &&
      this.#needsChildFetch(meta.data)
    );
  }

  /**
   * Cancel pending loads whose key now belongs to a different row object in data
   * that is no longer a tree (e.g. the only lazy root replaced by a same-key row
   * with `children: []`). `endHierarchy` never runs for flat data, so the
   * {@link #needsReconcile} pass doesn't see these replacements. Cancel-only:
   * flat data never requests children. Placeholders are skipped as in
   * `#needsReconcile`; on duplicate keys the last row owns the key, as in `rowKeyMap`.
   */
  #reconcileFlatRows(rows: readonly TreeRow[]): void {
    if (this.#loads.size === 0) return;
    const owners = new Map<string, TreeRow>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.__loading === true) continue;
      // Read-only key lookup — matches `#keyFor` without caching keys for flat rows.
      const key = row.id !== undefined ? String(row.id) : (this.#rowKeys.get(row as object) ?? String(i));
      if (this.#loads.has(key)) owners.set(key, row);
    }
    for (const [key, row] of owners) {
      if (this.#loads.get(key)?.row === row) continue;
      this.#queueReconcile(
        { key, data: row, depth: 0, hasChildren: false, isExpanded: false, parentKey: null, posInSet: 0, setSize: 0 },
        true,
      );
    }
  }

  /**
   * Queue a node for {@link #needsReconcile} handling. Deferred to ONE microtask:
   * `endHierarchy` runs inside the render pipeline, and cancelling / requesting
   * broadcasts `tree-load-end` / `tree-load-start` and queries ServerSide
   * synchronously. Loads of nodes that are not rendered (hidden under a
   * collapsed ancestor, or gone from the data) are left to settle.
   *
   * @param flat - Entry from {@link #reconcileFlatRows}: cancel only. `rowKeyMap`
   *   is empty for flat data, so the owner check was already applied by the caller.
   */
  #queueReconcile(meta: FlattenedTreeRow, flat = false): void {
    if (this.#pendingReconcile.push({ meta, flat }) > 1) return;
    queueMicrotask(() => {
      const pending = this.#pendingReconcile;
      this.#pendingReconcile = [];
      if (!this.grid) return;
      let started = false;
      for (const { meta: node, flat: cancelOnly } of pending) {
        // Only the key's current owner acts — skips rows replaced again by a later
        // rebuild, and keeps duplicate keys from cancelling each other in a loop.
        if (!cancelOnly && this.rowKeyMap.get(node.key)?.data !== node.data) continue;
        const load = this.#loads.get(node.key);
        if (load && load.row !== node.data) this.#cancelLoad(node.key);
        if (cancelOnly || !this.expandedKeys.has(node.key) || this.#requestedRows.has(node.data as object)) continue;
        // One automatic attempt per row object, even when no loader is configured.
        this.#requestedRows.add(node.data as object);
        started = this.requestLazyChildren(node) || started;
      }
      if (started) this.requestRender();
    });
  }

  /**
   * Request lazy children for a node that is being expanded.
   *
   * Two routes, in precedence order:
   * 1. **ServerSide** — when `ServerSidePlugin` is active, dispatch the
   *    `datasource:fetch-children` query; the result arrives asynchronously as
   *    a `datasource:children` (or `datasource:error`) broadcast.
   * 2. **Local `loadChildren`** — invoke the config callback directly. Works
   *    without `ServerSidePlugin` for grids that only need lazy tree children
   *    and not server-side root pagination/sorting/filtering.
   *
   * No-op when neither route is configured, this row is already loading, or
   * its children are already embedded. A pending load for a DIFFERENT row
   * object under the same key (replaced by a refetch) is cancelled first.
   *
   * @returns `true` when a fetch was started.
   */
  private requestLazyChildren(flatRow: FlattenedTreeRow): boolean {
    const { key, depth, data: row } = flatRow;
    const active = this.#loads.get(key);
    if (active?.row === row) return false;
    if (!this.#needsChildFetch(row)) return false;

    const isServerSideActive = this.queryBoolean('datasource:is-active');
    const { loadChildren } = this.config;
    if (!isServerSideActive && !loadChildren) return false;

    if (active) this.#cancelLoad(key);
    const controller = new AbortController();
    this.#loads.set(key, { row, depth, controller });
    this.#requestedRows.add(row as object);
    this.#cancelledRows.delete(row as object);
    this.broadcast<TreeLoadStartDetail>('tree-load-start', { key, row, depth });

    if (isServerSideActive) {
      this.grid.query('datasource:fetch-children', {
        context: { source: 'tree', parentNode: row, nodePath: [key] },
        signal: controller.signal,
      } satisfies FetchChildrenQuery);
      return true;
    }

    this.#loadChildrenLocally(key, row, depth, controller);
    return true;
  }

  /** Whether `meta`'s row object (not just its key) has a child load in flight. */
  #isLoading(meta: FlattenedTreeRow): boolean {
    return this.#loads.get(meta.key)?.row === meta.data;
  }

  /** Remove and return the in-flight load for `key` when it belongs to `row`. */
  #takeLoad(key: string, row: TreeRow): { row: TreeRow; depth: number; controller: AbortController } | undefined {
    const load = this.#loads.get(key);
    if (load?.row !== row) return undefined;
    this.#loads.delete(key);
    return load;
  }

  /**
   * Abort a superseded load and close its event pair with a cancelled
   * `tree-load-end`, so every `tree-load-start` gets exactly one end or error.
   */
  #cancelLoad(key: string): void {
    const load = this.#loads.get(key);
    if (!load) return;
    this.#loads.delete(key);
    // Not a settled attempt: a restored row must be able to load again automatically.
    this.#requestedRows.delete(load.row as object);
    this.#cancelledRows.add(load.row as object);
    load.controller.abort();
    this.broadcast<TreeLoadEndDetail>('tree-load-end', {
      key,
      row: load.row,
      depth: load.depth,
      childCount: 0,
      cancelled: true,
    });
  }

  /**
   * Drive the local `loadChildren` callback. Supports both `Promise` and
   * `Subscribable` results; the subscription is torn down on abort so an
   * Angular `HttpClient` request is cancelled natively.
   */
  #loadChildrenLocally(key: string, row: TreeRow, depth: number, controller: AbortController): void {
    // A callback is guaranteed by the caller's guard.
    const loadChildren = this.config.loadChildren as NonNullable<TreeConfig['loadChildren']>;

    const finish = (): boolean => {
      // Superseded (already reported as cancelled) or detached — drop the result.
      if (controller.signal.aborted) return false;
      this.#loads.delete(key);
      return true;
    };

    const onSuccess = (rows: TreeRow[] | null | undefined) => {
      if (!finish()) return;
      const children = rows ?? [];
      this.#mergeChildren(row, children);
      this.broadcast<TreeLoadEndDetail>('tree-load-end', { key, row, depth, childCount: children.length });
      this.requestRender();
    };

    const onError = (error: unknown) => {
      if (!finish()) return;
      this.broadcast<TreeLoadErrorDetail>('tree-load-error', { key, row, depth, error });
      this.requestRender();
    };

    let result: Promise<TreeRow[]> | Subscribable<TreeRow[]>;
    try {
      result = loadChildren({ row, key, depth, signal: controller.signal });
    } catch (error) {
      onError(error);
      return;
    }

    if (result && isSubscribable(result)) {
      // Take-one semantics: `onSuccess`/`onError` are single-shot (guarded by
      // `finish()`), so hold the subscription only until the first emission.
      // Without this, a source that never completes (a subject-like stream)
      // stays subscribed forever once its value has been consumed, because
      // `finish()` has already removed the load whose controller `detach()` aborts.
      let settled = false;
      let active: { unsubscribe(): void } | null = null;
      const release = (): void => {
        settled = true;
        active?.unsubscribe();
        active = null;
      };
      const subscription = result.subscribe({
        next: (rows) => {
          onSuccess(rows);
          release();
        },
        error: (error) => {
          onError(error);
          release();
        },
      });
      // A synchronous emission ran `release()` before `subscription` was bound.
      if (settled) {
        subscription.unsubscribe();
        return;
      }
      active = subscription;
      controller.signal.addEventListener('abort', release, { once: true });
      return;
    }
    Promise.resolve(result).then(onSuccess, onError);
  }

  /**
   * Resolve the effective sort state: prefer MultiSort's model when available,
   * fall back to local tree sort state.
   * This follows the same pattern as GroupingRowsPlugin.resolveGroupSortDirections.
   */
  private resolveEffectiveSortState(): { field: string; direction: 1 | -1 } | null {
    this.#multiSort = undefined;
    // When MultiSort is loaded, prefer its model for consistency
    const multiSortResults = this.grid?.query?.('sort:get-model', null);
    if (Array.isArray(multiSortResults) && multiSortResults.length > 0) {
      const sortModel = multiSortResults[0] as SortModel[];
      if (Array.isArray(sortModel)) {
        this.#multiSort = sortModel;
        return null;
      }
    }
    // Fallback: local sort state (when MultiSort is not loaded)
    return this.sortState;
  }

  /** @internal */
  override processColumns(columns: readonly ColumnConfig[]): ColumnConfig[] {
    if (this.flattenedRows.length === 0) {
      const cols = [...columns] as ColumnConfig[];
      // The wrapper cannot simply be dropped: `_schedulerMergeConfig` reseeds
      // `#baseColumns` from `_columns`, so a previously wrapped renderer is
      // already baked into the columns handed to us. Put the original back.
      if (this.#treeColumnWrapped) {
        const idx = cols.findIndex((c) => c.field === this.wrappedTreeColumnField);
        if (idx >= 0)
          cols[idx] = {
            ...cols[idx],
            renderer: this.#originalRendererAlias,
            viewRenderer: this.originalTreeColumnRenderer,
          };
      }
      this.#treeColumnWrapped = false;
      this.originalTreeColumnRenderer = undefined;
      this.#originalRendererAlias = undefined;
      this.#installedTreeRenderer = undefined;
      this.wrappedTreeColumnField = undefined;
      return cols;
    }

    const cols = [...columns] as ColumnConfig[];
    if (cols.length === 0) return cols;

    // Determine which column gets the tree toggle and indentation.
    // If treeColumn is configured, find it by field name; otherwise use the first column.
    const { treeColumn } = this.config;
    let targetIndex = 0;
    if (treeColumn) {
      const idx = cols.findIndex((c) => c.field === treeColumn);
      if (idx >= 0) targetIndex = idx;
    }
    const targetCol = cols[targetIndex];
    const targetField = targetCol.field;

    // Capture the original (unwrapped) renderer only once per target column.
    // On subsequent processColumns calls, reuse the cached original so we
    // don't nest tree-cell-wrappers.
    if (
      this.wrappedTreeColumnField !== targetField ||
      targetCol.viewRenderer !== this.#installedTreeRenderer ||
      targetCol.renderer !== this.#installedTreeRenderer
    ) {
      this.originalTreeColumnRenderer = targetCol.viewRenderer;
      this.#originalRendererAlias = targetCol.renderer;
      this.wrappedTreeColumnField = targetField;
    }
    const originalRenderer = this.#originalRendererAlias ?? this.originalTreeColumnRenderer;
    const wrappedRenderer: ColumnViewRenderer = (ctx) => {
      return this.#renderTreeCell(ctx, originalRenderer);
    };

    this.#installedTreeRenderer = wrappedRenderer;
    cols[targetIndex] = { ...targetCol, renderer: wrappedRenderer, viewRenderer: wrappedRenderer };
    this.#treeColumnWrapped = true;
    return cols;
  }

  #renderTreeCell(ctx: CellRenderContext, originalRenderer: ColumnViewRenderer | undefined): HTMLElement {
    const { row, value } = ctx;
    const { showExpandIcons = true, indentWidth } = this.config;
    const meta = this.#rowMeta.get(row as object);
    const depth = meta?.depth ?? 0;
    const cell = ctx.cellEl;
    let record = cell ? this.#cells.get(cell) : undefined;
    if (cell && record && (record.row !== row || record.key !== meta?.key || record.wrapper.parentElement !== cell)) {
      // Release before invoking a cached framework renderer, not after it reparents its output.
      const adapter = this.grid.__frameworkAdapter;
      adapter?.beginBatch?.(this.gridElement);
      try {
        releaseCell(this.grid, cell);
        record.wrapper.remove();
      } finally {
        adapter?.endBatch?.(this.gridElement);
      }
      record = undefined;
    }
    if (!record) {
      const wrapper = document.createElement('span');
      wrapper.className = 'tree-cell-wrapper';
      const content = document.createElement('span');
      content.className = 'tree-content';
      wrapper.appendChild(content);
      record = { row: row as object, key: meta?.key, wrapper, content };
      if (cell) this.#cells.set(cell, record);
    }
    const container = record.wrapper;
    container.style.setProperty('--tbw-tree-depth', String(depth));
    // Allow config-based indentWidth to override CSS default
    if (indentWidth !== undefined) {
      container.style.setProperty('--tbw-tree-indent-width', `${indentWidth}px`);
    } else {
      container.style.removeProperty('--tbw-tree-indent-width');
    }

    // Add expand/collapse icon, loading spinner, or spacer
    if (cell && showExpandIcons && meta?.hasChildren && this.config.disclosureRenderer) {
      this.#updateDisclosure(cell);
    } else {
      record.slot?.dispose();
      record.slot = undefined;
      this.#renderDefaultDecoration(container, record.content, meta);
    }

    // Add the original content
    const content = record.content;
    if (originalRenderer) {
      const result = originalRenderer(ctx);
      if (result instanceof Node) {
        if (result.parentNode !== content) content.replaceChildren(result);
      } else if (typeof result === 'string') {
        setSanitizedHTML(content, result);
      } else {
        content.replaceChildren();
      }
    } else {
      content.textContent = value != null ? String(value) : '';
    }
    return container;
  }

  #renderDefaultDecoration(wrapper: HTMLElement, content: HTMLElement, meta?: FlattenedTreeRow): void {
    while (wrapper.firstChild !== content) wrapper.firstChild?.remove();
    if (this.config.showExpandIcons === false) return;
    let decoration: HTMLElement;
    if (meta && this.#isLoading(meta)) {
      decoration = createDefaultSpinner('small');
      decoration.classList.add('tree-loading');
    } else {
      decoration = document.createElement('span');
      if (meta?.hasChildren) {
        decoration.className = `${GridClasses.TREE_TOGGLE}${meta.isExpanded ? ` ${GridClasses.EXPANDED}` : ''}`;
        this.setIcon(decoration, meta.isExpanded ? 'collapse' : 'expand');
        decoration.setAttribute('data-tree-key', meta.key);
      } else {
        decoration.className = 'tree-spacer';
      }
    }
    wrapper.insertBefore(decoration, content);
  }

  #updateDisclosure(cell: HTMLElement): void {
    const record = this.#cells.get(cell);
    const renderer = this.config.disclosureRenderer;
    if (!record || !renderer) return;
    const meta = this.#rowMeta.get(record.row);
    if (!meta?.hasChildren || this.config.showExpandIcons === false) return;
    if (record.slot?.renderer !== renderer) {
      record.slot?.dispose();
      while (record.wrapper.firstChild !== record.content) record.wrapper.firstChild?.remove();
      const host = document.createElement('span');
      host.style.display = 'contents';
      markDisclosureBoundary(host, this.gridElement);
      record.wrapper.insertBefore(host, record.content);
      record.slot = new ControlSlot(host, renderer, this.gridElement);
    }
    const slot = record.slot;
    slot.update({
      grid: this.grid as PublicGrid<TRow> & HTMLElement,
      host: slot.host,
      row: record.row as TRow,
      rowIndex: getRowIndexFromCell(cell),
      key: meta.key,
      depth: meta.depth,
      hasChildren: meta.hasChildren,
      expanded: this.expandedKeys.has(meta.key),
      loading: this.#isLoading(meta),
      disabled: this.#isLoading(meta),
      setExpanded: (expanded) => {
        const current = this.#rowMeta.get(record.row);
        if (
          !slot.active ||
          record.slot !== slot ||
          this.#cells.get(cell) !== record ||
          !this.gridElement.isConnected ||
          !this.grid.contains(cell) ||
          record.wrapper.parentElement !== cell ||
          !record.wrapper.contains(slot.host) ||
          this.rows[getRowIndexFromCell(cell)] !== record.row ||
          this.config.disclosureRenderer !== renderer ||
          this.config.showExpandIcons === false ||
          !current?.hasChildren ||
          current.key !== record.key ||
          this.#isLoading(current) ||
          this.expandedKeys.has(current.key) === expanded
        )
          return;
        this.toggle(current.key);
      },
    });
  }

  #releaseTreeCell(cell: HTMLElement): void {
    const record = this.#cells.get(cell);
    if (!record) return;
    this.#cells.delete(cell);
    unregisterControlCleanup(cell, this);
    record.slot?.dispose();
  }

  /** @internal */
  override afterCellRender(context: AfterCellRenderContext): void {
    const cell = context.cellElement;
    if (this.#cells.has(cell)) registerControlCleanup(cell, () => this.#releaseTreeCell(cell), this);
  }

  /** Replace only disclosure controls, preserving expansion and content renderers. @since 3.9.0 */
  setDisclosureRenderer(renderer: TreeConfig<TRow>['disclosureRenderer']): void {
    if (this.config.disclosureRenderer === renderer) return;
    this.config.disclosureRenderer = this.userConfig.disclosureRenderer = renderer;
    this.requestAfterRender();
  }

  #refreshDisclosures(): void {
    for (const [cell, record] of this.#cells) {
      if (!this.grid.contains(cell) || record.wrapper.parentElement !== cell) {
        this.#releaseTreeCell(cell);
      } else if (this.config.disclosureRenderer) {
        this.#updateDisclosure(cell);
      } else if (record.slot) {
        // Restore the default decoration without touching the content renderer.
        const meta = this.#rowMeta.get(record.row);
        record.slot.dispose();
        record.slot = undefined;
        this.#renderDefaultDecoration(record.wrapper, record.content, meta);
      }
    }
  }

  // #endregion

  // #region Event Handlers

  /** @internal */
  override onCellClick(event: CellClickEvent): boolean {
    // closest(): a custom icon (setIcon HTML/element) puts the click target inside the toggle
    const toggle = (event.originalEvent?.target as Element | null)?.closest?.(`.${GridClasses.TREE_TOGGLE}`);
    if (!toggle) return false;
    // #568: core also routes `dblclick` here; toggle only on clicks so a double-click
    // toggles twice (click, click), not three times. Still claim it — the toggle owns it.
    if (event.originalEvent.type === 'dblclick') return true;

    const key = toggle.getAttribute('data-tree-key');
    if (!key) return false;

    const flatRow = this.rowKeyMap.get(key);
    if (!flatRow) return false;

    this.expandedKeys = toggleExpand(this.expandedKeys, key);

    // Request lazy children when expanding a node without embedded children
    if (this.expandedKeys.has(key)) {
      this.requestLazyChildren(flatRow);
    }

    this.broadcast<TreeExpandDetail>('tree-expand', {
      key,
      row: flatRow.data,
      expanded: this.expandedKeys.has(key),
      depth: flatRow.depth,
      expandedKeys: [...this.expandedKeys],
    });
    this.requestRender();
    return true;
  }

  /** @internal */
  override onKeyDown(event: KeyboardEvent): boolean | void {
    // SPACE toggles expansion when on a row with children
    if (event.key !== ' ') return;
    // An open editor (or any input in the row) owns Space — let it type (#546).
    if (isFormFieldKeyTarget(event)) return;

    const focusRow = this.grid._focusRow;
    const flatRow = this.#rowMeta.get(this.rows[focusRow] as object);
    if (!flatRow?.hasChildren) return;

    event.preventDefault();
    this.expandedKeys = toggleExpand(this.expandedKeys, flatRow.key);

    // Request lazy children when expanding a node without embedded children
    if (this.expandedKeys.has(flatRow.key)) {
      this.requestLazyChildren(flatRow);
    }

    this.broadcast<TreeExpandDetail>('tree-expand', {
      key: flatRow.key,
      row: flatRow.data,
      expanded: this.expandedKeys.has(flatRow.key),
      depth: flatRow.depth,
      expandedKeys: [...this.expandedKeys],
    });
    this.requestRenderWithFocus();
    return true;
  }

  /** @internal */
  override onHeaderClick(event: HeaderClickEvent): boolean {
    if (this.flattenedRows.length === 0 || !event.column.sortable) return false;

    // When MultiSort is active, let it handle header clicks entirely.
    // Tree will pick up the sort model in processRows via resolveEffectiveSortState().
    const multiSortResults = this.grid?.query?.('sort:get-model', null);
    if (Array.isArray(multiSortResults) && multiSortResults.length > 0) {
      // MultiSort is loaded — don't consume the event, let MultiSort handle it
      return false;
    }

    // Fallback: manage own sort state when MultiSort is not loaded
    const { field } = event.column;
    if (!this.sortState || this.sortState.field !== field) {
      this.sortState = { field, direction: 1 };
    } else if (this.sortState.direction === 1) {
      this.sortState = { field, direction: -1 };
    } else {
      this.sortState = null;
    }

    // Sync grid sort indicator
    const gridEl = this.grid;
    if (gridEl._sortState !== undefined) {
      gridEl._sortState = this.sortState ? { ...this.sortState } : null;
    }

    this.broadcast('sort-change', { field, direction: this.sortState?.direction ?? 0 });
    this.requestRender();
    return true;
  }

  /** @internal */
  override afterRender(): void {
    this.#refreshDisclosures();
    const body = this.gridElement?.querySelector('.rows');
    this.#retireRowMetadata(body);
    const style = this.animationStyle;
    this.#reveal.reconcile(body, (element) => this.#renderedRevealKey(element), style !== false);
    if (!body) return;

    const shouldAnimate = style !== false && this.keysToAnimate.size > 0;
    const animClass = style === 'fade' ? 'tbw-tree-fade-in' : 'tbw-tree-slide-in';

    for (const rowEl of body.querySelectorAll<HTMLElement>(':scope > .data-grid-row')) {
      // Look up by row identity: other hierarchy contributors (group rows)
      // may be interleaved with tree rows in the rendered list.
      const treeRow = this.#rowMeta.get((rowEl as RowElementInternal).__rowDataRef as object);
      if (!treeRow) continue;

      this.#rowMetadata.set(rowEl, 'aria-expanded', treeRow.hasChildren ? String(treeRow.isExpanded) : null);
      rowEl.classList.toggle(
        'tbw-row-expanded',
        (treeRow.hasChildren && treeRow.isExpanded) || rowEl.classList.contains('tbw-detail-expanded'),
      );

      if (!rowEl.classList.contains('tbw-row-loading'))
        this.#rowMetadata.set(rowEl, 'aria-busy', this.#isLoading(treeRow) ? 'true' : null);

      if (shouldAnimate && treeRow.key && this.keysToAnimate.has(treeRow.key)) {
        this.#reveal.apply(rowEl, treeRow.key, animClass);
      }
    }
    this.keysToAnimate.clear();
  }

  /** @internal */
  override onScrollRender(): void {
    this.#reveal.reconcile(
      this.gridElement?.querySelector('.rows') ?? null,
      (element) => this.#renderedRevealKey(element),
      this.animationStyle !== false,
    );
  }

  #renderedRevealKey(element: HTMLElement): string | undefined {
    return this.#rowMeta.get((element as RowElementInternal).__rowDataRef as object)?.key;
  }

  #retireRowMetadata(body?: Element | null): void {
    for (const element of this.#rowMetadata.elements) {
      const row = (element as RowElementInternal).__rowDataRef as object;
      if (element.parentElement === body && this.#rowMeta.has(row)) continue;
      this.#rowMetadata.release(element);
    }
  }

  // #endregion

  // #region Public API

  /**
   * Expand a specific tree node, revealing its children.
   *
   * If the node is already expanded, this is a no-op.
   * Does **not** emit a `tree-expand` event (use {@link toggle} for event emission).
   *
   * @param key - The unique key of the node to expand (from {@link FlattenedTreeRow.key})
   *
   * @example
   * ```ts
   * const tree = grid.getPluginByName('tree');
   * tree.expand('documents');          // Expand a root node
   * tree.expand('documents||reports');  // Expand a nested node
   * ```
   */
  expand(key: string): void {
    this.expandedKeys.add(key);
    const flatRow = this.rowKeyMap.get(key);
    if (flatRow) {
      this.requestLazyChildren(flatRow);
    }
    this.requestRender();
  }

  /**
   * Collapse a specific tree node, hiding its children.
   *
   * If the node is already collapsed, this is a no-op.
   * Does **not** emit a `tree-expand` event (use {@link toggle} for event emission).
   *
   * @param key - The unique key of the node to collapse (from {@link FlattenedTreeRow.key})
   *
   * @example
   * ```ts
   * const tree = grid.getPluginByName('tree');
   * tree.collapse('documents');
   * ```
   */
  collapse(key: string): void {
    this.expandedKeys.delete(key);
    this.requestRender();
  }

  /**
   * Toggle the expanded state of a tree node.
   *
   * If the node is expanded it will be collapsed, and vice versa.
   * Emits a `tree-expand` event (broadcast to both DOM consumers and plugin bus).
   *
   * @param key - The unique key of the node to toggle (from {@link FlattenedTreeRow.key})
   *
   * @example
   * ```ts
   * const tree = grid.getPluginByName('tree');
   * tree.toggle('documents');  // Expand if collapsed, collapse if expanded
   * ```
   */
  toggle(key: string): void {
    this.expandedKeys = toggleExpand(this.expandedKeys, key);
    const flatRow = this.rowKeyMap.get(key);
    if (flatRow) {
      // Request lazy children when expanding a node without embedded children
      if (this.expandedKeys.has(key)) {
        this.requestLazyChildren(flatRow);
      }
      this.broadcast<TreeExpandDetail>('tree-expand', {
        key,
        row: flatRow.data,
        expanded: this.expandedKeys.has(key),
        depth: flatRow.depth,
        expandedKeys: [...this.expandedKeys],
      });
    } else {
      this.emitPluginEvent('tree-expand', { expandedKeys: [...this.expandedKeys] });
    }
    this.requestRender();
  }

  /**
   * Expand all tree nodes recursively.
   *
   * Every node with children will be expanded, revealing the full tree hierarchy.
   * Emits a `tree-expand` plugin event.
   *
   * @example
   * ```ts
   * const tree = grid.getPluginByName('tree');
   * tree.expandAll();
   * ```
   */
  expandAll(): void {
    this.expandedKeys = expandAll(this.#rootRows ?? this.rows, this.config, null, 0, this.#resolveKey);
    this.emitPluginEvent('tree-expand', { expandedKeys: [...this.expandedKeys] });
    this.requestRender();
  }

  /**
   * Collapse all tree nodes.
   *
   * Every node will be collapsed, showing only root-level rows.
   * Emits a `tree-expand` plugin event.
   *
   * @example
   * ```ts
   * const tree = grid.getPluginByName('tree');
   * tree.collapseAll();
   * ```
   */
  collapseAll(): void {
    this.expandedKeys = collapseAll();
    this.emitPluginEvent('tree-expand', { expandedKeys: [...this.expandedKeys] });
    this.requestRender();
  }

  /**
   * Check whether a specific tree node is currently expanded.
   *
   * @param key - The unique key of the node to check
   * @returns `true` if the node is expanded, `false` otherwise
   */
  isExpanded(key: string): boolean {
    return this.expandedKeys.has(key);
  }

  /**
   * Get the keys of all currently expanded nodes.
   *
   * Returns a snapshot copy — mutating the returned array does not affect the tree state.
   *
   * @returns Array of expanded node keys
   *
   * @example
   * ```ts
   * const tree = grid.getPluginByName('tree');
   * const keys = tree.getExpandedKeys();
   * localStorage.setItem('treeState', JSON.stringify(keys));
   * ```
   */
  getExpandedKeys(): string[] {
    return [...this.expandedKeys];
  }

  /**
   * Get the flattened row model used for rendering.
   *
   * Returns a snapshot copy of the internal flattened tree rows, including
   * hierarchy metadata (depth, hasChildren, isExpanded, parentKey).
   *
   * @returns Array of {@link FlattenedTreeRow} objects
   */
  getFlattenedRows(): FlattenedTreeRow[] {
    return [...this.flattenedRows];
  }

  /**
   * Get tree metadata (depth, key, hasChildren, isExpanded, parentKey) for a
   * specific row reference. Returns `undefined` if the row is not part of the
   * currently-flattened tree (e.g. collapsed under a parent or never processed).
   *
   * Tree metadata lives in a parallel WeakMap keyed by row identity \u2014 it is
   * NOT stored on the row object itself. This preserves the invariant that
   * `_rows[i]` IS the user's source row reference, so `grid.updateRow(s)`
   * mutations survive the next ROWS-phase rebuild.
   *
   * @example
   * ```ts
   * const tree = grid.getPluginByName('tree');
   * const meta = tree.getRowMeta(grid.rows[0]);
   * console.log(meta?.depth, meta?.hasChildren);
   * ```
   */
  getRowMeta(row: TreeRow): FlattenedTreeRow | undefined {
    return this.#rowMeta.get(row as object);
  }

  /**
   * Look up an original row data object by its tree key.
   *
   * @param key - The unique key of the node
   * @returns The original row data, or `undefined` if not found
   */
  getRowByKey(key: string): TreeRow | undefined {
    return this.rowKeyMap.get(key)?.data;
  }

  /**
   * Expand all ancestor nodes of the target key, revealing it in the tree.
   *
   * Useful for "scroll to node" or search-and-reveal scenarios where a deeply
   * nested node needs to be made visible.
   *
   * @param key - The unique key of the node to reveal
   *
   * @example
   * ```ts
   * const tree = grid.getPluginByName('tree');
   * // Reveal a deeply nested node by expanding all its parents
   * tree.expandToKey('root||child||grandchild');
   * ```
   */
  expandToKey(key: string): void {
    this.expandedKeys = expandToKey(this.#rootRows ?? this.rows, key, this.config, this.expandedKeys, this.#resolveKey);
    this.requestRender();
  }

  // #endregion
}
