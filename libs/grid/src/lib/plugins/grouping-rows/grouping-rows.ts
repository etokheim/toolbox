/**
 * Row Grouping Core Logic
 *
 * Grouped row models, aggregations and render identity helpers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  DefaultExpandedValue,
  GroupDefinition,
  GroupingRowsConfig,
  GroupOnContext,
  GroupRowModelItem,
  RenderRow,
} from './types';
import type { HierarchyNode, HierarchyRowMeta } from '../hierarchy/types';
import { tryResolveRowId } from '../../core/internal/row-manager';

/** @internal Collect expansion keys without plugin state. */
export function collectPreDefinedGroupKeys(groups: GroupDefinition[]): string[] {
  const keys: string[] = [];
  for (const group of groups) {
    keys.push(group.key);
    if (group.children?.length) keys.push(...collectPreDefinedGroupKeys(group.children));
  }
  return keys;
}

/** @internal Keep handled group cells indexed for current projection lookups. */
export function indexGroupCells(rowEl: HTMLElement, index: number): void {
  const value = String(index);
  rowEl.querySelectorAll(':scope > .cell').forEach((cell) => {
    cell.setAttribute('data-row', value);
  });
}

/** @internal Structural and data occurrences have independent identity namespaces. */
export function getGroupRevealKey(item: RenderRow, getRowId?: (row: unknown) => string): unknown {
  if (item.kind === 'group') return `group:${item.key}`;
  if (item.row === null || typeof item.row !== 'object') return item.row;
  const id = tryResolveRowId(item.row, getRowId);
  return id === undefined ? item.row : `data:${id}`;
}

/** @internal Resolve current projection ownership, never a recycled data-group-key. */
export function getRenderedGroupRevealKey(
  element: HTMLElement,
  rows: readonly RenderRow[],
  getRowId?: (row: unknown) => string,
): unknown {
  const index = Number(element.querySelector(':scope > .cell[data-row]')?.getAttribute('data-row') ?? -1);
  const item = rows[index];
  return item ? getGroupRevealKey(item, getRowId) : undefined;
}

/** Context for the root row list (no parent). */
const ROOT_CONTEXT: GroupOnContext = { parent: null, depth: 0 };

/** @internal Preserve root expansion when adding/removing a structure contributor. */
export class RootGroupKeys {
  readonly paths = new Map<string, string[]>();
  #scoped = false;

  prepare(scoped: boolean, expanded: Set<string>): void {
    if (scoped !== this.#scoped) {
      const open = [...this.paths.values()].filter((path) => expanded.has(this.#key(path)));
      for (const path of this.paths.values()) expanded.delete(this.#key(path));
      this.#scoped = scoped;
      for (const path of open) expanded.add(this.#key(path));
    }
    this.paths.clear();
  }

  #key(path: string[]): string {
    return this.#scoped ? JSON.stringify([null, path]) : path.join('||');
  }
}

/** @internal Shared structural header shape for flat and composed models. */
export function createGroupRow(item: GroupRowModelItem, depth = item.depth, count = getGroupRowCount(item)) {
  return {
    __isGroupRow: true,
    __groupKey: item.key,
    __groupValue: item.value,
    __groupDepth: depth,
    __groupRows: item.rows,
    __groupExpanded: item.expanded,
    __groupCollapsible: item.collapsible,
    __groupRowCount: count,
    __rowCacheKey: `group:${item.key}`,
  };
}

/** @internal Re-nest the visible group model for composition with natural children. */
export function nestGroupRows(
  flat: RenderRow[],
  baseDepth: number,
  dataNode: (row: unknown, index: number) => HierarchyNode,
  rowCount: (item: GroupRowModelItem) => number,
  renderItems: WeakMap<object, RenderRow>,
): HierarchyNode[] {
  const roots: HierarchyNode[] = [];
  const open: HierarchyNode[] = [];
  for (const item of flat) {
    if (item.kind === 'data') {
      const node = dataNode(item.row, item.rowIndex);
      (open.length > 0 ? (open[open.length - 1].children as HierarchyNode[]) : roots).push(node);
      if (typeof item.row === 'object' && item.row !== null) renderItems.set(item.row, item);
      continue;
    }
    const groupItem: GroupRowModelItem = baseDepth === 0 ? item : { ...item, depth: baseDepth + item.depth };
    const row = createGroupRow(item, groupItem.depth, rowCount(item));
    renderItems.set(row, groupItem);
    const node: HierarchyNode = { row, key: item.key, expanded: item.expanded, shaped: true, children: [] };
    open.length = item.depth;
    (item.depth > 0 ? (open[item.depth - 1].children as HierarchyNode[]) : roots).push(node);
    open.push(node);
  }
  return roots;
}

/** @internal Preserve an already-flat group model without a second node graph. */
export function flattenGroupRows(flat: readonly RenderRow[], meta: WeakMap<object, HierarchyRowMeta>): unknown[] {
  const parents = new Array<number>(flat.length);
  const stack: number[] = [];
  const counts = new Map<number, number>();
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i];
    if (item.kind === 'group') stack.length = item.depth;
    const parent = stack.at(-1) ?? -1;
    parents[i] = parent;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
    if (item.kind === 'group') stack.push(i);
  }
  const positions = new Map<number, number>();
  return flat.map((item, i) => {
    const parent = parents[i];
    const parentItem = flat[parent];
    const level = item.kind === 'group' ? item.depth + 1 : parentItem?.kind === 'group' ? parentItem.depth + 2 : 1;
    const posInSet = (positions.get(parent) ?? 0) + 1;
    positions.set(parent, posInSet);
    const row = item.kind === 'group' ? createGroupRow(item) : item.row;
    if (typeof row === 'object' && row !== null) {
      const setSize = counts.get(parent);
      if (setSize === undefined) throw new Error('Missing sibling count for a grouped row');
      meta.set(row, { level, setSize, posInSet });
    }
    return row;
  });
}

/** @internal Compare logical occurrences, including structural headers, across projections. */
export function collectVisibleRowKeys(
  flat: readonly RenderRow[],
  previous: ReadonlySet<unknown>,
  newlyVisible: Set<unknown>,
  keyOf: (item: RenderRow) => unknown,
): Set<unknown> {
  newlyVisible.clear();
  const current = new Set<unknown>();
  for (const item of flat) {
    const key = keyOf(item);
    current.add(key);
    if (!previous.has(key)) newlyVisible.add(key);
  }
  return current;
}

interface GroupNode {
  key: string; // composite key
  path: string[];
  value: any;
  depth: number;
  rows: any[];
  children: Map<string, GroupNode>;
  parent?: GroupNode;
}

interface BuildGroupingArgs {
  rows: any[];
  config: GroupingRowsConfig;
  expanded: Set<string>;
  /** Initial expanded state to apply (processed by the plugin) */
  initialExpanded?: Set<string>;
  /** Sort direction per group depth level. 1 = ascending, -1 = descending.
   *  When omitted, groups at all levels sort ascending. */
  groupSortDirections?: Map<number, 1 | -1>;
  /** Passed to `groupOn` as its second argument (default: the root list). */
  context?: GroupOnContext;
  /** Parent occurrence identity for collision-free nested group keys. */
  scope?: string | null;
  /** Structural ancestry, independent of the serialized key format. */
  nestedParents?: Map<string, { scope: string | null; parent: string | null }>;
  keyPaths?: Map<string, string[]>;
}

/**
 * Build a flattened grouping projection (collapsed by default).
 * Returns empty array when groupOn not configured or all rows ungrouped.
 *
 * @param args - The grouping arguments
 * @returns Flattened array of render rows (groups + data rows)
 */
export function buildGroupedRowModel({
  rows,
  config,
  expanded,
  initialExpanded,
  groupSortDirections,
  context = ROOT_CONTEXT,
  scope,
  nestedParents,
  keyPaths,
}: BuildGroupingArgs): RenderRow[] {
  const groupOn = config.groupOn;
  if (typeof groupOn !== 'function') {
    return [];
  }

  const root: GroupNode = { key: '__root__', path: [], value: null, depth: -1, rows: [], children: new Map() };

  for (const path of config.emptyGroups?.(context) ?? []) {
    if (!path.length || path.some((segment) => typeof segment !== 'string' || segment === '__ungrouped__')) {
      throw new Error('emptyGroups requires nonempty string paths without the reserved __ungrouped__ segment');
    }
    let parent = root;
    for (let depth = 0; depth < path.length; depth++) {
      const value = path[depth];
      let node = parent.children.get(value);
      if (!node) {
        const segments = [...parent.path, value];
        const key = scope === undefined ? segments.join('||') : JSON.stringify([scope, segments]);
        node = { key, path: segments, value, depth, rows: [], children: new Map(), parent };
        parent.children.set(value, node);
        keyPaths?.set(JSON.stringify(segments), segments);
        if (scope !== undefined) nestedParents?.set(key, { scope, parent: parent === root ? null : parent.key });
      }
      parent = node;
    }
  }

  // Build tree structure — push each row into every ancestor along the path
  // so that each group's `rows` array contains ALL data rows in its subtree.
  // This is required for correct counts and aggregations on multi-level groups.
  rows.forEach((r) => {
    let path: any = groupOn(r, context);
    if (path == null || path === false) path = ['__ungrouped__'];
    else if (!Array.isArray(path)) path = [path];

    let parent = root;
    path.forEach((rawVal: any, depthIdx: number) => {
      const seg = rawVal == null ? '∅' : String(rawVal);
      let node = parent.children.get(seg);
      if (!node) {
        const path = [...parent.path, seg];
        const composite =
          scope === undefined ? (parent === root ? seg : parent.key + '||' + seg) : JSON.stringify([scope, path]);
        node = { key: composite, path, value: rawVal, depth: depthIdx, rows: [], children: new Map(), parent };
        keyPaths?.set(JSON.stringify(path), path);
        parent.children.set(seg, node);
        if (scope !== undefined) nestedParents?.set(composite, { scope, parent: parent === root ? null : parent.key });
      }
      node.rows.push(r);
      parent = node;
    });
  });

  // All ungrouped? treat as no grouping
  if (root.children.size === 1 && root.children.has('__ungrouped__')) {
    const only = root.children.get('__ungrouped__')!;
    if (only.rows.length === rows.length) return [];
  }

  // Pre-build row→index map for O(1) lookups (avoids O(n²) from rows.indexOf)
  const rowIndexMap = new Map<any, number>();
  for (let i = 0; i < rows.length; i++) {
    rowIndexMap.set(rows[i], i);
  }

  // Merge expanded sets - use initialExpanded on first render, then expanded takes over
  const effectiveExpanded = initialExpanded ? new Set([...expanded, ...initialExpanded]) : expanded;
  const fixed = config.childGroupsCollapsible === false && context.parent !== null;

  const order = config.groupOrder?.(context);
  const groupRanks = order?.length ? new Map<string, number>() : undefined;
  if (order && groupRanks) {
    for (const value of order) if (!groupRanks.has(value)) groupRanks.set(value, groupRanks.size);
  }

  // Sort sibling groups by their group value so that group header order is
  // deterministic and respects the active sort direction for each depth level.
  // Default: ascending. When a user sorts a grouped column, the corresponding
  // depth level's direction flips, keeping groups in predictable order.
  const sortedChildren = (node: GroupNode): GroupNode[] => {
    const children = [...node.children.values()];
    // Determine direction for this depth level (children are one level deeper than the node)
    const childDepth = node === root ? 0 : node.depth + 1;
    const dir = groupSortDirections?.get(childDepth) ?? 1;
    children.sort((a, b) => {
      if (groupRanks) {
        const rank =
          (groupRanks.get(a.path[a.depth]) ?? groupRanks.size) - (groupRanks.get(b.path[b.depth]) ?? groupRanks.size);
        if (rank !== 0) return rank;
      }
      const av = a.value;
      const bv = b.value;
      if (av == null && bv == null) return 0;
      if (av == null) return dir;
      if (bv == null) return -dir;
      return av > bv ? dir : av < bv ? -dir : 0;
    });
    return children;
  };

  // Flatten tree to array
  const flat: RenderRow[] = [];
  const visit = (node: GroupNode) => {
    if (node === root) {
      for (const c of sortedChildren(node)) visit(c);
      return;
    }

    const isExpanded = fixed || effectiveExpanded.has(node.key);
    flat.push({
      kind: 'group',
      key: node.key,
      value: node.value,
      depth: node.depth,
      rows: node.rows,
      expanded: isExpanded,
      ...(fixed ? { collapsible: false } : {}),
    });

    if (isExpanded) {
      if (node.children.size) {
        for (const c of sortedChildren(node)) visit(c);
      } else {
        node.rows.forEach((r) => flat.push({ kind: 'data', row: r, rowIndex: rowIndexMap.get(r) ?? -1 }));
      }
    }
  };
  visit(root);

  return flat;
}

/**
 * Discover which column field produces the group value at each depth level.
 *
 * Samples the first grouped row's `groupOn` output to get the group path, then checks
 * which column fields produce matching values for that row. This mapping allows
 * the plugin to apply user-invoked column sort directions to the correct group
 * depth levels.
 *
 * @param context - Passed to `groupOn` (default: the root list).
 * @returns Map from depth index to column field name, or empty map if unmappable
 */
export function resolveGroupFields(
  rows: any[],
  groupOn: NonNullable<GroupingRowsConfig['groupOn']>,
  columnFields: string[],
  context: GroupOnContext = ROOT_CONTEXT,
): Map<number, string> {
  const depthToField = new Map<number, string>();
  let sampleRow: any;
  let path: any = null;
  for (const row of rows) {
    path = groupOn(row, context);
    if (path != null && path !== false) {
      sampleRow = row;
      break;
    }
  }
  if (sampleRow === undefined) return depthToField;
  if (!Array.isArray(path)) path = [path];

  for (let depth = 0; depth < path.length; depth++) {
    const groupValue = path[depth];
    for (const field of columnFields) {
      if (sampleRow[field] === groupValue) {
        depthToField.set(depth, field);
        break;
      }
    }
  }
  return depthToField;
}

/**
 * Toggle expansion state for a group key.
 *
 * @param expandedKeys - Current set of expanded keys
 * @param key - The group key to toggle
 * @returns New set with toggled state
 */
export function toggleGroupExpansion(expandedKeys: Set<string>, key: string): Set<string> {
  const newSet = new Set(expandedKeys);
  if (newSet.has(key)) {
    newSet.delete(key);
  } else {
    newSet.add(key);
  }
  return newSet;
}

/** @internal Preserve legacy standalone accordion ancestry and depth rules. */
export function collapseUnscopedPeers(
  expandedKeys: ReadonlySet<string>,
  key: string,
  depth: number,
  rows: readonly RenderRow[],
): Set<string> {
  const retained = new Set<string>();
  for (const existingKey of expandedKeys) {
    if (key.startsWith(existingKey + '||')) {
      retained.add(existingKey);
      continue;
    }
    if (existingKey.startsWith(key + '||')) continue;
    const group = rows.find((row): row is GroupRowModelItem => row.kind === 'group' && row.key === existingKey);
    if (group && group.depth !== depth) retained.add(existingKey);
  }
  return retained;
}

/** Collapse only peers of a scoped group and their descendants; retain other parents' state. */
export function collapseScopedPeers(
  expandedKeys: Set<string>,
  key: string,
  parents: ReadonlyMap<string, { scope: string | null; parent: string | null }>,
): Set<string> {
  const result = new Set(expandedKeys);
  const target = parents.get(key);
  if (!target) return result;
  for (const expanded of expandedKeys) {
    let candidate = expanded;
    let meta = parents.get(candidate);
    if (meta?.scope !== target.scope) continue;
    while (meta && meta.parent !== target.parent && meta.parent !== null) {
      candidate = meta.parent;
      meta = parents.get(candidate);
    }
    if (meta?.parent === target.parent && candidate !== key) result.delete(expanded);
  }
  return result;
}

/**
 * Expand all groups.
 *
 * @param rows - The flattened render rows
 * @returns Set of all group keys
 */
export function expandAllGroups(rows: RenderRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'group') {
      keys.add(row.key);
    }
  }
  return keys;
}

/**
 * Collapse all groups.
 *
 * @returns Empty set
 */
export function collapseAllGroups(): Set<string> {
  return new Set();
}

/**
 * Resolve a defaultExpanded value to a set of keys to expand.
 * This needs to be called AFTER building the group model to get all keys.
 *
 * Note: `plugins/pivot/pivot-engine.ts` has a same-named function with the
 * opposite `undefined` default (expand-all). See the comment there.
 *
 * @param value - The defaultExpanded config value
 * @param allGroupKeys - All group keys from the model
 * @returns Set of keys to expand initially
 */
export function resolveDefaultExpanded(value: DefaultExpandedValue, allGroupKeys: string[]): Set<string> {
  if (value === true) {
    // Expand all groups
    return new Set(allGroupKeys);
  }
  if (value === false || value == null) {
    // Collapse all groups
    return new Set();
  }
  if (typeof value === 'number') {
    // Expand group at this index
    const key = allGroupKeys[value];
    return key ? new Set([key]) : new Set();
  }
  if (typeof value === 'string') {
    // Expand group with this key
    return new Set([value]);
  }
  if (Array.isArray(value)) {
    // Expand groups with these keys
    return new Set(value);
  }
  return new Set();
}

/**
 * Get all group keys from a flattened model.
 *
 * @param rows - The flattened render rows
 * @returns Array of group keys
 */
export function getGroupKeys(rows: RenderRow[]): string[] {
  return rows.filter((r): r is GroupRowModelItem => r.kind === 'group').map((r) => r.key);
}

/**
 * Count total rows in a group (including nested groups).
 *
 * @param groupRow - The group row
 * @returns Total row count
 */
export function getGroupRowCount(groupRow: RenderRow): number {
  if (groupRow.kind !== 'group') return 0;
  return groupRow.rows.length;
}

// #region Pre-Defined Group Model

interface PreDefinedGroupModelArgs {
  groups: GroupDefinition[];
  expanded: Set<string>;
  groupRows: Map<string, unknown[]>;
  loadingGroups: Set<string>;
  parentPath?: string[];
}

/**
 * Build a flattened render model from pre-defined group definitions.
 *
 * Unlike `buildGroupedRowModel`, this does not analyze row data — groups
 * are provided externally (e.g. from a server). Row data for each group
 * is populated lazily via the `groupRows` map.
 *
 * @param args - Pre-defined grouping arguments
 * @returns Flattened array of render rows (groups + data rows)
 */
export function buildPreDefinedGroupModel({
  groups,
  expanded,
  groupRows,
  loadingGroups,
  parentPath = [],
}: PreDefinedGroupModelArgs): RenderRow[] {
  const flat: RenderRow[] = [];
  const depth = parentPath.length;

  for (const group of groups) {
    const currentPath = [...parentPath, group.key];
    const isExpanded = expanded.has(group.key);
    const rows = groupRows.get(group.key) ?? [];
    const isLoading = loadingGroups.has(group.key);

    flat.push({
      kind: 'group',
      key: group.key,
      value: group.value,
      depth,
      rows,
      expanded: isExpanded,
    });

    if (isExpanded) {
      // Nested child groups take priority over leaf rows
      if (group.children?.length) {
        const childRows = buildPreDefinedGroupModel({
          groups: group.children,
          expanded,
          groupRows,
          loadingGroups,
          parentPath: currentPath,
        });
        flat.push(...childRows);
      } else if (isLoading) {
        // Loading placeholder — rendered by the plugin as a loading indicator
        flat.push({ kind: 'data', row: { __loading: true, __groupKey: group.key }, rowIndex: -1 });
      } else {
        // Leaf rows from the groupRows map
        rows.forEach((row, idx) => {
          flat.push({ kind: 'data', row, rowIndex: idx });
        });
      }
    }
  }

  return flat;
}

/**
 * Compute the group path (array of ancestor keys) for a given group key
 * within a pre-defined group structure.
 *
 * @param groups - The group definitions to search
 * @param targetKey - The key to find
 * @param parentPath - Accumulated path (used for recursion)
 * @returns Array of group keys from root to target, or empty array if not found
 */
export function getGroupPath(groups: GroupDefinition[], targetKey: string, parentPath: string[] = []): string[] {
  for (const group of groups) {
    const currentPath = [...parentPath, group.key];
    if (group.key === targetKey) {
      return currentPath;
    }
    if (group.children?.length) {
      const found = getGroupPath(group.children, targetKey, currentPath);
      if (found.length > 0) return found;
    }
  }
  return [];
}
// #endregion
