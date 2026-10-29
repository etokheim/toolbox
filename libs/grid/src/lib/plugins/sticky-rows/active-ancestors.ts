import { CONFIG_RULE_WARN, warnDiagnostic } from '../../core/internal/diagnostics';
import { getRowWindow, setRowWindow, type RowWindow } from '../../core/internal/row-window';
import { getRowFlow } from '../../core/internal/row-flow';
import {
  getRowCacheKey,
  getRowIndexAtOffset,
  resolveConfiguredRowHeight,
  toVirtualScrollTop,
} from '../../core/internal/virtualization';
import type { GridElement } from '../../core/plugin/base-plugin';
import type { GridConfig, RowElementInternal, ScrollToRowOptions } from '../../core/types';
import type { HierarchyModel } from '../hierarchy/hierarchy';
import { buildAncestorIndex, indexEligibleAncestors, type AncestorIndex } from './ancestor-index';
import { layoutAncestors, type AncestorFrame } from './ancestor-layout';
import type { StickyRowsConfig } from './types';

/** @internal Owns live ancestor geometry; never creates another renderer or control. */
export class ActiveAncestors implements RowWindow {
  // #region State and lifecycle
  indices: readonly number[] = [];
  elements = new Map<number, RowElementInternal>();
  readonly #grid: GridElement;
  readonly #config: StickyRowsConfig;
  #index: AncestorIndex = { rows: [], parents: [], subtreeEnds: [] };
  #rows: readonly unknown[] | undefined;
  #model: HierarchyModel | undefined;
  #epoch = -1;
  #getRowId: GridConfig['getRowId'];
  #rowKeys = new Map<unknown, unknown>();
  #renderedKeys = new WeakMap<RowElementInternal, unknown>();
  #entering = new Set<RowElementInternal>();
  #sticky: boolean[] = [];
  #frames: AncestorFrame[] = [];
  #header: HTMLElement | null = null;
  #headerShift = 0;
  #pending = 0;
  #exhausted = false;
  #resizeObserver: ResizeObserver | undefined;
  #viewportAbort: AbortController | undefined;
  #disposed = false;
  #heightAnchor:
    | {
        key: unknown;
        inside: number;
        nativeTop: number;
        source: readonly unknown[];
        getRowId: GridConfig['getRowId'];
        height: GridConfig['rowHeight'];
        rows?: readonly unknown[];
        target?: number;
      }
    | undefined;

  constructor(grid: GridElement, config: StickyRowsConfig, signal: AbortSignal) {
    this.#grid = grid;
    this.#config = config;
    setRowWindow(grid, this);
    signal.addEventListener('abort', () => this.dispose(), { once: true });
    this.#bindViewport();
  }

  #bindViewport(): void {
    const grid = this.#grid;
    const config = this.#config;
    if (config.scrollContainer) {
      const { signal } = (this.#viewportAbort = new AbortController());
      const schedule = () => {
        if (!signal.aborted) this.#schedule();
      };
      config.scrollContainer.addEventListener('scroll', schedule, { passive: true, signal });
      for (const event of ['wheel', 'touchmove', 'pointerdown', 'keydown']) {
        config.scrollContainer.addEventListener(event, () => this.cancelHeightAnchor(), { passive: true, signal });
      }
      grid.ownerDocument.defaultView?.addEventListener('resize', schedule, { passive: true, signal });
      this.#resizeObserver = new ResizeObserver(schedule);
      this.#resizeObserver.observe(config.scrollContainer);
      this.#resizeObserver.observe(grid);
      this.reveal = (index, options) => this.#reveal(index, options);
      this.pageHeight = () => this.viewport()?.height ?? 0;
    }
  }

  reveal?: (index: number, options?: ScrollToRowOptions) => void;
  pageHeight?: () => number;

  setViewport(viewport: Pick<StickyRowsConfig, 'scrollContainer' | 'topOffset'>): void {
    const changedOwner = this.#config.scrollContainer !== viewport.scrollContainer;
    this.cancelHeightAnchor();
    if (changedOwner) this.#clearViewport();
    this.#config.scrollContainer = viewport.scrollContainer;
    this.#config.topOffset = viewport.topOffset;
    if (changedOwner) this.#bindViewport();
    this.#schedule();
  }

  #clearViewport(): void {
    this.#viewportAbort?.abort();
    this.#viewportAbort = undefined;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    if (this.#pending) this.#grid.ownerDocument.defaultView?.cancelAnimationFrame(this.#pending);
    this.#pending = 0;
    this.#header?.style.removeProperty('--tbw-ancestor-header-shift');
    this.#header?.classList.remove('tbw-ancestor-header');
    this.#header = null;
    this.#headerShift = 0;
    this.#grid._bodyEl?.style.removeProperty('--tbw-ancestor-content-height');
    this.#grid._bodyEl?.classList.remove('tbw-ancestor-external-body');
    this.#exhausted = false;
    this.reveal = undefined;
    this.pageHeight = undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancelHeightAnchor();
    this.#clearViewport();
    for (const row of this.elements.values()) this.#clearRow(row);
    if (getRowWindow(this.#grid) === this) setRowWindow(this.#grid, undefined);
    this.elements.clear();
    this.#entering.clear();
  }
  // #endregion

  // #region Row window
  reconcile(pool: RowElementInternal[], create: () => RowElementInternal): RowElementInternal[] {
    const available = new Map(pool.map((row) => [this.#renderedKeys.get(row) ?? row, row]));
    const next: RowElementInternal[] = [];
    this.elements.clear();
    this.#entering.clear();
    for (const index of this.indices) {
      const data = this.#grid._rows[index];
      const key = this.#rowKeys.get(data) ?? data;
      let row = available.get(key);
      if (!row) {
        row = create();
        this.#entering.add(row);
      }
      available.delete(key);
      this.#renderedKeys.set(row, key);
      next.push(row);
      this.elements.set(index, row);
    }
    return next.concat([...available.values()]);
  }

  select(start: number, end: number): boolean {
    const previous = this.indices;
    this.indices = this.#select(start, end);
    return previous.length !== this.indices.length || this.indices.some((index, i) => index !== previous[i]);
  }

  #select(start: number, end: number): readonly number[] {
    this.#rebuild();
    const viewport = this.viewport();
    this.#computeFrames(viewport);
    if (viewport?.height === 0) return [];
    const result: number[] = [];
    let frame = 0;
    for (let row = start; row < end; row++) {
      while (frame < this.#frames.length && this.#frames[frame].index < row) {
        result.push(this.#frames[frame++].index);
      }
      if (this.#frames[frame]?.index === row) frame++;
      result.push(row);
    }
    while (frame < this.#frames.length) result.push(this.#frames[frame++].index);
    return result;
  }

  layout(): void {
    this.#rebuild();
    const grid = this.#grid;
    this.#orderRows();
    const external = this.viewport();
    this.#computeFrames(external);
    const scrollTop = external?.scrollTop ?? this.#scrollTop();
    const startOffset = this.#offsetAt(grid._virtualization.start);
    const frames = new Map(this.#frames.map((frame) => [frame.index, frame]));
    for (const [index, row] of this.elements) {
      const frame = frames.get(index);
      if (!frame) {
        this.#clearRow(row);
        continue;
      }

      const retained = index < grid._virtualization.start || index >= grid._virtualization.end;
      const natural = retained ? startOffset : this.#offsetAt(index);
      row.classList.add('tbw-ancestor-live');
      row.classList.toggle('tbw-ancestor-retained', retained);
      row.style.setProperty('--tbw-ancestor-shift', `${frame.top + scrollTop - natural}px`);
      row.style.setProperty('--tbw-ancestor-order', String(this.#frames.length - this.#frames.indexOf(frame)));
    }
    if (external) {
      if (this.#header !== external.header) {
        if (this.#header) this.#resizeObserver?.unobserve(this.#header);
        this.#header?.style.removeProperty('--tbw-ancestor-header-shift');
        this.#header?.classList.remove('tbw-ancestor-header');
        this.#header = external.header;
        if (this.#header) this.#resizeObserver?.observe(this.#header);
      }
      this.#headerShift = external.headerShift;
      this.#header?.classList.add('tbw-ancestor-header');
      this.#header?.style.setProperty('--tbw-ancestor-header-shift', `${this.#headerShift}px`);
      const body = grid._bodyEl;
      body.classList.add('tbw-ancestor-external-body');
      body.style.setProperty('--tbw-ancestor-content-height', `${this.#offsetAt(grid._rows.length)}px`);
      if (external.exhausted && !this.#exhausted) {
        warnDiagnostic(CONFIG_RULE_WARN, 'Header/footer leave no usable ancestor viewport.', grid.id, 'stickyRows');
      }
      this.#exhausted = external.exhausted;
    }
  }

  #orderRows(): void {
    const body = this.#grid._bodyEl;
    const active = body.ownerDocument.activeElement;
    // New rows were appended during rendering. Place them first so reverse
    // scrolling does not move the entire retained suffix around the entrants.
    if (this.#entering.size) {
      let anchor: Element | null = null;
      for (let i = this.#grid._rowPool.length - 1; i >= 0; i--) {
        const row = this.#grid._rowPool[i];
        if (this.#entering.has(row)) this.#placeRow(row, anchor, active);
        anchor = row;
      }
      this.#entering.clear();
    }
    // Retain the general ordering pass for actual data reorders.
    let anchor: Element | null = null;
    for (let i = this.#grid._rowPool.length - 1; i >= 0; i--) {
      const row = this.#grid._rowPool[i];
      this.#placeRow(row, anchor, active);
      anchor = row;
    }
  }

  #placeRow(row: RowElementInternal, anchor: Element | null, active: Element | null): void {
    let next = row.nextElementSibling;
    while (next && !next.classList.contains('data-grid-row')) next = next.nextElementSibling;
    if (next === anchor) return;
    const body = this.#grid._bodyEl;
    if (typeof body.moveBefore === 'function') body.moveBefore(row, anchor);
    // Reorder other rows around focus when state-preserving movement is unavailable.
    else if (!row.contains(active)) body.insertBefore(row, anchor);
  }

  offsets(focusedRowIndex?: number): { top: number; bottom: number; skipScroll?: boolean } {
    this.#rebuild();
    let top = this.#frames.reduce((height, frame) => Math.max(height, frame.top + frame.height), 0);
    const focused = this.#frames.find((frame) => frame.index === focusedRowIndex);
    if (!focused && focusedRowIndex !== undefined && this.#index.rows[focusedRowIndex]) {
      top = this.#contextHeight(
        focusedRowIndex,
        (this.viewport()?.height ?? this.#grid._virtualization.viewportEl?.clientHeight ?? 0) -
          (getRowFlow(this.#grid)?.bottom() ?? 0),
      );
    }
    return { top, bottom: 0, skipScroll: focused !== undefined && focused.top >= 0 };
  }
  // #endregion

  // #region Viewport geometry
  /** External row-space viewport; core still owns the natural position cache. */
  viewport(physical = false):
    | {
        scrollTop: number;
        height: number;
        container: HTMLElement;
        header: HTMLElement | null;
        headerShift: number;
        exhausted: boolean;
      }
    | undefined {
    const owner = this.#config.scrollContainer;
    const viewport = this.#grid._virtualization.viewportEl;
    if (!owner || !viewport) return undefined;
    const header = this.#grid._headerRowEl?.closest<HTMLElement>('.header') ?? null;
    const ownerTop = owner.getBoundingClientRect().top + owner.clientTop;
    const ownerHeight = owner.clientHeight;
    const viewportRect = viewport.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    const headerHeight = headerRect?.height ?? 0;
    const naturalHeaderTop = (headerRect?.top ?? viewportRect.top) - (this.#header === header ? this.#headerShift : 0);
    const target = Math.min(
      Math.max(naturalHeaderTop, ownerTop + (this.#config.topOffset ?? 0)),
      Math.max(naturalHeaderTop, viewportRect.bottom - headerHeight),
    );
    const top = Math.max(viewportRect.top, target + headerHeight, ownerTop);
    const bottom = Math.min(viewportRect.bottom, ownerTop + ownerHeight);
    const height = Math.max(0, bottom - top);
    return {
      scrollTop: (physical ? undefined : this.#heightAnchor?.target) ?? Math.max(0, top - viewportRect.top),
      height,
      container: owner,
      header,
      headerShift: target - naturalHeaderTop,
      exhausted:
        headerHeight + (this.#config.topOffset ?? 0) >= ownerHeight &&
        ownerHeight > 0 &&
        viewportRect.bottom > ownerTop &&
        naturalHeaderTop < ownerTop + ownerHeight,
    };
  }
  // #endregion

  // #region Generation and natural positions
  #rebuild(): void {
    const grid = this.#grid;
    const hierarchy = grid.getPluginByName('hierarchy');
    const model = hierarchy?.getRowModel();
    const getRowId = grid.effectiveConfig.getRowId;
    if (
      this.#rows === grid._rows &&
      this.#model === model &&
      this.#epoch === grid.__rowRenderEpoch &&
      this.#getRowId === getRowId
    )
      return;
    if (this.#getRowId !== getRowId) this.#renderedKeys = new WeakMap();
    this.#getRowId = getRowId;
    this.#index = buildAncestorIndex(model?.rows ?? grid._rows, (row) => hierarchy?.getRowMeta(row), grid._rows);
    this.#rowKeys.clear();
    const occurrences = new Map<unknown, unknown>();
    for (const row of this.#index.rows) {
      // Synthetic keys are native-owned; real rows require explicit occurrence IDs.
      const key =
        row && typeof row === 'object' && '__rowCacheKey' in row ? getRowCacheKey(row) : (getRowId?.(row) ?? row);
      if (occurrences.has(key)) {
        // An ambiguous ID never authorizes transferring a live view between objects.
        const previous = occurrences.get(key);
        this.#rowKeys.set(previous, previous);
        this.#rowKeys.set(row, row);
      } else {
        occurrences.set(key, row);
        this.#rowKeys.set(row, key);
      }
    }
    const predicate = this.#config.isSticky;
    this.#sticky = this.#index.rows.map((row, index) =>
      typeof predicate === 'function'
        ? Boolean(predicate(row, index))
        : Boolean(row && typeof row === 'object' && Reflect.get(row, predicate)),
    );
    this.#index = indexEligibleAncestors(this.#index, this.#sticky);
    this.#rows = grid._rows;
    this.#model = model;
    this.#epoch = grid.__rowRenderEpoch;
  }

  #computeFrames(external: { scrollTop: number; height: number } | undefined): void {
    const grid = this.#grid;
    if (getRowFlow(grid)?.exhausted?.()) {
      this.#frames = [];
      return;
    }
    this.#frames = layoutAncestors(
      this.#index,
      this.#sticky,
      (index) => this.#offsetAt(index),
      (index) => this.#heightAt(index),
      (offset) => this.#rowAt(offset),
      external?.scrollTop ?? this.#scrollTop(),
      (external?.height ?? grid._virtualization.viewportEl?.clientHeight ?? 0) - (getRowFlow(grid)?.bottom() ?? 0),
      (offset) => getRowFlow(grid)?.scopeAt?.(offset),
      (index) =>
        getRowFlow(grid)?.scopeEnd?.(index, this.#index.subtreeEnds[index]) ??
        this.#offsetAt(this.#index.subtreeEnds[index]),
    );
  }

  #offsetAt(index: number): number {
    const state = this.#grid._virtualization;
    const cache = state.positionCache;
    if (cache?.[index]) return cache[index].offset;
    if (cache?.length && index === cache.length) {
      const last = cache[cache.length - 1];
      return last.offset + last.height + (last.after ?? 0);
    }
    return index * state.rowHeight + (index === 0 ? (getRowFlow(this.#grid)?.emptyHeight() ?? 0) : 0);
  }

  #heightAt(index: number): number {
    const grid = this.#grid;
    return (
      resolveConfiguredRowHeight(grid.effectiveConfig.rowHeight, grid._rows[index], index) ??
      (this.elements.get(index)?.offsetHeight || grid._virtualization.rowHeight)
    );
  }

  #contextHeight(index: number, available: number): number {
    if (getRowFlow(this.#grid)?.exhausted?.()) return 0;
    const height = this.#heightAt(index);
    let context = 0;
    for (let parent = this.#index.parents[index]; parent !== -1; parent = this.#index.parents[parent]) {
      const parentHeight = this.#heightAt(parent);
      if (context + parentHeight + height > available) break;
      context += parentHeight;
    }
    return context;
  }

  #rowAt(offset: number): number {
    const state = this.#grid._virtualization;
    return Math.min(
      this.#grid._rows.length - 1,
      state.positionCache
        ? getRowIndexAtOffset(state.positionCache, Math.max(0, offset))
        : Math.max(0, Math.floor(offset / state.rowHeight)),
    );
  }

  #scrollTop(): number {
    const state = this.#grid._virtualization;
    return toVirtualScrollTop(state.container?.scrollTop ?? 0, state.scrollMapping);
  }

  #clearRow(row: HTMLElement): void {
    row.classList.remove('tbw-ancestor-live', 'tbw-ancestor-retained');
    row.style.removeProperty('--tbw-ancestor-shift');
    row.style.removeProperty('--tbw-ancestor-order');
  }
  // #endregion

  // #region External scrolling and reveal
  captureHeightAnchor(height: GridConfig['rowHeight']): ((scrollTop: number) => number | undefined) | undefined {
    const viewport = this.viewport(true);
    const grid = this.#grid;
    const config = grid.effectiveConfig;
    if (!viewport?.height || !grid._rows.length || height === config.rowHeight) return;
    if (typeof height !== 'function' && !(typeof height === 'number' && height > 0)) return;
    const index = this.#rowAt(viewport.scrollTop + Math.abs(viewport.scrollTop) * Number.EPSILON);
    if (index < 0) return;
    this.#heightAnchor ??= {
      key: getRowCacheKey(grid._rows[index], config.getRowId),
      inside: Math.max(0, viewport.scrollTop - this.#offsetAt(index)),
      nativeTop: viewport.container.scrollTop,
      source: grid.sourceRows,
      getRowId: config.getRowId,
      height: config.rowHeight,
    };
    const anchor = this.#heightAnchor;
    return (nativeTop) => {
      const effective = grid.effectiveConfig;
      if (
        this.#heightAnchor !== anchor ||
        nativeTop !== anchor.nativeTop ||
        grid.sourceRows !== anchor.source ||
        effective.getRowId !== anchor.getRowId ||
        effective.rowHeight === anchor.height ||
        effective.rowHeight === undefined
      ) {
        this.cancelHeightAnchor();
        return;
      }
      const current = grid._rows.findIndex((row) => getRowCacheKey(row, effective.getRowId) === anchor.key);
      if (current < 0) {
        this.cancelHeightAnchor();
        return;
      }
      const extent = grid._virtualization.positionCache?.[current]?.height ?? grid._virtualization.rowHeight;
      anchor.target = this.#offsetAt(current) + Math.min(anchor.inside, Math.max(0, extent - 1));
      anchor.rows = grid._rows;
      this.#restoreHeightAnchor();
      return viewport.container.scrollTop;
    };
  }

  cancelHeightAnchor(): void {
    this.#heightAnchor = undefined;
  }

  #restoreHeightAnchor(): void {
    const anchor = this.#heightAnchor;
    const owner = this.#config.scrollContainer;
    if (!anchor || anchor.target === undefined || !owner) return;
    const grid = this.#grid;
    const clampedTop = Math.min(anchor.nativeTop, Math.max(0, owner.scrollHeight - owner.clientHeight));
    if (
      grid.sourceRows !== anchor.source ||
      grid._rows !== anchor.rows ||
      grid.effectiveConfig.getRowId !== anchor.getRowId ||
      (owner.scrollTop !== anchor.nativeTop && owner.scrollTop !== clampedTop)
    ) {
      this.cancelHeightAnchor();
      return;
    }
    // The content-height wrapper may settle in ResizeObserver after the cache
    // rebuild. Applying earlier can clamp the real owner against the old extent.
    const viewport = grid._virtualization.viewportEl;
    if (!viewport || Math.abs(viewport.getBoundingClientRect().height - this.#offsetAt(grid._rows.length)) > 1) return;
    const current = this.viewport(true);
    if (!current) return;
    this.cancelHeightAnchor();
    owner.scrollTop += anchor.target - current.scrollTop;
  }

  #schedule(): void {
    if (this.#disposed || this.#pending) return;
    const win = this.#grid.ownerDocument.defaultView;
    const owner = this.#config.scrollContainer ?? this.#grid._virtualization.container;
    if (!win || !owner) return;
    this.#pending = win.requestAnimationFrame(() => {
      this.#pending = 0;
      this.#restoreHeightAnchor();
      this.#grid._onScrollBatched(owner.scrollTop);
    });
  }

  #reveal(index: number, options?: ScrollToRowOptions): void {
    const owner = this.#config.scrollContainer;
    const viewport = this.viewport();
    const rowsViewport = this.#grid._virtualization.viewportEl;
    if (!owner || !viewport || !rowsViewport || !this.#grid._rows.length) return;
    this.#rebuild();
    this.#computeFrames(viewport);
    index = Math.max(0, Math.min(index, this.#grid._rows.length - 1));
    const offsets = this.offsets(index);
    if (offsets.skipScroll) return;
    const ownerTop = owner.getBoundingClientRect().top + owner.clientTop;
    const headerHeight = viewport.header?.getBoundingClientRect().height ?? 0;
    const contentTop = ownerTop + (this.#config.topOffset ?? 0) + headerHeight;
    const bottom = ownerTop + owner.clientHeight - (getRowFlow(this.#grid)?.bottom() ?? 0);
    const available = bottom - contentTop;
    if (available <= 0) {
      if (!this.#exhausted) {
        warnDiagnostic(
          CONFIG_RULE_WARN,
          'Header/footer leave no usable ancestor viewport.',
          this.#grid.id,
          'stickyRows',
        );
      }
      this.#exhausted = true;
      return;
    }
    const height = this.#heightAt(index);
    const context = this.#contextHeight(index, available);
    // Physical row origin remains meaningful before and after grid intersection;
    // a clamped logical offset cannot bring an off-screen grid back into view.
    const top = rowsViewport.getBoundingClientRect().top + this.#offsetAt(index);
    let align = options?.align ?? 'nearest';
    if (align === 'nearest') {
      if (viewport.height > 0 && top >= contentTop + offsets.top && top + height <= bottom) return;
      align = top < contentTop + offsets.top || height > available - context ? 'start' : 'end';
    }
    let desiredTop = contentTop + context;
    if (align === 'end') {
      desiredTop = bottom - height;
    } else if (align === 'center') {
      desiredTop += (available - context - height) / 2;
    }
    const smooth =
      options?.behavior === 'smooth' &&
      getComputedStyle(this.#grid).getPropertyValue('--tbw-animation-enabled').trim() !== '0';
    owner.scrollTo({ top: owner.scrollTop + top - desiredTop, behavior: smooth ? 'smooth' : 'instant' });
  }
  // #endregion
}
