import type { GridHost } from '../types';

/**
 * Resolve a configured or conventional row ID. Missing IDs return undefined;
 * errors from a configured resolver propagate.
 */
export function tryResolveRowId<T>(row: T, getRowId?: (row: T) => string): string | undefined {
  const r = row as Record<string, unknown>;
  if (r?.__loading === true) {
    if (r.__index != null) return `__loading:${r.__index}`;
    if (r.__groupKey != null) return `__loading:group:${r.__groupKey}`;
    return undefined;
  }
  if (getRowId) {
    return getRowId(row);
  }

  if ('id' in r && r.id != null) return String(r.id);
  if ('_id' in r && r._id != null) return String(r._id);

  return undefined;
}

type EditTargetHost<T> = Pick<GridHost<T>, 'rows' | 'sourceRows' | 'effectiveConfig' | '_pendingSourceUpdate'>;

/** Private ownership snapshot shared by edit history and selected-cell operations. */
export interface EditTarget<T = unknown> {
  row: (T & object) | undefined;
  rowId: string | undefined;
  resolver: ((row: T) => string) | undefined;
  ambiguous: boolean;
}

function matchingRows<T>(grid: EditTargetHost<T>, id: string, resolver: EditTarget<T>['resolver']): (T & object)[] {
  const matches = new Set<T & object>();
  for (const row of new Set([...(grid.rows ?? []), ...grid.sourceRows])) {
    if (row && typeof row === 'object' && tryResolveRowId(row, resolver) === id) matches.add(row);
  }
  return [...matches];
}

/** Capture existing identity, never an index-derived substitute. */
export function captureEditTarget<T>(grid: EditTargetHost<T>, row: T): EditTarget<T> {
  const resolver = grid.effectiveConfig?.getRowId;
  const owner = row && typeof row === 'object' ? row : undefined;
  const rowId = owner ? tryResolveRowId(owner, resolver) || undefined : undefined;
  return {
    row: owner,
    rowId,
    resolver,
    ambiguous: rowId !== undefined && matchingRows(grid, rowId, resolver).length > 1,
  };
}

/** Re-resolve unique IDs; ID-less edits require the original live object. */
export function resolveEditTarget<T>(
  grid: EditTargetHost<T>,
  target: EditTarget<T>,
): { row: T & object; rowId?: string } | undefined {
  if (
    grid._pendingSourceUpdate === 'rows' ||
    !target.row ||
    target.ambiguous ||
    target.resolver !== grid.effectiveConfig?.getRowId
  )
    return undefined;
  if (target.rowId !== undefined) {
    const matches = matchingRows(grid, target.rowId, target.resolver);
    if (matches.length === 1) return { row: matches[0], rowId: target.rowId };
  } else if (grid.rows?.includes(target.row) || grid.sourceRows.includes(target.row)) {
    return { row: target.row };
  }
  return undefined;
}
