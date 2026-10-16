import { registerControlCleanup, unregisterControlCleanup } from '../../core/internal/control-lifecycle';
import { CONFIG_RULE_ERROR, CONFIG_RULE_WARN, throwDiagnostic, warnDiagnostic } from '../../core/internal/diagnostics';
import { tryResolveRowId } from '../../core/internal/row-manager';
import { getHoveredRow, observeRowHover } from '../../core/internal/row-hover';
import type { AfterCellRenderContext, GridElementRef } from '../../core/plugin/base-plugin';
import type { ColumnConfig, RowElementInternal } from '../../core/types';
import { getDirection, type TextDirection } from '../../core/internal/utils';
import { getColumnPinned, resolveStickyPosition } from './pinned-columns';

function physicalPin(column: ColumnConfig, direction: TextDirection) {
  const pin = getColumnPinned(column);
  return pin && resolveStickyPosition(pin, direction);
}

interface CellOwner {
  cell: HTMLElement;
  row: HTMLElement;
  data: object;
  id: string | undefined;
  field: string;
  leases: Set<object>;
}

/** Optional, bounded DOM ownership for right-pinned action surfaces. */
export class CellExpansion {
  // #region State
  readonly #grid: GridElementRef;
  readonly #owners = new Map<HTMLElement, CellOwner>();
  readonly #abort = new AbortController();
  readonly #resize: ResizeObserver;
  #headers: HTMLElement[] = [];
  #viewport: HTMLElement | null = null;
  #columns: readonly ColumnConfig[] = [];
  #eligibleFields = new Set<string>();
  #widths = new Map<string, number>();
  #disposed = false;
  #warnedRtl = false;
  // #endregion

  // #region Lifecycle
  constructor(grid: GridElementRef) {
    this.#grid = grid;
    this.#resize = new ResizeObserver(() => this.#measure());
    const options = { signal: this.#abort.signal };
    observeRowHover(grid, () => this.#paint(), this.#abort.signal);
    grid.addEventListener('focusin', () => this.#paint(), options);
    grid.addEventListener(
      'focusout',
      () => {
        // Portal consumers acquire their lease in the same native event turn.
        queueMicrotask(() => {
          if (!this.#disposed) this.#paint();
        });
      },
      options,
    );
  }

  configure(columns: readonly ColumnConfig[]): void {
    this.#columns = columns;
    this.#configureEligibility(getDirection(this.#grid));
    this.reconcile();
    this.#measure();
  }

  bind(context: AfterCellRenderContext): void {
    const { cellElement: cell, rowElement: row, column, row: data } = context;
    const previous = this.#owners.get(cell);
    if (!this.#eligibleFields.has(column.field) || data == null || typeof data !== 'object') {
      if (previous) this.#retire(previous);
      return;
    }
    const id = tryResolveRowId(data, this.#grid.effectiveConfig?.getRowId);
    if (
      previous &&
      (previous.id !== id ||
        previous.row !== row ||
        previous.field !== column.field ||
        (id === undefined && previous.data !== data))
    ) {
      this.#retire(previous);
    }
    const current = this.#owners.get(cell);
    if (!current) {
      const owner: CellOwner = { cell, row, data, id, field: column.field, leases: new Set() };
      this.#owners.set(cell, owner);
      registerControlCleanup(cell, () => this.#retire(owner), owner);
    } else {
      current.data = data;
    }
    const width = this.#widths.get(column.field);
    if (width !== undefined) cell.style.setProperty('--tbw-pinned-cell-width', `${width}px`);
  }

  afterRender(): void {
    this.reconcile();
    const viewport = this.#grid._bodyEl?.closest<HTMLElement>('.tbw-scroll-area') ?? null;
    const headers = Array.from(this.#grid.querySelectorAll<HTMLElement>('.header-row > .cell')).filter(
      (cell) => cell.closest('[data-tbw-grid]') === this.#grid,
    );
    if (
      viewport === this.#viewport &&
      headers.length === this.#headers.length &&
      headers.every((cell, index) => cell === this.#headers[index])
    )
      return;
    this.#resize.disconnect();
    this.#headers = headers;
    this.#viewport = viewport;
    if (viewport) this.#resize.observe(viewport);
    for (const header of headers) this.#resize.observe(header);
    this.#measure();
  }

  reconcile(): void {
    for (const owner of this.#owners.values()) {
      if (!this.#live(owner)) this.#retire(owner);
    }
    this.#paint();
  }

  retain(rowId: string, field: string): () => void {
    this.reconcile();
    const matches = [...this.#owners.values()].filter((owner) => owner.id === rowId && owner.field === field);
    if (typeof rowId !== 'string' || matches.length !== 1) {
      throwDiagnostic(
        CONFIG_RULE_ERROR,
        `retainCellExpansion requires one mounted action cell for occurrence "${rowId}", field "${field}".`,
        this.#grid.id,
        'pinnedColumns',
      );
    }
    const owner = matches[0];
    const lease = {};
    owner.leases.add(lease);
    this.#paint();
    return () => {
      if (!owner.leases.delete(lease) || this.#owners.get(owner.cell) !== owner) return;
      this.#paint();
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#abort.abort();
    this.#resize.disconnect();
    for (const owner of this.#owners.values()) this.#retire(owner);
  }
  // #endregion

  // #region Ownership and geometry
  #live(owner: CellOwner): boolean {
    return (
      owner.row.parentElement === this.#grid._bodyEl &&
      owner.cell.parentElement === owner.row &&
      (owner.row as RowElementInternal).__rowDataRef === owner.data &&
      this.#eligibleFields.has(owner.field)
    );
  }

  #configureEligibility(direction: TextDirection): void {
    if (direction === 'rtl') {
      this.#eligibleFields.clear();
      if (!this.#warnedRtl) {
        this.#warnedRtl = true;
        warnDiagnostic(
          CONFIG_RULE_WARN,
          'expandedCellWidth supports LTR grids only; RTL expansion is disabled.',
          this.#grid.id,
          'pinnedColumns',
        );
      }
      return;
    }
    this.#eligibleFields = new Set(
      this.#columns
        .filter(
          (column) =>
            column.utility === true &&
            typeof column.expandedCellWidth === 'number' &&
            Number.isFinite(column.expandedCellWidth) &&
            column.expandedCellWidth > 0 &&
            physicalPin(column, direction) === 'right',
        )
        .map((column) => column.field),
    );
  }

  #rowFor(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const row = target.closest<HTMLElement>('.data-grid-row');
    return row?.parentElement === this.#grid._bodyEl ? row : null;
  }

  #retire(owner: CellOwner): void {
    if (this.#owners.get(owner.cell) !== owner) return;
    unregisterControlCleanup(owner.cell, owner);
    owner.leases.clear();
    owner.cell.removeAttribute('data-tbw-cell-expanded');
    owner.cell.style.removeProperty('--tbw-pinned-cell-width');
    this.#owners.delete(owner.cell);
  }

  #paint(): void {
    const hovered = matchMedia('(hover: hover)').matches ? this.#rowFor(getHoveredRow(this.#grid)) : null;
    let active = this.#rowFor(this.#grid.ownerDocument.activeElement) ?? hovered;
    for (const owner of this.#owners.values()) {
      if (owner.leases.size > 0) {
        active = owner.row;
        break;
      }
    }
    for (const owner of this.#owners.values()) {
      owner.cell.toggleAttribute('data-tbw-cell-expanded', owner.row === active);
    }
  }

  #measure(): void {
    if (this.#disposed || !this.#viewport) return;
    const direction = getDirection(this.#grid);
    this.#configureEligibility(direction);
    this.reconcile();
    const widths = new Map(this.#headers.map((cell) => [cell.dataset.field, cell.getBoundingClientRect().width]));
    this.#widths.clear();
    const leftWidth = this.#columns.reduce(
      (sum, column) => (physicalPin(column, direction) === 'left' ? sum + (widths.get(column.field) ?? 0) : sum),
      0,
    );
    const right = this.#columns.filter(
      (column) => physicalPin(column, direction) === 'right' && widths.has(column.field),
    );
    let offset = 0;
    for (let i = right.length - 1; i >= 0; i--) {
      const column = right[i];
      const base = widths.get(column.field) ?? 0;
      // An inner right-pinned neighbour is an occupied rail, not an overlay target.
      const available = i === 0 ? this.#viewport.clientWidth - leftWidth - offset : base;
      const width = Math.max(base, Math.min(column.expandedCellWidth ?? base, available));
      this.#widths.set(column.field, width);
      for (const owner of this.#owners.values()) {
        if (owner.field === column.field) owner.cell.style.setProperty('--tbw-pinned-cell-width', `${width}px`);
      }
      offset += base;
    }
    this.#paint();
  }
  // #endregion
}
