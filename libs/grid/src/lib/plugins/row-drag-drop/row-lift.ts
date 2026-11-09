/**
 * Pure geometry and tree-target helpers for the live-preview (lifted) row drag.
 *
 * Every slot is computed once from the layout at drag start, so the preview
 * never reads back transformed rows and cannot oscillate.
 *
 * @internal
 */

/** Px the pointer must travel before a press becomes a lifted drag. */
export const LIFT_THRESHOLD = 6;
/** Px the block must travel past a slot midpoint before the room moves. */
export const SLOT_HYSTERESIS = 8;
/** Never start a drag from these, even with `dragFrom: 'row'`. */
export const NO_ROW_DRAG = '[data-tbw-no-row-drag],.tbw-no-row-drag';

/** Drag-start layout: rows that stay (`rest`) and where the dragged block may land. */
export interface LiftLayout {
  /** Flat index → position in `rest`, or -1 for a dragged row. */
  restPos: Int32Array;
  /** Flat indices of the rows that stay, in display order. */
  rest: number[];
  /** Top of the block when it lands in slot `s` (length `rest + 1`). */
  slotTops: number[];
  /** Dragged flat indices in display order. */
  block: number[];
  /** Offset of each dragged row inside the block. */
  stack: Map<number, number>;
  /** Total block height. */
  blockHeight: number;
  /** Slot the grabbed row starts in. */
  home: number;
  /** Whether the block already sits contiguously at `home`. */
  contiguous: boolean;
}

/** Build the slot geometry for dragging `dragged` (flat indices) out of `total` rows. */
export function liftLayout(
  total: number,
  dragged: ReadonlySet<number>,
  grabbed: number,
  height: (index: number) => number,
): LiftLayout {
  const restPos = new Int32Array(total);
  const rest: number[] = [];
  const slotTops = [0];
  const block: number[] = [];
  const stack = new Map<number, number>();
  let blockHeight = 0;
  let home = 0;
  let r = 0;
  for (let i = 0; i < total; i++) {
    if (dragged.has(i)) {
      restPos[i] = -1;
      block.push(i);
      stack.set(i, blockHeight);
      blockHeight += height(i);
    } else {
      if (i < grabbed) home++;
      restPos[i] = r++;
      rest.push(i);
      slotTops.push(slotTops[slotTops.length - 1] + height(i));
    }
  }
  const contiguous = block.length > 0 && block[block.length - 1] - block[0] === block.length - 1;
  return { restPos, rest, slotTops, block, stack, blockHeight, home, contiguous };
}

/**
 * Slot whose top is nearest `top`. The current slot keeps a `hysteresis`
 * bonus, so the room only moves once the block clearly passes a midpoint.
 */
export function nearestRowSlot(slotTops: readonly number[], top: number, current: number, hysteresis: number): number {
  let lo = 0;
  let hi = slotTops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slotTops[mid] < top) lo = mid + 1;
    else hi = mid;
  }
  const best = lo > 0 && top - slotTops[lo - 1] < slotTops[lo] - top ? lo - 1 : lo;
  const cur = slotTops[current];
  if (cur === undefined) return best;
  return Math.abs(top - slotTops[best]) < Math.abs(top - cur) - hysteresis ? best : current;
}

/** Translate for the row at flat `index` while the room is open at `slot`. */
export function restShift(layout: LiftLayout, index: number, slot: number, offset: number): number {
  const r = layout.restPos[index];
  return layout.slotTops[r] + (r >= slot ? layout.blockHeight : 0) - offset;
}

/** Read-only view of the hierarchy (flat data: depth 0, no parents). */
export interface RowTreeAccess<T> {
  depth(row: T): number;
  parent(row: T): T | null;
  /** True when the row shows children that are currently expanded. */
  expanded(row: T): boolean;
  children(parent: T | null): readonly T[];
}

/** A place the moving rows could land. */
export interface DropCandidate<T> {
  parent: T | null;
  /** Index among `children(parent)` with the moving rows removed. */
  index: number;
  depth: number;
}

function indexAmong<T>(siblings: readonly T[], moving: ReadonlySet<T>, anchor: T, after: boolean): number {
  let k = 0;
  for (const row of siblings) {
    if (row === anchor) return k + (after ? 1 : 0);
    if (!moving.has(row)) k++;
  }
  return -1;
}

/**
 * Every parent/index the gap between `prev` and `next` (visible rows that
 * stay) can mean, nearest to `depth` first: before `next`; after `prev` or
 * any ancestor whose subtree ends at the gap; or as the first child of an
 * expanded `prev` whose children all move.
 */
export function dropCandidates<T>(
  prev: T | undefined,
  next: T | undefined,
  moving: ReadonlySet<T>,
  depth: number,
  tree: RowTreeAccess<T>,
): DropCandidate<T>[] {
  const out: DropCandidate<T>[] = [];
  const add = (parent: T | null, index: number, d: number) => {
    if (index < 0 || out.some((c) => c.parent === parent && c.index === index)) return;
    out.push({ parent, index, depth: d });
  };
  if (next !== undefined) {
    const parent = tree.parent(next);
    add(parent, indexAmong(tree.children(parent), moving, next, false), tree.depth(next));
  }
  const nextDepth = next === undefined ? -1 : tree.depth(next);
  if (prev !== undefined && tree.expanded(prev) && nextDepth <= tree.depth(prev)) {
    add(prev, 0, tree.depth(prev) + 1);
  }
  for (let p: T | null = prev ?? null; p !== null && tree.depth(p) >= nextDepth; p = tree.parent(p)) {
    const parent = tree.parent(p);
    add(parent, indexAmong(tree.children(parent), moving, p, true), tree.depth(p));
  }
  if (out.length === 0) add(null, prev === undefined ? 0 : tree.children(null).filter((r) => !moving.has(r)).length, 0);
  return out
    .map((c, k) => ({ c, k }))
    .sort((a, b) => Math.abs(a.c.depth - depth) - Math.abs(b.c.depth - depth) || a.k - b.k)
    .map(({ c }) => c);
}

/**
 * Keep only rows with no ancestor in the set: a dragged parent carries its
 * subtree, so its descendants never move on their own.
 */
export function movingRoots<T>(rows: readonly T[], tree: RowTreeAccess<T>): T[] {
  const set = new Set(rows);
  return rows.filter((row) => {
    for (let p = tree.parent(row); p !== null; p = tree.parent(p)) if (set.has(p)) return false;
    return true;
  });
}

/**
 * New sibling arrays after moving `roots` to `target`. Keys are the affected
 * parents (`null` = top level); nothing is mutated.
 */
export function moveRows<T>(roots: readonly T[], target: DropCandidate<T>, tree: RowTreeAccess<T>): Map<T | null, T[]> {
  const out = new Map<T | null, T[]>();
  const list = (parent: T | null) => {
    let arr = out.get(parent);
    if (!arr) out.set(parent, (arr = [...tree.children(parent)]));
    return arr;
  };
  for (const row of roots) {
    const arr = list(tree.parent(row));
    const at = arr.indexOf(row);
    if (at >= 0) arr.splice(at, 1);
  }
  const dest = list(target.parent);
  dest.splice(Math.min(target.index, dest.length), 0, ...roots);
  return out;
}

/** Swallow the click a finished drag produces. */
export function suppressNextClick(el: HTMLElement): void {
  const swallow = (e: Event) => {
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  el.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => el.removeEventListener('click', swallow, true), 0);
}

/** Whether `target` sits inside the user's current non-empty text selection. */
export function insideTextSelection(target: Node): boolean {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  if (!sel || sel.isCollapsed || !sel.toString()) return false;
  for (let i = 0; i < sel.rangeCount; i++) if (sel.getRangeAt(i).intersectsNode(target)) return true;
  return false;
}

/** Fill `{name}` placeholders. */
export function fillMessage(text: string, values: Record<string, number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
