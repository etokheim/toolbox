/**
 * Column Reordering Plugin (Class-based)
 *
 * Provides drag-and-drop column reordering functionality for tbw-grid.
 * Supports keyboard and mouse interactions with visual feedback.
 * Uses FLIP animation technique for smooth column transitions.
 *
 * Animation respects grid-level animation.mode setting but style is plugin-configured.
 */

import { GridClasses } from '../../core/constants';
import { ensureCellVisible } from '../../core/internal/keyboard';
import { BaseGridPlugin, type PluginManifest, type PluginQuery } from '../../core/plugin/base-plugin';
import type { ColumnConfig, GridHost } from '../../core/types';
import type { ContextMenuParams, HeaderContextMenuItem } from '../context-menu/types';
import {
  type DragAlternativeAction,
  type DragAlternativeMenu,
  createDragAlternativeMenu,
  prefersInlineDragAlternative,
} from '../shared/drag-alternative-menu';
import { startPointerDrag } from '../../core/internal/pointer-drag';
import {
  canMoveColumn,
  columnOffsets,
  insertionSlots,
  moveColumn,
  measureHeader,
  nearestSlot,
  suppressNextClick,
} from './column-drag';
import { LIFTED, LivePreviewStyle } from './live-preview-style';
import styles from './reorder.css?inline';
import type { ColumnMoveDetail, ReorderConfig } from './types';

const QUERY_CAN_MOVE_COLUMN = 'canMoveColumn';
const QUERY_GET_CONTEXT_MENU_ITEMS = 'getContextMenuItems';

/** Menu order band for column moving — after pinning (40-49). */
const MOVE_ITEM_ORDER = 50;

/** Grid attribute present while FLIP transforms are in flight. */
const FLIP_ATTR = 'data-tbw-reorder-flip';

/** An in-flight drag with `livePreview` enabled. */
interface LiveDrag {
  /** Column order when the drag started — the rollback target. */
  original: string[];
  /** Fields being dragged, in display order. */
  dragged: string[];
  /** Field reported as `column-move` detail.field. */
  primary: string;
  /** Rendered width of every visible column, measured at drag start. */
  widths: Map<string, number>;
  /** Slot of every visible column in the original order, relative to the first column. */
  lefts: Map<string, number>;
  /** Distance from the header row's left edge to the first column's slot. */
  origin: number;
  /** Pointer distance from the dragged block's left edge when the drag began. */
  grab: number;
  /** The other columns, in original order; the block is inserted among them. */
  rest: string[];
  /** Left edge of the block for each insertion position into `rest`. */
  slots: number[];
  /** Whether each insertion position is a valid drop. */
  allowed: boolean[];
  /** Insertion position of the original order. */
  home: number;
  /** Insertion position currently previewed. */
  slot: number;
  /** Order currently previewed. */
  order: string[];
  /** Per-field offsets of the current preview; stationary fields are omitted. */
  deltas: Map<string, number>;
  /** Lifted header cells following the pointer (pointer drags only). */
  lifted: HTMLElement[] | null;
  /** Last pointer x, replayed while edge auto-scroll moves the content. */
  lastX: number;
  /** Pending auto-scroll frame. */
  frame: number;
}

/** Grid attribute present while a header is lifted by a pointer drag. */
const LIFT_ATTR = 'data-tbw-reorder-lifting';
/** Pointer travel before a press on a header becomes a drag. */
const LIFT_THRESHOLD = 4;
/** Distance another slot must win by before the preview changes. */
const SLOT_HYSTERESIS = 8;
/** Width of the edge zones that auto-scroll a wide grid during a pointer drag. */
const EDGE = 32;

const sameOrder = (a: string[], b: string[]): boolean => a.length === b.length && a.every((f, i) => f === b[i]);

/**
 * Column Reorder Plugin for tbw-grid
 *
 * Lets users rearrange columns by dragging and dropping column headers. Supports smooth
 * FLIP animations, fade transitions, or instant reordering. Animation respects the
 * grid-level `animation.mode` setting.
 *
 * ## Installation
 *
 * ```ts
 * import { ReorderPlugin } from '@toolbox-web/grid/plugins/reorder-columns';
 * ```
 *
 * ## Keyboard Shortcuts
 *
 * | Key | Action |
 * |-----|--------|
 * | `Alt + ←` | Move focused column left |
 * | `Alt + →` | Move focused column right |
 *
 * ## Events
 *
 * | Event | Detail | Cancelable | Description |
 * |-------|--------|------------|-------------|
 * | `column-move` | `{ field, fromIndex, toIndex, columnOrder }` | Yes | Fired when a column move is attempted |
 *
 * @example Basic Drag-and-Drop Reordering
 * ```ts
 * import { queryGrid } from '@toolbox-web/grid';
 * import { ReorderPlugin } from '@toolbox-web/grid/plugins/reorder-columns';
 *
 * const grid = queryGrid('tbw-grid');
 * grid.gridConfig = {
 *   columns: [
 *     { field: 'id', header: 'ID' },
 *     { field: 'name', header: 'Name' },
 *     { field: 'email', header: 'Email' },
 *   ],
 *   plugins: [new ReorderPlugin({ animation: 'flip', animationDuration: 200 })],
 * };
 *
 * // Persist column order
 * grid.on('column-move', ({ columnOrder }) => {
 *   localStorage.setItem('columnOrder', JSON.stringify(columnOrder));
 * });
 * ```
 *
 * @example Prevent Moves That Break Group Boundaries
 * ```ts
 * grid.on('column-move', (detail, e) => {
 *   if (!isValidMoveWithinGroup(detail.field, detail.fromIndex, detail.toIndex)) {
 *     e.preventDefault(); // Column snaps back to original position
 *   }
 * });
 * ```
 *
 * @see {@link ReorderConfig} for all configuration options
 * @see {@link ColumnMoveDetail} for the event detail structure
 * @see GroupingColumnsPlugin for column group integration
 *
 * @internal Extends BaseGridPlugin
 * @since 1.24.0
 */
export class ReorderPlugin extends BaseGridPlugin<ReorderConfig> {
  /** @internal */
  readonly name = 'reorderColumns';
  /** @internal */
  override readonly aliases = ['reorder'] as const;
  /** @internal */
  override readonly styles = styles;

  /**
   * Plugin manifest - declares handled queries.
   * @internal
   */
  static override readonly manifest: PluginManifest = {
    queries: [
      {
        type: QUERY_CAN_MOVE_COLUMN,
        description: 'Authoritative check for whether a column may be reordered (honors lockPosition).',
      },
      {
        type: QUERY_GET_CONTEXT_MENU_ITEMS,
        description: 'Contributes the click-only column move actions (WCAG 2.2 SC 2.5.7) to the header context menu.',
      },
    ],
  };

  /** @internal */
  override handleQuery(query: PluginQuery): unknown {
    if (query.type === QUERY_CAN_MOVE_COLUMN) {
      const column = query.context as ColumnConfig | undefined;
      return column ? canMoveColumn(column) : undefined;
    }
    if (query.type === QUERY_GET_CONTEXT_MENU_ITEMS) {
      const params = query.context as ContextMenuParams | undefined;
      if (!params?.isHeader) return undefined;
      return this.#moveActions(params.field)?.map((action, i): HeaderContextMenuItem => ({
        id: `reorder-${i}`,
        label: action.label,
        disabled: action.disabled,
        action: action.run,
        order: MOVE_ITEM_ORDER + i,
      }));
    }
    return undefined;
  }

  /** @internal */
  protected override get defaultConfig(): Partial<ReorderConfig> {
    return {
      animation: 'flip', // Plugin's own default
    };
  }

  /**
   * Resolve animation type from plugin config.
   * Uses base class isAnimationEnabled to respect grid-level settings.
   */
  private get animationType(): false | 'flip' | 'fade' {
    // Check if animations are globally disabled
    if (!this.isAnimationEnabled) return false;

    // Plugin config (with default from defaultConfig)
    if (this.config.animation !== undefined) return this.config.animation;

    return 'flip'; // Plugin default
  }

  /**
   * Get animation duration, allowing plugin config override.
   * Uses base class animationDuration for default.
   */
  protected override get animationDuration(): number {
    // Plugin config override
    if (this.config.animationDuration !== undefined) {
      return this.config.animationDuration;
    }
    return super.animationDuration;
  }

  // #region Internal State
  private isDragging = false;
  private draggedField: string | null = null;
  private draggedIndex: number | null = null;
  private dropIndex: number | null = null;
  /** When dragging a group header, holds the field names in that fragment. */
  private draggedGroupFields: string[] = [];
  /** Initial column order (captured after order-attribute reordering). Used by resetColumnOrder(). */
  private originalColumnOrder: string[] | null = null;
  /** Lazily created click-only move menu (WCAG 2.2 SC 2.5.7). */
  private moveMenu: DragAlternativeMenu | null = null;
  /** Active live-preview drag, or `null` (also `null` for classic drags). */
  #live: LiveDrag | null = null;
  /** Stylesheet holding the preview transforms, so recycled body rows pick them up too. */
  #previewStyle = new LivePreviewStyle(
    () => this.gridElement,
    (cell) => this.getGroupFragmentFields(cell, ''),
    () => (this.animationType ? this.animationDuration : 0),
  );
  /** Pending commit while a released header settles into its slot. */
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** A mouse/pen press on a header that may become a lifted drag; blocks the native drag. */
  #pointerArmed = false;
  #cancelPointer: (() => void) | null = null;
  #flipToken = 0;

  /** Typed internal grid accessor. */
  get #internalGrid(): GridHost {
    return this.grid;
  }

  /**
   * Check if a column can be moved, considering both column config and plugin queries.
   *
   * The local `canMoveColumn(column)` check (lockPosition / suppressMovable) runs first;
   * cross-plugin vetoes (e.g. PinnedColumnsPlugin blocking sticky columns) are then
   * collected via the `canMoveColumn` query. Other plugins (e.g. VisibilityPlugin) get
   * the same answer by querying — ReorderPlugin's `handleQuery` returns the local check.
   */
  private canMoveColumnWithPlugins(column: ColumnConfig | undefined): boolean {
    if (!column || !canMoveColumn(column)) return false;
    const responses = this.grid.query<boolean>(QUERY_CAN_MOVE_COLUMN, column);
    return !responses.includes(false);
  }

  /**
   * Add the click-only move control to a movable header cell.
   *
   * WCAG 2.2 SC 2.5.7 "Dragging Movements" is **not** satisfied by the
   * `Alt + Arrow` shortcuts: the criterion is about pointer input, and the W3C
   * Understanding text is explicit that a keyboard equivalent only counts when
   * it also exposes controls that can be clicked or tapped. The alternative is
   * always reachable from the header's context menu; this button is the extra,
   * opt-in affordance for `a11y.dragAlternatives: 'inline'`.
   *
   * It costs ~24px of every header cell — it is a flex sibling of the label
   * rather than an overlay, because an overlay would swallow the header's own
   * click-to-sort target on narrow columns — so it is removed again as soon as
   * the mode no longer calls for it.
   */
  #syncMoveControl(headerEl: HTMLElement, field: string, column: ColumnConfig | undefined): void {
    this.#syncInlineMoveButton(headerEl, `Move column ${String(column?.header ?? field)}`, (btn) =>
      this.#openMoveMenu(btn, field),
    );
  }

  /**
   * Add or remove the inline `\u2194` button on `hostEl` according to the current
   * drag-alternative mode. Shared by header cells and group header cells so the
   * two affordances can never drift apart.
   */
  #syncInlineMoveButton(hostEl: HTMLElement, ariaLabel: string, open: (btn: HTMLElement) => void): void {
    const existing = hostEl.querySelector<HTMLElement>(':scope > .tbw-col-move-btn');
    if (!prefersInlineDragAlternative(this.grid)) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tbw-col-move-btn';
    btn.tabIndex = -1;
    // Not draggable, or a press on the button would start an HTML5 column drag.
    btn.draggable = false;
    btn.textContent = '\u2194';
    btn.setAttribute('aria-label', ariaLabel);
    // Stop the press from reaching the header's sort handler or the drag start.
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      open(btn);
    });
    hostEl.appendChild(btn);
  }

  /**
   * The single-click move actions for `field`, or `null` when the column
   * cannot be moved. Shared by the standalone menu and the `getContextMenuItems`
   * contribution so the two can never drift apart.
   */
  #moveActions(field: string): DragAlternativeAction[] | null {
    const column = this.columns.find((c) => c.field === field);
    if (!this.canMoveColumnWithPlugins(column)) return null;

    const order = this.getColumnOrder();
    const fromIndex = order.indexOf(field);
    if (fromIndex === -1) return null;

    const firstMovable = order.findIndex((f) => this.#isMoveTarget(f));
    let lastMovable = -1;
    for (let i = order.length - 1; i >= 0; i--) {
      if (this.#isMoveTarget(order[i])) {
        lastMovable = i;
        break;
      }
    }
    return [
      {
        label: 'Move left',
        disabled: !this.#canStep(order, fromIndex, -1),
        run: () => this.moveColumn(field, fromIndex - 1),
      },
      {
        label: 'Move right',
        disabled: !this.#canStep(order, fromIndex, 1),
        run: () => this.moveColumn(field, fromIndex + 1),
      },
      {
        label: 'Move to start',
        disabled: firstMovable === -1 || firstMovable === fromIndex,
        run: () => this.moveColumn(field, firstMovable),
      },
      {
        label: 'Move to end',
        disabled: lastMovable === -1 || lastMovable === fromIndex,
        run: () => this.moveColumn(field, lastMovable),
      },
    ];
  }

  /** Open the click-only move menu anchored to a header cell or its move button. */
  #openMoveMenu(anchor: HTMLElement, field: string): void {
    const actions = this.#moveActions(field);
    if (!actions) return;
    const column = this.columns.find((c) => c.field === field);

    this.moveMenu ??= createDragAlternativeMenu('tbw-col-move-menu', 'tbw-col-move-menu');
    this.moveMenu.open(anchor, `Move column ${String(column?.header ?? field)}`, actions);
  }

  /**
   * The group-row fragments in visual order, each as the fields it spans.
   *
   * Read back from the DOM rather than from the group config because a fragment
   * is what the user actually sees and drags: `mergeGroups` splits one configured
   * group into several cells when pinning or an interleaved utility column breaks
   * its span, and each of those cells moves independently.
   */
  #groupFragments(gridEl: HTMLElement): { id: string; fields: string[] }[] {
    const visible = this.visibleColumns;
    const fragments: { id: string; fields: string[] }[] = [];

    gridEl.querySelectorAll<HTMLElement>('.header-group-row > .cell[data-group]').forEach((cell) => {
      const id = cell.getAttribute('data-group');
      if (!id) return;
      const fields = this.getGroupFragmentFields(cell, id);
      if (fields.length > 0) fragments.push({ id, fields });
    });

    // The cells are appended in span order, but a plugin may re-parent them.
    return fragments.sort(
      (a, b) => visible.findIndex((c) => c.field === a.fields[0]) - visible.findIndex((c) => c.field === b.fields[0]),
    );
  }

  /**
   * The single-click move actions for a group fragment, or `null` when the
   * fragment cannot be moved.
   *
   * A step moves the whole fragment past its whole neighbour — landing *inside*
   * a neighbouring group would split that group, which dragging cannot do either.
   * A neighbour that holds even one locked column disables the step rather than
   * being skipped, since moving past it would still shift its index.
   */
  #groupMoveActions(gridEl: HTMLElement, fragmentFields: string[]): DragAlternativeAction[] | null {
    if (!fragmentFields.every((f) => this.#isMoveTarget(f))) return null;

    const fragments = this.#groupFragments(gridEl);
    const at = fragments.findIndex((f) => f.fields[0] === fragmentFields[0]);
    if (at === -1) return null;

    const movable = (fragment: { fields: string[] } | undefined): boolean =>
      !!fragment && fragment.fields.every((f) => this.#isMoveTarget(f));
    const spanMovable = (from: number, to: number): boolean =>
      from <= to && fragments.slice(from, to + 1).every(movable);
    const move = (target: { fields: string[] }, before: boolean) => () =>
      this.executeGroupBlockMove(fragmentFields, target.fields, before);

    return [
      {
        label: 'Move left',
        disabled: !movable(fragments[at - 1]),
        run: move(fragments[at - 1] ?? { fields: fragmentFields }, true),
      },
      {
        label: 'Move right',
        disabled: !movable(fragments[at + 1]),
        run: move(fragments[at + 1] ?? { fields: fragmentFields }, false),
      },
      {
        label: 'Move to start',
        disabled: at === 0 || !spanMovable(0, at - 1),
        run: move(fragments[0], true),
      },
      {
        label: 'Move to end',
        disabled: at === fragments.length - 1 || !spanMovable(at + 1, fragments.length - 1),
        run: move(fragments[fragments.length - 1], false),
      },
    ];
  }

  /** Open the click-only move menu for a group fragment. */
  #openGroupMoveMenu(anchor: HTMLElement, groupHeaderEl: HTMLElement, fragmentFields: string[]): void {
    const gridEl = this.gridElement;
    if (!gridEl) return;
    const actions = this.#groupMoveActions(gridEl, fragmentFields);
    if (!actions) return;

    this.moveMenu ??= createDragAlternativeMenu('tbw-col-move-menu', 'tbw-col-move-menu');
    this.moveMenu.open(anchor, `Move group ${this.#groupLabel(groupHeaderEl)}`, actions);
  }

  /** The visible group label, falling back to its id when a renderer drew no text. */
  #groupLabel(groupHeaderEl: HTMLElement): string {
    const text = groupHeaderEl.textContent?.replace('\u2194', '').trim();
    return text || (groupHeaderEl.getAttribute('data-group') ?? '');
  }

  /** Whether `field` names a column this plugin is allowed to move past or onto. */
  #isMoveTarget(field: string): boolean {
    return this.canMoveColumnWithPlugins(this.columns.find((c) => c.field === field));
  }

  /** Whether stepping one position toward `dir` lands on a movable neighbour. */
  #canStep(order: string[], fromIndex: number, dir: -1 | 1): boolean {
    const toIndex = fromIndex + dir;
    if (toIndex < 0 || toIndex >= order.length) return false;
    return this.#isMoveTarget(order[toIndex]);
  }

  /**
   * Clear all drag-related classes from header cells and group header cells.
   */
  private clearDragClasses(): void {
    this.gridElement?.querySelectorAll('.header-row > .cell, .header-group-row > .cell').forEach((h) => {
      h.classList.remove(GridClasses.DRAGGING, 'drop-target', 'drop-before', 'drop-after');
    });
  }
  // #endregion

  // #region Lifecycle

  /** @internal */
  override attach(grid: import('../../core/plugin/base-plugin').GridElement): void {
    super.attach(grid);

    // Listen for reorder requests from other plugins (e.g., VisibilityPlugin)
    // Uses disconnectSignal for automatic cleanup - no need for manual removeEventListener
    this.gridElement.addEventListener(
      'column-reorder-request',
      (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.field && typeof detail.toIndex === 'number') {
          this.moveColumn(detail.field, detail.toIndex);
        }
      },
      { signal: this.disconnectSignal },
    );

    // Live preview hit-tests against the original layout rather than the
    // transformed cell under the pointer, so it listens once on the grid.
    const opts = { signal: this.disconnectSignal };
    // dragenter too: when the preview slides a cell under a still pointer, the
    // release's dragenter alone decides whether the drop is accepted.
    this.gridElement.addEventListener('dragenter', (e) => this.#onLiveDragOver(e), opts);
    this.gridElement.addEventListener('dragover', (e) => this.#onLiveDragOver(e), opts);
    this.gridElement.addEventListener('drop', (e) => this.#onLiveDrop(e), opts);
    this.gridElement.addEventListener(
      'dragleave',
      (e) => {
        const live = this.#live;
        const to = e.relatedTarget;
        if (live && !(to instanceof Node && this.gridElement.contains(to))) this.#rest(live);
      },
      opts,
    );
  }

  /** @internal */
  override detach(): void {
    if (this.#live) cancelAnimationFrame(this.#live.frame);
    this.#live = null;
    this.#cancelPointer?.();
    this.#cancelPointer = null;
    this.#pointerArmed = false;
    clearTimeout(this.#settleTimer);
    this.#settleTimer = undefined;
    this.#previewStyle.dispose();
    this.isDragging = false;
    this.draggedField = null;
    this.draggedIndex = null;
    this.dropIndex = null;
    this.draggedGroupFields = [];
    this.moveMenu?.dispose();
    this.moveMenu = null;
  }
  // #endregion

  // #region Hooks

  /** @internal */
  override afterRender(): void {
    const gridEl = this.gridElement;
    if (!gridEl) return;

    // Capture initial column order on first render (after order-attribute reordering)
    if (!this.originalColumnOrder) {
      this.originalColumnOrder = this.columns.map((c) => c.field);
    }

    const headers = gridEl.querySelectorAll('.header-row > .cell');

    headers.forEach((header) => {
      const headerEl = header as HTMLElement;
      const field = headerEl.getAttribute('data-field');
      if (!field) return;

      const column = this.columns.find((c) => c.field === field);
      if (!this.canMoveColumnWithPlugins(column)) {
        headerEl.draggable = false;
        headerEl.querySelector(':scope > .tbw-col-move-btn')?.remove();
        return;
      }

      headerEl.draggable = true;
      this.#syncMoveControl(headerEl, field, column);

      // Remove existing listeners to prevent duplicates
      if (headerEl.getAttribute('data-dragstart-bound')) return;
      headerEl.setAttribute('data-dragstart-bound', 'true');

      // The always-available pointer alternative (WCAG 2.2 SC 2.5.7): right-click,
      // long-press, and Shift+F10 all raise `contextmenu`. Skipped when the context
      // menu plugin is loaded, since it renders the same actions itself from the
      // `getContextMenuItems` contribution and two stacked menus help nobody.
      headerEl.addEventListener('contextmenu', (e: MouseEvent) => {
        if (this.grid.getPluginByName('contextMenu')) return;
        e.preventDefault();
        this.#openMoveMenu(headerEl, field);
      });

      // With livePreview, a mouse or pen lifts the header itself (no drag image)
      // instead of starting a native drag. Touch keeps the native drag.
      headerEl.addEventListener('pointerdown', (e: PointerEvent) =>
        this.#onLiftPointerDown(e, headerEl, () => [field], field),
      );

      headerEl.addEventListener('dragstart', (e: DragEvent) => {
        if (this.#pointerArmed) {
          e.preventDefault();
          return;
        }
        const currentOrder = this.getColumnOrder();
        const orderIndex = currentOrder.indexOf(field);
        this.isDragging = true;
        this.draggedField = field;
        this.draggedIndex = orderIndex;
        this.draggedGroupFields = []; // Clear any stale group state

        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', field);
        }

        headerEl.classList.add(GridClasses.DRAGGING);
        this.#startLive([field], field, e.clientX, false);
      });

      headerEl.addEventListener('dragend', () => {
        this.#cancelLive();
        this.isDragging = false;
        this.draggedField = null;
        this.draggedIndex = null;
        this.dropIndex = null;
        this.draggedGroupFields = [];
        this.clearDragClasses();
      });

      headerEl.addEventListener('dragover', (e: DragEvent) => {
        if (this.#live) return;
        e.preventDefault();
        if (!this.isDragging) return;
        // Back over its own slot: forget the last target, or releasing here would still move it.
        if (this.draggedField === field && this.draggedGroupFields.length === 0) {
          this.dropIndex = null;
          return;
        }
        // Skip if this column is part of the dragged group fragment
        if (this.draggedGroupFields.includes(field)) return;

        const rect = headerEl.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;

        const currentOrder = this.getColumnOrder();
        const orderIndex = currentOrder.indexOf(field);
        this.dropIndex = e.clientX < midX ? orderIndex : orderIndex + 1;

        this.clearDragClasses();
        // Re-mark dragged elements
        if (this.draggedGroupFields.length > 0) {
          for (const f of this.draggedGroupFields) {
            this.gridElement
              ?.querySelector(`.header-row > .cell[data-field="${f}"]`)
              ?.classList.add(GridClasses.DRAGGING);
          }
        } else if (this.draggedField) {
          this.gridElement
            ?.querySelector(`.header-row > .cell[data-field="${this.draggedField}"]`)
            ?.classList.add(GridClasses.DRAGGING);
        }
        headerEl.classList.add('drop-target');
        headerEl.classList.toggle('drop-before', e.clientX < midX);
        headerEl.classList.toggle('drop-after', e.clientX >= midX);
      });

      headerEl.addEventListener('dragleave', (e: DragEvent) => {
        // Moving onto the label, sort icon or resize handle is not leaving the cell.
        if (e.relatedTarget instanceof Node && headerEl.contains(e.relatedTarget)) return;
        headerEl.classList.remove('drop-target', 'drop-before', 'drop-after');
      });

      headerEl.addEventListener('drop', (e: DragEvent) => {
        if (this.#live) return;
        e.preventDefault();
        if (!this.isDragging) return;

        // Group fragment drop onto individual column header
        if (this.draggedGroupFields.length > 0) {
          if (this.draggedGroupFields.includes(field)) return;
          const rect = headerEl.getBoundingClientRect();
          const before = e.clientX < rect.left + rect.width / 2;
          this.executeGroupBlockMove(this.draggedGroupFields, [field], before);
          return;
        }

        // Individual column drop
        const draggedField = this.draggedField;
        const draggedIndex = this.draggedIndex;
        const dropIndex = this.dropIndex;

        if (!this.isDragging || draggedField === null || draggedIndex === null || dropIndex === null) {
          return;
        }

        const effectiveToIndex = dropIndex > draggedIndex ? dropIndex - 1 : dropIndex;
        const currentOrder = this.getColumnOrder();
        const newOrder = moveColumn(currentOrder, draggedIndex, effectiveToIndex);

        const detail: ColumnMoveDetail = {
          field: draggedField,
          fromIndex: draggedIndex,
          toIndex: effectiveToIndex,
          columnOrder: newOrder,
        };

        // Emit cancelable event first - only update if not cancelled
        const cancelled = this.emitCancelable('column-move', detail);
        if (!cancelled) {
          // Update the grid's column order (with optional view transition)
          this.updateColumnOrder(newOrder);
        }
      });
    });

    // Set up drag listeners for group header cells (if column grouping is active).
    // Deferred to a microtask because GroupingColumnsPlugin.afterRender() creates the
    // .header-group-row DOM, and it may run after this plugin in hook order.
    queueMicrotask(() => this.setupGroupHeaderDrag(gridEl));
  }

  /**
   * Set up drag-and-drop listeners on group header cells (.header-group-row > .cell).
   * Dragging a group header moves all columns in that fragment as a block.
   * Implicit groups (ungrouped column spans) are not draggable.
   */
  private setupGroupHeaderDrag(gridEl: HTMLElement): void {
    const groupHeaders = gridEl.querySelectorAll('.header-group-row > .cell[data-group]');

    groupHeaders.forEach((gh) => {
      const groupHeaderEl = gh as HTMLElement;
      const groupId = groupHeaderEl.getAttribute('data-group');
      if (!groupId || groupId.startsWith('__implicit__')) return;

      // Determine which columns are in this fragment by reading the grid-column style
      const fragmentFields = this.getGroupFragmentFields(groupHeaderEl, groupId);
      if (fragmentFields.length === 0) return;

      // Check if all columns in the fragment can be moved
      const allMovable = fragmentFields.every((f) => {
        const col = this.columns.find((c) => c.field === f);
        return this.canMoveColumnWithPlugins(col);
      });
      if (!allMovable) return;

      groupHeaderEl.draggable = true;
      groupHeaderEl.style.cursor = 'grab';

      // Re-synced every render so a change of drag-alternative mode is picked up.
      this.#syncInlineMoveButton(groupHeaderEl, `Move group ${this.#groupLabel(groupHeaderEl)}`, (btn) =>
        this.#openGroupMoveMenu(btn, groupHeaderEl, fragmentFields),
      );

      // Already bound?
      if (groupHeaderEl.getAttribute('data-group-drag-bound')) return;
      groupHeaderEl.setAttribute('data-group-drag-bound', 'true');

      // The always-available pointer alternative (WCAG 2.2 SC 2.5.7). Unlike a
      // header cell this is not skipped when the context menu plugin is loaded:
      // that plugin resolves neither a cell nor a `header-cell` part here, so it
      // already swallows the native menu on a group header without offering one.
      groupHeaderEl.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.#openGroupMoveMenu(groupHeaderEl, groupHeaderEl, fragmentFields);
      });

      groupHeaderEl.addEventListener('pointerdown', (e: PointerEvent) =>
        this.#onLiftPointerDown(e, groupHeaderEl, () => fragmentFields, fragmentFields[0]),
      );

      groupHeaderEl.addEventListener('dragstart', (e: DragEvent) => {
        if (this.#pointerArmed) {
          e.preventDefault();
          return;
        }
        this.isDragging = true;
        this.draggedField = null;
        this.draggedIndex = null;
        this.draggedGroupFields = [...fragmentFields];

        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `group:${groupId}`);
        }

        groupHeaderEl.classList.add(GridClasses.DRAGGING);
        // Also mark the individual column headers as dragging
        for (const f of fragmentFields) {
          gridEl.querySelector(`.header-row > .cell[data-field="${f}"]`)?.classList.add(GridClasses.DRAGGING);
        }
        this.#startLive(fragmentFields, fragmentFields[0], e.clientX, false);
      });

      groupHeaderEl.addEventListener('dragend', () => {
        this.#cancelLive();
        this.isDragging = false;
        this.draggedField = null;
        this.draggedIndex = null;
        this.dropIndex = null;
        this.draggedGroupFields = [];
        this.clearDragClasses();
      });

      // Group header is also a drop target for other groups / individual columns
      groupHeaderEl.addEventListener('dragover', (e: DragEvent) => {
        if (this.#live) return;
        e.preventDefault();
        if (!this.isDragging) return;
        // If dragging the same fragment, ignore
        if (
          this.draggedGroupFields.length > 0 &&
          this.draggedGroupFields.length === fragmentFields.length &&
          this.draggedGroupFields.every((f) => fragmentFields.includes(f))
        )
          return;

        const rect = groupHeaderEl.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const before = e.clientX < midX;

        this.clearDragClasses();
        groupHeaderEl.classList.add('drop-target');
        groupHeaderEl.classList.toggle('drop-before', before);
        groupHeaderEl.classList.toggle('drop-after', !before);
      });

      groupHeaderEl.addEventListener('dragleave', (e: DragEvent) => {
        if (e.relatedTarget instanceof Node && groupHeaderEl.contains(e.relatedTarget)) return;
        groupHeaderEl.classList.remove('drop-target', 'drop-before', 'drop-after');
      });

      groupHeaderEl.addEventListener('drop', (e: DragEvent) => {
        if (this.#live) return;
        e.preventDefault();
        if (!this.isDragging) return;

        const rect = groupHeaderEl.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;

        if (this.draggedGroupFields.length > 0) {
          // Group-to-group drop: move dragged fragment as block relative to this fragment
          if (
            this.draggedGroupFields.length === fragmentFields.length &&
            this.draggedGroupFields.every((f) => fragmentFields.includes(f))
          )
            return;
          this.executeGroupBlockMove(this.draggedGroupFields, fragmentFields, before);
        } else if (this.draggedField) {
          // Individual column dropped onto group header
          const currentOrder = this.getColumnOrder();
          const anchorField = before ? fragmentFields[0] : fragmentFields[fragmentFields.length - 1];
          const fromIndex = currentOrder.indexOf(this.draggedField);
          const toIndex = before ? currentOrder.indexOf(anchorField) : currentOrder.indexOf(anchorField) + 1;
          if (fromIndex === -1 || toIndex === -1) return;
          const effectiveToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
          const newOrder = moveColumn(currentOrder, fromIndex, effectiveToIndex);
          const cancelled = this.emitCancelable<ColumnMoveDetail>('column-move', {
            field: this.draggedField,
            fromIndex,
            toIndex: effectiveToIndex,
            columnOrder: newOrder,
          });
          if (!cancelled) this.updateColumnOrder(newOrder);
        }
      });
    });
  }

  /**
   * Get the column field names that belong to a group header fragment.
   * Reads the grid-column CSS style of the header cell to determine the column range.
   */
  private getGroupFragmentFields(groupHeaderEl: HTMLElement, _groupId: string): string[] {
    // Parse grid-column (e.g., "2 / span 3") to get start index and span
    const gridColumn = groupHeaderEl.style.gridColumn;
    const match = /(\d+)\s*\/\s*span\s+(\d+)/.exec(gridColumn);
    if (!match) return [];

    const startCol = parseInt(match[1], 10); // 1-based CSS grid column
    const span = parseInt(match[2], 10);

    // Map CSS grid columns to visible column fields
    const visibleColumns = this.visibleColumns;
    const fields: string[] = [];
    for (let i = startCol - 1; i < startCol - 1 + span && i < visibleColumns.length; i++) {
      const col = visibleColumns[i];
      if (col) fields.push(col.field);
    }
    return fields;
  }

  /**
   * Move a group of columns as a block to a new position relative to target fields.
   */
  private executeGroupBlockMove(draggedFields: string[], targetFields: string[], before: boolean): void {
    const currentOrder = this.getColumnOrder();
    const remaining = currentOrder.filter((f) => !draggedFields.includes(f));

    const anchorField = before ? targetFields[0] : targetFields[targetFields.length - 1];
    const insertAt = remaining.indexOf(anchorField);
    if (insertAt === -1) return;

    const insertIndex = before ? insertAt : insertAt + 1;
    const draggedInOrder = currentOrder.filter((f) => draggedFields.includes(f));
    remaining.splice(insertIndex, 0, ...draggedInOrder);

    // Emit cancelable column-move for the first field so lockGroupOrder guard can check
    const cancelled = this.emitCancelable<ColumnMoveDetail>('column-move', {
      field: draggedFields[0],
      fromIndex: currentOrder.indexOf(draggedFields[0]),
      toIndex: insertIndex,
      columnOrder: remaining,
    });
    if (!cancelled) {
      this.updateColumnOrder(remaining);
    }
  }

  /**
   * Handle Alt+Arrow keyboard shortcuts for column reordering.
   * @internal
   */
  override onKeyDown(event: KeyboardEvent): boolean | void {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
      return;
    }

    const grid = this.#internalGrid;
    const focusCol = grid._focusCol;
    const columns = grid._visibleColumns;

    if (focusCol < 0 || focusCol >= columns.length) return;

    const column = columns[focusCol];
    if (!this.canMoveColumnWithPlugins(column)) return;

    const currentOrder = this.getColumnOrder();
    const fromIndex = currentOrder.indexOf(column.field);
    if (fromIndex === -1) return;

    const toIndex = event.key === 'ArrowLeft' ? fromIndex - 1 : fromIndex + 1;

    // Check bounds
    if (toIndex < 0 || toIndex >= currentOrder.length) return;

    // Check if target position is allowed (e.g., not into pinned area)
    const targetColumn = columns.find((c) => c.field === currentOrder[toIndex]);
    if (!this.canMoveColumnWithPlugins(targetColumn)) return;

    this.moveColumn(column.field, toIndex);

    // Update focus to follow the moved column and refresh visual focus state
    grid._focusCol = toIndex;
    ensureCellVisible(this.#internalGrid);

    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  // #endregion

  // #region Public API

  /**
   * Get the current column order from the grid.
   * @returns Array of field names in display order
   */
  getColumnOrder(): string[] {
    return this.grid.getColumnOrder();
  }

  /**
   * Move a column to a new position.
   * @param field - The field name of the column to move
   * @param toIndex - The target index
   */
  moveColumn(field: string, toIndex: number): void {
    const currentOrder = this.getColumnOrder();
    const fromIndex = currentOrder.indexOf(field);
    if (fromIndex === -1) return;

    const newOrder = moveColumn(currentOrder, fromIndex, toIndex);

    // Emit cancelable event first - only update if not cancelled
    const cancelled = this.emitCancelable<ColumnMoveDetail>('column-move', {
      field,
      fromIndex,
      toIndex,
      columnOrder: newOrder,
    });
    if (!cancelled) {
      // Update with view transition
      this.updateColumnOrder(newOrder);
    }
  }

  /**
   * Set a specific column order.
   * @param order - Array of field names in desired order
   */
  setColumnOrder(order: string[]): void {
    this.updateColumnOrder(order);
  }

  /**
   * Reset column order to the original configuration order.
   */
  resetColumnOrder(): void {
    // Use the captured initial order (including order-attribute reordering),
    // or fall back to current column order if not yet captured
    const originalOrder = this.originalColumnOrder ?? this.columns.map((c) => c.field);
    this.updateColumnOrder(originalOrder);
  }
  // #endregion

  // #region Live Preview

  /** Whether live movement can run: opted in, and every column has a measurable header. */
  #canLive(): boolean {
    return !!this.config.livePreview && !!this.gridElement && !this.grid.getPluginByName('columnVirtualization');
  }

  /**
   * A mouse or pen press on a movable header: once it travels past the
   * threshold, the header lifts and follows the pointer along the header row.
   * Arming also refuses the native `dragstart`, so no drag image appears.
   */
  #onLiftPointerDown(e: PointerEvent, el: HTMLElement, fields: () => string[], primary: string): void {
    if (!this.#canLive() || e.button !== 0 || e.pointerType === 'touch') return;
    if (this.#live || this.#settleTimer !== undefined || this.#pointerArmed) return;
    if (e.target instanceof Element && e.target.closest('.resize-handle, .tbw-col-move-btn, input, select, textarea'))
      return;
    const startX = e.clientX;
    const id = e.pointerId;
    this.#pointerArmed = true;
    // Before promotion nothing is captured, so a quick move off the header (or a
    // release elsewhere) would never reach the drag: capture once it travels.
    const early = (m: PointerEvent) => {
      if (m.pointerId !== id) return;
      if (m.type === 'pointerup') {
        if (!this.#live) this.#cancelPointer?.();
      } else if (Math.hypot(m.clientX - startX, m.clientY - e.clientY) >= LIFT_THRESHOLD && !el.hasPointerCapture(id))
        el.setPointerCapture(id);
    };
    document.addEventListener('pointermove', early, true);
    document.addEventListener('pointerup', early, true);
    const disarm = () => {
      document.removeEventListener('pointermove', early, true);
      document.removeEventListener('pointerup', early, true);
      this.#pointerArmed = false;
      this.#cancelPointer = null;
    };
    this.#cancelPointer = startPointerDrag(
      e,
      el,
      {
        onPromote: () => this.#startLive(fields(), primary, startX, true),
        onMove: (pe) => {
          const live = this.#live;
          if (!live) return;
          live.lastX = pe.clientX;
          this.#follow(live);
          this.#autoScroll(live);
        },
        onEnd: () => {
          disarm();
          this.#liftDrop();
        },
        onCancel: () => {
          const lifted = !!this.#live;
          disarm();
          this.#cancelLive();
          // Escape mid-drag: the later release still clicks the header; it must not sort.
          const gridEl = this.gridElement;
          if (lifted && gridEl)
            document.addEventListener('pointerup', () => suppressNextClick(gridEl), { capture: true, once: true });
        },
      },
      { threshold: LIFT_THRESHOLD },
    );
  }

  /**
   * Begin a live-preview drag when `livePreview` is on. Measures every visible
   * column once, so slot geometry comes from the original layout and never
   * from whatever transformed cell happens to be under the pointer.
   */
  #startLive(dragged: string[], primary: string, clientX: number, lift: boolean): void {
    this.#live = null;
    const gridEl = this.gridElement;
    if (!this.#canLive()) return;
    const row = gridEl.querySelector<HTMLElement>('.header-row');
    if (!row) return;

    // Settle any rollback still sliding back, so the measurement is untransformed.
    this.#previewStyle.end(false);

    const measured = measureHeader(
      row,
      this.visibleColumns.map((c) => c.field),
      primary,
    );
    if (!measured) return;
    const { widths, lefts, origin, rowLeft } = measured;

    const original = this.getColumnOrder();
    const block = original.filter((f) => dragged.includes(f));
    const rest = original.filter((f) => !dragged.includes(f));
    const home = original.slice(0, original.indexOf(block[0])).filter((f) => !dragged.includes(f)).length;
    // A multi-column block never lands inside another explicit group.
    const groupOf = new Map<string, number>();
    this.#groupFragments(gridEl).forEach(({ id, fields }, i) => {
      if (!id.startsWith('__implicit__')) fields.forEach((f) => groupOf.set(f, i));
    });
    const { slots, allowed } = insertionSlots(
      rest,
      widths,
      home,
      (f) => this.#isMoveTarget(f),
      groupOf,
      block.length > 1,
    );

    let lifted: HTMLElement[] | null = null;
    if (lift) {
      lifted = [...gridEl.querySelectorAll<HTMLElement>('.header-row > .cell[data-field]')].filter(
        (c) => c.closest('tbw-grid') === gridEl && block.includes(c.getAttribute('data-field') ?? ''),
      );
      gridEl.querySelectorAll<HTMLElement>('.header-group-row > .cell[data-group]').forEach((c) => {
        const fields = this.getGroupFragmentFields(c, '');
        if (fields.length && fields.every((f) => block.includes(f))) lifted?.push(c);
      });
      for (const c of lifted) {
        c.classList.add(LIFTED);
        c.style.transition = 'none';
      }
      gridEl.setAttribute(LIFT_ATTR, '');
    }

    this.#live = {
      original,
      dragged: block,
      primary,
      widths,
      lefts,
      origin,
      grab: clientX - rowLeft - origin - (lefts.get(block[0]) ?? 0),
      rest,
      slots,
      allowed,
      home,
      slot: home,
      order: original,
      deltas: new Map(),
      lifted,
      lastX: clientX,
      frame: 0,
    };
    // Hides the resize handles for the whole drag, not only once a column moves.
    if (lift) this.#previewStyle.write(new Map());
  }

  /**
   * Move the block to where the pointer puts it: the lifted header follows the
   * pointer (clamped to the header lane), the other columns slide once the
   * block passes half of a neighbour. Pure geometry, so the preview cannot
   * oscillate while cells are mid-transition.
   */
  #follow(live: LiveDrag): void {
    const row = this.gridElement?.querySelector<HTMLElement>('.header-row');
    if (!row) return;
    const open = live.slots.filter((_, k) => live.allowed[k]);
    const raw = live.lastX - row.getBoundingClientRect().left - live.origin - live.grab;
    const left = Math.min(Math.max(raw, Math.min(...open)), Math.max(...open));
    live.slot = nearestSlot(live.slots, live.allowed, left, live.slot, SLOT_HYSTERESIS);
    this.#preview(live, [...live.rest.slice(0, live.slot), ...live.dragged, ...live.rest.slice(live.slot)]);
    if (!live.lifted) return;
    const dx = left - (live.lefts.get(live.dragged[0]) ?? 0);
    for (const c of live.lifted) c.style.transform = `translateX(${dx}px)`;
  }

  /** Back to the original order, e.g. once a native drag leaves the header lane. */
  #rest(live: LiveDrag): void {
    live.slot = live.home;
    this.#preview(live, live.original);
  }

  /** Scroll a wide grid while the pointer sits in an edge zone, keeping the lift under it. */
  #autoScroll(live: LiveDrag): void {
    if (live.frame || this.#live !== live) return;
    const area = this.gridElement?.querySelector<HTMLElement>('.tbw-scroll-area');
    if (!area || area.scrollWidth <= area.clientWidth) return;
    const r = area.getBoundingClientRect();
    const pinned = this.#internalGrid._getHorizontalScrollOffsets?.() ?? { left: 0, right: 0 };
    const lo = r.left + pinned.left + EDGE;
    const hi = r.right - pinned.right - EDGE;
    const over = live.lastX < lo ? live.lastX - lo : live.lastX > hi ? live.lastX - hi : 0;
    if (!over) return;
    const before = area.scrollLeft;
    area.scrollLeft += Math.sign(over) * Math.min(EDGE, 2 + Math.abs(over) / 2);
    if (area.scrollLeft === before) return;
    this.#follow(live);
    live.frame = requestAnimationFrame(() => {
      live.frame = 0;
      this.#autoScroll(live);
    });
  }

  /** A native drag (touch) over the grid: inside the header lane it previews, elsewhere it rests. */
  #onLiveDragOver(e: DragEvent): void {
    const live = this.#live;
    const gridEl = this.gridElement;
    if (!live || live.lifted || !gridEl) return;
    const rows = [...gridEl.querySelectorAll<HTMLElement>('.header-group-row, .header-row')].filter(
      (r) => r.closest('tbw-grid') === gridEl,
    );
    const top = Math.min(...rows.map((r) => r.getBoundingClientRect().top));
    const bottom = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom));
    if (!rows.length || e.clientY < top || e.clientY > bottom) {
      this.#rest(live);
      return;
    }
    live.lastX = e.clientX;
    this.#follow(live);
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  /** Native drop: commit the previewed order. */
  #onLiveDrop(e: DragEvent): void {
    const live = this.#live;
    if (!live || live.lifted) return;
    e.preventDefault();
    this.#live = null;
    this.#commit(live);
  }

  /** Pointer release: the lifted header settles into its slot, then the order commits. */
  #liftDrop(): void {
    const live = this.#live;
    if (!live) return;
    this.#live = null;
    cancelAnimationFrame(live.frame);
    // The release also clicks the header; that click must not sort.
    if (this.gridElement) suppressNextClick(this.gridElement);
    const settle = this.animationType ? this.animationDuration : 0;
    if (!settle) {
      this.#commit(live);
      return;
    }
    const dx = live.deltas.get(live.dragged[0]) ?? 0;
    for (const c of live.lifted ?? []) {
      c.style.transition = `transform ${settle}ms ease-out`;
      c.style.transform = dx ? `translateX(${dx}px)` : 'translateX(0px)';
    }
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = undefined;
      this.#commit(live);
    }, settle);
  }

  /** Commit the previewed order — the only point a live drag persists anything. */
  #commit(live: LiveDrag): void {
    this.#unlift(live);
    const order = live.order;
    if (sameOrder(order, live.original)) {
      this.#previewStyle.end(false);
      return;
    }
    const cancelled = this.emitCancelable<ColumnMoveDetail>('column-move', {
      field: live.primary,
      fromIndex: live.original.indexOf(live.primary),
      toIndex: order.indexOf(live.primary),
      columnOrder: order,
    });
    if (cancelled) {
      this.#previewStyle.end(true);
      return;
    }
    // Same task as setColumnOrder, and its body rebuild runs in the next frame
    // before paint, so the cells never show in the old order without transforms.
    this.#previewStyle.end(false);
    this.grid.setColumnOrder(order);
    this.grid.requestStateChange?.();
  }

  /** Put lifted headers down; the preview stylesheet takes over their position. */
  #unlift(live: LiveDrag): void {
    if (!live.lifted) return;
    for (const c of live.lifted) {
      c.classList.remove(LIFTED);
      c.style.transition = '';
      c.style.transform = '';
    }
    this.gridElement?.removeAttribute(LIFT_ATTR);
  }

  /** Escape, a release outside a target, or a re-render ending the drag: slide back. */
  #cancelLive(): void {
    const live = this.#live;
    if (!live) return;
    this.#live = null;
    cancelAnimationFrame(live.frame);
    this.#unlift(live);
    this.#previewStyle.end(true);
  }
  /** Show `order` by translating every cell from its original slot. */
  #preview(live: LiveDrag, order: string[]): void {
    if (sameOrder(order, live.order)) return;
    live.order = order;
    live.deltas = columnOffsets(live.original, order, live.widths);
    this.#previewStyle.write(live.deltas);
  }

  // #endregion

  // #region View Transition

  /**
   * Capture header cell positions before reorder.
   */
  private captureHeaderPositions(): Map<string, number> {
    const positions = new Map<string, number>();
    this.gridElement?.querySelectorAll('.header-row > .cell[data-field]').forEach((cell) => {
      const field = cell.getAttribute('data-field');
      if (field) positions.set(field, cell.getBoundingClientRect().left);
    });
    return positions;
  }

  /**
   * Apply FLIP animation for column reorder.
   * Uses CSS transitions - JS sets initial transform and toggles class.
   * @param oldPositions - Header positions captured before DOM change
   */
  private animateFLIP(oldPositions: Map<string, number>): void {
    const gridEl = this.gridElement;
    if (!gridEl || oldPositions.size === 0) return;

    // Compute deltas from header cells (one per column, stable reference).
    // All cells in the same column share the same horizontal offset.
    const deltas = new Map<string, number>();
    gridEl.querySelectorAll('.header-row > .cell[data-field]').forEach((cell) => {
      const field = cell.getAttribute('data-field');
      if (!field) return;
      const oldLeft = oldPositions.get(field);
      if (oldLeft === undefined) return;
      const deltaX = oldLeft - cell.getBoundingClientRect().left;
      if (Math.abs(deltaX) > 1) deltas.set(field, deltaX);
    });

    if (deltas.size === 0) return;

    // Apply transforms to ALL cells (headers + body).
    // After forceLayout(), body cells are fully rebuilt in new DOM order
    // with correct data-field attributes, so header-derived deltas apply correctly.
    const cells: HTMLElement[] = [];
    gridEl.querySelectorAll('.cell[data-field]').forEach((cell) => {
      const deltaX = deltas.get(cell.getAttribute('data-field') ?? '');
      if (deltaX !== undefined) {
        const el = cell as HTMLElement;
        el.style.transform = `translateX(${deltaX}px)`;
        cells.push(el);
      }
    });

    if (cells.length === 0) return;

    // Hides resize handles while cells are out of DOM order — see reorder.css.
    const token = ++this.#flipToken;
    gridEl.setAttribute(FLIP_ATTR, '');

    // Force reflow then animate to final position via CSS transition
    void gridEl.offsetHeight;

    const duration = this.animationDuration;

    requestAnimationFrame(() => {
      cells.forEach((el) => {
        el.classList.add('flip-animating');
        el.style.transform = '';
      });

      // Cleanup after animation
      setTimeout(() => {
        cells.forEach((el) => {
          el.style.transform = '';
          el.classList.remove('flip-animating');
        });
        if (token === this.#flipToken) gridEl.removeAttribute(FLIP_ATTR);
      }, duration + 50);
    });
  }

  /**
   * Apply crossfade animation for moved columns.
   * Uses CSS keyframes - JS just toggles classes.
   */
  private animateFade(applyChange: () => void): void {
    const gridEl = this.gridElement;
    if (!gridEl) {
      applyChange();
      return;
    }

    // Capture old positions to detect which columns moved
    const oldPositions = this.captureHeaderPositions();

    // Apply the change first
    applyChange();

    // Find which columns changed position
    const movedFields = new Set<string>();
    gridEl.querySelectorAll('.header-row > .cell[data-field]').forEach((cell) => {
      const field = cell.getAttribute('data-field');
      if (!field) return;
      const oldLeft = oldPositions.get(field);
      if (oldLeft === undefined) return;
      const newLeft = cell.getBoundingClientRect().left;
      if (Math.abs(oldLeft - newLeft) > 1) {
        movedFields.add(field);
      }
    });

    if (movedFields.size === 0) return;

    // Add animation class to moved columns (headers + body cells)
    const cells: HTMLElement[] = [];
    gridEl.querySelectorAll('.cell[data-field]').forEach((cell) => {
      const field = cell.getAttribute('data-field');
      if (field && movedFields.has(field)) {
        const el = cell as HTMLElement;
        el.classList.add('fade-animating');
        cells.push(el);
      }
    });

    if (cells.length === 0) return;

    // Remove class after animation completes
    const duration = this.animationDuration;
    setTimeout(() => {
      cells.forEach((el) => el.classList.remove('fade-animating'));
    }, duration + 50);
  }

  /**
   * Update column order with configured animation.
   */
  private updateColumnOrder(newOrder: string[]): void {
    const animation = this.animationType;

    if (animation === 'flip' && this.gridElement) {
      const oldPositions = this.captureHeaderPositions();
      this.grid.setColumnOrder(newOrder);
      // setColumnOrder now requests COLUMNS phase (not just VIRTUALIZATION), so
      // processColumns() runs and bumps __rowRenderEpoch. forceLayout() waits
      // for the pending phase to flush, ensuring body cells are fully rebuilt
      // with correct data-field attributes before the FLIP animation runs.
      if (typeof this.grid.forceLayout === 'function') {
        this.grid.forceLayout().then(() => {
          this.animateFLIP(oldPositions);
        });
      } else {
        // Fallback: animate headers only (body cells may not be rebuilt yet)
        requestAnimationFrame(() => {
          this.animateFLIP(oldPositions);
        });
      }
    } else if (animation === 'fade') {
      this.animateFade(() => this.grid.setColumnOrder(newOrder));
    } else {
      this.grid.setColumnOrder(newOrder);
    }

    this.grid.requestStateChange?.();
  }
  // #endregion
}
