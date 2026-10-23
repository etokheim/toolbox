/**
 * Resolve a configured or conventional row ID. Missing IDs return undefined;
 * errors from a configured resolver propagate.
 */
export function tryResolveRowId<T>(row: T, getRowId?: (row: T) => string): string | undefined {
  if (getRowId) {
    return getRowId(row);
  }

  const r = row as Record<string, unknown>;
  if ('id' in r && r.id != null) return String(r.id);
  if ('_id' in r && r._id != null) return String(r._id);

  return undefined;
}
