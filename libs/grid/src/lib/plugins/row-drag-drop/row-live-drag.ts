/**
 * Live-preview row drag (`livePreview: true`): the dragged rows lift and
 * follow the pointer vertically while the other rows slide aside to open
 * room. Nothing persists until release, which commits one `row-move`.
 *
 * @internal Owned by `RowDragDropPlugin`.
 */

import { GridClasses } from '../../core/constants';
import { announce } from '../../core/internal/aria';
import type { AutoScroller } from '../shared/drag-drop-protocol';
import { startPointerDrag } from '../../core/internal/pointer-drag';
import type { GridHost } from '../../core/types';
import { findDragHandle } from './drag-handle-controls';
import {
  LIFT_THRESHOLD,
  NO_ROW_DRAG,
  SLOT_HYSTERESIS,
  type DropCandidate,
  type LiftLayout,
  type RowTreeAccess,
  dropCandidates,
  fillMessage,
  insideTextSelection,
  liftLayout,
  moveRows,
  movingRoots,
  nearestRowSlot,
  restShift,
  suppressNextClick,
} from './row-lift';
import type { RowDragDropConfig, RowDragPayload, RowDragStartDetail, RowLiveMessages, RowMoveDetail } from './types';

/** Grid attribute while rows are lifted (cursor, transitions). */
const LIFT_ATTR = 'data-tbw-row-lifting';
/** Grid attribute while the pointer is over a rejected target. */
const INVALID_ATTR = 'data-tbw-row-drop-invalid';
/** Class on every lifted row element. */
const LIFTED = 'tbw-row-lifted';

const LIVE_MESSAGES: RowLiveMessages = {
  start: 'Picked up {count} row(s).',
  position: 'Position {position} of {total}.',
  invalid: 'Cannot drop here.',
  cancel: 'Move cancelled.',
  drop: 'Dropped at position {position} of {total}.',
};

/** One live-preview drag, from promotion to settle. @internal */
interface LiveRowDrag<T> {
  grabbed: T;
  grabIndex: number;
  /** Rows that move on their own (descendants travel inside them). */
  roots: T[];
  rootSet: Set<T>;
  /** Processed rows at drag start; a different array ends the drag. */
  view: readonly unknown[];
  layout: LiftLayout;
  offsets: Float64Array;
  depth: number;
  /** Pointer offset from the block top, in px. */
  grabDy: number;
  lastX: number;
  lastY: number;
  blockTop: number;
  /** Slot nearest the pointer (may be rejected). */
  hover: number;
  /** Slot where the room is open (last accepted). */
  slot: number;
  target: DropCandidate<T> | null;
  verdicts: Map<number, { target: DropCandidate<T> } | { reason: string }>;
  invalid: string | null;
  /** Element → flat index it showed at the last paint, to skip transitions on recycle. */
  painted: WeakMap<HTMLElement, number>;
  /** False until the first paint; later, newly seen elements jump instead of sliding. */
  primed: boolean;
  /** Released: rows slide into place, the pointer no longer steers. */
  settling: boolean;
  tree: RowTreeAccess<T>;
  /** Whether a visible row is real data (not a group header or other synthetic row). */
  isData: (row: unknown) => boolean;
}

/** What the controller needs from its plugin. */
export interface LiveRowDragHost<T> {
  grid(): GridHost;
  config(): RowDragDropConfig<T>;
  rowIndex(rowEl: HTMLElement): number;
  /** Whether `el` is a control that must keep its own pointer behaviour. */
  interactive(el: Element): boolean;
  /** `dragFrom` lets a drag start from the row itself. */
  rowDraggable(): boolean;
  /** A native HTML5 drag is in progress. */
  busy(): boolean;
  settleMs(): number;
  /** Dispatch a cancelable event; `true` when it was cancelled. */
  emit(name: string, detail: unknown): boolean;
  /** The auto-scroller; `ensure` creates it when `autoScroll` allows. */
  scroller(ensure?: boolean): AutoScroller | null;
  gridId(): string;
}

export class LiveRowDragController<T = unknown> {
  readonly #host: LiveRowDragHost<T>;
  /** Drag in progress (lifted rows following the pointer). */
  #live: LiveRowDrag<T> | null = null;
  /** A mouse/pen press may still become a live drag; refuses the native `dragstart`. */
  #liveArmed = false;
  #cancelLivePointer: (() => void) | null = null;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  #announceTimer: ReturnType<typeof setTimeout> | undefined;
  #reasonEl: HTMLElement | null = null;
  #reasonOrigin: { x: number; y: number } | null = null;
  #scrollFrame = 0;

  constructor(host: LiveRowDragHost<T>) {
    this.#host = host;
  }

  get #grid(): GridHost {
    return this.#host.grid();
  }

  get #rows(): unknown[] {
    return this.#grid.rows ?? [];
  }

  get #sourceRows(): unknown[] {
    return this.#grid.sourceRows ?? [];
  }

  get #config(): RowDragDropConfig<T> {
    return this.#host.config();
  }

  get #el(): HTMLElement | undefined {
    return this.#grid?._hostElement;
  }

  /** A press is armed or rows are lifted: the native `dragstart` must be refused. */
  get active(): boolean {
    return this.#liveArmed || !!this.#live;
  }

  /** After a render or scroll render: re-place the rows under a held drag. */
  refresh(): void {
    if (this.#live) this.#liveRefresh(this.#live);
  }

  destroy(): void {
    this.#cancelLivePointer?.();
    this.#endLive();
  }

  /** Merged announcement texts. */
  get #messages(): RowLiveMessages {
    return { ...LIVE_MESSAGES, ...this.#config.liveMessages };
  }

  /** Hierarchy view: the Tree plugin's metadata, or flat rows when there is no tree. */
  #treeAccess(): { tree: RowTreeAccess<T>; isData: (row: unknown) => boolean } {
    const treePlugin = this.#grid.getPluginByName?.('tree');
    const meta = (row: unknown) => treePlugin?.getRowMeta(row as Record<string, unknown>);
    const field = treePlugin?.getChildrenField() ?? 'children';
    const source = this.#sourceRows as T[];
    const sourceSet = new Set<unknown>(source);
    const isTree = !!treePlugin && this.#rows.some((row) => meta(row) !== undefined);
    const tree: RowTreeAccess<T> = {
      depth: (row) => meta(row)?.depth ?? 0,
      parent: (row) => {
        const key = meta(row)?.parentKey;
        return key == null ? null : ((treePlugin?.getRowByKey(key) as T | undefined) ?? null);
      },
      expanded: (row) => {
        const m = meta(row);
        return !!m?.hasChildren && !!m.isExpanded;
      },
      children: (parent) =>
        parent === null ? source : (((parent as Record<string, unknown>)[field] as T[] | undefined) ?? []),
    };
    return { tree, isData: isTree ? (row) => meta(row) !== undefined : (row) => sourceSet.has(row) };
  }

  /** `canDrag` plus plugin vetoes; tree parents are allowed because they carry their subtree. */
  #liveGrabAllowed(row: T, index: number): boolean {
    if (this.#config.canDrag && !this.#config.canDrag(row, index)) return false;
    const treePlugin = this.#grid.getPluginByName?.('tree');
    if (treePlugin?.getRowMeta(row as Record<string, unknown>)) return true;
    const vetoes = this.#grid.query?.<boolean>('canMoveRow', row);
    return !(Array.isArray(vetoes) && vetoes.includes(false));
  }

  /** The grabbed row, plus every selected row of its type when it is selected. */
  #liveDragRows(index: number, grabbed: T): T[] {
    const view = this.#rows;
    const selection = this.#grid.getPluginByName?.('selection') as
      { getSelectedRowIndices?: () => number[] } | undefined;
    const selected = selection?.getSelectedRowIndices?.() ?? [];
    if (!selected.includes(index) || selected.length < 2) return [grabbed];
    const typeOf = this.#config.rowType;
    const type = typeOf?.(grabbed);
    return [...selected]
      .sort((a, b) => a - b)
      .filter((i) => {
        const row = view[i] as T | undefined;
        if (row === undefined) return false;
        if (row === grabbed) return true;
        return (!typeOf || typeOf(row) === type) && this.#liveGrabAllowed(row, i);
      })
      .map((i) => view[i] as T);
  }

  /** A mouse/pen press that may become a lifted drag once it travels {@link LIFT_THRESHOLD}px. */
  pointerDown(e: PointerEvent): void {
    if (!this.#config.livePreview || e.button !== 0 || e.pointerType === 'touch') return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.#live || this.#liveArmed || this.#settleTimer !== undefined || this.#host.busy()) return;
    const gridEl = this.#el;
    const target = e.target;
    if (!gridEl || !(target instanceof Element)) return;
    const rowEl = target.closest<HTMLElement>('.data-grid-row');
    if (!rowEl || !this.#grid._bodyEl?.contains(rowEl)) return;
    const binding = findDragHandle(e, gridEl);
    if (binding && (!binding.owns(e) || !binding.valid)) return;
    const onHandle = !!binding || !!target.closest('.dg-row-drag-handle');
    if (!onHandle && !this.#host.rowDraggable()) return;
    if (target.closest(NO_ROW_DRAG) || target.closest(`.${GridClasses.EDITING}`)) return;
    if (!onHandle && this.#host.interactive(target)) return;
    if (insideTextSelection(target)) return;
    const index = this.#host.rowIndex(rowEl);
    const row = this.#rows[index] as T | undefined;
    if (row === undefined || !this.#liveGrabAllowed(row, index)) return;
    const origin = onHandle ? 'handle' : 'row';
    if (this.#config.shouldStartDrag && !this.#config.shouldStartDrag({ row, index, event: e, origin })) return;
    this.#armLive(e, gridEl, index);
  }

  #armLive(e: PointerEvent, gridEl: HTMLElement, index: number): void {
    const id = e.pointerId;
    this.#liveArmed = true;
    // Nothing is captured before promotion, so a quick move off the grid (or a
    // release elsewhere) would never reach the drag: capture once it travels.
    const early = (m: PointerEvent) => {
      if (m.pointerId !== id) return;
      if (m.type === 'pointerup') {
        if (!this.#live) this.#cancelLivePointer?.();
      } else if (
        Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) >= LIFT_THRESHOLD &&
        !gridEl.hasPointerCapture(id)
      ) {
        try {
          gridEl.setPointerCapture(id);
        } catch {
          /* detached or synthetic pointer */
        }
      }
    };
    document.addEventListener('pointermove', early, true);
    document.addEventListener('pointerup', early, true);
    const disarm = () => {
      document.removeEventListener('pointermove', early, true);
      document.removeEventListener('pointerup', early, true);
      this.#liveArmed = false;
      this.#cancelLivePointer = null;
    };
    this.#cancelLivePointer = startPointerDrag(
      e,
      gridEl,
      {
        onPromote: () => this.#startLive(index, e.clientY),
        onMove: (pe) => {
          const live = this.#live;
          if (!live || live.settling) return;
          live.lastX = pe.clientX;
          live.lastY = pe.clientY;
          this.#follow(live);
          this.#host.scroller()?.onPointerMove(pe.clientY);
        },
        onEnd: () => {
          disarm();
          this.#liveDrop();
        },
        onCancel: () => {
          const lifted = !!this.#live && !this.#live.settling;
          disarm();
          if (!lifted) return;
          this.#revertLive();
          // Escape mid-drag: the later release still clicks the row; it must not activate it.
          document.addEventListener('pointerup', () => suppressNextClick(gridEl), { capture: true, once: true });
        },
      },
      { threshold: LIFT_THRESHOLD },
    );
  }

  /**
   * Row tops: measured height where rendered (else the cache estimate), plus
   * any non-data gap after the row (`after`, e.g. a pinned-rows scoped footer).
   */
  #rowOffsets(count: number): Float64Array {
    const virt = this.#grid._virtualization;
    const cache = virt?.positionCache;
    const fallback = virt?.rowHeight || 28;
    const measured = new Map<number, number>();
    for (const el of this.#grid._bodyEl?.querySelectorAll<HTMLElement>('.data-grid-row') ?? []) {
      const i = this.#host.rowIndex(el);
      if (i >= 0) measured.set(i, el.offsetHeight);
    }
    const offsets = new Float64Array(count + 1);
    for (let i = 0; i < count; i++)
      offsets[i + 1] = offsets[i] + (measured.get(i) || cache?.[i]?.height || fallback) + (cache?.[i]?.after ?? 0);
    return offsets;
  }

  /** Viewport y of the content top (row 0), from the first rendered row's untransformed layout box. */
  #contentOrigin(offsets: Float64Array): number | null {
    const body = this.#grid._bodyEl;
    if (!body) return null;
    for (const el of body.querySelectorAll<HTMLElement>('.data-grid-row')) {
      const i = this.#host.rowIndex(el);
      if (i < 0 || i >= offsets.length - 1) continue;
      const top = el.offsetParent === body ? el.offsetTop : el.offsetTop - body.offsetTop;
      return body.getBoundingClientRect().top + top - offsets[i];
    }
    return null;
  }

  /** Promotion: lift the dragged rows, measured once from the drag-start layout. */
  #startLive(index: number, clientY: number): void {
    const gridEl = this.#el;
    const view = this.#rows;
    const grabbed = view[index] as T | undefined;
    if (!gridEl || grabbed === undefined) return;
    const { tree, isData } = this.#treeAccess();
    const roots = movingRoots(this.#liveDragRows(index, grabbed), tree);
    const rootSet = new Set(roots);
    const dragged = new Set<number>();
    for (let i = 0; i < view.length; i++) {
      if (!rootSet.has(view[i] as T)) continue;
      const depth = tree.depth(view[i] as T);
      dragged.add(i);
      while (i + 1 < view.length && tree.depth(view[i + 1] as T) > depth) dragged.add(++i);
    }
    if (!dragged.has(index)) return;

    const startDetail: RowDragStartDetail<T> = {
      rows: roots,
      indices: [...dragged],
      operation: 'move',
      dropZone: this.#config.dropZone ?? '',
    };
    if (this.#host.emit('row-drag-start', startDetail)) return;

    const offsets = this.#rowOffsets(view.length);
    const layout = liftLayout(view.length, dragged, index, (i) => offsets[i + 1] - offsets[i]);
    const origin = this.#contentOrigin(offsets);
    if (origin === null) return;
    const blockTop = offsets[index] - (layout.stack.get(index) ?? 0);
    let root: T = grabbed;
    while (!rootSet.has(root)) root = tree.parent(root) ?? grabbed;

    const live: LiveRowDrag<T> = {
      grabbed,
      grabIndex: index,
      roots,
      rootSet,
      view,
      layout,
      offsets,
      depth: tree.depth(root),
      grabDy: clientY - origin - blockTop,
      lastX: 0,
      lastY: clientY,
      blockTop,
      hover: -1,
      slot: layout.home,
      target: null,
      verdicts: new Map(),
      invalid: null,
      painted: new WeakMap(),
      primed: false,
      settling: false,
      tree,
      isData,
    };
    this.#live = live;
    getSelection?.()?.removeAllRanges();
    gridEl.setAttribute(LIFT_ATTR, '');
    this.#host.scroller(true);
    this.#announceNow(fillMessage(this.#messages.start, { count: roots.length }));
  }

  /**
   * Follow the pointer: the block is clamped to the body, the room moves only
   * past a slot midpoint (with hysteresis) and only to an accepted target.
   */
  #follow(live: LiveRowDrag<T>): void {
    const origin = this.#contentOrigin(live.offsets);
    if (origin === null) return;
    const { slotTops } = live.layout;
    live.blockTop = Math.min(Math.max(live.lastY - origin - live.grabDy, 0), slotTops[slotTops.length - 1]);
    const hover = nearestRowSlot(slotTops, live.blockTop, live.hover, SLOT_HYSTERESIS);
    if (hover !== live.hover) {
      live.hover = hover;
      const verdict = this.#verdict(live, hover);
      if ('target' in verdict) {
        const moved = live.slot !== hover || !live.target;
        live.slot = hover;
        live.target = verdict.target;
        this.#setInvalid(live, null);
        if (moved && live.primed) {
          const { parent, index } = verdict.target;
          const total = live.tree.children(parent).filter((r) => !live.rootSet.has(r)).length + 1;
          this.#announceLater(fillMessage(this.#messages.position, { position: index + 1, total }));
        }
      } else {
        this.#setInvalid(live, verdict.reason);
      }
    }
    this.#placeReason(live);
    this.#paint(live);
  }

  /** Accepted target for slot `s`, or why it is rejected. Cached per drag. */
  #verdict(live: LiveRowDrag<T>, s: number): { target: DropCandidate<T> } | { reason: string } {
    const cached = live.verdicts.get(s);
    if (cached) return cached;
    const { rest, home, contiguous } = live.layout;
    const view = live.view;
    const prevRow = s > 0 ? (view[rest[s - 1]] as T) : undefined;
    const nextRow = s < rest.length ? (view[rest[s]] as T) : undefined;
    let prev: T | undefined;
    let next: T | undefined;
    for (let r = s - 1; r >= 0 && prev === undefined; r--) if (live.isData(view[rest[r]])) prev = view[rest[r]] as T;
    for (let r = s; r < rest.length && next === undefined; r++)
      if (live.isData(view[rest[r]])) next = view[rest[r]] as T;
    const candidates = dropCandidates(prev, next, live.rootSet, live.depth, live.tree);
    let result: { target: DropCandidate<T> } | { reason: string };
    if (s === home && contiguous) {
      const own = live.tree.parent(live.roots[0]);
      result = { target: candidates.find((c) => c.parent === own) ?? candidates[0] };
    } else {
      let reason: string | undefined;
      const accepted = candidates.find((c) => {
        const verdict = this.#accepts(live, c, s, prevRow, nextRow);
        if (verdict !== true) reason ??= verdict;
        return verdict === true;
      });
      result = accepted ? { target: accepted } : { reason: reason ?? this.#messages.invalid };
    }
    live.verdicts.set(s, result);
    return result;
  }

  /** `true`, or the reason `target` is rejected (own subtree, `canDropAt`, `canDrop`). */
  #accepts(live: LiveRowDrag<T>, target: DropCandidate<T>, s: number, prevRow?: T, nextRow?: T): true | string {
    const invalid = this.#messages.invalid;
    for (let p = target.parent; p !== null; p = live.tree.parent(p)) if (live.rootSet.has(p)) return invalid;
    const verdict =
      this.#config.canDropAt?.({
        rows: live.roots,
        row: live.grabbed,
        targetParent: target.parent,
        index: target.index,
        prevRow,
        nextRow,
      }) ?? true;
    if (verdict === false) return invalid;
    if (typeof verdict === 'object') return verdict.reason || invalid;
    if (this.#config.canDrop) {
      const payload: RowDragPayload<T> = {
        sessionId: 'intra',
        sourceGridId: this.#host.gridId(),
        dropZone: this.#config.dropZone ?? '',
        rows: live.roots,
        rowIndices: live.layout.block,
        operation: 'move',
      };
      if (!this.#config.canDrop(payload, s)) return invalid;
    }
    return true;
  }

  #setInvalid(live: LiveRowDrag<T>, reason: string | null): void {
    if (live.invalid === reason) return;
    live.invalid = reason;
    const gridEl = this.#el;
    gridEl?.toggleAttribute(INVALID_ATTR, reason !== null);
    if (reason === null) {
      this.#reasonEl?.remove();
      this.#reasonEl = this.#reasonOrigin = null;
      return;
    }
    if (!this.#reasonEl && gridEl) {
      this.#reasonEl = document.createElement('div');
      this.#reasonEl.className = 'tbw-row-drop-reason';
      // Announced through the grid's live region instead.
      this.#reasonEl.setAttribute('aria-hidden', 'true');
      gridEl.appendChild(this.#reasonEl);
    }
    if (this.#reasonEl) this.#reasonEl.textContent = reason;
    this.#announceNow(reason);
  }

  #placeReason(live: LiveRowDrag<T>): void {
    const el = this.#reasonEl;
    if (!el) return;
    // A contained/transformed ancestor can own `position: fixed`; measure its origin once.
    if (!this.#reasonOrigin) {
      el.style.left = el.style.top = '0px';
      const r = el.getBoundingClientRect();
      this.#reasonOrigin = { x: r.left, y: r.top };
    }
    el.style.left = `${live.lastX + 14 - this.#reasonOrigin.x}px`;
    el.style.top = `${live.lastY + 18 - this.#reasonOrigin.y}px`;
  }

  /** Write every rendered row's transform for the current slot and block position. */
  #paint(live: LiveRowDrag<T>): void {
    const body = this.#grid._bodyEl;
    if (!body) return;
    const recycled: HTMLElement[] = [];
    for (const el of body.querySelectorAll<HTMLElement>('.data-grid-row')) {
      const i = this.#host.rowIndex(el);
      const known = i >= 0 && i < live.view.length;
      const lifted = known && live.layout.restPos[i] === -1;
      const y = !known
        ? 0
        : lifted
          ? live.blockTop + (live.layout.stack.get(i) ?? 0) - live.offsets[i]
          : restShift(live.layout, i, live.slot, live.offsets[i]);
      const was = live.painted.get(el);
      // A recycled or newly rendered row jumps to its spot instead of sliding there.
      if (!lifted && !live.settling && (was === undefined ? live.primed : was !== i)) {
        el.style.transition = 'none';
        recycled.push(el);
      }
      live.painted.set(el, i);
      el.classList.toggle(LIFTED, lifted);
      el.style.transform = Math.abs(y) < 0.5 ? '' : `translateY(${y}px)`;
      if (lifted && i === live.grabIndex && live.roots.length > 1)
        el.setAttribute('data-tbw-drag-count', String(live.roots.length));
      else el.removeAttribute('data-tbw-drag-count');
    }
    live.primed = true;
    if (recycled.length) {
      void body.offsetHeight;
      for (const el of recycled) el.style.transition = '';
    }
  }

  /** Re-render or scroll under a held drag: re-place rows, or end the drag if the rows changed. */
  #liveRefresh(live: LiveRowDrag<T>): void {
    if (this.#rows.length !== live.view.length || this.#rows[live.grabIndex] !== live.grabbed) {
      this.#cancelLivePointer?.();
      this.#endLive();
      return;
    }
    if (live.settling) this.#paint(live);
    else this.#follow(live);
  }

  scrolled(): void {
    if (!this.#live || this.#scrollFrame) return;
    this.#scrollFrame = requestAnimationFrame(() => {
      this.#scrollFrame = 0;
      const live = this.#live;
      if (live && !live.settling) this.#follow(live);
    });
  }

  /** Release: settle into the open room, then commit once; a rejected target reverts. */
  #liveDrop(): void {
    const live = this.#live;
    if (!live || live.settling) return;
    this.#host.scroller()?.stop();
    if (this.#el) suppressNextClick(this.#el);
    const noop = live.slot === live.layout.home && live.layout.contiguous;
    if (live.invalid !== null || !live.target || noop) {
      this.#revertLive();
      return;
    }
    live.settling = true;
    live.blockTop = live.layout.slotTops[live.slot];
    const settle = this.#host.settleMs();
    for (const el of this.#grid._bodyEl?.querySelectorAll<HTMLElement>(`.${LIFTED}`) ?? [])
      el.style.transition = settle ? `transform ${settle}ms ease-out` : 'none';
    this.#paint(live);
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = undefined;
      this.#commitLive(live);
    }, settle);
  }

  /** The only point a live drag persists anything: one cancelable `row-move`. */
  #commitLive(live: LiveRowDrag<T>): void {
    const target = live.target;
    if (this.#live !== live || !target) return;
    const lists = moveRows(live.roots, target, live.tree);
    const top = lists.get(null) ?? [...(this.#sourceRows as T[])];
    const detail: RowMoveDetail<T> = {
      row: live.grabbed,
      fromIndex: live.grabIndex,
      toIndex: live.slot + live.layout.block.indexOf(live.grabIndex),
      rows: top,
      source: 'drag',
      movedRows: live.roots,
      targetParent: target.parent,
      targetIndex: target.index,
    };
    if (this.#host.emit('row-move', detail)) {
      this.#revertLive();
      return;
    }
    const total = (lists.get(target.parent) ?? []).length;
    this.#endLive();
    const field = this.#grid.getPluginByName?.('tree')?.getChildrenField() ?? 'children';
    for (const [parent, children] of lists) if (parent !== null) (parent as Record<string, unknown>)[field] = children;
    // Same task as clearing the transforms; the body re-renders before the next paint.
    this.#grid.rows = top;
    this.#announceNow(fillMessage(this.#messages.drop, { position: target.index + 1, total }));
  }

  /** Escape, a rejected release or a cancelled `row-move`: everything slides back. */
  #revertLive(): void {
    const live = this.#live;
    if (!live) return;
    live.settling = true;
    this.#host.scroller()?.stop();
    this.#setInvalid(live, null);
    clearTimeout(this.#settleTimer);
    for (const el of this.#grid._bodyEl?.querySelectorAll<HTMLElement>('.data-grid-row') ?? []) {
      el.classList.remove(LIFTED);
      el.removeAttribute('data-tbw-drag-count');
      el.style.transition = '';
      el.style.transform = '';
    }
    this.#announceNow(this.#messages.cancel);
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = undefined;
      this.#endLive();
    }, this.#host.settleMs());
  }

  /** Drop all live-preview state and inline styles at once. */
  #endLive(): void {
    clearTimeout(this.#settleTimer);
    this.#settleTimer = undefined;
    clearTimeout(this.#announceTimer);
    cancelAnimationFrame(this.#scrollFrame);
    this.#scrollFrame = 0;
    const live = this.#live;
    this.#live = null;
    this.#reasonEl?.remove();
    this.#reasonEl = this.#reasonOrigin = null;
    const gridEl = this.#el;
    if (!gridEl || !live) return;
    gridEl.removeAttribute(LIFT_ATTR);
    gridEl.removeAttribute(INVALID_ATTR);
    for (const el of this.#grid._bodyEl?.querySelectorAll<HTMLElement>('.data-grid-row') ?? []) {
      el.classList.remove(LIFTED);
      el.removeAttribute('data-tbw-drag-count');
      el.style.transition = 'none';
      el.style.transform = '';
    }
    requestAnimationFrame(() => {
      for (const el of this.#grid._bodyEl?.querySelectorAll<HTMLElement>('.data-grid-row') ?? [])
        el.style.transition = '';
    });
  }

  #announceNow(text: string): void {
    clearTimeout(this.#announceTimer);
    if (this.#el) announce(this.#el, text);
  }

  /** Positions change quickly while dragging; announce only where the pointer rests. */
  #announceLater(text: string): void {
    clearTimeout(this.#announceTimer);
    this.#announceTimer = setTimeout(() => this.#announceNow(text), 300);
  }
}
