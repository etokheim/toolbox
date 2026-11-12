/**
 * Row Drag-Drop Plugin Types
 *
 * Public types for {@link RowDragDropPlugin} — drag rows within a single grid
 * **and** between grids that share a `dropZone` identifier.
 */

import type { ControlRenderer, PublicGrid } from '../../core/types';
import type { RowDragPayload } from '../shared/drag-drop-protocol';

// Re-exported so consumers can import it from the plugin's public entry point
// without reaching into `plugins/shared`. The wire format is owned by the
// protocol module because the encode/decode/validate pair lives there.
export type { RowDragPayload };

/** State and native binding for one row's drag control. @since 3.9.0 */
export interface RowDragHandleContext<T = unknown> {
  grid: PublicGrid<T> & HTMLElement;
  host: HTMLElement;
  row: T;
  /** Existing getRowId / id / _id contract; undefined for rows without identity. */
  rowId: string | undefined;
  /** Current processed position, not a durable identity. */
  rowIndex: number;
  ariaLabel: string;
  /** Pickup eligibility only; destinations still run their own validation. */
  disabled: boolean;
  dragging: boolean;
  /**
   * Register one HTML handle root (a button may contain SVG). Use as a React ref
   * or call while constructing a DOM control. Null unbinds it. The plugin owns
   * draggable, click-to-menu and keyboard wiring; do not duplicate those handlers.
   */
  bindHandle(element: HTMLElement | null): void;
}

/**
 * Configuration for {@link RowDragDropPlugin}.
 *
 * @since 2.4.0
 */
export interface RowDragDropConfig<T = unknown> {
  // === Intra-grid ===

  /**
   * Custom drag control; omitted preserves the original grip, null renders nothing.
   * Bind the HTML root with context.bindHandle. Persistent ControlViews receive
   * updates without remounting. Opting in evaluates canDrag during control refresh,
   * so that callback must be a pure predicate. Moves still validate at activation.
   * @since 3.9.0
   */
  dragHandleRenderer?: ControlRenderer<RowDragHandleContext<T>>;

  /**
   * Enable keyboard shortcuts (`Alt + ↑` / `Alt + ↓`) for moving rows.
   * Keyboard moves are intra-grid only. `Ctrl + ↑/↓` is also accepted but
   * deprecated (unavailable on macOS) and will be removed in the next major.
   * @default true
   */
  enableKeyboard?: boolean;

  /**
   * Show a drag handle column.
   *
   * Defaults to `true` when {@link RowDragDropConfig.dragFrom dragFrom} is
   * `'handle'` (the default) or `'both'`, and to `false` when `dragFrom` is
   * `'row'` — when the entire row is the drag handle, the dedicated grip
   * column adds no value. Set explicitly to override.
   * @default true (or false when `dragFrom: 'row'`)
   */
  showDragHandle?: boolean;

  /**
   * Where on a row a drag can be initiated.
   *
   * - `'handle'` (default): only the grip column starts a drag.
   * - `'row'`: any cell starts a drag, and the grip column is hidden by
   *   default. Recommended for transfer-list / kanban-style UIs where a
   *   dedicated handle adds visual noise.
   * - `'both'`: either the grip OR any cell starts a drag.
   *
   * Row-origin drags on interactive descendants (inputs, buttons, anchors,
   * contenteditable, open cell editors, selection checkboxes) are suppressed.
   * A custom button explicitly registered with bindHandle is an intentional
   * handle; independent interactive descendants inside it remain excluded.
   * @default 'handle'
   */
  dragFrom?: 'handle' | 'row' | 'both';

  /**
   * Position of the drag handle column.
   * @default 'left'
   */
  dragHandlePosition?: 'left' | 'right';

  /**
   * Width of the drag handle column in pixels.
   * @default 40
   */
  dragHandleWidth?: number;

  /**
   * Debounce time in milliseconds for rapid keyboard moves.
   * Events are batched and emitted after this delay.
   * @default 150
   */
  debounceMs?: number;

  /**
   * Animation type for row movement.
   * - `false`: instant reorder
   * - `'flip'`: FLIP animation (slides rows smoothly)
   * @default 'flip'
   */
  animation?: false | 'flip';

  /**
   * Validation callback invoked at `dragstart` and on intra-grid keyboard moves
   * to decide whether a row can be picked up. Custom drag handle renderers also
   * evaluate it during visual refresh and activation; keep this predicate pure.
   * Omitted renderers retain the original lazy evaluation.
   *
   * @param row   The row about to be dragged.
   * @param index The row's current index in the source grid's `_rows`.
   * @returns `false` to block the drag.
   */
  canDrag?: (row: T, index: number) => boolean;

  // === Cross-grid ===

  /**
   * Shared zone identifier. Two grids that opt into the same zone may
   * exchange rows. Omit for intra-grid reordering only, with no cross-grid
   * affordances.
   */
  dropZone?: string;

  /**
   * Cross-grid drop semantics.
   * - `'move'` (default): the row is removed from the source grid's `_rows`
   *   and inserted into the target.
   * - `'copy'`: the source `_rows` is unchanged; the target inserts a copy.
   *
   * The user's input `sourceRows` array is never mutated on either side —
   * persistence is consumer-driven via the `row-transfer` event.
   *
   * @default 'move'
   */
  operation?: 'copy' | 'move';

  /**
   * Validation callback invoked during `dragover` (same-window) and at drop
   * time to decide whether a drop should be accepted at `targetIndex`.
   *
   * For intra-grid drops, `payload.sourceGridId` equals this grid's id.
   *
   * @returns `false` to reject the drop.
   */
  canDrop?: (payload: RowDragPayload<T>, targetIndex: number) => boolean;

  /**
   * Optional row transformer applied when a row leaves this grid in a
   * cross-window / cross-iframe drag (i.e. when the WeakRef live-reference
   * path cannot be used). Use to strip internal IDs or rename fields before
   * the row crosses a security boundary.
   *
   * Same-window drops use live references and bypass this hook entirely.
   */
  serializeRow?: (row: T) => unknown;

  /**
   * Optional row transformer applied when a row lands in this grid via a
   * cross-window / cross-iframe drag. Use to assign new IDs or remap fields.
   *
   * Same-window drops use live references and bypass this hook entirely.
   */
  deserializeRow?: (raw: unknown) => T;

  /**
   * Auto-scroll the target grid when the cursor approaches its viewport top
   * or bottom edge during drag.
   *
   * - `true` (default): enable with the default tuning
   *   (`edgeSize: 60`, `speed: 8`, `maxSpeed: 24`).
   * - `false`: disabled.
   * - object: overrides any of the tuning fields.
   *
   * @default true
   */
  autoScroll?: boolean | { edgeSize?: number; speed?: number; maxSpeed?: number };

  /**
   * Lifted, smooth intra-grid drag for mouse and pen. Once the pointer
   * travels 6px the dragged rows lift (shadow, no drag image) and follow the
   * pointer vertically; neighbouring rows slide aside to open room. Release
   * settles the rows, then commits once through `row-move`; `Escape` or a
   * release over an invalid target reverts. Touch keeps the native drag.
   *
   * With `dragFrom: 'row' | 'both'` the drag may start from anywhere on the
   * row, including links and checkboxes (their native link drag is
   * suppressed; a plain click keeps its meaning). Buttons, text inputs,
   * selects, open editors, selected text and elements marked
   * `data-tbw-no-row-drag` / `.tbw-no-row-drag` never start a drag. The click
   * that ends a drag is suppressed, so a drop never also activates the row or
   * link. Only the drag handle (and `dragFrom: 'row'` rows) shows the grab cursor.
   *
   * Tree-aware with the Tree plugin: a dragged parent carries its subtree,
   * a row never lands inside its own subtree, and the drop target parent is
   * resolved from the gap the rows land in. The gap right below a parent with
   * no visible child — empty (`children: []`) or collapsed — drops into it at
   * index 0; resting there opens a collapsed parent (see `expandOnHoverDelay`)
   * without ending the drag.
   *
   * @default false
   * @since 3.11.0
   */
  livePreview?: boolean;

  /**
   * Live preview with the Tree plugin only. Milliseconds the accepted drop
   * target must rest inside a collapsed parent before the parent expands
   * (through the Tree plugin's `toggle`, so `tree-expand` fires). The drag
   * keeps going over the new rows. `false` never expands.
   *
   * @default 600
   * @since 3.11.0
   */
  expandOnHoverDelay?: number | false;

  /**
   * Live preview only. Classifies rows for multi-row drags: when the grabbed
   * row is selected, only selected rows whose type equals the grabbed row's
   * type move with it. Rows without a type match each other.
   *
   * @since 3.11.0
   */
  rowType?: (row: T) => string | undefined;

  /**
   * Live preview only. Decides whether the dragged rows may land in a
   * target. Return `{ reason }` to reject with a message shown next to the
   * pointer and announced to screen readers; `false` rejects with the
   * generic message. On a rejected target no room opens and the cursor shows
   * `not-allowed`; releasing there reverts. `canDrop` is still consulted.
   *
   * @since 3.11.0
   */
  canDropAt?: (context: RowDropTargetContext<T>) => boolean | { reason: string };

  /**
   * Live preview only. Veto starting a pointer drag, e.g. while the app is
   * in a spreadsheet or selection mode. Return `false` to leave the press to
   * other features.
   *
   * @since 3.11.0
   */
  shouldStartDrag?: (context: RowDragStartContext<T>) => boolean;

  /**
   * Live preview only. Screen-reader announcements and the default
   * invalid-target text. Each entry overrides the English default.
   *
   * @since 3.11.0
   */
  liveMessages?: Partial<RowLiveMessages>;
}

/**
 * Where a live-preview drag would land, passed to `canDropAt`.
 *
 * @since 3.11.0
 */
export interface RowDropTargetContext<T = unknown> {
  /** Rows that move (the grabbed row plus same-type selected rows; descendants travel inside their parents). */
  rows: T[];
  /** The row the pointer grabbed. */
  row: T;
  /** Parent the rows would land under; `null` for the top level (or for flat data). */
  targetParent: T | null;
  /** Insertion index among the target parent's children (or the top-level rows), with the moving rows removed. */
  index: number;
  /** Visible row directly above the gap, if any. */
  prevRow: T | undefined;
  /** Visible row directly below the gap, if any. */
  nextRow: T | undefined;
}

/**
 * Passed to `shouldStartDrag` before a live-preview drag arms.
 *
 * @since 3.11.0
 */
export interface RowDragStartContext<T = unknown> {
  /** Row under the press. */
  row: T;
  /** Its index in the processed rows. */
  index: number;
  /** The originating `pointerdown`. */
  event: PointerEvent;
  /** Whether the press started on the drag handle or elsewhere on the row. */
  origin: 'handle' | 'row';
}

/**
 * Live-preview announcement texts. `{count}`, `{position}` and `{total}` are
 * replaced with numbers.
 *
 * @since 3.11.0
 */
export interface RowLiveMessages {
  /** @default 'Picked up {count} row(s).' */
  start: string;
  /** @default 'Position {position} of {total}.' */
  position: string;
  /** @default 'Cannot drop here.' */
  invalid: string;
  /** @default 'Move cancelled.' */
  cancel: string;
  /** @default 'Dropped at position {position} of {total}.' */
  drop: string;
}

/**
 * Event detail emitted when a row is moved within a single grid.
 *
 * The `row-move` event fires only for intra-grid moves. Cross-grid moves emit
 * `row-transfer` instead.
 * @since 2.4.0
 */
export interface RowMoveDetail<T = unknown> {
  /** The row that was moved. */
  row: T;
  /** The original index of the row. */
  fromIndex: number;
  /** The new index of the row. */
  toIndex: number;
  /** The full rows array in new order. */
  rows: T[];
  /** How the move was initiated. */
  source: 'keyboard' | 'drag';
  /**
   * Live preview only: every row that moved (descendants travel inside
   * their parents). With the Tree plugin, `rows` is the new top level and the
   * affected parents' children arrays are replaced once the event is not
   * cancelled; cancel it to persist the move yourself.
   * @since 3.11.0
   */
  movedRows?: T[];
  /** Live preview only: parent the rows landed under (`null` = top level). @since 3.11.0 */
  targetParent?: T | null;
  /**
   * Live preview only: insertion index among the target parent's children
   * with the moved rows removed (`0` = first child, also for an empty or
   * collapsed parent; `children.length` after removal = last).
   * @since 3.11.0
   */
  targetIndex?: number;
}

/**
 * Detail for the `row-drag-start` event (source grid).
 *
 * @since 2.4.0
 */
export interface RowDragStartDetail<T = unknown> {
  /** Rows being dragged (single row, or whole selection if dragged row is selected). */
  rows: T[];
  /** Indices of those rows in the source grid's `_rows`. */
  indices: number[];
  /** Operation requested by the source grid's config. */
  operation: 'move' | 'copy';
  /** Drop zone (empty string when the source grid is intra-grid only). */
  dropZone: string;
}

/**
 * Detail for the `row-drag-end` event (source grid).
 *
 * @since 2.4.0
 */
export interface RowDragEndDetail<T = unknown> {
  /** Rows that were being dragged. */
  rows: T[];
  /** Their indices at dragstart. */
  indices: number[];
  /** True when a target grid accepted the drop (cross-grid drops only). */
  accepted: boolean;
}

/**
 * Detail for the `row-drop` event (target grid, cancelable).
 *
 * @since 2.4.0
 */
export interface RowDropDetail<T = unknown> {
  /** Decoded payload from the source grid. */
  payload: RowDragPayload<T>;
  /** Convenience accessor — same as `payload.sourceGridId`. */
  sourceGridId: string;
  /** Final insertion index in the target grid's `_rows`. */
  targetIndex: number;
  /** Operation requested by the source grid (`'move'` | `'copy'`). */
  operation: 'move' | 'copy';
}

/**
 * Detail for the `row-transfer` event (fired on BOTH grids after success).
 *
 * @since 2.4.0
 */
export interface RowTransferDetail<T = unknown> {
  /** Rows that were transferred. */
  rows: T[];
  /** Source grid id. */
  fromGridId: string;
  /** Target grid id. */
  toGridId: string;
  /** Indices the rows occupied in the source grid's `_rows`. */
  fromIndices: number[];
  /** Insertion index in the target grid's `_rows`. */
  toIndex: number;
  /** Operation that was applied. */
  operation: 'move' | 'copy';
}

/**
 * Internal state for pending keyboard moves (debouncing).
 * @internal
 */
export interface PendingMove {
  /** Original index when debounce started. */
  originalIndex: number;
  /** Current pending index. */
  currentIndex: number;
  /** The row being moved. */
  row: unknown;
}

// Module Augmentation — register events and plugin name for type-safe lookups.
declare module '../../core/types' {
  interface DataGridEventMap<TRow = unknown> {
    /**
     * Fired when a row is reordered within a single grid (drag or keyboard).
     * Cancelable — call `preventDefault()` to revert the move.
     * Cross-grid drops emit `row-transfer` / `row-drop` instead.
     * @group Row Drag-Drop Events
     */
    'row-move': RowMoveDetail<TRow>;

    /**
     * Fired on the **source** grid when a row drag begins.
     * Cancelable — call `preventDefault()` to abort the drag.
     * @group Row Drag-Drop Events
     */
    'row-drag-start': RowDragStartDetail<TRow>;

    /**
     * Fired on the **source** grid when a row drag ends, regardless of outcome.
     * `detail.accepted` is `true` only for cross-grid drops that landed.
     * @group Row Drag-Drop Events
     */
    'row-drag-end': RowDragEndDetail<TRow>;

    /**
     * Fired on the **target** grid when a cross-grid drop is about to be
     * applied. Cancelable — call `preventDefault()` to reject the drop.
     * Not fired for intra-grid moves (those still emit `row-move`).
     * @group Row Drag-Drop Events
     */
    'row-drop': RowDropDetail<TRow>;

    /**
     * Fired on **both** the source and target grid after a successful
     * cross-grid drop. Use this to persist changes in your data store.
     * @group Row Drag-Drop Events
     */
    'row-transfer': RowTransferDetail<TRow>;
  }

  interface PluginNameMap {
    /** Primary name for the row drag-drop plugin. */
    rowDragDrop: import('./row-drag-drop-plugin').RowDragDropPlugin;
  }
}
