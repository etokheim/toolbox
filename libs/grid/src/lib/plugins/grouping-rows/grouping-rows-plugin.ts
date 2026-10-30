/**
 * Row Grouping Plugin (Class-based)
 *
 * Enables hierarchical row grouping with expand/collapse and aggregations.
 */

import { GridClasses } from '../../core/constants';
import { announce, getA11yMessage } from '../../core/internal/aria';
import { isControlEvent, releaseCell } from '../../core/internal/control-lifecycle';
import { isFormFieldKeyTarget } from '../shared/form-field-target';
import { renderLoadingPlaceholderRow } from '../shared/loading-placeholder';
import { setSanitizedHTML } from '../../core/internal/sanitize';
import { BaseGridPlugin, type GridElement, type PluginManifest, type PluginQuery } from '../../core/plugin/base-plugin';
import type { CellClickEvent, HeaderClickEvent } from '../../core/plugin/base-plugin';
import { RowMetadata } from '../../core/plugin/row-metadata';
import type { PublicGrid, RowElementInternal } from '../../core/types';
import type { HierarchyContributor, HierarchyNode, HierarchyRowMeta, HierarchySiblingContext } from '../hierarchy';
import { buildHierarchy, HierarchyPlugin } from '../hierarchy';
import { FLAT_HIERARCHY, hasDefaultHierarchyHooks, type HierarchyModel } from '../hierarchy/hierarchy';
import { RevealAnimation } from '../hierarchy/reveal-animation';
import type {
  DataSourceChildrenDetail,
  DataSourceDataDetail,
  DataSourceErrorDetail,
  FetchChildrenQuery,
  ViewportMappingQuery,
  ViewportMappingResponse,
} from '../server-side/datasource-types';
import {
  collapseScopedPeers,
  collapseUnscopedPeers,
  buildGroupedRowModel,
  buildPreDefinedGroupModel,
  nestGroupRows,
  collectVisibleRowKeys,
  collectGroupKeys,
  buildRootSlots,
  computeRootOwners,
  findGroupDefinition,
  getGroupRevealKey,
  getRenderedGroupRevealKey,
  indexGroupCells,
  expandAllGroups,
  flattenGroupRows,
  getGroupKeys,
  getGroupPath,
  getGroupRowCount,
  interleaveRootNodes,
  leadingGroups,
  mapViewportToNodes,
  resolveDefaultExpanded,
  resolveGroupFields,
  RootGroupKeys,
  toggleGroupExpansion,
} from './grouping-rows';
import styles from './grouping-rows.css?inline';
import { GroupRowView } from './group-row-view';
import { GroupingDisclosures } from './grouping-disclosures';
import { ChildGroupExpansion } from './child-group-expansion';
import type {
  DefaultExpandedValue,
  ExpandCollapseAnimation,
  GroupCollapseDetail,
  GroupDefinition,
  GroupExpandDetail,
  GroupingRowsConfig,
  GroupingRowsDisclosureContext,
  GroupLoadErrorDetail,
  GroupOnContext,
  GroupRowModelItem,
  GroupToggleDetail,
  RenderRow,
} from './types';

/**
 * Group state information returned by getGroupState()
 * @since 0.1.1
 */
export interface GroupState {
  /** Whether grouping is currently active */
  isActive: boolean;
  /** Number of expanded groups */
  expandedCount: number;
  /** Total number of groups */
  totalGroups: number;
  /** Array of expanded group keys */
  expandedKeys: string[];
}

/**
 * Row Grouping Plugin for tbw-grid
 *
 * Organizes rows into collapsible hierarchical groups. Perfect for organizing data
 * by category, department, status, or any other dimension—or even multiple dimensions
 * for nested grouping. Includes aggregation support for summarizing group data.
 *
 * ## Installation
 *
 * ```ts
 * import { GroupingRowsPlugin } from '@toolbox-web/grid/plugins/grouping-rows';
 * ```
 *
 * ## CSS Custom Properties
 *
 * | Property | Default | Description |
 * |----------|---------|-------------|
 * | `--tbw-group-indent-width` | `1.25em` | Indentation per group level |
 * | `--tbw-grouping-rows-bg` | `var(--tbw-color-panel-bg)` | Group row background |
 * | `--tbw-grouping-rows-count-color` | `var(--tbw-color-fg-muted)` | Count badge color |
 * | `--tbw-animation-duration` | `200ms` | Expand/collapse animation |
 *
 * @example Single-Level Grouping by Department
 * ```ts
 * import { queryGrid } from '@toolbox-web/grid';
 * import { GroupingRowsPlugin } from '@toolbox-web/grid/plugins/grouping-rows';
 *
 * const grid = queryGrid('tbw-grid');
 * grid.gridConfig = {
 *   columns: [
 *     { field: 'name', header: 'Employee' },
 *     { field: 'department', header: 'Department' },
 *     { field: 'salary', header: 'Salary', type: 'currency' },
 *   ],
 *   plugins: [
 *     new GroupingRowsPlugin({
 *       groupOn: (row) => [row.department],
 *       showRowCount: true,
 *       defaultExpanded: false,
 *     }),
 *   ],
 * };
 * ```
 *
 * @example Multi-Level Grouping
 * ```ts
 * new GroupingRowsPlugin({
 *   groupOn: (row) => [row.region, row.department, row.team],
 *   indentWidth: 24,
 *   animation: 'slide',
 * })
 * ```
 *
 * @see {@link GroupingRowsConfig} for all configuration options
 * @see {@link GroupState} for the group state structure
 *
 * @internal Extends BaseGridPlugin
 * @since 0.1.1
 */
export class GroupingRowsPlugin extends BaseGridPlugin<GroupingRowsConfig> implements HierarchyContributor {
  /**
   * Plugin manifest - declares configuration validation rules and events.
   * @internal
   */
  static override readonly manifest: PluginManifest<GroupingRowsConfig> = {
    modifiesRowStructure: true,
    hookPriority: {
      processRows: 10, // Run after ServerSide (-10) so we receive managedNodes[]
      // Run before MultiSort so we can intercept header clicks on grouped columns
      onHeaderClick: -1,
      // Claim toggle clicks before Editing/Selection, whatever the registration order (#565)
      onCellClick: -10,
    },
    incompatibleWith: [
      {
        name: 'pivot',
        reason:
          'PivotPlugin creates its own aggregated row and column structure. ' +
          'Row grouping cannot be applied on top of pivot-generated rows.',
      },
    ],
    events: [
      {
        type: 'group-toggle',
        description: 'Emitted when groups are expanded/collapsed. Broadcast to both DOM consumers and plugin bus.',
      },
      {
        type: 'group-expand',
        description: 'Emitted when a pre-defined group is expanded.',
      },
      {
        type: 'group-collapse',
        description: 'Emitted when a pre-defined group is collapsed.',
      },
      {
        type: 'group-load-error',
        description:
          "Emitted when a pre-defined group's ServerSide getChildRows() fails. The group leaves its loading state.",
      },
    ],
    queries: [
      {
        type: 'canMoveRow',
        description: 'Returns false for group header rows (cannot be reordered)',
      },
      {
        type: 'grouping:get-grouped-fields',
        description: 'Returns the column field names that match group depth levels (string[])',
      },
      {
        type: 'datasource:viewport-mapping',
        description: 'Translates flat viewport row indices to top-level group indices for ServerSide pagination.',
      },
    ],
    configRules: [
      {
        id: 'groupingRows/accordion-defaultExpanded',
        severity: 'warn',
        message:
          `"accordion: true" and "defaultExpanded" (non-false) are used together.\n` +
          `  → In accordion mode, only one group can be open at a time.\n` +
          `  → Using defaultExpanded with multiple groups will collapse to one on first toggle.\n` +
          `  → Consider using "defaultExpanded: false" or a single group key/index with accordion mode.`,
        check: (config) =>
          config.accordion === true &&
          config.defaultExpanded !== false &&
          config.defaultExpanded !== undefined &&
          // Allow single group expansion with accordion
          !(typeof config.defaultExpanded === 'number') &&
          !(typeof config.defaultExpanded === 'string') &&
          // Warn if true or array with multiple items
          (config.defaultExpanded === true ||
            (Array.isArray(config.defaultExpanded) && config.defaultExpanded.length > 1)),
      },
    ],
  };

  /**
   * Optional dependency on MultiSort for coordinated sort management.
   * When MultiSort is loaded, GroupingRows queries its sort model to determine
   * group header ordering. Without it, falls back to core sort state.
   */
  static override readonly dependencies = [
    {
      name: 'hierarchy',
      required: true,
      reason: 'Builds the hierarchical row model',
      provide: () => new HierarchyPlugin(),
    },
    { name: 'multiSort', required: false, reason: 'Queries sort model for coordinated group sorting' },
    { name: 'serverSide', required: false, reason: 'Consumes datasource events for lazy-loaded grouped data' },
  ];

  /** @internal */
  readonly name = 'groupingRows';
  /** @internal */
  readonly hierarchyStage = 'transform';
  /** @internal */
  override readonly styles = styles;

  /** @internal */
  protected override get defaultConfig(): Partial<GroupingRowsConfig> {
    return {
      defaultExpanded: false,
      showRowCount: true,
      indentWidth: 20,
      aggregators: {},
      animation: 'slide',
      accordion: false,
    };
  }

  // #region Internal State
  private expandedKeys: Set<string> = new Set();
  private flattenedRows: RenderRow[] = [];
  private isActive = false;
  private previousVisibleKeys = new Set<unknown>();
  private keysToAnimate = new Set<unknown>();
  #reveal = new RevealAnimation();
  /** Track if initial defaultExpanded has been applied */
  private hasAppliedDefaultExpanded = false;
  /**
   * Expansion override to apply on the next `processRows` rebuild instead of
   * — or in addition to — `config.defaultExpanded`. Set by `setGroupOn(fn, expanded)`
   * and by `expandAll()` / `collapseAll()` when the grouping config has just
   * changed (so `flattenedRows` is stale). Cleared once consumed by a rebuild.
   * See issue #335.
   */
  private pendingExpansion: DefaultExpandedValue | undefined;
  /**
   * Set by `setGroupOn` to mark the cached `flattenedRows` as stale until the
   * next `processRows` runs. While true, `expandAll`/`collapseAll` defer via
   * `pendingExpansion` instead of reading the stale snapshot. See issue #335.
   */
  private groupConfigDirty = false;
  /** Pre-defined group definitions (from config, setGroups(), or datasource:data) */
  private preDefinedGroups: GroupDefinition[] = [];
  /**
   * ServerSide-fed definitions, sparse and indexed by node (`startNode + i` of each
   * `datasource:data` block). `preDefinedGroups` is its compacted form. Merged per
   * block within one ServerSide cache generation, reset when the generation changes (#538).
   */
  #nodeGroups: (GroupDefinition | undefined)[] = [];
  /** Definitions come from generation-stamped ServerSide blocks — unloaded root nodes render as its placeholders. */
  #serverFed = false;
  /** `DataSourceDataDetail.generation` of the claimed blocks (`undefined` = none, or a legacy emitter). */
  #serverGeneration: number | undefined;
  /**
   * Every group key a ServerSide block delivered, across generations — `defaultExpanded: true`
   * opens only keys not in here, so a group the user collapsed stays collapsed after a refetch.
   */
  #seenServerKeys = new Set<string>();
  /** Row data keyed by group key (from setGroupRows() or datasource:children) */
  private groupRowsMap = new Map<string, unknown[]>();
  /** Groups currently in a loading state */
  private loadingGroups = new Set<string>();
  /**
   * In-flight `datasource:fetch-children` requests (ServerSide active only),
   * keyed by group key. Each controller's signal is passed as
   * `FetchChildrenQuery.signal`, so aborting it cancels `getChildRows()` and
   * drops its result. Aborted when the group definitions are replaced (`setGroups()`,
   * or a new ServerSide cache generation — sort/filter, `refresh()`, `purgeCache()` —
   * which then re-requests every still-expanded group whose rows were loaded or
   * loading; an appended ServerSide block keeps them), on `setGroupRows`/`clearGroupRows`,
   * and on detach. Collapsing keeps the
   * load: its rows are cached for the next expand, and re-expanding while it is
   * in flight does not re-request.
   */
  #groupLoads = new Map<string, AbortController>();
  /**
   * Group keys already requested in the current definitions generation (any
   * request path). An expanded group whose rows were never requested —
   * `defaultExpanded`, `expandAll()`, `expand()` — gets ONE automatic request
   * after the render that shows it (#534); a failing group is therefore not
   * re-requested on every render. A manual collapsed → expanded transition
   * (`toggle()`, `expand()`, `expandAll()`) is a fresh attempt, so collapse +
   * re-expand still retries. Cleared when the definitions are replaced (`setGroups()`,
   * a new ServerSide cache generation, detach) — not when a later ServerSide block is appended.
   */
  #requestedKeys = new Set<string>();
  #groupRequestsQueued = false;
  /** Column fields that produce group values (depth 0, 1, ...). Cached for
   *  the `grouping:get-grouped-fields` query so MultiSort can filter them out. */
  private groupedFields: string[] = [];
  /** User-specified sort directions per group depth level. Toggled via
   *  header clicks on grouped columns. */
  private userGroupSortDirections = new Map<number, 1 | -1>();
  #metadata = new RowMetadata();
  #disclosures: GroupingDisclosures = new GroupingDisclosures({
    grid: () => this.grid as PublicGrid & HTMLElement,
    config: () => this.config,
    state: (index) => this.#disclosureState(index),
    toggle: (key) => this.toggle(key),
    nativeButton: (key) => this.#rowView.createToggleButton(this.isExpanded(key), () => this.toggle(key)),
  });

  // Per-rebuild state, set in `beginHierarchy`.
  #mode: 'groupOn' | 'predefined' = 'groupOn';
  #pending: DefaultExpandedValue | undefined;
  #pendingApplied = false;
  #groupSortDirections: Map<number, 1 | -1> | undefined;
  /** Set once a sibling list yielded the grouped column fields (nested-only grouping skips the root list). */
  #groupFieldsResolved = false;
  /** Render-model item of every row emitted by this rebuild, keyed by row object. */
  #renderItems = new WeakMap<object, RenderRow>();
  /** Node index of every root row (top-level group or ServerSide placeholder) emitted by this rebuild. */
  #rootIndexOf = new WeakMap<object, number>();
  /** Pre-defined mode: node index of the root each `flattenedRows` entry belongs to, and the root count. */
  #rootOwners: { owners: number[]; count: number } = { owners: [], count: 0 };
  #anyGroup = false;
  #childExpansion = new ChildGroupExpansion();
  #nestedParents = new Map<string, { scope: string | null; parent: string | null }>();
  #rootKeys = new RootGroupKeys();
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

  // #region Lifecycle

  /** @internal */
  override detach(): void {
    this.#disclosures.releaseAll();
    this.#releaseRowMetadata();

    this.expandedKeys.clear();
    this.flattenedRows = [];
    this.isActive = false;
    this.previousVisibleKeys.clear();
    this.keysToAnimate.clear();
    this.#reveal.clear();
    this.hasAppliedDefaultExpanded = false;
    this.pendingExpansion = undefined;
    this.groupConfigDirty = false;
    this.preDefinedGroups = [];
    this.#resetServerGroups();
    this.#rootOwners = { owners: [], count: 0 };
    this.groupRowsMap.clear();
    this.#abortGroupLoads();
    this.#requestedKeys.clear();
    this.loadingGroups.clear();
    this.groupedFields = [];
    this.userGroupSortDirections.clear();
    this.#childExpansion.clear();
    this.#rootKeys = new RootGroupKeys();
  }

  /**
   * Provide row height for group header rows.
   *
   * If `groupRowHeight` is configured, returns that value for group rows.
   * This allows the variable row height system to use known heights for
   * group headers without needing to measure them from the DOM.
   *
   * @param row - The row object (may be a group row)
   * @param _index - Index in the processed rows array (unused)
   * @returns Height in pixels for group rows, undefined for data rows
   *
   * @internal Plugin hook for variable row height support
   */
  override getRowHeight(row: unknown, _index: number): number | undefined {
    // Only provide height if groupRowHeight is configured
    if (this.config.groupRowHeight == null) return undefined;

    // Check if this is a group row
    if ((row as { __isGroupRow?: boolean }).__isGroupRow === true) {
      return this.config.groupRowHeight;
    }

    return undefined;
  }

  /**
   * Handle plugin queries.
   * @internal
   */
  override handleQuery(query: PluginQuery): unknown {
    if (query.type === 'canMoveRow') {
      // Group header rows cannot be reordered
      const row = query.context as { __isGroupRow?: boolean } | null | undefined;
      if (row?.__isGroupRow === true) {
        return false;
      }
    }
    if (query.type === 'grouping:get-grouped-fields') {
      return [...this.groupedFields];
    }
    if (query.type === 'datasource:viewport-mapping') {
      // Translate visible flat row indices → top-level node indices for ServerSide pagination.
      // Unloaded nodes are placeholder roots, so the mapping reaches past the loaded groups (#538).
      const { viewportStart, viewportEnd } = query.context as ViewportMappingQuery;
      if (this.flattenedRows.length === 0 || this.#mode !== 'predefined') return undefined;
      return mapViewportToNodes(this.#rootOwners, viewportStart, viewportEnd) satisfies ViewportMappingResponse;
    }
    return undefined;
  }

  // #region Lifecycle

  /** @internal */
  override attach(grid: GridElement): void {
    super.attach(grid);

    // Listen for datasource:data from ServerSidePlugin — claim data as group definitions
    this.on('datasource:data', (detail: unknown) => {
      const d = detail as DataSourceDataDetail<GroupDefinition>;
      if (d.claimed) return;
      d.claimed = true;
      const groups = d.rows;
      // Another block of the current dataset: merge it at its node offset and keep
      // loaded rows, in-flight loads and expansion (#538).
      if (this.#serverFed && d.generation !== undefined && d.generation === this.#serverGeneration) {
        this.#mergeServerGroups(groups, d.startNode);
        this.requestRender();
        return;
      }
      // A new dataset (first load, refresh, purge, server sort/filter): expanded groups
      // whose rows were loaded or loading are invalidated, so re-request them below.
      const reload = [...this.expandedKeys].filter((k) => this.groupRowsMap.has(k) || this.#groupLoads.has(k));
      this.#nodeGroups = [];
      // Only generation-stamped blocks are node-indexed; a legacy emitter's block is a compact replacement.
      this.#serverFed = d.generation !== undefined;
      this.#serverGeneration = d.generation;
      // The default resolves once: an applied default (or retained expansion) survives a refetch,
      // so collapsed groups stay collapsed; never-seen groups still open via `#seenServerKeys`.
      this.hasAppliedDefaultExpanded ||= this.expandedKeys.size > 0;
      this.#mergeServerGroups(groups, this.#serverFed ? d.startNode : 0);
      this.groupRowsMap.clear();
      this.#abortGroupLoads();
      this.#requestedKeys.clear();
      this.loadingGroups.clear();
      for (const key of reload) {
        const groupDef = findGroupDefinition(this.preDefinedGroups, key);
        if (groupDef) this.#requestGroupRows(key, groupDef, getGroupPath(this.preDefinedGroups, key));
      }
      this.requestRender();
    });

    // Listen for datasource:children — consume child rows from ServerSide
    this.on('datasource:children', (detail: unknown) => {
      const d = detail as DataSourceChildrenDetail;
      if (d.context?.source !== 'grouping-rows') return;
      d.claimed = true;

      // Store the rows for the group and clear loading state
      const groupKey = d.context.groupKey as string;
      if (groupKey) {
        this.#groupLoads.delete(groupKey);
        this.groupRowsMap.set(groupKey, d.rows);
        this.loadingGroups.delete(groupKey);
        this.requestRender();
      }
    });

    // Listen for datasource:error — release the group's loading state;
    // collapsing and re-expanding retries the fetch.
    this.on('datasource:error', (detail: unknown) => {
      const d = detail as DataSourceErrorDetail;
      if (d.context?.source !== 'grouping-rows') return;
      const groupKey = d.context.groupKey as string | undefined;
      if (!groupKey || !this.#groupLoads.delete(groupKey)) return;
      this.loadingGroups.delete(groupKey);
      this.emit<GroupLoadErrorDetail>('group-load-error', {
        groupKey,
        groupPath: (d.context.groupPath as string[] | undefined) ?? [groupKey],
        error: d.error,
      });
      this.requestRender();
    });
  }

  /**
   * Abort a group's in-flight fetch (or every fetch when `groupKey` is omitted)
   * and release its loading state — an aborted request never settles.
   */
  #abortGroupLoads(groupKey?: string): void {
    for (const [key, controller] of this.#groupLoads) {
      if (groupKey != null && key !== groupKey) continue;
      controller.abort();
      this.#groupLoads.delete(key);
      this.loadingGroups.delete(key);
    }
  }

  /** Forget ServerSide-fed definitions (`setGroups()`, detach). */
  #resetServerGroups(): void {
    this.#nodeGroups = [];
    this.#serverFed = false;
    this.#serverGeneration = undefined;
    this.#seenServerKeys.clear();
  }

  /**
   * Place a block's definitions at their node indices and refresh the compacted `preDefinedGroups`.
   * Once the default has been applied (the render-time resolution runs once), `defaultExpanded: true`
   * opens the block's never-seen groups like the first block's.
   */
  #mergeServerGroups(groups: GroupDefinition[], startNode: number): void {
    const start = Number.isInteger(startNode) && startNode > 0 ? startNode : 0;
    for (let i = 0; i < groups.length; i++) this.#nodeGroups[start + i] = groups[i];
    this.preDefinedGroups = this.#nodeGroups.filter((group): group is GroupDefinition => group != null);
    const openNew = this.config.defaultExpanded === true && this.hasAppliedDefaultExpanded;
    for (const key of collectGroupKeys(groups)) {
      if (openNew && !this.#seenServerKeys.has(key)) this.expandedKeys.add(key);
      this.#seenServerKeys.add(key);
    }
  }

  /**
   * Show a group's loading state and request its rows via `datasource:fetch-children`,
   * unless a request for it is already in flight. The request is tracked (and made
   * cancellable) only when a ServerSide data source will answer it.
   */
  #requestGroupRows(key: string, group: GroupDefinition, groupPath: string[]): void {
    this.#requestedKeys.add(key);
    this.loadingGroups.add(key);
    if (this.#groupLoads.has(key)) return;
    const controller = this.queryBoolean('datasource:is-active') ? new AbortController() : undefined;
    if (controller) this.#groupLoads.set(key, controller);
    this.grid?.query?.('datasource:fetch-children', {
      context: { source: 'grouping-rows', groupKey: key, group, groupPath },
      signal: controller?.signal,
    } satisfies FetchChildrenQuery);
  }

  /** An expanded pre-defined group whose rows were never loaded, loading, or requested this generation. */
  #needsGroupRows(item: RenderRow): item is GroupRowModelItem {
    return (
      item.kind === 'group' &&
      item.expanded &&
      !this.groupRowsMap.has(item.key) &&
      !this.loadingGroups.has(item.key) &&
      !this.#requestedKeys.has(item.key)
    );
  }

  /** Flush automatic group-row requests in a microtask — side effects stay out of the render pipeline (#534). */
  #queueGroupRowRequests(): void {
    if (this.#groupRequestsQueued) return;
    this.#groupRequestsQueued = true;
    queueMicrotask(() => {
      this.#groupRequestsQueued = false;
      this.#requestExpandedGroupRows();
    });
  }

  /**
   * Request the rows of every rendered, expanded leaf group that has none, however it
   * was expanded (`defaultExpanded`, `expandAll()`, `expand()`). ServerSide only —
   * imperative mode leaves loading to the consumer (`group-expand` / `setGroupRows`).
   * Expansion is rechecked against `expandedKeys`: a group (or ancestor) collapsed
   * after the render that queued this flush is skipped, and stays eligible.
   */
  #requestExpandedGroupRows(): void {
    if (!this.isActive || this.#mode !== 'predefined') return;
    const serverSideActive = this.queryBoolean('datasource:is-active');
    const groups = this.getActiveGroups();
    let requested = false;
    for (const item of this.flattenedRows) {
      if (!this.#needsGroupRows(item)) continue;
      const groupPath = getGroupPath(groups, item.key);
      if (!groupPath.every((key) => this.expandedKeys.has(key))) continue;
      const group = findGroupDefinition(groups, item.key);
      // A parent group renders its child groups, never rows.
      if (!serverSideActive || !group || group.children?.length) {
        this.#requestedKeys.add(item.key);
        continue;
      }
      this.#requestGroupRows(item.key, group, groupPath);
      requested = true;
    }
    if (requested) this.requestRender();
  }

  /**
   * Intercept header clicks on grouped columns to toggle group sort direction.
   * Returns `true` for grouped columns to prevent MultiSort from handling them.
   * @internal
   */
  override onHeaderClick(event: HeaderClickEvent): boolean | void {
    const fieldIndex = this.groupedFields.indexOf(event.field);
    if (fieldIndex === -1) return; // Not a grouped column — let other plugins handle it

    if (!event.column.sortable) return;

    // The fieldIndex in groupedFields corresponds to the group depth level
    // (resolveGroupFields populates them in depth order: 0, 1, 2, ...)
    const targetDepth = fieldIndex;

    // Toggle direction: asc → desc → asc
    const current = this.userGroupSortDirections.get(targetDepth) ?? 1;
    this.userGroupSortDirections.set(targetDepth, current === 1 ? -1 : 1);

    this.requestRender();
    return true; // Prevent MultiSort from handling this column
  }
  // #endregion

  // #region Sort State Resolution

  /**
   * Build a sort-direction map for each group depth level by cross-referencing
   * the active sort state with the column fields that produce group values.
   *
   * Supports three direction sources (in priority order):
   * 1. User-set directions via header clicks on grouped columns
   * 2. MultiSort plugin model (for backwards compatibility / state restore)
   * 3. Core single-column sort state
   */
  private resolveGroupSortDirections(rows: readonly any[], context: GroupOnContext): Map<number, 1 | -1> | undefined {
    const config = this.config;
    if (typeof config.groupOn !== 'function' || rows.length === 0) {
      this.groupedFields = [];
      return undefined;
    }

    // Discover depth → field mapping by sampling rows
    const columnFields = this.columns.map((c) => c.field);
    const depthToField = resolveGroupFields([...rows], config.groupOn, columnFields, context);

    // Cache grouped field names for the grouping:get-grouped-fields query
    this.groupedFields = [...depthToField.values()];

    if (depthToField.size === 0) return undefined;

    // Start with user-set directions (from header clicks on grouped columns)
    const directions = new Map<number, 1 | -1>(this.userGroupSortDirections);

    // Fill missing depths from MultiSort model or core sort state
    if (directions.size < depthToField.size) {
      const activeSorts = new Map<string, 1 | -1>();

      const multiSortResults = this.grid?.query?.('sort:get-model', null);
      if (Array.isArray(multiSortResults) && multiSortResults.length > 0) {
        const sortModel = multiSortResults[0] as Array<{ field: string; direction: 'asc' | 'desc' }>;
        if (Array.isArray(sortModel)) {
          for (const entry of sortModel) {
            activeSorts.set(entry.field, entry.direction === 'desc' ? -1 : 1);
          }
        }
      }

      if (activeSorts.size === 0) {
        const sortState = this.grid._sortState;
        if (sortState) {
          activeSorts.set(sortState.field, sortState.direction);
        }
      }

      for (const [depth, field] of depthToField) {
        if (!directions.has(depth)) {
          const dir = activeSorts.get(field);
          if (dir !== undefined) {
            directions.set(depth, dir);
          }
        }
      }
    }

    return directions.size > 0 ? directions : undefined;
  }

  // #endregion

  // #region Hooks

  /**
   * Auto-detect grouping configuration from grid config.
   * Called by plugin system to determine if plugin should activate.
   */
  static detect(rows: readonly any[], config: any): boolean {
    return (
      typeof config?.groupOn === 'function' ||
      typeof config?.enableRowGrouping === 'boolean' ||
      Array.isArray(config?.groups)
    );
  }

  /** @internal */
  override processRows(rows: readonly any[]): any[] {
    const hierarchy = this.grid?.getPluginByName?.('hierarchy');
    return hierarchy ? hierarchy.process(rows, this) : buildHierarchy(rows, [this]);
  }

  /** @internal Hierarchy contributor hook */
  beginHierarchy(_rows: readonly unknown[]): boolean {
    // Snapshot + clear deferred-expansion state at the top so any early-return
    // (no groupOn, empty rows, etc.) doesn't leave a stale `pendingExpansion`
    // behind to be (mis-)applied to the next unrelated rebuild.
    this.#pending = this.pendingExpansion;
    this.pendingExpansion = undefined;
    this.groupConfigDirty = false;
    this.#pendingApplied = false;
    this.#anyGroup = false;
    this.#renderItems = new WeakMap();
    this.#nestedParents.clear();
    this.#rootIndexOf = new WeakMap();

    // Pre-defined groups path — use external group structure instead of groupOn analysis
    if (this.preDefinedGroups.length > 0 || Array.isArray(this.config.groups)) {
      this.#mode = 'predefined';
      return true;
    }

    if (typeof this.config.groupOn !== 'function') {
      this.isActive = false;
      this.flattenedRows = [];
      this.groupedFields = [];
      return false;
    }
    this.#mode = 'groupOn';
    this.groupedFields = [];
    this.#groupSortDirections = undefined;
    this.#groupFieldsResolved = false;
    return true;
  }

  /** @internal Hierarchy contributor hook */
  processSiblings(nodes: HierarchyNode[], context: HierarchySiblingContext): HierarchyNode[] {
    const isRoot = context.parentKey === null && context.parent === null;
    if (this.#mode === 'predefined') return isRoot ? this.#preDefinedNodes(context.depth, nodes) : nodes;

    const config = this.config;
    const rows = nodes.map((node) => node.row);
    // A structure contributor has assigned occurrence keys. Namespace root groups
    // too, so a root label cannot impersonate a nested group's serialized identity.
    const scope = isRoot
      ? nodes.some((node) => node.key !== undefined)
        ? null
        : undefined
      : (context.parentKey ?? '');
    if (isRoot) this.#rootKeys.prepare(scope !== undefined, this.expandedKeys);
    const groupOnContext = { parent: context.parent, depth: context.depth };
    if (!this.#groupFieldsResolved) {
      this.#groupSortDirections = this.resolveGroupSortDirections(rows, groupOnContext);
      this.#groupFieldsResolved = this.groupedFields.length > 0;
    }
    const build = (expanded: Set<string>, initialExpanded?: Set<string>) =>
      buildGroupedRowModel({
        rows,
        config,
        expanded,
        initialExpanded,
        groupSortDirections: this.#groupSortDirections,
        context: groupOnContext,
        scope,
        nestedParents: this.#nestedParents,
        keyPaths: isRoot ? this.#rootKeys.paths : undefined,
      });

    const grouped = isRoot
      ? this.#buildRootGroups(build)
      : this.#childExpansion.build(build, config, this.expandedKeys, context.parentKey ?? '', this.#pending);
    if (!isRoot && this.#pending !== undefined) this.#pendingApplied = true;
    if (grouped.length === 0) return nodes;

    this.#anyGroup = true;
    return nestGroupRows(
      grouped,
      context.depth,
      (row, index) => nodes[index] ?? { row },
      getGroupRowCount,
      this.#renderItems,
    );
  }

  /** @internal Hierarchy contributor hook */
  endHierarchy(rows: readonly unknown[]): boolean {
    if (this.#mode === 'predefined') this.#rootOwners = computeRootOwners(rows, this.#rootIndexOf);
    return this.#finishRows(
      rows.map((row) => this.#renderItems.get(row as object) ?? { kind: 'data', row, rowIndex: -1 }),
    );
  }

  /** @internal Single-contributor shortcut; Hierarchy retains metadata ownership. */
  [FLAT_HIERARCHY](
    rows: readonly unknown[],
    meta = new WeakMap<object, HierarchyRowMeta>(),
  ): HierarchyModel | undefined {
    if (!hasDefaultHierarchyHooks(this, GroupingRowsPlugin.prototype)) return undefined;
    if (this.#mode !== 'groupOn') return undefined;
    this.#rootKeys.prepare(false, this.expandedKeys);
    const input = [...rows];
    const groupSortDirections = this.resolveGroupSortDirections(input, { parent: null, depth: 0 });
    const grouped = this.#buildRootGroups((expanded, initialExpanded) =>
      buildGroupedRowModel({
        rows: input,
        config: this.config,
        expanded,
        initialExpanded,
        groupSortDirections,
        keyPaths: this.#rootKeys.paths,
      }),
    );
    this.#anyGroup = grouped.length > 0;
    this.#finishRows(grouped);
    return { rows: this.#anyGroup ? flattenGroupRows(grouped, meta) : input, positions: meta };
  }

  #finishRows(flat: RenderRow[]): boolean {
    this.isActive = this.#anyGroup;
    this.flattenedRows = this.#anyGroup ? flat : [];
    this.previousVisibleKeys = collectVisibleRowKeys(flat, this.previousVisibleKeys, this.keysToAnimate, (item) =>
      getGroupRevealKey(item, this.grid?.effectiveConfig?.getRowId),
    );
    if (this.#mode === 'predefined' && flat.some((item) => this.#needsGroupRows(item))) this.#queueGroupRowRequests();
    if (!this.#anyGroup) {
      this.keysToAnimate.clear();
      return false;
    }

    // Notify subscribers when a deferred expansion has been applied so React/
    // host code can mirror the new state without a follow-up call. Use
    // `broadcast` so DOM listeners (`grid.addEventListener('group-toggle')`)
    // see the change too — matches the manifest contract for `group-toggle`
    // and `toggle()`'s emit pattern.
    if (this.#pendingApplied) {
      this.broadcast<GroupToggleDetail>('group-toggle', { expandedKeys: [...this.expandedKeys] });
    }

    return true;
  }

  /** Group the root rows, resolving `defaultExpanded` / a pending expansion against the fresh group keys. */
  #buildRootGroups(build: (expanded: Set<string>, initialExpanded?: Set<string>) => RenderRow[]): RenderRow[] {
    const config = this.config;
    if (
      this.#pending === undefined &&
      (this.hasAppliedDefaultExpanded || this.expandedKeys.size > 0 || config.defaultExpanded === false)
    )
      return build(this.expandedKeys);
    // First build: get structure to know all group keys
    // (needed for index-based defaultExpanded)
    const initialBuild = build(new Set());
    if (initialBuild.length === 0) return initialBuild;

    // Determine which expansion config to resolve against the *fresh* group
    // keys. A pending value (from `setGroupOn(fn, expanded)` or a deferred
    // `expandAll`/`collapseAll` after `setGroupOn`) takes priority and is
    // applied unconditionally — including the empty case (collapseAll). Falls
    // back to the first-render `defaultExpanded` resolution.
    const pendingExpansion = this.#pending;
    let expansionConfig: DefaultExpandedValue | undefined;
    const isPendingApply = pendingExpansion !== undefined;
    if (isPendingApply) {
      expansionConfig = pendingExpansion;
    } else if (!this.hasAppliedDefaultExpanded && this.expandedKeys.size === 0 && config.defaultExpanded !== false) {
      expansionConfig = config.defaultExpanded ?? false;
    }

    let initialExpanded: Set<string> | undefined;
    if (expansionConfig !== undefined) {
      const allKeys = getGroupKeys(initialBuild);
      initialExpanded = resolveDefaultExpanded(expansionConfig, allKeys);
      if (isPendingApply) {
        // Pending overrides any stale keys — apply unconditionally.
        this.expandedKeys = new Set(initialExpanded);
        this.hasAppliedDefaultExpanded = true;
      } else if (initialExpanded.size > 0) {
        this.expandedKeys = new Set(initialExpanded);
        this.hasAppliedDefaultExpanded = true;
      }
    }
    this.#pendingApplied = isPendingApply;

    // Build with proper expanded state
    return build(this.expandedKeys, initialExpanded);
  }

  /** @internal */
  override onCellClick(event: CellClickEvent): boolean | void {
    if (isControlEvent(event.originalEvent, this.gridElement)) return;
    const row = event.row as Record<string, unknown> | undefined;

    // Check if this is a group row toggle
    if (row?.__isGroupRow) {
      const target = event.originalEvent.target as HTMLElement;
      if (target?.closest(`.${GridClasses.GROUP_TOGGLE}`)) {
        // #568: claim but ignore the `dblclick` core routes here — its two clicks already toggled
        if (event.originalEvent.type === 'dblclick') return true;
        this.toggle(row.__groupKey as string);
        return true; // Prevent default
      }
    }
  }

  /** @internal */
  override onKeyDown(event: KeyboardEvent): boolean | void {
    if (isControlEvent(event, this.gridElement)) return;
    // SPACE toggles expansion on group rows
    if (event.key !== ' ') return;
    // Inputs (e.g. in a custom group renderer) own Space (#546).
    if (isFormFieldKeyTarget(event)) return;

    const focusRow = this.grid._focusRow;
    const row = this.rows[focusRow] as Record<string, unknown> | undefined;

    // Only handle SPACE on group rows
    if (!row?.__isGroupRow || row.__groupCollapsible === false) return;

    event.preventDefault();
    this.toggle(row.__groupKey as string);

    // Restore focus styling after render completes via render pipeline
    this.requestRenderWithFocus();
    return true;
  }

  /**
   * Render a row. Returns true if we handled the row (group row or loading placeholder), false otherwise.
   * @internal
   */
  override renderRow(row: any, rowEl: HTMLElement, rowIndex: number): boolean {
    this.#disclosures.syncRow(row, rowEl, rowIndex);
    // Handle loading placeholder rows for pre-defined groups
    // Uses the grid's built-in row loading API for consistent, customizable spinners
    if (row?.__loading === true && row?.__groupKey) {
      this.#metadata.release(rowEl);
      renderLoadingPlaceholderRow(this.grid, rowEl, row, rowIndex);
      return true;
    }

    // Only handle group rows
    if (!row?.__isGroupRow) {
      this.#resetRecycledGroup(rowEl);
      return false;
    }

    const config = this.config;

    // If a custom renderer is provided, use it
    if (config.groupRowRenderer) {
      const toggleExpand = () => {
        this.toggle(row.__groupKey);
      };

      const result = config.groupRowRenderer({
        key: row.__groupKey,
        value: row.__groupValue,
        depth: row.__groupDepth,
        rows: row.__groupRows,
        expanded: row.__groupExpanded,
        collapsible: row.__groupCollapsible,
        toggleExpand,
      });

      if (result) {
        this.#metadata.release(rowEl);
        this.#clearGroupRow(rowEl);
        rowEl.className = 'data-grid-row group-row';
        (rowEl as RowElementInternal).__isCustomRow = true; // Mark for proper class reset on recycle
        this.#metadata.set(rowEl, 'data-group-depth', String(row.__groupDepth));
        if (typeof result === 'string') {
          setSanitizedHTML(rowEl, result);
        } else {
          rowEl.replaceChildren(result);
        }
        indexGroupCells(rowEl, rowIndex);
        return true;
      }
    }

    // Helper to toggle expansion
    const handleToggle = () => {
      this.toggle(row.__groupKey);
    };

    // Default group row rendering - keep data-grid-row class for focus/keyboard navigation
    rowEl.className = 'data-grid-row group-row';
    (rowEl as RowElementInternal).__isCustomRow = true; // Mark for proper class reset on recycle
    if (row.__groupCollapsible === false) this.#metadata.release(rowEl);
    this.#metadata.set(rowEl, 'data-group-depth', String(row.__groupDepth));
    rowEl.setAttribute('role', 'row');
    if (row.__groupCollapsible !== false) this.#metadata.set(rowEl, 'aria-expanded', String(row.__groupExpanded));
    // Public theming hook — see also TreePlugin / MasterDetailPlugin.
    rowEl.classList.toggle('tbw-row-expanded', row.__groupCollapsible !== false && !!row.__groupExpanded);
    // Use CSS variable for depth-based indentation
    this.#metadata.set(rowEl, '--tbw-group-depth', String(row.__groupDepth || 0));
    if (config.indentWidth !== undefined) {
      this.#metadata.set(rowEl, '--tbw-group-indent-width', `${config.indentWidth}px`);
    }
    // Clear any inline height from previous use (e.g., responsive card mode sets height: auto)
    // This ensures group rows use CSS-defined height, not stale inline styles from recycled elements
    rowEl.style.height = '';
    if (!this.#disclosures.records.has(rowEl)) this.#clearGroupRow(rowEl);

    const isFullWidth = config.fullWidth !== false; // default true

    if (isFullWidth) {
      this.#rowView.renderFullWidthGroupRow(row, rowEl, handleToggle);
    } else {
      this.#rowView.renderPerColumnGroupRow(row, rowEl, handleToggle);
    }
    indexGroupCells(rowEl, rowIndex);
    this.#disclosures.update(rowEl, rowIndex);

    return true;
  }

  /** @internal */
  override afterRender(): void {
    this.#disclosures.refresh();
    this.#releaseRowMetadata(this.isActive);
    const body = this.gridElement?.querySelector('.rows') ?? null;
    const style = this.animationStyle;
    this.#reveal.reconcile(body, (element) => this.#renderedRevealKey(element), this.isActive && style !== false);
    if (!this.isActive || !body || style === false || this.keysToAnimate.size === 0) return;
    const animClass = style === 'fade' ? 'tbw-group-fade-in' : 'tbw-group-slide-in';

    for (const rowEl of body.querySelectorAll<HTMLElement>(':scope > .data-grid-row')) {
      const key = this.#renderedRevealKey(rowEl);
      if (key !== undefined && this.keysToAnimate.has(key)) {
        this.#reveal.apply(rowEl, key, animClass);
      }
    }
    this.keysToAnimate.clear();
  }

  /** @internal */
  override onScrollRender(): void {
    this.#reveal.reconcile(
      this.gridElement?.querySelector('.rows') ?? null,
      (element) => this.#renderedRevealKey(element),
      this.isActive && this.animationStyle !== false,
    );
  }

  #renderedRevealKey(element: HTMLElement): unknown {
    return getRenderedGroupRevealKey(element, this.flattenedRows, this.grid?.effectiveConfig?.getRowId);
  }
  // #endregion

  // #region Pre-Defined Groups

  /**
   * Build the root nodes from pre-defined group definitions.
   * Used when `groups` config or `setGroups()` provides external group structure.
   *
   * ServerSide-fed (#538): the root list is node-indexed — a loaded definition, or the
   * ServerSide placeholder `input` holds for an unloaded node, so unloaded groups take up
   * scroll space and scrolling to them maps (`datasource:viewport-mapping`) onto their
   * block. `input` is authoritative: a definition ServerSide no longer lists (its block was
   * purged) does not render — see `buildRootSlots`.
   */
  #preDefinedNodes(baseDepth: number, input: readonly HierarchyNode[]): HierarchyNode[] {
    const active = this.getActiveGroups();
    const { slots, groups } = this.#serverFed
      ? buildRootSlots(this.#nodeGroups, input)
      : { slots: active, groups: active };
    if (slots.length === 0) return [];

    // Resolve defaultExpanded on first render only. A numeric index waits until every
    // definition before it has loaded (blocks may land out of order, #538). Server-fed, the
    // default resolves against the LOADED definitions, never the rendered `slots`/`groups`: a
    // local filter hides a definition without unloading it, and must not stall or shift a
    // numeric index, nor leave a hidden group out of `true` (the default resolves only once).
    const defaultExpanded = this.config.defaultExpanded ?? false;
    if (!this.hasAppliedDefaultExpanded && this.expandedKeys.size === 0 && defaultExpanded !== false) {
      // Not server-fed: `slots` === `groups`, unfiltered.
      const loaded = !this.#serverFed
        ? groups
        : typeof defaultExpanded === 'number'
          ? leadingGroups(this.#nodeGroups)
          : this.preDefinedGroups;
      const allKeys = collectGroupKeys(loaded);
      const initialExpanded = resolveDefaultExpanded(defaultExpanded, allKeys);
      if (initialExpanded.size > 0) {
        this.expandedKeys = new Set(initialExpanded);
        this.hasAppliedDefaultExpanded = true;
      }
    }

    const grouped = buildPreDefinedGroupModel({
      groups,
      expanded: this.expandedKeys,
      groupRows: this.groupRowsMap,
      loadingGroups: this.loadingGroups,
    });
    // Prefer the server-reported row count over the loaded rows.
    this.#anyGroup = true;
    const groupNodes = nestGroupRows(
      grouped,
      baseDepth,
      (row) => ({ row }),
      (item) => findGroupDefinition(groups, item.key)?.rowCount ?? item.rows.length,
      this.#renderItems,
    );
    return interleaveRootNodes(slots, groupNodes, this.#rootIndexOf);
  }

  /**
   * Get the active group definitions (pre-defined or empty).
   */
  private getActiveGroups(): GroupDefinition[] {
    if (this.preDefinedGroups.length > 0) return this.preDefinedGroups;
    return Array.isArray(this.config.groups) ? this.config.groups : [];
  }
  // #endregion

  // #region Private Rendering Helpers

  #resetRecycledGroup(rowEl: HTMLElement): void {
    if (!(rowEl as RowElementInternal).__isCustomRow || !rowEl.classList.contains('group-row')) return;
    this.#clearGroupRow(rowEl);
    this.#metadata.release(rowEl);
  }

  #releaseRowMetadata(detachedOnly = false): void {
    for (const element of this.#metadata.elements) {
      if (detachedOnly && this.gridElement.contains(element)) continue;
      if (this.#metadata.owns(element, 'data-group-depth') && element.classList.contains('group-row')) {
        this.#clearGroupRow(element);
      }
      this.#metadata.release(element);
    }
  }

  #clearGroupRow(rowEl: HTMLElement): void {
    this.grid.__frameworkAdapter?.beginBatch?.();
    try {
      for (const cell of Array.from(rowEl.children)) releaseCell(this.grid, cell as HTMLElement);
      rowEl.replaceChildren();
    } finally {
      this.grid.__frameworkAdapter?.endBatch?.();
    }
  }

  #rowView: GroupRowView = new GroupRowView({
    config: () => this.config,
    columns: () => this.columns,
    gridElement: () => this.gridElement,
    disclosures: this.#disclosures,
    label: (expanded) => this.#disclosureLabel(expanded),
    setIcon: (element, icon) => this.setIcon(element, icon),
  });

  #disclosureLabel(expanded: boolean): string {
    return this.config.disclosureLabel?.(expanded) ?? (expanded ? 'Collapse group' : 'Expand group');
  }

  #disclosureState(rowIndex: number): Omit<GroupingRowsDisclosureContext, 'host' | 'setExpanded'> | undefined {
    const group = this.flattenedRows[rowIndex];
    if (group?.kind !== 'group' || group.collapsible === false || this.groupConfigDirty) return;
    const expanded = this.isExpanded(group.key);
    return {
      grid: this.grid as PublicGrid & HTMLElement,
      key: group.key,
      value: group.value,
      depth: group.depth,
      rows: group.rows,
      rowCount: findGroupDefinition(this.getActiveGroups(), group.key)?.rowCount ?? group.rows.length,
      ariaLabel: this.#disclosureLabel(expanded),
      expanded,
      // Loading does not disable native group collapse; retain that policy.
      disabled: false,
    };
  }

  // #endregion

  // #region Public API

  /** Replace disclosure controls without resetting groups or expansion. @since 3.9.0 */
  setDisclosureRenderer(renderer: GroupingRowsConfig['disclosureRenderer']): void {
    if (this.config.disclosureRenderer === renderer) return;
    const hadRenderer = !!this.config.disclosureRenderer;
    this.config.disclosureRenderer = this.userConfig.disclosureRenderer = renderer;
    if (hadRenderer) this.requestAfterRender();
    else this.requestRender();
  }

  /**
   * Expand all groups.
   *
   * Safe to call immediately after {@link setGroupOn}: when the grouping
   * config has just changed, the cached `flattenedRows` is stale, so the
   * call defers until the next render rebuilds the group model against the
   * new `groupOn` (issue #335). The `group-toggle` event is emitted once
   * the new keys are known.
   *
   * With `ServerSidePlugin` active, every newly expanded pre-defined group
   * requests its rows via `getChildRows()` after the next render (#534).
   */
  expandAll(): void {
    if (this.groupConfigDirty) {
      // flattenedRows is stale — defer until processRows rebuilds it. Clear
      // the cached set so callers don't observe stale keys via
      // `getExpandedGroups()` between this call and the next render.
      this.pendingExpansion = true;
      this.expandedKeys = new Set();
      this.requestRender();
      return;
    }
    this.expandedKeys = new Set([...this.expandedKeys].filter((key) => this.#isFixedGroup(key)));
    for (const key of expandAllGroups(this.flattenedRows)) {
      this.expandedKeys.add(key);
      this.#requestedKeys.delete(key);
    }
    this.broadcast<GroupToggleDetail>('group-toggle', { expandedKeys: [...this.expandedKeys] });
    this.requestRender();
  }

  /**
   * Collapse all groups.
   *
   * Safe to call immediately after {@link setGroupOn}: defers until the next
   * render rebuilds the group model so the collapse targets the new groups
   * rather than a stale snapshot (issue #335).
   */
  collapseAll(): void {
    if (this.groupConfigDirty) {
      this.pendingExpansion = false;
      this.expandedKeys = new Set();
      this.requestRender();
      return;
    }
    this.expandedKeys = new Set([...this.expandedKeys].filter((key) => this.#isFixedGroup(key)));
    this.broadcast<GroupToggleDetail>('group-toggle', { expandedKeys: [...this.expandedKeys] });
    this.requestRender();
  }

  /**
   * Toggle expansion of a specific group.
   * In accordion mode, expanding a group will collapse all sibling groups.
   * @param key - The group key to toggle
   */
  toggle(key: string): void {
    if (this.#isFixedGroup(key)) return;
    const isExpanding = !this.expandedKeys.has(key);
    const config = this.config;

    // Find the group to get its depth for accordion mode
    const group = this.flattenedRows.find((r) => r.kind === 'group' && r.key === key) as GroupRowModelItem | undefined;
    const accordion =
      typeof config.accordion === 'function' ? !!group && config.accordion(group.depth) : config.accordion;

    // In accordion mode, collapse sibling groups when expanding
    if (accordion && isExpanding && group) {
      this.expandedKeys = this.#nestedParents.has(key)
        ? collapseScopedPeers(this.expandedKeys, key, this.#nestedParents)
        : collapseUnscopedPeers(this.expandedKeys, key, group.depth, this.flattenedRows);
      this.expandedKeys.add(key);
    } else {
      this.expandedKeys = toggleGroupExpansion(this.expandedKeys, key);
    }

    this.broadcast<GroupToggleDetail>('group-toggle', {
      key,
      expanded: this.expandedKeys.has(key),
      value: group?.value,
      depth: group?.depth ?? 0,
      expandedKeys: [...this.expandedKeys],
    });

    this.#notifyPreDefinedToggle(key, isExpanding);

    // Announce group state change for screen readers
    const expanded = this.expandedKeys.has(key);
    const groupName = group?.value != null ? String(group.value) : key;
    if (expanded) {
      const rowCount = group?.rows?.length ?? 0;
      announce(this.gridElement, getA11yMessage(this.gridElement, 'groupExpanded', groupName, rowCount));
    } else {
      announce(this.gridElement, getA11yMessage(this.gridElement, 'groupCollapsed', groupName));
    }

    this.requestRender();
  }

  #notifyPreDefinedToggle(key: string, isExpanding: boolean): void {
    const activeGroups = this.getActiveGroups();
    if (activeGroups.length > 0) {
      const groupPath = getGroupPath(activeGroups, key);
      if (isExpanding) {
        this.emit<GroupExpandDetail>('group-expand', { groupKey: key, groupPath });

        // Request child rows via unified DataSource if not already cached or in flight
        if (!this.groupRowsMap.has(key)) {
          const groupDef = findGroupDefinition(activeGroups, key);
          if (groupDef) this.#requestGroupRows(key, groupDef, groupPath);
        }
      } else {
        this.emit<GroupCollapseDetail>('group-collapse', { groupKey: key, groupPath });
      }
    }
  }

  /**
   * Check if a specific group is expanded.
   * @param key - The group key to check
   * @returns Whether the group is expanded
   */
  isExpanded(key: string): boolean {
    return this.#isFixedGroup(key) || this.expandedKeys.has(key);
  }

  #isFixedGroup(key: string): boolean {
    return (
      this.config.childGroupsCollapsible === false &&
      this.#mode === 'groupOn' &&
      this.#childExpansion.fixedKeys.has(key)
    );
  }

  /**
   * Expand a specific group.
   * With `ServerSidePlugin` active, an expanded pre-defined group without rows requests
   * them via `getChildRows()` after the next render, like {@link toggle}.
   * @param key - The group key to expand
   */
  expand(key: string): void {
    this.#setGroupExpanded(key, true);
  }

  /**
   * Collapse a specific group.
   * @param key - The group key to collapse
   */
  collapse(key: string): void {
    this.#setGroupExpanded(key, false);
  }

  #setGroupExpanded(key: string, expanded: boolean): void {
    if (this.#isFixedGroup(key) || this.expandedKeys.has(key) === expanded) return;
    const keys = new Set(this.expandedKeys);
    if (expanded) {
      keys.add(key);
      this.#requestedKeys.delete(key);
    } else keys.delete(key);
    this.expandedKeys = keys;
    this.requestRender();
  }

  /**
   * Get the current group state.
   * @returns Group state information
   */
  getGroupState(): GroupState {
    const groupRows = this.flattenedRows.filter((r) => r.kind === 'group');
    return {
      isActive: this.isActive,
      expandedCount: this.expandedKeys.size,
      totalGroups: groupRows.length,
      expandedKeys: [...this.expandedKeys],
    };
  }

  /**
   * Get the total count of visible rows (including group headers).
   * @returns Number of visible rows
   */
  getRowCount(): number {
    return this.flattenedRows.length;
  }

  /**
   * Refresh the grouped row model.
   * Call this after modifying groupOn or other config options.
   */
  refreshGroups(): void {
    this.requestRender();
  }

  /**
   * Get current expanded group keys.
   * @returns Array of expanded group keys
   */
  getExpandedGroups(): string[] {
    return [...this.expandedKeys];
  }

  /**
   * Get the flattened row model.
   * @returns Array of render rows (groups + data rows)
   */
  getFlattenedRows(): RenderRow[] {
    return this.flattenedRows;
  }

  /**
   * Check if grouping is currently active.
   * @returns Whether grouping is active
   */
  isGroupingActive(): boolean {
    return this.isActive;
  }

  /**
   * Set the groupOn function dynamically.
   *
   * Optionally specify the initial expansion state to apply against the new
   * group set. Without it, the previous `expandedKeys` are kept (and most
   * likely won't match the new keys, so groups land collapsed). With it,
   * the new groups are expanded synchronously on the next render — no need
   * to chain `setGroupOn(fn); expandAll()` or wait for `requestAnimationFrame`.
   *
   * If you do call `expandAll()` / `collapseAll()` separately right after
   * `setGroupOn`, those calls automatically defer to the same mechanism so
   * they target the new groups rather than the stale snapshot. See issue #335.
   *
   * @param fn - The groupOn function or undefined to disable
   * @param expanded - Optional initial expansion for the new grouping:
   *   - `true`: expand all new groups
   *   - `false`: collapse all new groups
   *   - `string` / `string[]`: expand specific group key(s)
   *   - `number`: expand the group at this index
   *   When omitted, existing `expandedKeys` are preserved (legacy behavior).
   *
   * @example Group by a new field and expand everything
   * ```ts
   * plugin.setGroupOn((row) => row.counterparty, true);
   * ```
   *
   * @example Group by a new field but keep all groups collapsed
   * ```ts
   * plugin.setGroupOn((row) => row.region, false);
   * ```
   */
  setGroupOn(fn: GroupingRowsConfig['groupOn'], expanded?: DefaultExpandedValue): void {
    this.#disclosures.releaseAll();
    (this.config as GroupingRowsConfig).groupOn = fn;
    this.groupConfigDirty = true;
    if (expanded !== undefined) {
      this.pendingExpansion = expanded;
      this.expandedKeys = new Set();
      this.hasAppliedDefaultExpanded = false;
    }
    this.requestRender();
  }

  /**
   * Replace or clear category ordering without resetting group expansion.
   * Identical callback references are a no-op. Other configuration and selection
   * retain their existing ownership; category values and group keys are unchanged.
   *
   * @param groupOrder - Scoped ordering callback, or undefined for normal ordering
   * @since 3.9.0
   */
  setGroupOrder(groupOrder: GroupingRowsConfig['groupOrder']): void {
    if (this.config.groupOrder === groupOrder) return;
    this.config.groupOrder = groupOrder;
    this.requestRender();
  }

  /** Replace admitted empty group paths without resetting expansion. @since 3.10.0 */
  setEmptyGroups(emptyGroups: GroupingRowsConfig['emptyGroups']): void {
    if (this.config.emptyGroups === emptyGroups) return;
    this.config.emptyGroups = emptyGroups;
    this.requestRender();
  }

  // --- Pre-defined group API ---

  /**
   * Replace auto-detected groups with an externally provided group structure.
   *
   * When groups are set, the plugin switches to pre-defined mode — `groupOn`
   * is ignored and the plugin renders the provided group headers instead.
   * Row data for each group must be populated via {@link setGroupRows}.
   *
   * @param groups - Array of group definitions, or empty array to clear
   */
  setGroups(groups: GroupDefinition[]): void {
    this.#disclosures.releaseAll();
    this.#resetServerGroups();
    this.preDefinedGroups = groups;
    this.groupRowsMap.clear();
    this.#abortGroupLoads();
    this.#requestedKeys.clear();
    this.loadingGroups.clear();
    this.expandedKeys.clear();
    this.hasAppliedDefaultExpanded = false;
    this.requestRender();
  }

  /**
   * Get the current pre-defined group structure.
   *
   * Returns the groups set via {@link setGroups}, received from `datasource:data`,
   * or the `groups` config array. Returns an empty array when using `groupOn`-based grouping.
   *
   * @returns Current group definitions
   */
  getGroups(): GroupDefinition[] {
    if (this.preDefinedGroups.length > 0) return [...this.preDefinedGroups];
    return Array.isArray(this.config.groups) ? [...this.config.groups] : [];
  }

  /**
   * Populate row data for an expanded group.
   *
   * Call this in response to a `group-expand` event after fetching rows
   * from the server. The plugin will re-render to show the rows.
   *
   * When `ServerSidePlugin` is loaded, this is handled automatically via
   * `datasource:children` events — you only need this for the imperative API.
   *
   * @param groupKey - The group key to populate
   * @param rows - The row data for this group
   */
  setGroupRows(groupKey: string, rows: unknown[]): void {
    this.#abortGroupLoads(groupKey);
    this.groupRowsMap.set(groupKey, rows);
    this.loadingGroups.delete(groupKey);
    this.requestRender();
  }

  /**
   * Toggle loading indicator for a group.
   *
   * When loading is true, the group shows a loading spinner instead of row data.
   * Call with `false` after rows are loaded (also cleared by {@link setGroupRows}).
   *
   * @param groupKey - The group key
   * @param loading - Whether the group is loading
   */
  setGroupLoading(groupKey: string, loading: boolean): void {
    if (loading) {
      this.loadingGroups.add(groupKey);
    } else {
      this.loadingGroups.delete(groupKey);
    }
    this.requestRender();
  }

  /**
   * Clear cached row data for one or all groups.
   *
   * Use when the server data has changed and groups need to be re-fetched
   * on next expand. Also cancels any in-flight ServerSide fetch for the
   * cleared groups, so a stale response cannot repopulate them.
   *
   * @param groupKey - Specific group key to clear, or omit to clear all
   */
  clearGroupRows(groupKey?: string): void {
    this.#abortGroupLoads(groupKey);
    if (groupKey != null) {
      this.groupRowsMap.delete(groupKey);
    } else {
      this.groupRowsMap.clear();
    }
    this.requestRender();
  }
  // #endregion
}
