/**
 * Hierarchy Engine
 *
 * Pure row-model builder shared by the HierarchyPlugin and its contributors.
 */

import type { HierarchyContributor, HierarchyNode, HierarchyRowMeta } from './types';

/** @internal Optional flat-model shortcut; never used when contributors compose. */
export const FLAT_HIERARCHY = Symbol.for('tbw.grid.flat-hierarchy');

interface FlatHierarchyContributor {
  [FLAT_HIERARCHY](rows: readonly unknown[], meta?: WeakMap<object, HierarchyRowMeta>): HierarchyModel | undefined;
}

/** @internal A published row generation and its read-only positional index. */
export interface HierarchyModel {
  rows: unknown[];
  positions: Pick<WeakMap<object, HierarchyRowMeta>, 'get'>;
}

const building = new WeakSet<HierarchyContributor>();

/** @internal Custom contributor hooks always use the generic pipeline. */
export function hasDefaultHierarchyHooks(contributor: HierarchyContributor, prototype: HierarchyContributor): boolean {
  return (
    contributor.processSiblings === prototype.processSiblings && contributor.endHierarchy === prototype.endHierarchy
  );
}

/**
 * Build the flat row list for `rows` from every contributor's sibling-list
 * transforms, recording each emitted row's ARIA position in `meta`.
 *
 * Contributors whose `beginHierarchy` returns `false` sit out the rebuild.
 * With no active contributor the rows pass through unchanged. When every
 * active contributor's `endHierarchy` returns `false`, no position is kept in `meta`.
 *
 * This is what `HierarchyPlugin.process()` runs for all attached contributors.
 * Call it directly to run a contributor without a grid — e.g. as the
 * `processRows` fallback when no HierarchyPlugin is attached, or in unit tests.
 *
 * @example
 * ```ts
 * override processRows(rows: readonly unknown[]): unknown[] {
 *   const hierarchy = this.grid?.getPluginByName('hierarchy');
 *   return hierarchy ? hierarchy.process(rows, this) : buildHierarchy(rows, [this]);
 * }
 * ```
 *
 * @param rows - The root rows.
 * @param contributors - Contributors to run, in `processRows` hook order.
 * @param meta - Receives each emitted row's position. Pass a fresh map per rebuild.
 * @returns The flattened rows, in render order.
 * @since 3.9.0
 */
export function buildHierarchy(
  rows: readonly unknown[],
  contributors: readonly HierarchyContributor[],
  meta: WeakMap<object, HierarchyRowMeta> = new WeakMap(),
): unknown[] {
  return buildHierarchyModel(rows, contributors, meta).rows;
}

/** @internal Allows a standalone contributor to lend its completed metadata generation. */
export function buildHierarchyModel(
  rows: readonly unknown[],
  contributors: readonly HierarchyContributor[],
  meta?: WeakMap<object, HierarchyRowMeta>,
): HierarchyModel {
  if (contributors.some((contributor) => building.has(contributor))) {
    throw new Error('Hierarchy contributors cannot rebuild re-entrantly');
  }
  for (const contributor of contributors) building.add(contributor);
  try {
    return compose(rows, contributors, meta);
  } finally {
    for (const contributor of contributors) building.delete(contributor);
  }
}

function beginContributors(
  rows: readonly unknown[],
  contributors: readonly HierarchyContributor[],
): HierarchyContributor[] {
  const active: HierarchyContributor[] = [];
  for (const stage of ['structure', 'transform'] as const) {
    for (const c of contributors) {
      if (c.hierarchyStage === stage && c.beginHierarchy(rows)) active.push(c);
    }
  }
  return active;
}

function compose(
  rows: readonly unknown[],
  contributors: readonly HierarchyContributor[],
  suppliedMeta?: WeakMap<object, HierarchyRowMeta>,
): HierarchyModel {
  const active = beginContributors(rows, contributors);
  if (active.length === 0) return { rows: [...rows], positions: suppliedMeta ?? new WeakMap() };
  if (active.length === 1) {
    const contributor = active[0] as HierarchyContributor & Partial<FlatHierarchyContributor>;
    const flat = contributor[FLAT_HIERARCHY]?.(rows, suppliedMeta);
    if (flat) return flat;
  }

  const meta = suppliedMeta ?? new WeakMap<object, HierarchyRowMeta>();
  const out: unknown[] = [];
  const process = (nodes: HierarchyNode[], parent: HierarchyNode | null, depth: number): HierarchyNode[] => {
    const context = { parent: parent ? parent.row : null, parentKey: parent?.key ?? null, depth };
    for (const c of active) nodes = c.processSiblings(nodes, context);
    return nodes;
  };
  const emit = (nodes: HierarchyNode[], depth: number): void => {
    const setSize = nodes.length;
    for (let i = 0; i < setSize; i++) {
      const node = nodes[i];
      out.push(node.row);
      if (typeof node.row === 'object' && node.row !== null) {
        meta.set(node.row, { level: depth + 1, setSize, posInSet: i + 1 });
      }
      const children = node.children;
      if (node.expanded && children) {
        emit(node.shaped ? children : process(children, node, depth + 1), depth + 1);
      }
    }
  };

  const roots: HierarchyNode[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) roots[i] = { row: rows[i] };
  emit(process(roots, null, 0), 0);
  return finishHierarchy(out, active, meta);
}

function finishHierarchy(
  out: unknown[],
  active: readonly HierarchyContributor[],
  meta: WeakMap<object, HierarchyRowMeta>,
): HierarchyModel {
  const positionOf = (row: unknown) => (typeof row === 'object' && row !== null ? meta.get(row) : undefined);
  let shaped = false;
  for (const c of active) if (c.endHierarchy(out, positionOf)) shaped = true;
  if (!shaped) {
    for (const row of out) if (typeof row === 'object' && row !== null) meta.delete(row);
  }
  return { rows: out, positions: meta };
}
