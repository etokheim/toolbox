/**
 * Editor cell expansion — lets the focused editing cell of a column with
 * `editorWidth` / `editorHeight` overlay its neighbours while the editor is open.
 *
 * The cell keeps its column track and row height: negative margins cancel the
 * extra size so the item's outer size (and therefore every track) is unchanged.
 * Layout snaps instantly (so measurements stay exact); the grow/shrink is a
 * purely visual `clip-path` animation.
 */
import { GridClasses } from '../../../core/constants';
import { CONFIG_RULE_WARN, warnDiagnostic } from '../../../core/internal/diagnostics';
import { getDirection } from '../../../core/internal/utils';
import type { ColumnConfig, GridHost } from '../../../core/types';
import { isInsideOpenAriaOverlay } from './helpers';

/** Attribute present on the expanded editing cell. */
export const EDITOR_EXPANDED_ATTR = 'data-tbw-editor-expanded';
/** Attribute raising the row of the expanded cell above the rows below it. */
export const EDITOR_EXPANDED_ROW_ATTR = 'data-tbw-editor-expanded-row';

type Size = number | 'content';
type Target = { cell: HTMLElement; width?: Size; height?: Size };

const STYLE_PROPS = ['width', 'height', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom'] as const;
/** Clip inset revealing the box-shadow at the end of the grow animation. */
const SHADOW_ROOM = '-40px';

function resolveSize(value: unknown): Size | undefined {
  if (value === 'content') return value;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Returns the requested editor width, or `undefined` when the column does not opt in. */
export function resolveEditorWidth(column: ColumnConfig | undefined): Size | undefined {
  return resolveSize(column?.editorWidth);
}

/** Returns the requested editor height, or `undefined` when the column does not opt in. */
export function resolveEditorHeight(column: ColumnConfig | undefined): Size | undefined {
  return resolveSize(column?.editorHeight);
}

/** Offset of a box of `extent` starting at `start`: grow towards `max`, flip back when that side lacks room. */
function place(start: number, extent: number, min: number, max: number): number {
  return Math.max(Math.min(start, max - extent), Math.min(min, start)) - start;
}

/** Parses a CSS `<time>` (`120ms`, `.12s`) to milliseconds. */
function toMs(value: string): number {
  const v = value.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n;
}

export class EditorExpansion {
  readonly #grid: GridHost;
  readonly #onChange: () => void;
  readonly #resize: ResizeObserver | undefined;
  #cell: HTMLElement | null = null;
  #geometry = '';
  #collapsing: { cell: HTMLElement; animation: Animation } | null = null;
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
    if (target?.cell !== this.#cell) this.#collapse(true);
    if (target) this.#expand(target);
    this.#observe();
  }

  dispose(): void {
    this.#disposed = true;
    this.#resize?.disconnect();
    this.#collapse(false);
    this.#finishCollapse();
  }

  #resolveTarget(): Target | null {
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
    const width = resolveEditorWidth(column);
    const height = resolveEditorHeight(column);
    for (const [key, value, resolved] of [
      ['editorWidth', column.editorWidth, width],
      ['editorHeight', column.editorHeight, height],
    ] as const) {
      if (value !== undefined && resolved === undefined)
        this.#warn(column.field + key, `columns.${column.field}.${key} must be a finite positive number or 'content'.`);
    }
    if (width === undefined && height === undefined) return null;
    if (getDirection(grid) === 'rtl') {
      this.#warn('\u0000rtl', 'editorWidth/editorHeight support LTR grids only; editor expansion is disabled.');
      return null;
    }
    return { cell, width, height };
  }

  #expand({ cell, width: requestedWidth, height: requestedHeight }: Target): void {
    const viewport = this.#viewport();
    if (!viewport) return;
    const isNew = this.#cell !== cell;
    if (this.#collapsing?.cell === cell) this.#finishCollapse();
    // Measure the unexpanded cell: the attribute's `justify-self: start` would shrink it to its content.
    for (const prop of STYLE_PROPS) cell.style.removeProperty(prop);
    cell.removeAttribute(EDITOR_EXPANDED_ATTR);
    const base = cell.getBoundingClientRect();
    let { left, right } = viewport;
    // Pinned rails stay visible above the scrolling body, so they bound the overlay.
    for (const sibling of cell.parentElement?.children ?? []) {
      if (sibling.classList.contains(GridClasses.STICKY_LEFT))
        left = Math.max(left, sibling.getBoundingClientRect().right);
      else if (sibling.classList.contains(GridClasses.STICKY_RIGHT))
        right = Math.min(right, sibling.getBoundingClientRect().left);
    }
    let width = base.width;
    if (requestedWidth !== undefined) {
      const wanted = requestedWidth === 'content' ? this.#measure(cell, 'width') : requestedWidth;
      width = Math.max(base.width, Math.min(wanted, right - left));
    }
    const marginLeft = place(base.left, width, left, right);
    cell.style.width = `${width}px`;
    let height = base.height;
    if (requestedHeight !== undefined) {
      const wanted = requestedHeight === 'content' ? this.#measure(cell, 'height') : requestedHeight;
      height = Math.max(base.height, Math.min(wanted, viewport.bottom - viewport.top));
    }
    cell.style.removeProperty('width');
    const grownX = width - base.width >= 0.5;
    const grownY = height - base.height >= 0.5;
    if (!grownX && !grownY) {
      // Styles are already reset for measuring, so there is nothing left to animate.
      this.#collapse(false);
      return;
    }
    const marginTop = place(base.top, height, viewport.top, viewport.bottom);
    if (grownX) {
      cell.style.width = `${width}px`;
      cell.style.marginLeft = `${marginLeft}px`;
      cell.style.marginRight = `${base.width - width - marginLeft}px`;
    }
    if (grownY) {
      cell.style.height = `${height}px`;
      cell.style.marginTop = `${marginTop}px`;
      cell.style.marginBottom = `${base.height - height - marginTop}px`;
    }
    const tokens = [];
    if (grownX) tokens.push(marginLeft < 0 ? 'left' : 'right');
    if (grownY) tokens.push(marginTop < 0 ? 'up' : 'down');
    cell.setAttribute(EDITOR_EXPANDED_ATTR, tokens.join(' '));
    cell.parentElement?.setAttribute(EDITOR_EXPANDED_ROW_ATTR, '');
    // Framework adapters mount editors asynchronously; measure 'content' again once they have.
    if (isNew && (requestedWidth === 'content' || requestedHeight === 'content'))
      requestAnimationFrame(() => this.schedule());
    this.#cell = cell;
    // The base box as CSS inset() values (top right bottom left) of the expanded box.
    const insets = [-marginTop, width - base.width + marginLeft, height - base.height + marginTop, -marginLeft];
    if (isNew) this.#animate(cell, insets, false);
    const geometry = `${width}:${marginLeft}:${height}:${marginTop}`;
    if (geometry !== this.#geometry) {
      this.#geometry = geometry;
      cell.dataset.tbwEditorInsets = insets.join(' ');
      this.#onChange();
    }
  }

  /** Measures the editor's intrinsic size; a large negative margin keeps the tracks untouched meanwhile. */
  #measure(cell: HTMLElement, axis: 'width' | 'height'): number {
    const margin = axis === 'width' ? 'margin-right' : 'margin-bottom';
    cell.style.setProperty(axis, 'max-content');
    cell.style.setProperty(margin, '-100000px');
    const size = cell.getBoundingClientRect()[axis];
    cell.style.removeProperty(axis);
    cell.style.removeProperty(margin);
    return size;
  }

  /** Visually grows (or shrinks) between the base box and the expanded box. */
  #animate(cell: HTMLElement, insets: number[], reverse: boolean): Animation | null {
    if (typeof cell.animate !== 'function') return null;
    const style = getComputedStyle(cell);
    const duration = toMs(style.getPropertyValue('--tbw-editor-expand-duration'));
    if (!duration) return null;
    const frames = [
      { clipPath: `inset(${insets.map((v) => `${v}px`).join(' ')})` },
      { clipPath: `inset(${SHADOW_ROOM})` },
    ];
    if (reverse) frames.reverse();
    return cell.animate(frames, {
      duration,
      easing: style.getPropertyValue('--tbw-editor-expand-easing').trim() || 'ease-out',
      fill: reverse ? 'forwards' : 'none',
    });
  }

  #collapse(animate: boolean): void {
    const cell = this.#cell;
    if (!cell) return;
    this.#cell = null;
    this.#geometry = '';
    this.#finishCollapse();
    const insets = (cell.dataset.tbwEditorInsets ?? '').split(' ').map(Number);
    const animation = animate && cell.isConnected && insets.length === 4 ? this.#animate(cell, insets, true) : null;
    if (!animation) {
      this.#clear(cell);
      return;
    }
    this.#collapsing = { cell, animation };
    animation.addEventListener('finish', () => {
      if (this.#collapsing?.animation === animation) this.#finishCollapse();
    });
  }

  /** Ends a pending shrink animation and restores the cell's layout. */
  #finishCollapse(): void {
    const pending = this.#collapsing;
    if (!pending) return;
    this.#collapsing = null;
    pending.animation.cancel();
    this.#clear(pending.cell);
  }

  #clear(cell: HTMLElement): void {
    for (const prop of STYLE_PROPS) cell.style.removeProperty(prop);
    cell.removeAttribute(EDITOR_EXPANDED_ATTR);
    delete cell.dataset.tbwEditorInsets;
    const row = cell.parentElement;
    if (row && this.#cell?.parentElement !== row) row.removeAttribute(EDITOR_EXPANDED_ROW_ATTR);
    this.#onChange();
  }

  /** Horizontal bounds from the scroll area, vertical bounds from the clipping rows viewport. */
  #viewport(): { left: number; right: number; top: number; bottom: number } | null {
    const body = this.#grid._bodyEl;
    const area = body?.closest<HTMLElement>('.tbw-scroll-area');
    if (!area) return null;
    const rect = area.getBoundingClientRect();
    const left = rect.left + area.clientLeft;
    const rows = body?.closest<HTMLElement>('.rows-viewport')?.getBoundingClientRect() ?? rect;
    return { left, right: left + (area.clientWidth || rect.width), top: rows.top, bottom: rows.bottom };
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
