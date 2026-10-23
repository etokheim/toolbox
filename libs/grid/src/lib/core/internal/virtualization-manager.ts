/**
 * VirtualizationManager — encapsulates all virtualization state and logic
 * that was previously inline in the DataGridElement class.
 *
 * Owns the VirtualState, position/height caches, and the core
 * refreshVirtualWindow algorithm. Takes the grid reference directly
 * (tightly coupled — this manager can never live outside the grid).
 */
import type { GridConfig, InternalGrid, VirtualState } from '../types';
import { RenderPhase } from './render-scheduler';
import { getRowWindow } from './row-window';
import { applyRowFlow, getRowFlow } from './row-flow';
import {
  computeAverageExcludingPluginRows,
  computeScrollMapping,
  createIdentityScrollMapping,
  fromVirtualScrollTop,
  getRowCacheKey,
  getRowIndexAtOffset,
  getTotalHeight,
  measureRenderedRowHeights,
  rebuildPositionCache,
  resolveConfiguredRowHeight,
  toVirtualScrollTop,
  updateRowHeight,
} from './virtualization';

/** Safety valve for `#scheduleGeometryVerification` against a layout that never settles. */
const MAX_GEOMETRY_VERIFY_PASSES = 3;

// #region VirtualizationManager

export class VirtualizationManager<T = any> {
  readonly #grid: InternalGrid<T>;

  // The full virtualization state — still a plain object so plugins can read
  // fields directly via `grid._virtualization` (they access the same reference).
  readonly state: VirtualState;

  #geometryVerifyHandle = 0;
  #geometryVerifyPasses = 0;
  #positionRows?: T[];

  constructor(grid: InternalGrid<T>, initialState?: Partial<VirtualState>) {
    this.#grid = grid;
    this.state = {
      enabled: true,
      rowHeight: 28,
      bypassThreshold: 24,
      start: 0,
      end: 0,
      container: null,
      viewportEl: null,
      totalHeightEl: null,
      positionCache: null,
      heightCache: {
        byKey: new Map<string, number>(),
        byRef: new WeakMap<object, number>(),
      },
      averageHeight: 28,
      measuredCount: 0,
      variableHeights: false,
      cachedViewportHeight: 0,
      cachedFauxHeight: 0,
      cachedScrollAreaHeight: 0,
      scrollAreaEl: null,
      scrollMapping: createIdentityScrollMapping(),
      ...initialState,
    };
  }

  // #region Cached Geometry

  /**
   * Live geometry read shared by the force-path spacer calculation and the post-render
   * verification, so a cache write and the check of that cache resolve element fallbacks
   * identically. `updateCachedGeometry()` deliberately does not use it — it must keep the
   * last known values rather than cache zeros when the elements are detached.
   */
  #readGeometry(): { fauxHeight: number; viewportHeight: number; scrollAreaHeight: number } {
    const s = this.state;
    const fauxScrollbar = s.container ?? this.#grid._hostElement;
    const viewportEl = s.viewportEl ?? fauxScrollbar;
    const fauxHeight = fauxScrollbar?.clientHeight ?? 0;
    return {
      fauxHeight,
      viewportHeight: viewportEl?.clientHeight ?? 0,
      scrollAreaHeight: s.scrollAreaEl ? s.scrollAreaEl.clientHeight : fauxHeight,
    };
  }

  /**
   * Update cached viewport and faux scrollbar geometry.
   * Called by ResizeObserver and on force-refresh to avoid forced layout reads during scroll.
   */
  updateCachedGeometry(): void {
    const s = this.state;
    const fauxScrollbar = s.container;
    const viewportEl = s.viewportEl ?? fauxScrollbar;
    if (viewportEl) {
      s.cachedViewportHeight = viewportEl.clientHeight;
    }
    if (fauxScrollbar) {
      s.cachedFauxHeight = fauxScrollbar.clientHeight;
    }
    const scrollAreaEl = s.scrollAreaEl;
    if (scrollAreaEl) {
      s.cachedScrollAreaHeight = scrollAreaEl.clientHeight;
    }
  }

  // #endregion

  // #region Spacer Height

  /**
   * Calculate total height for the faux scrollbar spacer element.
   * Used by both bypass and virtualized rendering paths to ensure consistent scroll behavior.
   *
   * @param totalRows - Total number of rows to calculate height for
   * @param forceRead - When true, reads fresh geometry from DOM (used after structural changes).
   *   When false, uses cached values from ResizeObserver to avoid forced synchronous layout.
   */
  calculateTotalSpacerHeight(totalRows: number, forceRead = false): number {
    const s = this.state;

    let fauxScrollHeight: number;
    let viewportHeight: number;
    let scrollAreaHeight: number;

    if (forceRead) {
      ({ fauxHeight: fauxScrollHeight, viewportHeight, scrollAreaHeight } = this.#readGeometry());

      s.cachedFauxHeight = fauxScrollHeight;
      s.cachedViewportHeight = viewportHeight;
      s.cachedScrollAreaHeight = scrollAreaHeight;
    } else {
      fauxScrollHeight = s.cachedFauxHeight;
      viewportHeight = s.cachedViewportHeight;
      scrollAreaHeight = s.cachedScrollAreaHeight || fauxScrollHeight;
    }

    const viewportHeightDiff = scrollAreaHeight - viewportHeight;
    const hScrollbarPadding = Math.max(0, fauxScrollHeight - scrollAreaHeight);

    let rowContentHeight: number;

    if (s.variableHeights && s.positionCache) {
      rowContentHeight = getTotalHeight(s.positionCache);
    } else {
      rowContentHeight = totalRows * s.rowHeight;
    }
    if (totalRows === 0) rowContentHeight += getRowFlow(this.#grid)?.emptyHeight() ?? 0;

    // Clamp the row-content portion to the browser's max element height. Above
    // this cap (Chromium ~33.5M px), a single element's rendered height is silently
    // truncated, so the tail of huge datasets becomes unreachable via the native
    // scrollbar / Ctrl+End. Storing the mapping here lets refreshVirtualWindow
    // (and the scroll listener / scrollToRow) translate between spacer-space
    // scrollTop and virtual row-content space.
    s.scrollMapping = computeScrollMapping(rowContentHeight, viewportHeight);

    return s.scrollMapping.spacerHeight + viewportHeightDiff + hScrollbarPadding;
  }

  // #endregion

  // #region Position Cache

  #positionsStale(): boolean {
    const s = this.state;
    return (
      s.variableHeights &&
      (this.#positionRows !== this.#grid._rows || s.positionCache?.length !== this.#grid._rows.length)
    );
  }

  /** Reconcile a new row generation before imperative navigation reads its geometry. */
  refreshChangedRows(): void {
    if (this.#positionsStale()) this.refreshVirtualWindow(true);
  }

  /**
   * Initialize or rebuild the position cache for variable row heights.
   * Called when rows change or variable heights mode is enabled.
   */
  initializePositionCache(): void {
    const s = this.state;
    if (!s.variableHeights) return;

    const grid = this.#grid;
    const flow = getRowFlow(grid);
    flow?.prepare();
    const rows = grid._rows;
    const estimatedHeight = s.rowHeight || 28;
    const getRowId = grid.effectiveConfig?.getRowId;
    const rowIdFn = getRowId ? (row: T) => getRowId(row) : undefined;

    s.positionCache = rebuildPositionCache(rows, s.heightCache, estimatedHeight, { rowId: rowIdFn }, (row, index) =>
      this.#resolveRowHeight(row, index),
    );
    if (flow) applyRowFlow(s.positionCache, flow);
    this.#positionRows = rows;

    const stats = computeAverageExcludingPluginRows(s.positionCache, rows, estimatedHeight, (row, index) =>
      grid._getPluginRowHeight(row, index),
    );
    s.measuredCount = stats.measuredCount;
    if (stats.measuredCount > 0) {
      s.averageHeight = stats.averageHeight;
    }
  }

  #resolveRowHeight(row: T, index: number): number | undefined {
    const pluginHeight = this.#grid._getPluginRowHeight(row, index);
    if (pluginHeight !== undefined) return pluginHeight;
    return resolveConfiguredRowHeight(this.#grid.effectiveConfig?.rowHeight, row, index);
  }

  /**
   * Invalidate a row's height in the position cache.
   * Call this when a plugin changes a row's height (e.g., expanding/collapsing a detail panel).
   * Updates the position cache incrementally O(1) + offset recalc O(k) without a full rebuild.
   *
   * @param rowIndex - Index of the row whose height changed
   * @param newHeight - Optional new height. If not provided, queries plugins for height.
   */
  invalidateRowHeight(rowIndex: number, newHeight?: number): void {
    const s = this.state;
    if (!s.variableHeights) return;
    if (!s.positionCache) return;

    const rows = this.#grid._rows;
    if (rowIndex < 0 || rowIndex >= rows.length) return;

    const row = rows[rowIndex];

    let height = newHeight;
    if (height === undefined) {
      height = this.#resolveRowHeight(row, rowIndex);
    }
    if (height === undefined) {
      height = s.rowHeight;
    }

    const currentEntry = s.positionCache[rowIndex];
    if (!currentEntry || Math.abs(currentEntry.height - height) < 1) {
      return;
    }

    updateRowHeight(s.positionCache, rowIndex, height);

    if (s.totalHeightEl) {
      const newTotalHeight = this.calculateTotalSpacerHeight(rows.length);
      s.totalHeightEl.style.height = `${newTotalHeight}px`;
    }
  }

  // #endregion

  // #region Row Measurement

  /**
   * Measure rendered row heights and update position cache.
   * Called after rows are rendered to capture actual DOM heights.
   * Only runs when variable heights mode is enabled.
   */
  measureRenderedRowHeights(start: number, end: number): void {
    if (!this.#measureRenderedRowHeights(start, end)) return;
    const s = this.state;
    if (s.totalHeightEl) {
      const newTotalHeight = this.calculateTotalSpacerHeight(this.#grid._rows.length);
      s.totalHeightEl.style.height = `${newTotalHeight}px`;
    }
  }

  #measureRenderedRowHeights(start: number, end: number): boolean {
    const s = this.state;
    if (!s.variableHeights) return false;
    if (!s.positionCache) return false;

    const grid = this.#grid;
    const bodyEl = grid._bodyEl;
    if (!bodyEl) return false;

    const rowElements = bodyEl.querySelectorAll(':scope > .data-grid-row');
    const getRowId = grid.effectiveConfig?.getRowId;
    const rows = grid._rows;

    const result = measureRenderedRowHeights(
      {
        positionCache: s.positionCache,
        heightCache: s.heightCache,
        rows,
        defaultHeight: s.rowHeight,
        start,
        end,
        rowIndices: getRowWindow(grid)?.indices,
        getPluginHeight: (row, index) => this.#resolveRowHeight(row, index),
        getRowId: getRowId ? (row: T) => getRowId(row) : undefined,
      },
      rowElements,
    );

    if (result.hasChanges) {
      s.measuredCount = result.measuredCount;
      s.averageHeight = result.averageHeight;
    }
    return result.hasChanges;
  }

  // #endregion

  // #region Core Virtual Window

  #restoreHeightAnchor?: (scrollTop: number) => number | undefined;

  /** Capture before configuration can overwrite the old cache or fixed height. */
  captureHeightAnchor(nextHeight: GridConfig<T>['rowHeight']): void {
    const grid = this.#grid;
    const s = this.state;
    const config = grid.effectiveConfig;
    const container = s.container;
    if (this.#restoreHeightAnchor) return;
    const window = getRowWindow(grid);
    if (window?.viewport?.()) {
      this.#restoreHeightAnchor = window.captureHeightAnchor?.(nextHeight);
      return;
    }
    if (!config || !s.enabled || !container || !grid._rows.length || nextHeight === config.rowHeight) return;
    if (typeof nextHeight !== 'function' && !(typeof nextHeight === 'number' && nextHeight > 0)) return;
    const nativeTop = container.scrollTop;
    const top = toVirtualScrollTop(nativeTop, s.scrollMapping);
    // Fractional capped mapping can round an exact row boundary just below itself.
    const boundary = top + Math.abs(top) * Number.EPSILON;
    const index =
      s.variableHeights && s.positionCache
        ? getRowIndexAtOffset(s.positionCache, boundary)
        : Math.floor(boundary / s.rowHeight);
    if (index < 0 || index >= grid._rows.length) return;
    const position = s.variableHeights ? s.positionCache?.[index] : undefined;
    if (s.variableHeights && !position) return;
    const key = getRowCacheKey(grid._rows[index], config.getRowId);
    const inside = Math.max(0, top - (position?.offset ?? index * s.rowHeight));
    const source = grid.sourceRows;

    // One configuration transaction, not scroll state: consume after rebuilding
    // authoritative positions and resizing the spacer, before choosing the window.
    this.#restoreHeightAnchor = (currentTop) => {
      this.cancelHeightAnchor();
      const effective = grid.effectiveConfig;
      if (
        !effective ||
        container !== s.container ||
        currentTop !== nativeTop ||
        source !== grid.sourceRows ||
        config.getRowId !== effective.getRowId ||
        config.rowHeight === effective.rowHeight ||
        effective.rowHeight === undefined
      )
        return undefined;
      const currentIndex = grid._rows.findIndex((row) => getRowCacheKey(row, effective.getRowId) === key);
      if (currentIndex < 0) return undefined;
      const position = s.variableHeights ? s.positionCache?.[currentIndex] : undefined;
      const offset = position?.offset ?? currentIndex * s.rowHeight;
      const height = position?.height ?? s.rowHeight;
      const target = offset + Math.min(inside, Math.max(0, height - 1));
      const max = Math.max(0, s.scrollMapping.rawContentHeight - s.scrollMapping.viewportHeight);
      const restored = fromVirtualScrollTop(Math.max(0, Math.min(target, max)), s.scrollMapping);
      container.scrollTop = restored;
      return restored;
    };
  }

  /** Explicit navigation and teardown take precedence over a pending height change. */
  cancelHeightAnchor(): void {
    this.#restoreHeightAnchor = undefined;
    getRowWindow(this.#grid)?.cancelHeightAnchor?.();
  }

  /**
   * Render every row without a virtual window (virtualization disabled).
   */
  #renderUnvirtualized(totalRows: number, skipAfterRender: boolean): boolean {
    const grid = this.#grid;
    grid._renderVisibleRows(0, totalRows);
    if (!skipAfterRender) grid._afterPluginRender();
    return true;
  }

  /**
   * Small-dataset bypass — render every row but keep the spacer, position cache
   * and ARIA counts in sync so a later growth past the threshold is seamless.
   */
  #renderBypassWindow(bodyEl: HTMLElement, totalRows: number, force: boolean, skipAfterRender: boolean): boolean {
    const s = this.state;
    const grid = this.#grid;
    // Bypass renders every row, so the window only ever changes on a force
    // refresh or a row-count change — claiming a change on every scroll frame
    // made callers re-run plugin onScrollRender() for nothing.
    const windowChanged = force || s.start !== 0 || s.end !== totalRows;
    s.start = 0;
    s.end = totalRows;
    grid._renderVisibleRows(0, totalRows, grid.__rowRenderEpoch);
    if (force) {
      if (s.variableHeights) {
        this.initializePositionCache();
        this.#measureRenderedRowHeights(0, totalRows);
      }
      // Both layout reads happen before either write, so the whole force path
      // costs a single reflow.
      let offset = s.container?.scrollTop ?? 0;
      const restoreAnchor = this.#restoreHeightAnchor;
      const rawScrollTop = offset;
      if (s.totalHeightEl) {
        const spacerHeight = this.calculateTotalSpacerHeight(totalRows, true);
        s.totalHeightEl.style.height = `${spacerHeight}px`;
        // The browser clamps scrollTop to the resized spacer, but not until the
        // next layout — mirror that here rather than paying a second read.
        const maxScroll = spacerHeight - s.cachedFauxHeight;
        if (offset > maxScroll) offset = maxScroll > 0 ? maxScroll : 0;
      }
      offset = restoreAnchor?.(rawScrollTop) ?? offset;
      // Re-apply the live scroll offset. Hard-coding translateY(0) desynced the
      // rows from the faux scrollbar, which keeps its scrollTop across a force
      // refresh — the tail rows became unreachable. Raw (un-mapped) scrollTop is
      // correct here and matches grid.ts's bypass scroll listener: a dataset small
      // enough to bypass is always far below MAX_ELEMENT_HEIGHT_PX, so the scroll
      // mapping is identity.
      bodyEl.style.transform = `translateY(${-offset}px)`;
    }
    grid._updateAriaCounts(totalRows, grid._visibleColumns.length);
    if (!skipAfterRender) grid._afterPluginRender();
    return windowChanged;
  }

  /**
   * Resolve the first row index of the visible window, applying zebra-stripe
   * parity, defensive clamping and any plugin-requested backwards extension.
   */
  #computeWindowStart(scrollTop: number, totalRows: number): number {
    const s = this.state;
    const positionCache = s.positionCache;

    let start: number;
    // Variable row heights: use binary search on position cache
    if (s.variableHeights && positionCache && positionCache.length > 0) {
      start = getRowIndexAtOffset(positionCache, scrollTop);
      if (start === -1) start = 0;
    } else {
      start = Math.floor(scrollTop / s.rowHeight);
    }

    // Round down to even number for zebra stripe parity
    start = start - (start % 2);
    if (start < 0) start = 0;
    // Defensive upper-clamp: with a capped scrollMapping the spacer's actual
    // scrollable extent can slightly exceed `spacerHeight - viewportHeight`
    // (e.g. horizontal-scrollbar padding, sub-pixel rounding), so a maxed-out
    // raw scrollTop could otherwise translate to a `start` past the end of the
    // dataset. Cap to the last possible row so `end` clamping (further below)
    // doesn't leave the renderer with `start > end`.
    if (totalRows > 0 && start > totalRows - 1) start = totalRows - 1;

    // Allow plugins to extend the start index backwards
    const pluginAdjustedStart = this.#grid._adjustPluginVirtualStart(start, scrollTop, s.rowHeight);
    if (pluginAdjustedStart !== undefined && pluginAdjustedStart < start) {
      start = pluginAdjustedStart - (pluginAdjustedStart % 2);
      if (start < 0) start = 0;
    }
    return start;
  }

  /**
   * Resolve the exclusive end index of the visible window (viewport + 3 rows overscan).
   */
  #computeWindowEnd(start: number, viewportHeight: number, totalRows: number): number {
    const s = this.state;
    const rowHeight = s.rowHeight;
    const positionCache = s.positionCache;

    let end: number;
    if (s.variableHeights && positionCache && positionCache.length > 0) {
      const targetHeight = viewportHeight + rowHeight * 3; // 3 rows overscan
      let accumulatedHeight = 0;
      end = start;

      while (end < totalRows && accumulatedHeight < targetHeight) {
        accumulatedHeight += positionCache[end].height;
        end++;
      }

      const minRows = Math.ceil(viewportHeight / rowHeight) + 3;
      if (end - start < minRows) {
        end = Math.min(start + minRows, totalRows);
      }
    } else {
      end = start + Math.ceil(viewportHeight / rowHeight) + 3;
    }

    return end > totalRows ? totalRows : end;
  }

  /**
   * Recalculate the spacer height in a microtask so DOM changes made by plugin
   * `afterRender` hooks (expanded detail rows, cards) are reflected.
   */
  #scheduleSpacerRecalc(totalRows: number): void {
    const s = this.state;
    queueMicrotask(() => {
      if (!s.totalHeightEl) return;
      const newTotalHeight = this.calculateTotalSpacerHeight(totalRows);
      if (s.cachedFauxHeight === 0 && s.cachedViewportHeight > 0) return;
      s.totalHeightEl.style.height = `${newTotalHeight}px`;
    });
  }

  /**
   * Re-read viewport geometry on the next frame and re-run virtualization if it
   * moved.
   *
   * A force refresh reads `viewportEl`/`scrollAreaEl` heights synchronously,
   * immediately after the scheduler re-rendered the header. Framework adapters
   * commit header renderers asynchronously (React portals, Angular embedded
   * views), so at that instant the header can be momentarily collapsed to its
   * CSS minimum — the spacer then gets `scrollAreaHeight - viewportHeight`
   * short and the tail rows become unreachable. The viewport ResizeObserver
   * cannot recover from this: the collapse and the restore happen within a
   * single frame, so the observed size never nets a change and the callback
   * never fires. A microtask (`#scheduleSpacerRecalc`) is also too early — it
   * still runs before the adapter's commit.
   */
  #scheduleGeometryVerification(): void {
    const s = this.state;
    if (this.#geometryVerifyHandle) return;
    this.#geometryVerifyHandle = requestAnimationFrame(() => {
      this.#geometryVerifyHandle = 0;
      const grid = this.#grid;
      // Teardown ends the burst: a reconnect must start from a full budget.
      if (!grid._schedulerIsConnected || !s.totalHeightEl) {
        this.#geometryVerifyPasses = 0;
        return;
      }

      const { fauxHeight, viewportHeight, scrollAreaHeight } = this.#readGeometry();
      if (
        viewportHeight === s.cachedViewportHeight &&
        scrollAreaHeight === s.cachedScrollAreaHeight &&
        fauxHeight === s.cachedFauxHeight
      ) {
        this.#geometryVerifyPasses = 0;
        return;
      }
      // Give up on an oscillating layout. Not re-requesting is what breaks the loop, so the
      // budget resets here — otherwise a later unrelated burst would skip a real correction.
      if (this.#geometryVerifyPasses >= MAX_GEOMETRY_VERIFY_PASSES) {
        this.#geometryVerifyPasses = 0;
        return;
      }
      this.#geometryVerifyPasses++;
      grid._requestSchedulerPhase(RenderPhase.VIRTUALIZATION, 'geometry-drift');
    });
  }

  /**
   * Core virtualization routine. Chooses between bypass (small datasets), grouped window rendering,
   * or standard row window rendering.
   * @param force - Whether to force a full refresh (not just scroll update)
   * @param skipAfterRender - When true, skip calling afterRender (used by scheduler which calls it separately)
   * @returns Whether the visible row window changed (start/end differ from previous)
   */
  refreshVirtualWindow(force = false, skipAfterRender = false): boolean {
    const s = this.state;
    const grid = this.#grid;
    const bodyEl = grid._bodyEl;
    if (!bodyEl) return false;
    // A property microtask or reentrant data-change can publish rows before the ROWS frame.
    force ||= this.#positionsStale();
    if (force) this.configureVariableHeights();

    const totalRows = grid._rows.length;
    const window = getRowWindow(grid);
    let external = window?.viewport?.();

    if (!s.enabled && !external) return this.#renderUnvirtualized(totalRows, skipAfterRender);
    if (force) this.#scheduleGeometryVerification();
    if (!external && totalRows <= s.bypassThreshold)
      return this.#renderBypassWindow(bodyEl, totalRows, force, skipAfterRender);

    // --- Normal virtualization path with faux scrollbar pattern ---
    const fauxScrollbar = s.container!;
    const viewportEl = s.viewportEl ?? fauxScrollbar;
    // External windows use a clipped visible band, but the faux spacer still
    // needs a current physical viewport height alongside scroll-area geometry.
    if (force && external) s.cachedViewportHeight = viewportEl.clientHeight;

    const viewportHeight =
      external?.height ??
      (force
        ? (s.cachedViewportHeight = viewportEl.clientHeight)
        : s.cachedViewportHeight || (s.cachedViewportHeight = viewportEl.clientHeight));
    const rawScrollTop = external?.container.scrollTop ?? fauxScrollbar.scrollTop;
    // Translate native scrollTop (clamped spacer space) into virtual row-content
    // space. Identity for datasets within MAX_ELEMENT_HEIGHT_PX. See computeScrollMapping.
    let scrollTop = external?.scrollTop ?? toVirtualScrollTop(rawScrollTop, s.scrollMapping);

    // On force refresh with variable heights, rebuild the position cache
    // to pick up any height changes from plugins (e.g., ResponsivePlugin
    // measuring actual card heights from DOM after first render).
    if (force && s.variableHeights) {
      this.initializePositionCache();
    }

    const restoreAnchor = force ? this.#restoreHeightAnchor : undefined;
    // Defer plugin window adjustment until the pending anchor has its final geometry.
    let start = restoreAnchor ? 0 : this.#computeWindowStart(scrollTop, totalRows);
    let end = restoreAnchor ? 0 : this.#computeWindowEnd(start, viewportHeight, totalRows);

    // Early-exit: visible window unchanged and not force
    const retainedChanged = !restoreAnchor && window?.select(start, end);
    if (!force && start === s.start && end === s.end && !retainedChanged) return false;

    // Read faux scrollbar height (cached on scroll path, fresh on force)
    const fauxScrollHeight = force
      ? (s.cachedFauxHeight = fauxScrollbar.clientHeight)
      : s.cachedFauxHeight || (s.cachedFauxHeight = fauxScrollbar.clientHeight);

    if (force && s.scrollAreaEl) {
      s.cachedScrollAreaHeight = s.scrollAreaEl.clientHeight;
    }

    // Guard: stale DOM references
    if (!external && fauxScrollHeight === 0 && viewportHeight > 0) {
      grid._requestSchedulerPhase(RenderPhase.VIRTUALIZATION, 'stale-refs-retry');
      return false;
    }

    // Recalculate spacer height on force refresh
    if (force && s.totalHeightEl) {
      s.totalHeightEl.style.height = `${this.calculateTotalSpacerHeight(totalRows)}px`;
    }
    if (restoreAnchor) {
      this.#restoreHeightAnchor = undefined;
      const restored = restoreAnchor(rawScrollTop) ?? rawScrollTop;
      external = window?.viewport?.();
      scrollTop = external?.scrollTop ?? toVirtualScrollTop(restored, s.scrollMapping);
      start = this.#computeWindowStart(scrollTop, totalRows);
      end = this.#computeWindowEnd(start, viewportHeight, totalRows);
    }
    s.start = start;
    s.end = end;

    // Calculate sub-pixel transform offset
    const positionCache = s.positionCache;
    const startRowOffset =
      s.variableHeights && positionCache && positionCache[start] ? positionCache[start].offset : start * s.rowHeight;
    bodyEl.style.transform = `translateY(${external ? startRowOffset : startRowOffset - scrollTop}px)`;

    grid._renderVisibleRows(start, end, grid.__rowRenderEpoch);

    // Measure rendered row heights on force refresh
    if (force && s.variableHeights) {
      this.measureRenderedRowHeights(start, end);
    }

    grid._updateAriaCounts(totalRows, grid._visibleColumns.length);

    // Run plugin afterRender hooks on force refresh
    if (force && !skipAfterRender) {
      grid._afterPluginRender();
      this.#scheduleSpacerRecalc(totalRows);
    }

    return true;
  }

  // #endregion

  // #region Row Height Measurement

  /** Set when a plugin drives variable heights but the user gave no `rowHeight` function. */
  #needsRowHeightMeasurement = false;

  /** Last positive numeric `gridConfig.rowHeight` seen, so merges can detect a mode change. */
  #configuredRowHeight: number | null = null;

  /**
   * Last value the `--tbw-row-height` CSS variable resolved to.
   * Used by `measureRowHeight` to distinguish a real theme switch (resolved value changed)
   * from natural drift between CSS-resolved height and `state.rowHeight` after content growth
   * pushed the latter above the former. 0 means "never resolved" — first resolution seeds it.
   */
  #lastResolvedCssRowHeight = 0;

  #rowHeightObserver?: ResizeObserver;
  #rowHeightObserverSetup = false;

  #hasRowHeightPlugin(): boolean {
    return this.#grid._pluginManager?.hasRowHeightPlugin?.() ?? false;
  }

  /**
   * Configure variable row heights based on plugins and user config.
   *
   * Handles three scenarios:
   * 1. Variable heights needed (rowHeight function or plugin with getRowHeight) → enable + init cache
   * 2. Fixed numeric rowHeight → set directly
   * 3. No config → measure from DOM after first paint
   */
  configureVariableHeights(): void {
    const s = this.state;
    const userRowHeight = this.#grid.effectiveConfig?.rowHeight;
    const hasRowHeightPlugin = this.#hasRowHeightPlugin();
    const fixedHeight = typeof userRowHeight === 'number' && userRowHeight > 0 ? userRowHeight : null;

    if (typeof userRowHeight === 'function' || hasRowHeightPlugin || getRowFlow(this.#grid)) {
      // Re-run on every merge, not just the first: `rowHeight` can gain, change or lose its
      // numeric form long after a plugin turned variable heights on.
      if (!s.variableHeights || fixedHeight !== this.#configuredRowHeight) {
        s.variableHeights = true;
        s.rowHeight = fixedHeight ?? (s.rowHeight || 28);
        this.initializePositionCache();
        // A numeric `rowHeight` is a contract, not a hint — never measure over it.
        this.#needsRowHeightMeasurement = typeof userRowHeight !== 'function' && fixedHeight === null;
      }
    } else if (!hasRowHeightPlugin && typeof userRowHeight !== 'function' && s.variableHeights) {
      // Plugin was removed — revert to fixed heights
      s.variableHeights = false;
      s.positionCache = null;
      this.#needsRowHeightMeasurement = false;
    } else if (fixedHeight !== null) {
      s.rowHeight = fixedHeight;
      s.variableHeights = false;
    } else {
      // No config — measure from DOM after first paint.
      // The ResizeObserver below handles subsequent dynamic changes.
      requestAnimationFrame(() => this.#measureRowHeight());
    }

    this.#configuredRowHeight = fixedHeight;
  }

  /**
   * Measure actual row height from DOM.
   *
   * Called from `requestAnimationFrame` after first paint (when no explicit rowHeight was
   * configured) and from a ResizeObserver on the first row (which catches dynamic CSS loading,
   * lazy images, font loading, etc.).
   */
  #measureRowHeight(): void {
    const grid = this.#grid;
    const s = this.state;

    // Skip if a plugin is managing variable row heights (e.g., ResponsivePlugin
    // with groups). The plugin handles height via getRowHeight() and we must
    // not override the base row height — that would cause oscillation loops.
    if (this.#hasRowHeightPlugin()) return;

    // Skip if the user provided an explicit numeric `gridConfig.rowHeight`.
    // The user has expressed intent ("rows are this tall") and the grid must
    // honor it absolutely — overriding via DOM measurement turns the user's
    // value into a no-op hint and creates the following nasty failure mode:
    // when content rows render at one height and placeholder/loading rows at
    // another (e.g. server-side plugin while a block is in flight), the
    // ResizeObserver alternates between the two heights, the measure logic
    // ratchets `state.rowHeight` to whichever is observed first, and the
    // virtualization window mis-fits the viewport — visible as either flicker
    // during scroll or a permanent gap before the pinned footer where the
    // bottom of the body should be filled.
    //
    // Users who want measurement-driven sizing should either omit `rowHeight`
    // (default branch below) or pass a function — both opt into the dynamic
    // path. A numeric value is a contract; respect it.
    const userRowHeight = grid.effectiveConfig?.rowHeight;
    if (typeof userRowHeight === 'number' && userRowHeight > 0) return;

    const bodyEl = grid._bodyEl;
    if (!bodyEl?.querySelector('.data-grid-row')) return;

    // Resolve the --tbw-row-height CSS variable to detect theme changes.
    // When a theme is swapped, the computed value changes (e.g., 52px → 28px).
    // Compared against the previously-resolved CSS value (NOT against the
    // current `state.rowHeight`) so that natural drift between CSS-resolved
    // height and a content-grown rowHeight doesn't masquerade as a theme
    // switch on every observation.
    const cssRowHeight = this.#resolveCssRowHeight();

    // Sample every currently-rendered body row and take the MEDIAN height.
    //
    // The old "trust the first row" approach made `state.rowHeight` hostage to
    // whatever the first row happened to look like at the moment the
    // ResizeObserver fired. That broke as soon as a single row deviated:
    //   - Editing the first row inflates it (framework form-field chrome)
    //     for as long as the editor is open. Single-row measurement ratchets
    //     `rowHeight` up to the inflated value, shrinks the virtual window
    //     to half its rows, and never recovers because the ratchet doesn't
    //     shrink.
    //   - A custom renderer in row[0] (taller chip, wrapping text, image)
    //     similarly poisons the global height for every other row.
    //
    // Median is robust to ~half of samples being outliers and degrades
    // gracefully when only one row is rendered (returns that row).
    //
    // Rows with an explicit per-row `--tbw-row-height` override are excluded
    // from the sample — they're intentional one-off heights (e.g. expanded
    // master-detail rows) and would skew the global default.
    const sampledHeights: number[] = [];
    for (const row of bodyEl.querySelectorAll<HTMLElement>('.data-grid-row')) {
      if (row.style.getPropertyValue('--tbw-row-height')) continue;
      let maxCellHeight = 0;
      row.querySelectorAll('.cell').forEach((cell) => {
        const h = (cell as HTMLElement).offsetHeight;
        if (h > maxCellHeight) maxCellHeight = h;
      });
      const h = Math.max(row.getBoundingClientRect().height, maxCellHeight);
      if (h > 0) sampledHeights.push(h);
    }
    if (sampledHeights.length === 0) return;
    sampledHeights.sort((a, b) => a - b);
    const mid = sampledHeights.length >> 1;
    const measuredHeight =
      sampledHeights.length % 2 === 1 ? sampledHeights[mid] : (sampledHeights[mid - 1] + sampledHeights[mid]) / 2;

    const currentHeight = s.rowHeight;
    const lastCss = this.#lastResolvedCssRowHeight;
    const cssChanged = cssRowHeight > 0 && lastCss > 0 && Math.abs(cssRowHeight - lastCss) > 1;
    const cssFirstResolved = cssRowHeight > 0 && lastCss === 0;
    const contentGrew = measuredHeight > 0 && measuredHeight - currentHeight > 1;

    if (cssRowHeight > 0) {
      this.#lastResolvedCssRowHeight = cssRowHeight;
    }

    if (cssChanged || cssFirstResolved || contentGrew) {
      // For real CSS changes (theme switch) and first resolution, take the
      // larger of CSS and measured so rows are never undersized. For content
      // growth (only direction we ratchet automatically), use the measurement.
      const next = cssChanged || cssFirstResolved ? Math.max(cssRowHeight, measuredHeight) : measuredHeight;
      if (Math.abs(next - currentHeight) > 1) {
        s.rowHeight = next;
        grid._requestSchedulerPhase(RenderPhase.VIRTUALIZATION, 'measureRowHeight');
      }
    }
  }

  /**
   * Resolve the --tbw-row-height CSS variable to a pixel value.
   * Reads from an existing row cell (which uses min-height: var(--tbw-row-height))
   * to avoid creating/removing temporary DOM elements.
   * Returns 0 if no row is available or the variable is unset.
   */
  #resolveCssRowHeight(): number {
    const host = this.#grid._hostElement;
    if (!host) return 0;
    const raw = getComputedStyle(host).getPropertyValue('--tbw-row-height').trim();
    if (!raw) return 0;
    // Pure pixel value — fast path, no DOM measurement needed
    if (raw.endsWith('px')) return parseFloat(raw) || 0;
    // Relative units (em, rem, etc.) — resolve from an existing cell's computed min-height.
    // Cells bind to --tbw-row-height via CSS, so their resolved min-height gives the pixel value.
    const cell = this.#grid._bodyEl?.querySelector(
      '.data-grid-row:not([style*="--tbw-row-height"]) > .cell',
    ) as HTMLElement | null;
    if (!cell) return 0;
    const minHeight = parseFloat(getComputedStyle(cell).minHeight);
    return minHeight > 0 ? minHeight : 0;
  }

  /**
   * Post-render hook for row-height bookkeeping. Installs the first-row observer once the rows
   * exist in the DOM, then performs the one-shot base-height measurement that
   * `configureVariableHeights` defers when a plugin drives heights but no `rowHeight` function
   * was supplied.
   *
   * The measurement latch is only spent once rows are actually renderable. Nothing re-arms it —
   * `configureVariableHeights` sets it inside `if (!s.variableHeights)`, and the ResizeObserver
   * path bails on `#hasRowHeightPlugin()` — so burning it on an empty body (async data lands on a
   * later render) would leave `state.rowHeight` at its 28px default forever.
   */
  afterRenderRowHeights(): void {
    if (this.state.enabled) this.#setupRowHeightObserver();
    if (!this.#needsRowHeightMeasurement) return;
    if (!this.#grid._bodyEl?.querySelector('.data-grid-row')) return;
    this.#needsRowHeightMeasurement = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // No usable height two frames later (rows gone again, or a zero-height/hidden layout) —
        // re-arm rather than lose the one-shot.
        if (!this.#measureRowHeightForPlugins()) this.#needsRowHeightMeasurement = true;
      });
    });
  }

  /**
   * Like `#measureRowHeight`, but rebuilds the position cache afterwards — the cache may have been
   * built with the wrong estimated height even if `rowHeight` was later corrected.
   *
   * @returns Whether a usable height was measured — `false` when no row is rendered or the
   * rendered row measures 0px.
   */
  #measureRowHeightForPlugins(): boolean {
    // Same contract as `#measureRowHeight`: a numeric `rowHeight` is never measured over.
    if (this.#configuredRowHeight !== null) return true;

    const firstRow = this.#grid._bodyEl?.querySelector('.data-grid-row');
    if (!firstRow) return false;

    // Find the tallest cell in the row (custom renderers may push some cells taller)
    let maxCellHeight = 0;
    firstRow.querySelectorAll('.cell').forEach((cell) => {
      const h = (cell as HTMLElement).offsetHeight;
      if (h > maxCellHeight) maxCellHeight = h;
    });

    const measuredHeight = Math.max((firstRow as HTMLElement).getBoundingClientRect().height, maxCellHeight);
    if (measuredHeight <= 0) return false;

    const s = this.state;
    if (Math.abs(measuredHeight - s.rowHeight) > 1) {
      s.rowHeight = measuredHeight;
      this.#grid._requestSchedulerPhase(RenderPhase.VIRTUALIZATION, 'measurePluginRowHeight');
    }
    this.initializePositionCache();
    if (s.totalHeightEl) {
      s.totalHeightEl.style.height = `${this.calculateTotalSpacerHeight(this.#grid._rows.length)}px`;
    }
    return true;
  }

  /**
   * Observe the first row for height changes (dynamic CSS, lazy images, font loading,
   * column virtualization). Self-guarding: only installs once per connected lifecycle.
   */
  #setupRowHeightObserver(): void {
    if (this.#rowHeightObserverSetup) return;

    const firstRow = this.#grid._bodyEl?.querySelector('.data-grid-row') as HTMLElement | null;
    if (!firstRow) return;

    this.#rowHeightObserverSetup = true;
    this.#rowHeightObserver?.disconnect();

    // Observe the row element itself, not individual cells — that catches every height change
    // at once. ResizeObserver fires on initial observation, so no separate measure call.
    this.#rowHeightObserver = new ResizeObserver(() => this.#measureRowHeight());
    this.#rowHeightObserver.observe(firstRow);
  }

  /** Tear down row-height observation and measurement state on disconnect. */
  disposeRowHeightObserver(): void {
    this.cancelHeightAnchor();
    if (!this.#rowHeightObserver) return;
    this.#rowHeightObserver.disconnect();
    this.#rowHeightObserver = undefined;
    this.#rowHeightObserverSetup = false;
    this.#lastResolvedCssRowHeight = 0;
  }

  // #endregion
}

// #endregion
