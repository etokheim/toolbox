/**
 * Column Reordering Core Logic
 *
 * Pure functions for column drag and reordering operations.
 */

/**
 * Check if a column can be moved based on its own metadata.
 * This checks column-level properties like lockPosition, utility, and suppressMovable.
 *
 * Both the top-level `lockPosition` (preferred) and legacy `meta.lockPosition` /
 * `meta.suppressMovable` are honored. `utility: true` columns (system columns
 * synthesized by plugins or authored by the app) are always treated as locked.
 *
 * Note: For full movability checks including plugin constraints (e.g., pinned columns),
 * use `grid.query<boolean>('canMoveColumn', column)` which queries all plugins that
 * declare the 'canMoveColumn' query in their manifest.
 *
 * @param column - The column configuration to check
 * @returns True if the column can be moved based on its metadata
 */
export function canMoveColumn(column: {
  lockPosition?: boolean;
  utility?: boolean;
  meta?: Record<string, unknown>;
}): boolean {
  if (column.lockPosition === true) return false;
  if (column.utility === true) return false;
  const meta = column.meta ?? {};
  return meta.lockPosition !== true && meta.suppressMovable !== true;
}

/**
 * Move a column from one position to another in the order array.
 *
 * @param columns - Array of field names in current order
 * @param fromIndex - The current index of the column to move
 * @param toIndex - The target index to move the column to
 * @returns New array with updated order
 */
export function moveColumn(columns: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex) return columns;
  if (fromIndex < 0 || fromIndex >= columns.length) return columns;
  if (toIndex < 0 || toIndex > columns.length) return columns;

  const result = [...columns];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

/**
 * Move a block of fields so it sits directly before or after an anchor field.
 *
 * This is the shape of every drag drop: a single column or a whole group
 * fragment is lifted out and re-inserted next to the hovered column (or the
 * first/last column of the hovered group fragment).
 *
 * @param order - Field names in current order
 * @param dragged - Fields being moved; kept in their current relative order
 * @param anchor - Field to insert next to; must not be one of `dragged`
 * @param before - Insert before (`true`) or after (`false`) the anchor
 * @returns The new order, or `null` when the anchor is not in the order
 */
export function moveColumnBlock(order: string[], dragged: string[], anchor: string, before: boolean): string[] | null {
  const remaining = order.filter((f) => !dragged.includes(f));
  const at = remaining.indexOf(anchor);
  if (at === -1) return null;
  remaining.splice(before ? at : at + 1, 0, ...order.filter((f) => dragged.includes(f)));
  return remaining;
}

/**
 * Horizontal offset each visible column needs to travel from its slot in
 * `from` to its slot in `to`, given every visible column's width.
 * Fields missing from `widths` (hidden columns) take no space.
 *
 * @returns Map of field to delta in px; columns that do not move are omitted
 */
export function columnOffsets(from: string[], to: string[], widths: Map<string, number>): Map<string, number> {
  const lefts = (order: string[]): Map<string, number> => {
    const out = new Map<string, number>();
    let x = 0;
    for (const f of order) {
      const w = widths.get(f);
      if (w === undefined) continue;
      out.set(f, x);
      x += w;
    }
    return out;
  };
  const before = lefts(from);
  const after = lefts(to);
  const deltas = new Map<string, number>();
  after.forEach((left, f) => {
    const d = left - (before.get(f) ?? left);
    if (Math.abs(d) > 0.5) deltas.set(f, d);
  });
  return deltas;
}
