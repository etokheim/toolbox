/**
 * Editor cell expansion — lets the focused editing cell of a column with
 * `editorWidth` overlay its neighbours while the editor is open.
 *
 * The cell keeps its column track: negative margins cancel the extra width so
 * the item's outer size (and therefore every track size) is unchanged.
 */
import { GridClasses } from '../../../core/constants';
import { CONFIG_RULE_WARN, warnDiagnostic } from '../../../core/internal/diagnostics';
import { getDirection } from '../../../core/internal/utils';
import type { ColumnConfig, GridHost } from '../../../core/types';
import { isInsideOpenAriaOverlay } from './helpers';

/** Attribute present on the expanded editing cell. */
export const EDITOR_EXPANDED_ATTR = 'data-tbw-editor-expanded';

const STYLE_PROPS = ['width', 'margin-left', 'margin-right'] as const;

/** Returns the requested editor width, or `undefined` when the column does not opt in. */
export function resolveEditorWidth(column: ColumnConfig | undefined): number | 'content' | undefined {
  const width = column?.editorWidth;
  if (width === 'content') return width;
  return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : undefined;
}

export class EditorExpansion {
  readonly #grid: GridHost;
  readonly #onChange: () => void;
  readonly #resize: ResizeObserver | undefined;
  #cell: HTMLElement | null = null;
  #geometry = '';
  #scheduled = false;
  #observed: HTMLElement | null = null;
  #warned = new Set<string>();
  #disposed = false;

  constructor(grid: GridHost, signal: AbortSignal, onChange: () => void) {
    this.#grid = grid;
    this.#onChange = onChange;
    const schedule = () => this.schedule();
    grid.addEventListener('focusin', schedule, { signal });
    grid.addEventListener('focusout', schedule, { signal });
    this.#resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    signal.addEventListener('abort', () => this.dispose(), { once: true });
  }

  /** The currently expanded cell, if any. */
  get cell(): HTMLElement | null {
    return this.#cell;
  }

  /** Coalesce a re-evaluation into one microtask (after focus moves and render hooks settle). */
  schedule(): void {
    if (this.#scheduled || this.#disposed) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (!this.#disposed) this.sync();
    });
  }

  sync(): void {
    const target = this.#resolveTarget();
    if (target?.cell !== this.#cell) this.#collapse();
    if (target) this.#expand(target.cell, target.width);
    this.#observe();
  }

  dispose(): void {
    this.#disposed = true;
    this.#resize?.disconnect();
    this.#collapse();
  }

  #resolveTarget(): { cell: HTMLElement; width: number | 'content' } | null {
    const grid = this.#grid;
    const body = grid._bodyEl;
    const active = grid.ownerDocument.activeElement;
    if (!body || !active) return null;
    let cell: HTMLElement | null = null;
    if (body.contains(active)) {
      const owner = active.closest<HTMLElement>('.cell.editing');
      // The editor itself (not the bare cell) must own focus.
      if (owner && owner !== active && owner.parentElement?.parentElement === body) cell = owner;
    } else if (
      this.#cell?.isConnected &&
      this.#cell.classList.contains('editing') &&
      (grid.containsFocus?.(active) || isInsideOpenAriaOverlay(active, this.#cell))
    ) {
      // Focus moved into the editor's registered/ARIA-owned overlay — keep the editor wide.
      cell = this.#cell;
    }
    if (!cell || cell.classList.contains(GridClasses.STICKY_LEFT) || cell.classList.contains(GridClasses.STICKY_RIGHT))
      return null;
    const column = grid._visibleColumns[Number(cell.getAttribute('data-col'))];
    if (!column || column.field !== cell.getAttribute('data-field')) return null;
    if (column.editorWidth !== undefined && resolveEditorWidth(column) === undefined) {
      this.#warn(column.field, `columns.${column.field}.editorWidth must be a finite positive number or 'content'.`);
    }
    const width = resolveEditorWidth(column);
    if (width === undefined) return null;
    if (getDirection(grid) === 'rtl') {
      this.#warn('\u0000rtl', 'editorWidth supports LTR grids only; editor expansion is disabled.');
      return null;
    }
    return { cell, width };
  }

  #expand(cell: HTMLElement, requested: number | 'content'): void {
    const viewport = this.#viewport();
    if (!viewport) return;
    for (const prop of STYLE_PROPS) cell.style.removeProperty(prop);
    const base = cell.getBoundingClientRect();
    let left = viewport.left;
    let right = viewport.right;
    // Pinned rails stay visible above the scrolling body, so they bound the overlay.
    for (const sibling of cell.parentElement?.children ?? []) {
      if (sibling.classList.contains(GridClasses.STICKY_LEFT))
        left = Math.max(left, sibling.getBoundingClientRect().right);
      else if (sibling.classList.contains(GridClasses.STICKY_RIGHT))
        right = Math.min(right, sibling.getBoundingClientRect().left);
    }
    let width = requested === 'content' ? this.#contentWidth(cell) : requested;
    width = Math.max(base.width, Math.min(width, right - left));
    if (width - base.width < 0.5) {
      this.#collapse();
      return;
    }
    // Prefer growing right; slide left (flip) when the right side lacks room.
    const start = Math.max(Math.min(base.left, right - width), Math.min(left, base.left));
    const marginLeft = start - base.left;
    const marginRight = base.width - width - marginLeft;
    cell.style.width = `${width}px`;
    cell.style.marginLeft = `${marginLeft}px`;
    cell.style.marginRight = `${marginRight}px`;
    cell.setAttribute(EDITOR_EXPANDED_ATTR, marginLeft < 0 ? 'left' : 'right');
    // Framework adapters mount editors asynchronously; measure 'content' again once they have.
    if (requested === 'content' && this.#cell !== cell) requestAnimationFrame(() => this.schedule());
    this.#cell = cell;
    const geometry = `${width}:${marginLeft}`;
    if (geometry !== this.#geometry) {
      this.#geometry = geometry;
      this.#onChange();
    }
  }

  #contentWidth(cell: HTMLElement): number {
    // Measure the editor's intrinsic width; the negative margin keeps the column track untouched meanwhile.
    cell.style.width = 'max-content';
    cell.style.marginRight = '-100000px';
    const width = cell.getBoundingClientRect().width;
    cell.style.removeProperty('width');
    cell.style.removeProperty('margin-right');
    return width;
  }

  #collapse(): void {
    const cell = this.#cell;
    if (!cell) return;
    this.#cell = null;
    this.#geometry = '';
    for (const prop of STYLE_PROPS) cell.style.removeProperty(prop);
    cell.removeAttribute(EDITOR_EXPANDED_ATTR);
    this.#onChange();
  }

  #viewport(): { left: number; right: number } | null {
    const area = this.#grid._bodyEl?.closest<HTMLElement>('.tbw-scroll-area');
    if (!area) return null;
    const rect = area.getBoundingClientRect();
    const left = rect.left + area.clientLeft;
    return { left, right: left + (area.clientWidth || rect.width) };
  }

  /** While expanded, horizontal scroll and resizes re-clamp the overlay. */
  #observe(): void {
    const area = this.#cell ? this.#grid._bodyEl?.closest<HTMLElement>('.tbw-scroll-area') : null;
    if (area === this.#observed) return;
    if (this.#observed) {
      this.#observed.removeEventListener('scroll', this.#onScroll);
      this.#resize?.disconnect();
    }
    this.#observed = area ?? null;
    if (area) {
      area.addEventListener('scroll', this.#onScroll, { passive: true });
      this.#resize?.observe(area);
    }
  }

  readonly #onScroll = () => this.schedule();

  #warn(key: string, message: string): void {
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    warnDiagnostic(CONFIG_RULE_WARN, message, this.#grid.id, 'editing');
  }
}
