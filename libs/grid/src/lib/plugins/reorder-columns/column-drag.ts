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
 * Pick the slot a dragged block settles into, from its on-screen left edge.
 *
 * `slots[k]` is the left edge the block would have if inserted at position `k`
 * among the other columns. The nearest allowed slot wins, so a neighbour swaps
 * once the block covers half of it, whatever the two widths are. The current
 * slot is kept until another one is closer by more than `hysteresis` px, so a
 * pointer resting on a threshold cannot make the columns flicker.
 *
 * @param slots - Left edge per insertion position
 * @param allowed - Whether each insertion position is a valid drop
 * @param left - Current left edge of the dragged block
 * @param current - Insertion position currently shown
 * @param hysteresis - Extra distance another slot must win by
 * @returns The insertion position to show
 */
export function nearestSlot(
  slots: readonly number[],
  allowed: readonly boolean[],
  left: number,
  current: number,
  hysteresis: number,
): number {
  let best = current;
  let bestDist = Math.abs(left - (slots[current] ?? left)) - hysteresis;
  slots.forEach((slot, k) => {
    const dist = Math.abs(left - slot);
    if (allowed[k] && dist < bestDist) {
      best = k;
      bestDist = dist;
    }
  });
  return best;
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

/**
 * Insertion positions for a dragged block among the other columns: the block's
 * left edge at each position, and whether a drop there is allowed. A position
 * is allowed next to a movable column (`isTarget`), and a multi-column block
 * never lands inside another explicit group (`groupOf`). `home` is always allowed.
 */
export function insertionSlots(
  rest: readonly string[],
  widths: ReadonlyMap<string, number>,
  home: number,
  isTarget: (field: string) => boolean,
  groupOf: ReadonlyMap<string, number>,
  isBlock: boolean,
): { slots: number[]; allowed: boolean[] } {
  const slots: number[] = [];
  let left = 0;
  for (let k = 0; k <= rest.length; k++) {
    slots.push(left);
    left += widths.get(rest[k]) ?? 0;
  }
  const target = (f: string | undefined) => f !== undefined && isTarget(f);
  const allowed = slots.map((_, k) => {
    if (k === home) return true;
    const prev = rest[k - 1];
    const next = rest[k];
    if (!target(prev) && !target(next)) return false;
    return !(isBlock && groupOf.has(prev) && groupOf.get(prev) === groupOf.get(next));
  });
  return { slots, allowed };
}

/** Swallow the next click on `el` within this task (the release that ended a drag). */
export function suppressNextClick(el: HTMLElement): void {
  const swallow = (e: Event) => {
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  el.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => el.removeEventListener('click', swallow, true), 0);
}

/**
 * Measure the header row once at drag start: each visible column's width and
 * untransformed left offset, and where the first column starts relative to
 * the row (`origin`). Returns `null` when a column has no rendered header.
 */
export function measureHeader(
  row: HTMLElement,
  fields: readonly string[],
  primary: string,
): { widths: Map<string, number>; lefts: Map<string, number>; origin: number; rowLeft: number } | null {
  const widths = new Map<string, number>();
  const lefts = new Map<string, number>();
  let x = 0;
  let primaryCell: Element | null = null;
  for (const field of fields) {
    const cell = row.querySelector(`:scope > .cell[data-field="${CSS.escape(field)}"]`);
    if (!cell) return null;
    if (field === primary) primaryCell = cell;
    const width = cell.getBoundingClientRect().width;
    widths.set(field, width);
    lefts.set(field, x);
    x += width;
  }
  if (!primaryCell) return null;

  // Header cells are never transformed here outside a FLIP, which `translateX` keeps exact.
  const transform = getComputedStyle(primaryCell).transform;
  const shift =
    transform && transform !== 'none' && typeof DOMMatrixReadOnly === 'function'
      ? new DOMMatrixReadOnly(transform).m41
      : 0;
  const rowLeft = row.getBoundingClientRect().left;
  const origin = primaryCell.getBoundingClientRect().left - shift - rowLeft - (lefts.get(primary) ?? 0);
  return { widths, lefts, origin, rowLeft };
}
