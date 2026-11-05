import { announce } from '../../core/internal/aria';
import { CONFIG_RULE_ERROR, throwDiagnostic } from '../../core/internal/diagnostics';
import { startPointerDrag } from '../../core/internal/pointer-drag';
import {
  BaseGridPlugin,
  type CellClickEvent,
  type GridElement,
  type PluginManifest,
} from '../../core/plugin/base-plugin';
import { isCellEntryTarget } from '../editing/internal/single-cell-entry';
import type {} from '../editing/types';
import type { CellRange } from '../selection/types';
import type {} from '../undo-redo/types';
import {
  createFillBaseline,
  executeFill,
  extendFillBaseline,
  type FillBaseline,
  fillBounds,
  isStructuralRow,
  planFill,
  rebaseFillPlan,
} from './fill-cells';
import styles from './fill-handle.css?inline';
import type { A11yMessages, GridConfig } from '../../core/types';
import type { FillCompleteDetail, FillDirection, FillHandleConfig, FillRequest } from './types';

interface FillSession {
  source: CellRange;
  targetRow: number;
  /** `drag` follows the pointer, `keyboard` follows arrows, `armed` awaits a target-cell tap. */
  kind: 'drag' | 'keyboard' | 'armed';
  baseline: FillBaseline;
}

const HANDLE_CLASS = 'tbw-fill-handle';
const PREVIEW_CLASS = 'tbw-fill-preview';

// English defaults live here, not in core DEFAULT_A11Y_MESSAGES, to keep them out of the core bundle.
const FILL_MESSAGES = {
  fillHandleLabel: () => 'Fill handle: drag or press Enter to fill rows',
  fillPreview: (rows: number, direction: FillDirection) =>
    `Fill ${direction} ${rows} rows. Enter applies, Escape cancels`,
  cellsFilled: (filled: number, notFilled: number) => `${filled} cells filled, ${notFilled} cells not filled`,
  fillLimitExceeded: () => 'Fill rejected: fill no more than 10,000 cells',
  fillCanceled: () => 'Fill canceled',
} satisfies Required<
  Pick<A11yMessages, 'fillHandleLabel' | 'fillPreview' | 'cellsFilled' | 'fillLimitExceeded' | 'fillCanceled'>
>;
type FillMessageKey = keyof typeof FILL_MESSAGES;

function getA11yMessage<K extends FillMessageKey>(
  gridEl: HTMLElement,
  key: K,
  ...args: Parameters<(typeof FILL_MESSAGES)[K]>
): string {
  const custom = (gridEl as HTMLElement & { effectiveConfig?: GridConfig }).effectiveConfig?.a11y?.messages?.[key];
  return ((custom ?? FILL_MESSAGES[key]) as (...a: typeof args) => string)(...args);
}

/**
 * Vertical automatic fill from a single selected range.
 *
 * Drag the corner handle (or tap it, then tap a target cell; or press
 * `Alt+ArrowDown`/`Alt+ArrowUp`, adjust with arrows and press Enter) to fill
 * existing displayed data rows. Numbers, `YYYY-MM-DD` dates, `Date` objects and
 * ISO timestamps continue a series; everything else repeats. All accepted writes
 * go through Editing and form one UndoRedo step.
 *
 * Requires Selection `{ mode: 'range' }`, Editing and UndoRedo.
 *
 * @since 3.11.0
 */
export class FillHandlePlugin<TRow = unknown> extends BaseGridPlugin<FillHandleConfig<TRow>> {
  /** @internal */
  readonly name = 'fillHandle';

  /** @internal */
  override readonly styles = styles;

  /** @internal */
  static override readonly dependencies = [
    { name: 'editing', required: true },
    { name: 'selection', required: true },
    { name: 'undoRedo', required: true },
  ];

  /** @internal */
  static override readonly manifest: PluginManifest<FillHandleConfig> = {
    hookPriority: { onCellClick: -10, onKeyDown: -30 },
    events: [
      { type: 'fill-start', description: 'Cancelable notification before a fill writes' },
      { type: 'fill-complete', description: 'Fill outcomes, cancellation or oversized-action rejection' },
    ],
  };

  #handle: HTMLElement | null = null;
  #preview: HTMLElement | null = null;
  #session: FillSession | null = null;
  #running = false;

  /** @internal */
  override attach(grid: GridElement): void {
    super.attach(grid);
    const selection = grid.getPluginByName('selection')?.resolvedConfig;
    const { mode, fillValue } = this.config;
    if (
      !grid.getPluginByName('editing') ||
      !grid.getPluginByName('undoRedo') ||
      selection?.mode !== 'range' ||
      (mode !== undefined && mode !== 'auto' && mode !== 'copy') ||
      (fillValue !== undefined && typeof fillValue !== 'function')
    ) {
      throwDiagnostic(
        CONFIG_RULE_ERROR,
        'FillHandle requires Editing, UndoRedo and Selection { mode: "range" }; mode must be "auto" or "copy" and fillValue a function.',
        grid.id,
        this.name,
      );
    }
    grid.addEventListener('selection-change', () => queueMicrotask(() => this.#render()), {
      signal: this.disconnectSignal,
    });
  }

  /** @internal */
  override detach(): void {
    this.#session = null;
    this.#handle?.remove();
    this.#preview?.remove();
    this.#handle = this.#preview = null;
    super.detach();
  }

  /**
   * Fill from `request.source` to `request.targetRow` (processed row and visible
   * column indices). Emits `fill-start` (cancelable) and `fill-complete`.
   * A target inside the source returns an empty, non-canceled result without events.
   */
  fill(request: FillRequest): FillCompleteDetail<TRow> {
    return this.#run(request);
  }

  // #region Hooks

  /** @internal */
  override afterRender(): void {
    this.#render();
  }

  /** @internal */
  override onScrollRender(): void {
    this.#render();
  }

  /** @internal */
  override onCellClick({ rowIndex, originalEvent }: CellClickEvent): boolean {
    const session = this.#session;
    if (session?.kind !== 'armed' || originalEvent.type !== 'click') return false;
    session.targetRow = rowIndex;
    this.#apply();
    return true;
  }

  /** @internal */
  override onKeyDown(event: KeyboardEvent): boolean {
    if (this.#handle && event.composedPath().includes(this.#handle)) return this.#handleKey(event);
    if (this.#session && event.key === 'Escape') {
      this.#cancel();
      event.preventDefault();
      return true;
    }
    if (
      (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') ||
      !event.altKey ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing ||
      !isCellEntryTarget(event, this.gridElement)
    )
      return false;
    const source = this.#source();
    if (!source) return false;
    event.preventDefault();
    const { firstRow, lastRow } = fillBounds({ source, targetRow: 0 }, this.rows.length, this.visibleColumns.length);
    this.#start(source, event.key === 'ArrowDown' ? lastRow + 1 : firstRow - 1, 'keyboard');
    this.#handle?.focus({ preventScroll: true });
    return true;
  }

  // #endregion

  // #region Interaction

  #handleKey(event: KeyboardEvent): boolean {
    const session = this.#session;
    const key = event.key;
    if (!session || session.kind === 'armed') {
      if (key !== 'Enter' && key !== ' ') return session ? this.#escape(event) : false;
      const source = session?.source ?? this.#source();
      if (!source) return false;
      event.preventDefault();
      const { firstRow, lastRow } = fillBounds({ source, targetRow: 0 }, this.rows.length, this.visibleColumns.length);
      this.#start(source, lastRow + 1 < this.rows.length ? lastRow + 1 : firstRow - 1, 'keyboard');
      return true;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(this.rows.length - 1, Math.max(0, session.targetRow + (key === 'ArrowDown' ? 1 : -1)));
      this.#preview_(next);
      this.grid.scrollToRow?.(next, { align: 'nearest' });
      return true;
    }
    if (key === 'Enter') {
      event.preventDefault();
      this.#apply();
      return true;
    }
    return this.#escape(event);
  }

  #escape(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape') return event.key !== 'Tab';
    event.preventDefault();
    this.#cancel();
    return true;
  }

  #onPointerDown(event: PointerEvent): void {
    if ((event.pointerType === 'mouse' && event.button !== 0) || !this.#handle) return;
    event.preventDefault();
    event.stopPropagation();
    const source = this.#session?.kind === 'armed' ? this.#session.source : this.#source();
    if (!source) return;
    const { lastRow } = fillBounds({ source, targetRow: 0 }, this.rows.length, this.visibleColumns.length);
    this.#start(source, lastRow, 'drag');
    let moved = false;
    startPointerDrag(event, this.#handle, {
      onMove: (move) => {
        moved = true;
        const row = this.#rowAtPoint(move.clientX, move.clientY);
        if (row !== undefined) this.#preview_(row);
      },
      onEnd: () => {
        if (moved && this.#session) this.#apply();
        else if (this.#session) {
          this.#session.kind = 'armed';
          this.#handle?.setAttribute('aria-pressed', 'true');
          this.#render();
        }
      },
      onCancel: () => this.#cancel(),
    });
  }

  #start(source: CellRange, targetRow: number, kind: FillSession['kind']): void {
    if (this.grid.query<boolean>('isEditing').some(Boolean)) return;
    this.#session = { source, targetRow: -1, kind, baseline: createFillBaseline(this.grid, { source, targetRow }) };
    this.#preview_(Math.min(this.rows.length - 1, Math.max(0, targetRow)));
  }

  #preview_(targetRow: number): void {
    const session = this.#session;
    if (!session || session.targetRow === targetRow) return;
    session.targetRow = targetRow;
    const request = { source: session.source, targetRow };
    extendFillBaseline(this.grid, session.baseline, request);
    this.#render();
    const { firstRow, lastRow } = fillBounds(request, this.rows.length, this.visibleColumns.length);
    const direction: FillDirection = targetRow > lastRow ? 'down' : 'up';
    let count = 0;
    const [from, to] = direction === 'down' ? [lastRow + 1, targetRow] : [targetRow, firstRow - 1];
    for (let index = from; index <= to; index++) if (!isStructuralRow(this.rows[index])) count++;
    if (session.kind !== 'drag')
      announce(this.gridElement, getA11yMessage(this.gridElement, 'fillPreview', count, direction));
  }

  #apply(): void {
    const session = this.#session;
    if (!session) return;
    this.#session = null;
    this.#run({ source: session.source, targetRow: session.targetRow }, session.baseline);
    this.#finish();
  }

  #cancel(): void {
    if (!this.#session) return;
    this.#session = null;
    announce(this.gridElement, getA11yMessage(this.gridElement, 'fillCanceled'));
    this.#finish();
  }

  #finish(): void {
    const focused = this.#handle?.matches(':focus');
    this.#handle?.setAttribute('aria-pressed', 'false');
    this.#render();
    if (focused) this.gridElement.focus({ preventScroll: true });
  }

  // #endregion

  // #region Execution

  #run(request: FillRequest, baseline?: FillBaseline): FillCompleteDetail<TRow> {
    const grid = this.grid;
    const plan = planFill(grid, request);
    const { firstRow } = fillBounds(request, Math.max(1, this.rows.length), Math.max(1, this.visibleColumns.length));
    const direction: FillDirection = plan?.direction ?? (request.targetRow < firstRow ? 'up' : 'down');
    const detail: FillCompleteDetail<TRow> = { request, direction, cells: [], limitExceeded: false, canceled: false };
    if (!plan) return detail;
    const undo = grid.getPluginByName('undoRedo');
    const complete = (message: string) => {
      announce(this.gridElement, message);
      this.emit<FillCompleteDetail<TRow>>('fill-complete', detail);
      return detail;
    };
    const canceled = () => {
      detail.canceled = true;
      return complete(getA11yMessage(this.gridElement, 'fillCanceled'));
    };
    if (this.#running || !undo || grid.query<boolean>('isEditing').some(Boolean)) return canceled();
    if (this.emitCancelable('fill-start', { request, direction })) return canceled();
    if (plan.limitExceeded) {
      detail.limitExceeded = true;
      return complete(getA11yMessage(this.gridElement, 'fillLimitExceeded'));
    }
    if (baseline && !rebaseFillPlan(plan, baseline)) return canceled();
    this.#running = true;
    try {
      const result = executeFill(grid, plan, undo, this.config as FillHandleConfig);
      if (result.canceled) return canceled();
      detail.cells = result.cells as FillCompleteDetail<TRow>['cells'];
    } finally {
      this.#running = false;
    }
    const filled = detail.cells.filter((cell) => cell.status === 'filled').length;
    if (filled) {
      const last = plan.targets[plan.targets.length - 1].index;
      const {
        firstRow: top,
        lastRow: bottom,
        firstCol,
        lastCol,
      } = fillBounds(request, this.rows.length, this.visibleColumns.length);
      grid.getPluginByName('selection')?.setRanges([
        {
          from: { row: Math.min(top, last), col: firstCol },
          to: { row: Math.max(bottom, last), col: lastCol },
        },
      ]);
    }
    return complete(getA11yMessage(this.gridElement, 'cellsFilled', filled, detail.cells.length - filled));
  }

  // #endregion

  // #region Rendering

  /** The single selected range, when fill is currently available. */
  #source(): CellRange | undefined {
    if (this.grid.effectiveConfig.selectable === false) return undefined;
    const selection = this.grid.getPluginByName('selection');
    if (!selection || selection.resolvedConfig.enabled === false) return undefined;
    if (this.grid.getPluginByName('editing')?.resolvedConfig.editOn === false) return undefined;
    if (this.grid.query<boolean>('isEditing').some(Boolean)) return undefined;
    const { ranges } = selection.getSelection();
    return ranges.length === 1 ? ranges[0] : undefined;
  }

  #cellFor(row: number, col: number): HTMLElement | null {
    const body = this.grid._bodyEl;
    return (
      body?.querySelector<HTMLElement>(`:scope > .data-grid-row > .cell[data-row="${row}"][data-col="${col}"]`) ?? null
    );
  }

  #rowAtPoint(x: number, y: number): number | undefined {
    const host = this.gridElement;
    const cell = host.ownerDocument.elementFromPoint?.(x, y)?.closest?.('.cell[data-row][data-col]');
    if (!cell || !this.grid._bodyEl?.contains(cell)) return undefined;
    const owner = cell.closest('tbw-grid, [data-tbw-grid]');
    if (owner && owner !== host) return undefined;
    const row = Number(cell.getAttribute('data-row'));
    return Number.isInteger(row) && row >= 0 ? row : undefined;
  }

  #render(): void {
    const container = this.gridElement?.querySelector<HTMLElement>('.tbw-grid-root');
    if (!container) return;
    const session = this.#session;
    const source = session?.source ?? this.#source();
    if (!source) {
      if (this.#handle) this.#handle.hidden = true;
      if (this.#preview) this.#preview.hidden = true;
      return;
    }
    const rowCount = this.rows.length;
    const colCount = this.visibleColumns.length;
    const bounds = fillBounds({ source, targetRow: session?.targetRow ?? 0 }, rowCount, colCount);
    const handle = (this.#handle ??= this.#createHandle(container));
    if (handle.parentElement !== container) container.appendChild(handle);
    handle.setAttribute('aria-label', getA11yMessage(this.gridElement, 'fillHandleLabel'));
    handle.classList.toggle('armed', session?.kind === 'armed');
    const hostRect = container.getBoundingClientRect?.();
    const corner = this.#cellFor(bounds.lastRow, bounds.lastCol);
    if (corner) {
      handle.hidden = false;
      const rect = corner.getBoundingClientRect?.();
      if (rect && hostRect) {
        // Keep the whole hit area left of the faux scrollbar, which stacks above plugin overlays.
        const viewport = container.querySelector('.rows-viewport')?.getBoundingClientRect?.();
        const half = (handle.offsetWidth || 24) / 2;
        const x = viewport && viewport.width > 0 ? Math.min(rect.right, viewport.right - half) : rect.right;
        handle.style.left = `${x - hostRect.left}px`;
        handle.style.top = `${rect.bottom - hostRect.top}px`;
      }
      // Selection's touch end-corner handle shares this corner; sit just below it.
      const rangeEnd = container.querySelector<HTMLElement>('.tbw-range-handle-end');
      handle.classList.toggle('beside-range-handle', !!rangeEnd && !rangeEnd.hidden);
    } else if (!session) {
      handle.hidden = true;
    }
    this.#renderPreview(container, hostRect, bounds, session);
  }

  #renderPreview(
    container: HTMLElement,
    hostRect: DOMRect | undefined,
    bounds: ReturnType<typeof fillBounds>,
    session: FillSession | null,
  ): void {
    const preview = (this.#preview ??= container.ownerDocument.createElement('div'));
    preview.className = PREVIEW_CLASS;
    preview.setAttribute('aria-hidden', 'true');
    if (preview.parentElement !== container) container.appendChild(preview);
    const { targetRow, firstRow, lastRow, firstCol, lastCol } = bounds;
    const down = targetRow > lastRow;
    if (!session || (!down && targetRow >= firstRow) || !hostRect) {
      preview.hidden = true;
      return;
    }
    const body = this.grid._bodyEl?.getBoundingClientRect?.();
    const edge = this.#cellFor(down ? lastRow : firstRow, firstCol)?.getBoundingClientRect?.();
    const end = this.#cellFor(targetRow, firstCol)?.getBoundingClientRect?.();
    const reference = end ?? edge;
    const right = this.#cellFor(reference === end ? targetRow : down ? lastRow : firstRow, lastCol);
    const rightRect = right?.getBoundingClientRect?.();
    if (!reference || !rightRect || !body) {
      preview.hidden = true;
      return;
    }
    const top = down ? (edge?.bottom ?? body.top) : (end?.top ?? body.top);
    const bottom = down ? (end?.bottom ?? body.bottom) : (edge?.top ?? body.bottom);
    preview.hidden = false;
    preview.style.left = `${reference.left - hostRect.left}px`;
    preview.style.top = `${top - hostRect.top}px`;
    preview.style.width = `${Math.max(0, rightRect.right - reference.left)}px`;
    preview.style.height = `${Math.max(0, bottom - top)}px`;
  }

  #createHandle(container: HTMLElement): HTMLElement {
    const handle = container.ownerDocument.createElement('div');
    handle.className = HANDLE_CLASS;
    handle.setAttribute('role', 'button');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-pressed', 'false');
    handle.addEventListener('pointerdown', (event) => this.#onPointerDown(event), { signal: this.disconnectSignal });
    container.appendChild(handle);
    return handle;
  }

  // #endregion
}

declare module '../../core/types' {
  interface PluginNameMap {
    fillHandle: FillHandlePlugin;
  }
}
