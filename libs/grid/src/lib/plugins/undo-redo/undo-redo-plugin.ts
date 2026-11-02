/**
 * Undo/Redo Plugin (Class-based)
 *
 * Provides undo/redo functionality for cell edits in tbw-grid.
 * Supports Ctrl+Z/Cmd+Z for undo and Ctrl+Y/Cmd+Y (or Ctrl+Shift+Z) for redo.
 */

import { GridClasses } from '../../core/constants';
import {
  CONFIG_RULE_ERROR,
  NO_TRANSACTION,
  ROW_NOT_FOUND,
  throwDiagnostic,
  warnDiagnostic,
} from '../../core/internal/diagnostics';
import {
  captureEditTarget,
  resolveEditTarget,
  tryResolveRowId,
  type EditTarget,
} from '../../core/internal/row-identity';
import { FOCUSABLE_EDITOR_SELECTOR } from '../../core/internal/rows';
import { writeCellField } from '../../core/internal/value-accessor';
import { BaseGridPlugin, type GridElement, type PluginDependency } from '../../core/plugin/base-plugin';
import type { GridHost } from '../../core/types';
import { ExternalHistoryBridge } from './external-history';
import {
  canRedo,
  canUndo,
  clearHistory,
  createCompoundAction,
  createEditAction,
  pushAction,
  redo,
  undo,
} from './history';
import type {
  EditAction,
  HistoryChangeDetail,
  UndoRedoAction,
  UndoRedoConfig,
  UndoRedoDetail,
  UndoRedoSnapshot,
} from './types';

interface CapturedHistory {
  undoStack: UndoRedoAction[];
  redoStack: UndoRedoAction[];
  targets: WeakMap<EditAction, EditTarget>;
}

/**
 * Undo/Redo Plugin for tbw-grid
 *
 * Tracks all cell edits and lets users revert or replay changes with familiar keyboard
 * shortcuts (Ctrl+Z / Ctrl+Y). Maintains an in-memory history stack with configurable
 * depth—perfect for data entry workflows where mistakes happen.
 *
 * > **Required Dependency:** This plugin requires EditingPlugin to be loaded first.
 * > UndoRedo tracks the edit history that EditingPlugin creates.
 *
 * ## Installation
 *
 * ```ts
 * import { EditingPlugin } from '@toolbox-web/grid/plugins/editing';
 * import { UndoRedoPlugin } from '@toolbox-web/grid/plugins/undo-redo';
 * ```
 *
 * ## Keyboard Shortcuts
 *
 * | Shortcut | Action |
 * |----------|--------|
 * | `Ctrl+Z` / `Cmd+Z` | Undo last edit |
 * | `Ctrl+Y` / `Cmd+Shift+Z` | Redo last undone edit |
 *
 * @example Basic Usage with EditingPlugin
 * ```ts
 * import { queryGrid } from '@toolbox-web/grid';
 * import { EditingPlugin } from '@toolbox-web/grid/plugins/editing';
 * import { UndoRedoPlugin } from '@toolbox-web/grid/plugins/undo-redo';
 *
 * const grid = queryGrid('tbw-grid');
 * grid.gridConfig = {
 *   columns: [
 *     { field: 'name', header: 'Name', editable: true },
 *     { field: 'price', header: 'Price', type: 'number', editable: true },
 *   ],
 *   plugins: [
 *     new EditingPlugin({ editOn: 'dblclick' }), // Required - must be first
 *     new UndoRedoPlugin({ maxHistorySize: 50 }),
 *   ],
 * };
 * ```
 *
 * @see {@link UndoRedoConfig} for configuration options
 * @see EditingPlugin for the required dependency
 *
 * @internal Extends BaseGridPlugin
 * @since 0.1.1
 */
export class UndoRedoPlugin extends BaseGridPlugin<UndoRedoConfig> {
  static #snapshots = new WeakMap<UndoRedoSnapshot, CapturedHistory>();

  /**
   * Plugin dependencies - UndoRedoPlugin requires EditingPlugin to track edits.
   *
   * The EditingPlugin must be loaded BEFORE this plugin in the plugins array.
   * @internal
   */
  static override readonly dependencies: PluginDependency[] = [
    { name: 'editing', required: true, reason: 'UndoRedoPlugin tracks cell edit history' },
  ];

  /** @internal */
  readonly name = 'undoRedo';

  /** @internal */
  protected override get defaultConfig(): Partial<UndoRedoConfig> {
    return {
      maxHistorySize: 100,
    };
  }

  // State as class properties
  private undoStack: UndoRedoAction[] = [];
  private redoStack: UndoRedoAction[] = [];

  // Coordinates in public actions describe the original edit, not its current owner.
  #targets = new WeakMap<EditAction, EditTarget>();
  #attached = false;
  #historyActivity = 0;
  #restoring = false;
  #external?: ExternalHistoryBridge;

  /** Suppresses recording during undo/redo to prevent feedback loops. */
  #suppressRecording = false;

  /** Accumulates edits during a transaction; `null` when no transaction is active. */
  #transactionBuffer: EditAction[] | null = null;

  /**
   * Open-transaction nesting depth. `beginTransaction` increments, `endTransaction`
   * decrements; the buffer is only finalized when it returns to 0. Nesting lets a
   * synchronous burst of commits (e.g. a multi-cell paste routed through
   * `updateRows`, where each cell fires `cell-commit` and consumers bracket it
   * with `beginTransaction()`/`queueMicrotask(endTransaction)`) coalesce into a
   * single compound undo entry instead of throwing "already in progress".
   */
  #transactionDepth = 0;
  #pendingFocus: EditAction | null = null;

  #captureTarget(action: EditAction, row: unknown): void {
    const target = captureEditTarget(this.grid, row);
    this.#targets.set(action, target);
    if (target.rowId !== undefined) action.rowId = target.rowId;
  }

  #resolveTarget(action: EditAction, warn = true): { row: object; rowId?: string } | undefined {
    const target = this.#targets.get(action);
    const resolved = target && resolveEditTarget(this.grid, target);
    if (resolved) return resolved;
    if (warn) {
      warnDiagnostic(
        ROW_NOT_FOUND,
        `Cannot replay history for field "${action.field}": the recorded row is unavailable, its ID is ambiguous, or the ID resolver changed. Skipping this edit.`,
        this.grid.id,
        this.name,
      );
    }
    return undefined;
  }

  /** Resolve the recorded owner before using the existing history mutation pipeline. */
  #applyValue(action: EditAction, value: unknown): boolean {
    const target = this.#resolveTarget(action);
    if (!target) return false;
    const { row, rowId } = target;
    if (rowId !== undefined) {
      // Notifies active editors and recomputes dirty state without re-recording history.
      this.grid.updateRow(rowId, { [action.field]: value }, 'history');
      return true;
    }

    // No-ID history retains its direct-write behavior, but never changes owners.
    writeCellField(row, action.field, value);
    this.grid._invalidateRowContent(row);
    return true;
  }

  /**
   * Move keyboard focus to the cell targeted by an undo/redo action.
   * If the grid is in row-edit mode and the cell has an active editor,
   * the editor input is focused so the user can continue editing.
   */
  #focusActionCell(action: EditAction): void {
    const internalGrid: GridHost = this.grid;
    const target = this.#resolveTarget(action, false);
    const rowIndex = target ? this.rows.indexOf(target.row) : -1;
    if (rowIndex < 0) return;

    // Map field name → visible column index
    const colIdx = internalGrid._visibleColumns?.findIndex((c) => c.field === action.field) ?? -1;
    if (colIdx < 0) return;

    internalGrid._focusRow = rowIndex;
    internalGrid._focusCol = colIdx;

    // If we're in row-edit mode, focus the editor input in the target cell
    const rowEl = internalGrid.findRenderedRowElement?.(rowIndex);
    if (!rowEl) return;

    const cellEl = rowEl.querySelector(`.cell[data-col="${colIdx}"]`) as HTMLElement | null;
    if (cellEl?.classList.contains(GridClasses.EDITING)) {
      const editor = cellEl.querySelector(FOCUSABLE_EDITOR_SELECTOR) as HTMLElement | null;
      editor?.focus({ preventScroll: true });
    }
  }

  /**
   * Apply value changes for a single or compound action.
   * Wraps `#applyValue` calls with `#suppressRecording` to prevent feedback loops.
   */
  #applyUndoRedoAction(action: UndoRedoAction, direction: 'undo' | 'redo'): Set<EditAction> {
    const applied = new Set<EditAction>();
    this.#suppressRecording = true;
    try {
      const subActions =
        action.type === 'compound' ? (direction === 'undo' ? [...action.actions].reverse() : action.actions) : [action];
      for (const sub of subActions) {
        if (this.#applyValue(sub, direction === 'undo' ? sub.oldValue : sub.newValue)) applied.add(sub);
      }
    } finally {
      this.#suppressRecording = false;
    }
    return applied;
  }

  /**
   * Focus the cell associated with an undo/redo action.
   * For compound actions, focuses the **last** action's cell. When consumers
   * use `beginTransaction()` + `recordEdit()` (cascaded fields) followed by
   * `queueMicrotask(() => endTransaction())`, the grid's auto-recorded
   * primary field edit is appended last. Focusing it ensures the cursor
   * lands on the field the user originally edited, not on a cascaded field
   * whose column may not even be visible.
   *
   * Focus is applied in `afterRender()`, not here: the change can re-sort or
   * re-filter the view, so the row's display index is only known after the
   * ROWS phase that `requestRenderWithFocus()` schedules.
   */
  #focusUndoRedoAction(action: UndoRedoAction, applied: Set<EditAction>): void {
    const target = action.type === 'compound' ? action.actions[action.actions.length - 1] : action;
    this.#pendingFocus = target && applied.has(target) ? target : null;
  }

  /**
   * Apply the focus deferred by an undo/redo once the view reflects the change.
   * @internal
   */
  override afterRender(): void {
    const target = this.#pendingFocus;
    if (!target) return;
    this.#pendingFocus = null;
    this.#focusActionCell(target);
  }

  /**
   * Subscribe to cell-edit-committed events from EditingPlugin.
   * @internal
   */
  override attach(grid: GridElement): void {
    if (this.#external?.pendingGroups) {
      throwDiagnostic(CONFIG_RULE_ERROR, 'Finish detached transaction scopes before reattaching UndoRedo.');
    }
    super.attach(grid);
    this.#external =
      this.config.externalHistory !== undefined
        ? new ExternalHistoryBridge(this.config.externalHistory, (state) => this.emit('history-change', state))
        : undefined;
    // Auto-record edits via Event Bus
    this.on(
      'cell-edit-committed',
      (detail: {
        rowIndex: number;
        rowId?: string;
        row?: unknown;
        field: string;
        oldValue: unknown;
        newValue: unknown;
      }) => {
        // Skip recording during undo/redo operations. When undo/redo applies a
        // value via updateRow, two things can cause re-entry:
        // 1. updateRow → cell-change → onValueChange → editor triggers commit
        // 2. Browser native undo (if not fully suppressed) fires input event → commit
        // The suppress flag prevents these from corrupting the history stacks.
        if (this.#suppressRecording || this.#external) return;
        this.#recordEdit(
          detail.rowIndex,
          detail.field,
          detail.oldValue,
          detail.newValue,
          detail.row ?? this.#recordedRow(detail.rowIndex, detail.rowId),
        );
      },
    );
    this.#attached = true;
    try {
      this.#external?.attach();
    } catch (error) {
      this.detach();
      throw error;
    }
  }

  /**
   * Clean up state when plugin is detached.
   * @internal
   */
  override detach(): void {
    this.#attached = false;
    try {
      this.#external?.detach();
    } finally {
      super.detach();
      this.undoStack = [];
      this.redoStack = [];
      this.#transactionBuffer = null;
      this.#transactionDepth = 0;
      this.#pendingFocus = null;
      this.#targets = new WeakMap();
    }
  }

  /**
   * Handle keyboard shortcuts for undo/redo.
   * - Ctrl+Z / Cmd+Z: Undo
   * - Ctrl+Y / Cmd+Y / Ctrl+Shift+Z / Cmd+Shift+Z: Redo
   *
   * When the keystroke originates from a focusable form control (e.g. an
   * active cell editor input, a filter text box) we defer to the browser's
   * native undo/redo first. We watch for a `beforeinput` event with
   * `inputType === 'historyUndo'` / `'historyRedo'` on the target — if the
   * browser had something to undo, it consumes the keystroke and we do
   * nothing; if it didn't (history depleted), we fall back to the grid's
   * own undo/redo. This lets users undo their typing/paste inside an open
   * editor, then continue undoing committed cell edits with the same key.
   * @internal
   */
  override onKeyDown(event: KeyboardEvent): boolean {
    const isUndo = (event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey;
    const isRedo = (event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey));

    if (!isUndo && !isRedo) return false;

    const path = event.composedPath();
    const owner = path.find((node) => node instanceof Element && node.matches('tbw-grid, [data-tbw-grid]'));
    if (owner && owner !== this.grid) return false;
    const kind: 'undo' | 'redo' = isUndo ? 'undo' : 'redo';
    const target = path[0] ?? event.target;

    if (this.#isNativeHistoryTarget(target)) {
      // Let the browser try its native undo/redo first. Only run ours if
      // the browser had nothing left in its own history.
      this.#deferToNativeHistory(target as HTMLElement, kind);
      return true;
    }

    // Prevent browser native undo on text inputs — it would conflict with
    // the grid's undo by mutating the input text independently, triggering
    // re-commits that cancel the grid undo.
    event.preventDefault();
    this.#requestHistory(kind);
    return true;
  }

  /**
   * Apply an undo or redo against the grid's own history stack.
   * Shared by the keyboard path and the public `undo()` / `redo()` so listeners
   * cannot tell them apart (#563).
   */
  #performHistory(kind: 'undo' | 'redo'): UndoRedoAction | null {
    this.#assertNotRestoring();
    this.#historyActivity++;
    try {
      const state = { undoStack: this.undoStack, redoStack: this.redoStack };
      const result = kind === 'undo' ? undo(state) : redo(state);
      if (!result.action) return null;

      const applied = this.#applyUndoRedoAction(result.action, kind);
      this.undoStack = result.newState.undoStack;
      this.redoStack = result.newState.redoStack;

      this.emit<UndoRedoDetail>(kind, { action: result.action, type: kind });
      this.#emitHistoryChange();
      this.#focusUndoRedoAction(result.action, applied);
      this.requestRenderWithFocus();
      return result.action;
    } finally {
      this.#historyActivity--;
    }
  }

  /** Notify listeners that the undo/redo stacks changed. */
  #emitHistoryChange(): void {
    this.#historyActivity++;
    try {
      this.emit<HistoryChangeDetail>('history-change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    } finally {
      this.#historyActivity--;
    }
  }

  #assertNotRestoring(): void {
    if (this.#restoring) {
      throwDiagnostic(
        CONFIG_RULE_ERROR,
        'Cannot mutate history during restoreHistory notification.',
        this.grid?.id,
        this.name,
      );
    }
  }

  #assertSnapshotReady(): void {
    this.#assertInternal();
    if (!this.#attached || this.#transactionDepth > 0 || this.#historyActivity > 0 || this.#restoring) {
      throwDiagnostic(
        CONFIG_RULE_ERROR,
        'History snapshots require an attached plugin outside transactions, replay and history-change notifications.',
        this.grid?.id,
        this.name,
      );
    }
  }

  #copyHistory(history: CapturedHistory): CapturedHistory {
    const targets = new WeakMap<EditAction, EditTarget>();
    const copyEdit = (action: EditAction): EditAction => {
      const copy = { ...action };
      const target = history.targets.get(action);
      if (target) targets.set(copy, { ...target });
      return copy;
    };
    const copyAction = (action: UndoRedoAction): UndoRedoAction =>
      action.type === 'compound' ? { ...action, actions: action.actions.map(copyEdit) } : copyEdit(action);
    return {
      undoStack: history.undoStack.map(copyAction),
      redoStack: history.redoStack.map(copyAction),
      targets,
    };
  }

  /**
   * True when the keystroke target is a form control with its own native
   * undo history (text inputs, textareas, contenteditable). `<select>` is
   * intentionally excluded — it has no undo history.
   */
  #isNativeHistoryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
  }

  /**
   * Watch for the browser's native undo/redo on `target`. The browser fires
   * `beforeinput` with `inputType: 'historyUndo' | 'historyRedo'` when it
   * actually has something to undo/redo. Wait through the keydown default action:
   * Chromium can run a microtask before its native beforeinput event.
   */
  #deferToNativeHistory(target: HTMLElement, kind: 'undo' | 'redo'): void {
    const wantedInputType = kind === 'undo' ? 'historyUndo' : 'historyRedo';
    const signal = this.disconnectSignal;
    let nativeHandled = false;

    const onBeforeInput = (e: Event) => {
      if ((e as InputEvent).inputType === wantedInputType) nativeHandled = true;
    };
    target.addEventListener('beforeinput', onBeforeInput, { capture: true });

    setTimeout(() => {
      target.removeEventListener('beforeinput', onBeforeInput, { capture: true } as EventListenerOptions);
      if (!nativeHandled && this.#attached && !signal.aborted) this.#requestHistory(kind);
    }, 0);
  }

  // #region Public API Methods

  /**
   * Record a cell edit for undo/redo tracking.
   * Call this when a cell value changes.
   *
   * The row's stable ID is captured from the row currently displayed at `rowIndex`,
   * so call this while `rowIndex` still points at the edited row (e.g. synchronously
   * inside a `cell-commit` handler). Undo/redo then target that row by ID even after
   * the view is sorted or filtered. Pass `rowId` explicitly when the row is not in
   * the view (e.g. `cell-commit` from an `updateRow()` on a filtered-out row reports
   * `rowIndex: -1`) — `detail.rowId` from `cell-commit` is the natural source.
   *
   * @param rowIndex - The display (processed-row) index where the edit occurred
   * @param field - The field (column key) that was edited
   * @param oldValue - The value before the edit
   * @param newValue - The value after the edit
   * @param rowId - Stable ID of the edited row; resolved from `rowIndex` when omitted (since 3.9.2)
   */
  recordEdit(rowIndex: number, field: string, oldValue: unknown, newValue: unknown, rowId?: string): void {
    this.#assertInternal();
    this.#assertNotRestoring();
    this.#recordEdit(rowIndex, field, oldValue, newValue, this.#recordedRow(rowIndex, rowId));
  }

  #recordedRow(rowIndex: number, rowId?: string): unknown {
    return rowId
      ? [...this.grid.sourceRows, ...this.rows].find(
          (candidate) => tryResolveRowId(candidate, this.grid.effectiveConfig.getRowId) === rowId,
        )
      : this.rows[rowIndex];
  }

  #recordEdit(rowIndex: number, field: string, oldValue: unknown, newValue: unknown, row: unknown): void {
    this.#assertNotRestoring();
    const action = createEditAction(rowIndex, field, oldValue, newValue);
    this.#captureTarget(action, row);

    // Buffer during transactions instead of pushing to undo stack
    if (this.#transactionBuffer) {
      this.#transactionBuffer.push(action);
      return;
    }

    const newState = pushAction(
      { undoStack: this.undoStack, redoStack: this.redoStack },
      action,
      this.config.maxHistorySize ?? 100,
    );
    this.undoStack = newState.undoStack;
    this.redoStack = newState.redoStack;
    this.#emitHistoryChange();
  }

  /**
   * Begin grouping subsequent edits into a single compound action.
   *
   * While a transaction is active, all `recordEdit()` calls (both manual
   * and auto-recorded from `cell-edit-committed`) are buffered instead of
   * pushed to the undo stack. Call `endTransaction()` to finalize the group.
   *
   * **Nesting:** transactions are re-entrant. Calling `beginTransaction()` while
   * one is already open increments a depth counter rather than throwing; the
   * buffer is finalized only when a matching `endTransaction()` returns the depth
   * to 0. This lets a synchronous burst of commits (e.g. a multi-cell paste, where
   * each `cell-commit` handler brackets itself with `beginTransaction()` +
   * `queueMicrotask(endTransaction)`) coalesce into a single compound undo entry.
   *
   * **Typical usage** — group a user edit with its cascaded side-effects:
   *
   * ```ts
   * grid.on('cell-commit', () => {
   *   const undoRedo = grid.getPluginByName('undoRedo');
   *   undoRedo.beginTransaction();
   *
   *   // Record cascaded updates (these won't auto-record)
   *   const oldB = row.fieldB;
   *   undoRedo.recordEdit(rowIndex, 'fieldB', oldB, computedB);
   *   grid.updateRow(rowId, { fieldB: computedB });
   *
   *   // End after the auto-recorded original edit is captured
   *   queueMicrotask(() => undoRedo.endTransaction());
   * });
   * ```
   */
  beginTransaction(): void {
    if (this.#external) return this.#external.begin();
    this.#assertInternal();
    this.#assertNotRestoring();
    if (this.#transactionDepth === 0) {
      this.#transactionBuffer = [];
    }
    this.#transactionDepth++;
  }

  /**
   * Finalize the current transaction, wrapping all buffered edits into a
   * single compound action on the undo stack.
   *
   * - If the buffer contains multiple edits, they are wrapped in a `CompoundEditAction`.
   * - If the buffer contains a single edit, it is pushed as a regular `EditAction`.
   * - If the buffer is empty, this is a no-op.
   *
   * Undoing a compound action reverts all edits in reverse order; redoing
   * replays them in forward order.
   *
   * When transactions are nested, only the outermost `endTransaction()` (the one
   * that returns the depth to 0) finalizes the buffer; inner calls just decrement.
   *
   * @throws Error if no transaction is in progress
   */
  endTransaction(): void {
    if (this.#external) return this.#external.end();
    this.#assertInternal();
    this.#assertNotRestoring();
    if (this.#transactionDepth === 0) {
      throwDiagnostic(NO_TRANSACTION, 'No transaction in progress. Call beginTransaction() first.');
    }

    this.#transactionDepth--;
    if (this.#transactionDepth > 0) return; // still inside an outer transaction

    const buffer = this.#transactionBuffer;
    this.#transactionBuffer = null;
    if (!buffer || buffer.length === 0) return;

    const action: UndoRedoAction = buffer.length === 1 ? buffer[0] : createCompoundAction(buffer);
    const newState = pushAction(
      { undoStack: this.undoStack, redoStack: this.redoStack },
      action,
      this.config.maxHistorySize ?? 100,
    );
    this.undoStack = newState.undoStack;
    this.redoStack = newState.redoStack;
    this.#emitHistoryChange();
  }

  /**
   * Programmatically undo the last native action. External mode requires requestUndo().
   *
   * Behaves exactly like Ctrl+Z: emits `undo` (with the undone action) and
   * `history-change`. These report stack movement, including skipped edits;
   * accepted ID-based mutations emit `cell-change` with source `history`.
   *
   * @returns The undone action, or null if nothing to undo
   */
  undo(): UndoRedoAction | null {
    this.#assertInternal();
    return this.#performHistory('undo');
  }

  /**
   * Programmatically redo the last undone native action. External mode requires requestRedo().
   *
   * Behaves exactly like Ctrl+Y: emits `redo` (with the redone action) and
   * `history-change`.
   *
   * @returns The redone action, or null if nothing to redo
   */
  redo(): UndoRedoAction | null {
    this.#assertInternal();
    return this.#performHistory('redo');
  }

  /**
   * Check if there are any actions that can be undone.
   */
  canUndo(): boolean {
    if (this.#external) return this.#external.state.canUndo;
    return canUndo({ undoStack: this.undoStack, redoStack: this.redoStack });
  }

  /**
   * Check if there are any actions that can be redone.
   */
  canRedo(): boolean {
    if (this.#external) return this.#external.state.canRedo;
    return canRedo({ undoStack: this.undoStack, redoStack: this.redoStack });
  }

  /**
   * Clear all undo/redo history.
   * Emits `history-change` when there was history to clear.
   */
  clearHistory(): void {
    this.#assertInternal();
    this.#assertNotRestoring();
    const hadHistory = this.undoStack.length > 0 || this.redoStack.length > 0;
    const newState = clearHistory();
    this.undoStack = newState.undoStack;
    this.redoStack = newState.redoStack;
    this.#transactionBuffer = null;
    this.#transactionDepth = 0;
    if (hadHistory) this.#emitHistoryChange();
    this.#targets = new WeakMap();
  }

  /**
   * Get a copy of the current undo stack.
   */
  getUndoStack(): UndoRedoAction[] {
    this.#assertInternal();
    return [...this.undoStack];
  }

  /**
   * Get a copy of the current redo stack.
   */
  getRedoStack(): UndoRedoAction[] {
    this.#assertInternal();
    return [...this.redoStack];
  }

  /**
   * Capture both history stacks with their original ownership evidence.
   * Call before detach, outside transactions, replay and history-change listeners.
   * The reusable token survives source cleanup, but retains row/value/resolver
   * references. Release it when no longer needed. Cell values are not deep-cloned.
   * @since 3.11.0
   */
  captureHistory(): UndoRedoSnapshot {
    this.#assertSnapshotReady();
    const snapshot = Object.freeze({}) as UndoRedoSnapshot;
    UndoRedoPlugin.#snapshots.set(
      snapshot,
      this.#copyHistory({
        undoStack: this.undoStack,
        redoStack: this.redoStack,
        targets: this.#targets,
      }),
    );
    return snapshot;
  }

  /**
   * Replace both stacks from a checkpoint created by this loaded module.
   * Call after the destination grid is ready, using the same logical dataset and
   * resolver function. Replay still skips missing/ambiguous owners and changed
   * resolvers; ID-less edits require the original live row object.
   *
   * Rejects invalid tokens, unsafe lifecycle/reentrant calls and snapshots whose
   * combined undo+redo entry count exceeds `maxHistorySize` (a compound counts as
   * one). Validation precedes replacement; nothing is silently trimmed.
   * Emits one `history-change`, even for empty history, and no data or focus changes.
   * Does not restore rows, editor state, dirty baselines or open transactions.
   * @since 3.11.0
   */
  restoreHistory(snapshot: UndoRedoSnapshot): void {
    this.#assertSnapshotReady();
    const history = UndoRedoPlugin.#snapshots.get(snapshot);
    if (!history) {
      throwDiagnostic(
        CONFIG_RULE_ERROR,
        'Invalid history snapshot; use captureHistory() from this loaded module.',
        this.grid?.id,
        this.name,
      );
    }

    if (history.undoStack.length + history.redoStack.length > (this.config.maxHistorySize ?? 100)) {
      throwDiagnostic(
        CONFIG_RULE_ERROR,
        'History snapshot exceeds the receiving maxHistorySize.',
        this.grid.id,
        this.name,
      );
    }
    const copy = this.#copyHistory(history);
    this.#restoring = true;
    try {
      this.undoStack = copy.undoStack;
      this.redoStack = copy.redoStack;
      this.#targets = copy.targets;
      this.#pendingFocus = null;
      this.#emitHistoryChange();
    } finally {
      this.#restoring = false;
    }
  }

  /**
   * Request Undo from the configured owner, without returning a native action.
   * External owners publish availability; this does not imply an accepted mutation.
   * @since 3.11.0
   */
  requestUndo(): void {
    this.#requestHistory('undo');
  }

  /** Request Redo from the configured owner. @since 3.11.0 */
  requestRedo(): void {
    this.#requestHistory('redo');
  }

  #requestHistory(direction: 'undo' | 'redo'): void {
    if (!this.#attached) throwDiagnostic(CONFIG_RULE_ERROR, 'History requests require an attached plugin.');
    if (this.#external) this.#external.request(direction);
    else this.#performHistory(direction);
  }

  #assertInternal(): void {
    if (this.#external || this.resolvedConfig.externalHistory !== undefined) {
      throwDiagnostic(CONFIG_RULE_ERROR, 'Native action and snapshot APIs are unavailable with externalHistory.');
    }
  }
  // #endregion
}
