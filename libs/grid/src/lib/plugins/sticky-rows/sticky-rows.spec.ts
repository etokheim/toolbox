import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridElement } from '../../core/plugin/base-plugin';
import type { ScrollEvent } from '../../core/plugin/types';
import type { ColumnConfig } from '../../core/types';
import { StickyRowsPlugin } from './sticky-rows-plugin';

/**
 * Unit tests for StickyRowsPlugin.
 *
 * Validates predicate evaluation, displayed-index computation across
 * `'push'` and `'stack'` modes, container DOM placement, clone reuse, and
 * push-mode displacement math.
 */

interface MockGridOpts {
  rows?: unknown[];
  columns?: ColumnConfig[];
  /** Pre-rendered row indices to seed `.rows .data-grid-row` elements for. */
  renderedIndices?: number[];
  rowHeight?: number;
}

function createMockGrid(opts: MockGridOpts = {}): HTMLElement & GridElement {
  const grid: HTMLElement = document.createElement('div');

  const root = document.createElement('div');
  root.className = 'tbw-grid-root';
  const scrollArea = document.createElement('div');
  scrollArea.className = 'tbw-scroll-area';
  const rowsBodyWrapper = document.createElement('div');
  rowsBodyWrapper.className = 'rows-body-wrapper';
  const rowsBody = document.createElement('div');
  rowsBody.className = 'rows-body';
  const header = document.createElement('div');
  header.className = 'header';
  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'rows-container';
  const rowsViewport = document.createElement('div');
  rowsViewport.className = 'rows-viewport';
  const rowsEl = document.createElement('div');
  rowsEl.className = 'rows';

  rowsViewport.appendChild(rowsEl);
  rowsContainer.appendChild(rowsViewport);
  rowsBody.appendChild(header);
  rowsBody.appendChild(rowsContainer);
  rowsBodyWrapper.appendChild(rowsBody);
  scrollArea.appendChild(rowsBodyWrapper);
  root.appendChild(scrollArea);
  grid.appendChild(root);

  // Seed pool rows for the requested indices so `findRenderedRow` can locate
  // them. Each row needs a single cell whose `data-row` matches.
  const rendered = opts.renderedIndices ?? [];
  const pool: HTMLElement[] = [];
  const cols = opts.columns ?? [];
  for (const idx of rendered) {
    const rowEl = document.createElement('div');
    rowEl.className = 'data-grid-row';
    Object.assign(rowEl, { __rowDataRef: opts.rows?.[idx] });
    pool[idx] = rowEl;
    rowEl.setAttribute('role', 'row');
    rowEl.dataset['testRow'] = String(idx);
    for (let c = 0; c < Math.max(1, cols.length); c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('data-row', String(idx));
      cell.setAttribute('data-col', String(c));
      const field = cols[c]?.field;
      if (field) cell.setAttribute('data-field', field);
      cell.textContent = `R${idx}C${c}`;
      rowEl.appendChild(cell);
    }
    rowsEl.appendChild(rowEl);
  }

  Object.defineProperty(grid, 'rows', { get: () => opts.rows ?? [], configurable: true });
  Object.defineProperty(grid, 'sourceRows', { get: () => opts.rows ?? [], configurable: true });
  Object.defineProperty(grid, 'columns', { get: () => opts.columns ?? [], configurable: true });
  Object.defineProperty(grid, '_visibleColumns', {
    get: () => opts.columns ?? [],
    configurable: true,
  });
  Object.defineProperty(grid, '_virtualization', {
    value: { start: 0, end: Math.max(-1, ...rendered) + 1, rowHeight: opts.rowHeight ?? 28, positionCache: null },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(grid, '_hostElement', { get: () => grid, configurable: true });
  Object.defineProperty(grid, '_bodyEl', { value: rowsEl, configurable: true });
  Object.defineProperty(grid, '_rowPool', { value: pool, configurable: true });
  Object.defineProperty(grid, 'getPluginState', { value: () => null, configurable: true });

  document.body.appendChild(grid);
  return grid as HTMLElement & GridElement;
}

function scrollEvent(scrollTop: number): ScrollEvent {
  return { scrollTop, scrollLeft: 0, scrollHeight: 0, scrollWidth: 0, clientHeight: 0, clientWidth: 0 };
}

async function settleSnapshots() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('StickyRowsPlugin', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  // #region constructor / defaults

  describe('defaults', () => {
    it('exposes correct plugin name', () => {
      const plugin = new StickyRowsPlugin({ isSticky: () => false });
      expect(plugin.name).toBe('stickyRows');
    });

    it('defaults to push mode with unbounded stacking', () => {
      const plugin = new StickyRowsPlugin({ isSticky: () => false });
      const grid = createMockGrid();
      plugin.attach(grid);
      expect(plugin.resolvedConfig.mode).toBe('push');
      expect(plugin.resolvedConfig.maxStacked).toBe(Infinity);
    });
  });

  // #endregion

  // #region predicate forms

  describe('isSticky resolution', () => {
    const rows = [{ flag: false }, { flag: true }, { flag: false }, { flag: true }, { flag: false }];

    it('accepts a field-name shorthand', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag' });
      const grid = createMockGrid({ rows, renderedIndices: [0, 1, 2, 3, 4] });
      plugin.attach(grid);
      plugin.afterRender();
      // Scrolling past row 1 should stick row 1 (push mode default).
      plugin.onScroll(scrollEvent(28 + 1));
      const sticky = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(sticky.length).toBe(1);
      expect((sticky[0] as HTMLElement).dataset['stickyRow']).toBe('1');
    });

    it('accepts a predicate function', () => {
      const plugin = new StickyRowsPlugin({
        isSticky: (row, idx) => idx % 2 === 1,
      });
      const grid = createMockGrid({ rows, renderedIndices: [0, 1, 2, 3, 4] });
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(100));
      const stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(stuck.length).toBe(1);
      // 100px / 28px ≈ index 3, so row 3 is the highest qualifying.
      expect((stuck[0] as HTMLElement).dataset['stickyRow']).toBe('3');
    });

    it('renders nothing when no row qualifies', () => {
      const plugin = new StickyRowsPlugin({ isSticky: () => false });
      const grid = createMockGrid({ rows, renderedIndices: [0, 1, 2] });
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(500));
      expect(grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row').length).toBe(0);
    });
  });

  // #endregion

  // #region container DOM placement

  describe('container placement', () => {
    it('inserts .tbw-sticky-rows as the first child of .rows-viewport so it overlays the row pool', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag' });
      const grid = createMockGrid({ rows: [{ flag: true }], renderedIndices: [0] });
      plugin.attach(grid);
      plugin.afterRender();

      const rowsViewport = grid.querySelector('.rows-viewport')!;
      const sticky = rowsViewport.querySelector('.tbw-sticky-rows');
      expect(sticky).not.toBeNull();
      // Must be the first child so the absolute-positioned overlay sits at
      // the top of the viewport above `.rows`.
      expect(rowsViewport.firstElementChild).toBe(sticky);
    });

    it('removes container on detach', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag' });
      const grid = createMockGrid({ rows: [{ flag: true }], renderedIndices: [0] });
      plugin.attach(grid);
      plugin.afterRender();
      expect(grid.querySelector('.tbw-sticky-rows')).not.toBeNull();

      plugin.detach();
      expect(grid.querySelector('.tbw-sticky-rows')).toBeNull();
    });

    it('applies a custom className to the container', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', className: 'my-clones' });
      const grid = createMockGrid({ rows: [{ flag: true }], renderedIndices: [0] });
      plugin.attach(grid);
      plugin.afterRender();
      expect(grid.querySelector('.tbw-sticky-rows.my-clones')).not.toBeNull();
    });
  });

  // #endregion

  // #region mode behavior

  describe("'push' mode", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ flag: i === 3 || i === 8 || i === 15 }));
    const rendered = Array.from({ length: 20 }, (_, i) => i);

    it('shows only the highest qualifying sticky row', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();
      // Scroll past rows 3 + 8, but not 15 → only 8 should be stuck.
      plugin.onScroll(scrollEvent(8 * 28 + 1));
      const stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(stuck.length).toBe(1);
      expect((stuck[0] as HTMLElement).dataset['stickyRow']).toBe('8');
    });

    it('swaps the stuck row when a higher-indexed sticky row passes', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();

      plugin.onScroll(scrollEvent(3 * 28 + 1));
      let stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect((stuck[0] as HTMLElement).dataset['stickyRow']).toBe('3');

      plugin.onScroll(scrollEvent(15 * 28 + 1));
      stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(stuck.length).toBe(1);
      expect((stuck[0] as HTMLElement).dataset['stickyRow']).toBe('15');
    });

    it('translates the stuck row upward when the next sticky row approaches', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();

      const rowH = 28;
      // Stick row 3, then scroll until row 8's top is 10px from the top — the
      // overlap should be (28 - 10) = 18 pixels of upward translation.
      const targetScroll = 8 * rowH - 10;
      plugin.onScroll(scrollEvent(targetScroll));

      const stuck = grid.querySelector('.tbw-sticky-rows .tbw-sticky-row') as HTMLElement | null;
      expect(stuck).not.toBeNull();
      expect((stuck as HTMLElement).dataset['stickyRow']).toBe('3');
      // Transform is applied to the container so push mode and stack-mode
      // anticipation can both slide uniformly.
      const container = grid.querySelector('.tbw-sticky-rows') as HTMLElement;
      expect(container.style.transform).toBe('translateY(-18px)');
    });

    it('clears the transform when no upward push is needed', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();

      // Push first
      plugin.onScroll(scrollEvent(8 * 28 - 10));
      // Then scroll back to a position where 3 is stuck and 8 is far below.
      plugin.onScroll(scrollEvent(3 * 28 + 1));
      const container = grid.querySelector('.tbw-sticky-rows') as HTMLElement;
      expect(container.style.transform).toBe('');
    });
  });

  describe("'stack' mode", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ flag: i === 3 || i === 8 || i === 15 }));
    const rendered = Array.from({ length: 20 }, (_, i) => i);

    it('stacks every qualifying sticky row in order', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'stack' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(15 * 28 + 1));
      const stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(Array.from(stuck).map((el) => (el as HTMLElement).dataset['stickyRow'])).toEqual(['3', '8', '15']);
    });

    it('caps the stack at maxStacked, evicting the oldest entries', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'stack', maxStacked: 2 });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(15 * 28 + 1));
      const stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(Array.from(stuck).map((el) => (el as HTMLElement).dataset['stickyRow'])).toEqual(['8', '15']);
    });

    it('synthesizes a stand-in for a sticky row that was never rendered', async () => {
      // Repro for the stuck-at-one-row bug: a config/data change wipes the
      // clone cache while the grid is scrolled deep, so only the sticky rows
      // still inside the window get re-primed. Scrolling further DOWN never
      // brings 3 and 8 back, so without a stand-in the stack under-renders
      // permanently.
      const data = Array.from({ length: 20 }, (_, i) => ({
        flag: i === 3 || i === 8 || i === 15,
        name: `row-${i}`,
      }));
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'stack' });
      const grid = createMockGrid({ rows: data, renderedIndices: [15], columns: [{ field: 'name' }] });
      plugin.attach(grid);
      plugin.afterRender();
      await settleSnapshots();
      plugin.onScroll(scrollEvent(15 * 28 + 1));

      const stuck = Array.from(grid.querySelectorAll<HTMLElement>('.tbw-sticky-rows .tbw-sticky-row'));
      expect(stuck.map((el) => el.dataset['stickyRow'])).toEqual(['3', '8', '15']);
      // The two stand-ins carry the row's own data, not the template's.
      expect(stuck[0].dataset['syntheticStickyRow']).toBe('');
      expect(stuck[0].querySelector('.cell')?.textContent).toBe('row-3');
      expect(stuck[1].querySelector('.cell')?.textContent).toBe('row-8');
      // The rendered one is a real DOM capture, not synthesized.
      expect(stuck[2].dataset['syntheticStickyRow']).toBeUndefined();
    });

    it('omits rather than synthesizes when cells hold custom-renderer DOM', () => {
      // Re-labelling a cell that contains element children would pin ANOTHER
      // row's rendered content — worse than a gap, so we keep the old
      // omit-the-row behaviour.
      const data = Array.from({ length: 20 }, (_, i) => ({
        flag: i === 3 || i === 8 || i === 15,
        name: `row-${i}`,
      }));
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'stack' });
      const grid = createMockGrid({ rows: data, renderedIndices: [15], columns: [{ field: 'name' }] });
      const cell = grid.querySelector('.rows .data-grid-row .cell') as HTMLElement;
      cell.textContent = '';
      cell.appendChild(document.createElement('span'));
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(15 * 28 + 1));

      const stuck = Array.from(grid.querySelectorAll<HTMLElement>('.tbw-sticky-rows .tbw-sticky-row'));
      expect(stuck.map((el) => el.dataset['stickyRow'])).toEqual(['15']);
    });

    it('stacks the next sticky as soon as its top reaches the bottom of the prior stuck row', () => {
      // Sticky indices 3 and 8. rowHeight 28. offset(8) = 224.
      // With idx=3 already stuck (height 28), idx=8 should latch when its
      // top reaches the bottom of the stack — i.e. scrollTop + 28 > 224,
      // so scrollTop > 196. NOT 224 (which would be after idx=8 has been
      // fully covered by idx=3).
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'stack' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();
      // scrollTop = 197 → idx=3 stuck (offset 84 < 197), idx=8 should also
      // qualify because offset(8)=224 < 197 + 28 = 225.
      plugin.onScroll(scrollEvent(197));
      let stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(Array.from(stuck).map((el) => (el as HTMLElement).dataset['stickyRow'])).toEqual(['3', '8']);
      // scrollTop = 195 → idx=8 should NOT yet qualify (224 < 223 is false).
      plugin.onScroll(scrollEvent(195));
      stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(Array.from(stuck).map((el) => (el as HTMLElement).dataset['stickyRow'])).toEqual(['3']);
    });

    it('animates the swap when at maxStacked: slides the stack up as the live next sticky approaches', () => {
      // Sticky indices 3, 8, 15. rowHeight 28. maxStacked=2 → settles to
      // [8, 15] once idx=15 has fully crossed the slot of idx=3. During
      // anticipation we keep showing [3, 8] but translate the container
      // upward as live idx=15 scrolls into the stack region — the live
      // row scrolls naturally beneath the stack (no clone added, no
      // duplicate row visible).
      //
      // sumStuckHeight for [3, 8] = 56. offsetOf(15) = 420.
      // Anticipation activates when distance < 0 — i.e. live idx=15's top
      // has reached the bottom of the stack: scrollTop + 56 > 420, so
      // scrollTop > 364. Push offset = scrollTop - 364, capped at
      // heightOf(3) = 28. Swap (evict-and-promote) at scrollTop > 392.
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'stack', maxStacked: 2 });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();

      // scrollTop=336 → distance=28, no anticipation, [3, 8] no transform.
      plugin.onScroll(scrollEvent(336));
      let container = grid.querySelector('.tbw-sticky-rows') as HTMLElement;
      expect(
        Array.from(container.querySelectorAll('.tbw-sticky-row')).map((el) => (el as HTMLElement).dataset['stickyRow']),
      ).toEqual(['3', '8']);
      expect(container.style.transform).toBe('');

      // scrollTop=378 → distance=-14, push 14. Still [3, 8] (no clone for
      // 15 yet — live row scrolls beneath the stack).
      plugin.onScroll(scrollEvent(378));
      container = grid.querySelector('.tbw-sticky-rows') as HTMLElement;
      expect(
        Array.from(container.querySelectorAll('.tbw-sticky-row')).map((el) => (el as HTMLElement).dataset['stickyRow']),
      ).toEqual(['3', '8']);
      expect(container.style.transform).toBe('translateY(-14px)');

      // scrollTop=393 → idx=15 fully crosses idx=3's slot
      // (420 < 393 + 56 - 28 = 421). Evict-and-promote: [8, 15], no
      // transform. At this exact pixel the live idx=15 sits at slot-3 of
      // the new stack, so the swap is seamless.
      plugin.onScroll(scrollEvent(393));
      container = grid.querySelector('.tbw-sticky-rows') as HTMLElement;
      expect(
        Array.from(container.querySelectorAll('.tbw-sticky-row')).map((el) => (el as HTMLElement).dataset['stickyRow']),
      ).toEqual(['8', '15']);
      expect(container.style.transform).toBe('');
    });
  });

  // #endregion

  // #region clone hygiene

  describe('clones', () => {
    it('marks clones as aria-hidden and strips focus styling', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag' });
      const grid = createMockGrid({ rows: [{ flag: true }, { flag: false }], renderedIndices: [0, 1] });
      // Add focus styling to the source row to verify the clone strips it.
      const liveRow = grid.querySelector('.rows .data-grid-row') as HTMLElement;
      liveRow.classList.add('row-focus');
      liveRow.setAttribute('tabindex', '0');
      liveRow.setAttribute('data-tbw-hovered', '');
      const actionCell = liveRow.querySelector<HTMLElement>('.cell')!;
      actionCell.setAttribute('data-tbw-hovered', '');
      actionCell.setAttribute('data-tbw-cell-expanded', '');
      actionCell.style.setProperty('--tbw-pinned-cell-width', '240px');

      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(28));

      const clone = grid.querySelector('.tbw-sticky-rows .tbw-sticky-row') as HTMLElement;
      expect(clone.getAttribute('aria-hidden')).toBe('true');
      expect(clone.classList.contains('row-focus')).toBe(false);
      expect(clone.hasAttribute('tabindex')).toBe(false);
      expect(clone.hasAttribute('data-tbw-hovered')).toBe(false);
      expect(clone.querySelector('[data-tbw-hovered]')).toBeNull();
      expect(liveRow.hasAttribute('data-tbw-hovered')).toBe(true);
      expect(clone.querySelector('[data-tbw-cell-expanded]')).toBeNull();
      expect(clone.querySelector<HTMLElement>('.cell')!.style.getPropertyValue('--tbw-pinned-cell-width')).toBe('');
      expect(actionCell.hasAttribute('data-tbw-cell-expanded')).toBe(true);
    });

    it('keeps cached clones when the underlying row leaves the rendered window', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag' });
      // Initially row 0 is rendered.
      const grid = createMockGrid({
        rows: [{ flag: true }, { flag: false }, { flag: false }, { flag: false }],
        renderedIndices: [0, 1, 2, 3],
      });
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(28));
      expect(grid.querySelector('.tbw-sticky-rows .tbw-sticky-row')).not.toBeNull();

      // Simulate virtualization sliding row 0 out of the window: remove it
      // from the .rows pool. The clone should remain visible.
      const liveRow = grid.querySelector('.rows .data-grid-row[data-test-row="0"]')?.parentElement
        ? (grid.querySelector('.rows .data-grid-row[data-test-row="0"]') as HTMLElement)
        : (grid.querySelector('.rows .data-grid-row') as HTMLElement);
      liveRow.remove();

      plugin.onScroll(scrollEvent(56));
      const stuck = grid.querySelectorAll('.tbw-sticky-rows .tbw-sticky-row');
      expect(stuck.length).toBe(1);
      expect((stuck[0] as HTMLElement).dataset['stickyRow']).toBe('0');
    });
  });

  // #endregion

  // #region async framework content settle pass (regression)

  describe('async framework cell content (settle pass)', () => {
    // Framework adapters (React/Vue) flush custom cell content on a microtask
    // AFTER the synchronous scroll hook. When a sticky row is recycled back
    // into the window on scroll-up, the grid sets the cell `data-row`
    // attribute synchronously but the cell content still shows the PREVIOUS
    // row. A clone captured during `onScrollRender` then holds stale content,
    // and because clones are cached by index it stays wrong forever (symptom:
    // scroll down, up, then down again pins a different row). The fix queues a
    // deferred style pass that re-captures the clone once content settles.

    const stickyRow0 = () => Array.from({ length: 20 }, (_, i) => ({ flag: i === 0 }));
    const allRendered = Array.from({ length: 20 }, (_, i) => i);

    function gridWithSpy(renderedIndices: number[]) {
      const grid = createMockGrid({ rows: stickyRow0(), renderedIndices });
      const requestAfterRender = vi.fn();
      Object.defineProperty(grid, 'requestAfterRender', { value: requestAfterRender, configurable: true });
      return { grid, requestAfterRender };
    }

    it('schedules a deferred style pass when a sticky row is in the rendered window', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const { grid, requestAfterRender } = gridWithSpy(allRendered);
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScrollRender();
      expect(requestAfterRender).toHaveBeenCalledTimes(1);
    });

    it('does not schedule a settle pass when no sticky row is in the rendered window', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      // Render rows 5..10 only — sticky row 0 is out of the window.
      const { grid, requestAfterRender } = gridWithSpy([5, 6, 7, 8, 9, 10]);
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScrollRender();
      expect(requestAfterRender).not.toHaveBeenCalled();
    });

    it('coalesces multiple scroll ticks into a single pass, re-arming after afterRender', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const { grid, requestAfterRender } = gridWithSpy(allRendered);
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScrollRender();
      plugin.onScrollRender();
      plugin.onScrollRender();
      expect(requestAfterRender).toHaveBeenCalledTimes(1);
      // The deferred pass runs afterRender, clearing the flag → next tick re-arms.
      plugin.afterRender();
      plugin.onScrollRender();
      expect(requestAfterRender).toHaveBeenCalledTimes(2);
    });

    it('re-captures the correct clone after stale framework content settles', async () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const { grid } = gridWithSpy(allRendered);
      plugin.attach(grid);

      const liveCell = (idx: number) =>
        grid.querySelector(`.rows .data-grid-row .cell[data-row="${idx}"]`) as HTMLElement;
      const cloneText = () =>
        (grid.querySelector('.tbw-sticky-rows .tbw-sticky-row .cell[data-row="0"]') as HTMLElement | null)
          ?.textContent ?? null;

      // Settled initial content → clone primed correctly, row 0 sticks.
      liveCell(0).textContent = 'SETTLED-0';
      plugin.afterRender();
      plugin.onScroll(scrollEvent(5 * 28 + 1));
      expect(cloneText()).toBe('SETTLED-0');

      // Scroll-up recycle: data-row="0" is present but the framework hasn't
      // flushed the cell content yet → it still shows the previous row.
      // onScrollRender captures this stale snapshot (poisons the cache).
      liveCell(0).textContent = 'STALE-PREVIOUS-ROW';
      plugin.onScrollRender();

      // Framework microtask flushes; the deferred settle pass (afterRender)
      // re-captures the now-correct clone.
      liveCell(0).textContent = 'SETTLED-0';
      plugin.afterRender();
      await settleSnapshots();

      // Row 0 scrolls out of the pool again — only the cached clone remains.
      liveCell(0).parentElement?.remove();
      plugin.onScroll(scrollEvent(0));
      plugin.onScroll(scrollEvent(5 * 28 + 1));
      expect(cloneText()).toBe('SETTLED-0');
    });

    it('never paints stale content on the displayed clone during a scroll-up recycle (no flash)', () => {
      // Regression for the real-world flash: scrolling DOWN past the sticky
      // row, then UP a few px recycles row 0 back into the rendered window.
      // The grid sets its cell `data-row` synchronously but async framework
      // adapters flush the cell content a microtask LATER, so the live row
      // momentarily shows the PREVIOUS row's content. `onScrollRender` must
      // NOT re-capture the displayed clone from that stale live DOM — doing so
      // paints the wrong content for one frame (visible flash) before the
      // deferred settle pass corrects it. The displayed clone must therefore
      // keep its last-good content through `onScrollRender` and stay correct
      // after the settle pass.
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const { grid } = gridWithSpy(allRendered);
      plugin.attach(grid);

      // Mimic a live scroll position past row 0 so the displayed set stays
      // `[0]` across `onScrollRender`/`afterRender` (which read the live
      // `container.scrollTop`, not the per-tick override). Without this the
      // set would collapse to `[]` and mask the bug.
      const vstate = (grid as unknown as { _virtualization: { container: { scrollTop: number } } })._virtualization;
      vstate.container = { scrollTop: 5 * 28 + 1 };

      const liveCell = (idx: number) =>
        grid.querySelector(`.rows .data-grid-row .cell[data-row="${idx}"]`) as HTMLElement;
      const cloneText = () =>
        (grid.querySelector('.tbw-sticky-rows .tbw-sticky-row .cell[data-row="0"]') as HTMLElement | null)
          ?.textContent ?? null;

      // Settled initial content → clone primed correctly, row 0 sticks.
      liveCell(0).textContent = 'SETTLED-0';
      plugin.afterRender();
      plugin.onScroll(scrollEvent(5 * 28 + 1));
      expect(cloneText()).toBe('SETTLED-0');

      // Scroll-up recycle: live row 0 momentarily holds the previous row's
      // not-yet-flushed content. The DISPLAYED clone must NOT pick it up —
      // it keeps showing the last-good content (no flash).
      liveCell(0).textContent = 'STALE-PREVIOUS-ROW';
      plugin.onScrollRender();
      expect(cloneText()).toBe('SETTLED-0');

      // Microtask flush settles the live content; the deferred settle pass
      // re-captures it (still correct), and a settle pass was scheduled.
      liveCell(0).textContent = 'SETTLED-0';
      plugin.afterRender();
      expect(cloneText()).toBe('SETTLED-0');
    });
  });

  // #endregion

  describe('normal-render snapshot settlement', () => {
    const settle = settleSnapshots;

    function fixture() {
      const rows = [{ flag: true, name: 'original' }];
      const grid = createMockGrid({ rows, renderedIndices: [0] });
      const scroll = document.createElement('div');
      scroll.scrollTop = 10;
      Object.defineProperty(grid, '_virtualization', {
        value: { start: 0, end: 1, rowHeight: 28, container: scroll },
      });
      const request = vi.fn();
      Object.defineProperty(grid, 'requestAfterRender', { value: request });
      const plugin = new StickyRowsPlugin({ isSticky: 'flag' });
      plugin.attach(grid);
      const cell = grid.querySelector<HTMLElement>('.rows > .data-grid-row > .cell')!;
      const text = () => grid.querySelector('.tbw-sticky-row .cell')?.textContent;
      return { grid, rows, plugin, cell, request, text };
    }

    it('coalesces bounded capture after later hooks commit without scheduling STYLE', async () => {
      const { plugin, cell, request, text } = fixture();
      plugin.afterRender();
      await settle();
      const capture = vi.spyOn(cell.parentElement!, 'cloneNode');
      plugin.afterRender();
      plugin.afterRender();
      plugin.afterRender();
      expect(capture).not.toHaveBeenCalled();
      // A later plugin hook may queue its adapter commit after StickyRows.
      queueMicrotask(() => {
        cell.textContent = 'settled';
      });
      await settle();
      expect(text()).toBe('settled');
      expect(capture).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
      const count = capture.mock.calls.length;
      for (let i = 0; i < 20; i++) plugin.onScroll(scrollEvent(10));
      await settle();
      expect(capture).toHaveBeenCalledTimes(count);
      plugin.detach();
    });

    it('accepts settled empty/native content and never restores stale last-good DOM', async () => {
      const { plugin, cell, text } = fixture();
      plugin.afterRender();
      await settle();
      expect(text()).toBe('R0C0');
      plugin.afterRender();
      queueMicrotask(() => cell.replaceChildren());
      await settle();
      expect(text()).toBe('');
      const native = document.createElement('span');
      native.textContent = 'native';
      cell.append(native);
      plugin.afterRender();
      await settle();
      expect(text()).toBe('native');
      plugin.detach();
    });

    function stackFixture() {
      const rows = Array.from({ length: 4 }, (_, index) => ({ flag: index < 3 }));
      const grid = createMockGrid({ rows, renderedIndices: [0, 1, 2, 3] });
      const scroll = document.createElement('div');
      scroll.scrollTop = 1;
      grid._virtualization.container = scroll;
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'stack', maxStacked: 2 });
      plugin.attach(grid);
      const live = (index: number) => grid._rowPool[index];
      const clone = (index: number) => grid.querySelector<HTMLElement>(`[data-sticky-row="${index}"]`);
      return { grid, rows, scroll, plugin, live, clone };
    }

    it('captures stacked and non-displayed rows once and retains their current cache owners', async () => {
      const { plugin, live, clone } = stackFixture();
      plugin.afterRender();
      await settle();
      expect(clone(0)).not.toBeNull();
      expect(clone(1)).not.toBeNull();
      expect(clone(2)).toBeNull();

      const templates = vi.fn();
      const captures = [0, 1, 2].map((index) => {
        const row = live(index);
        const original = row.cloneNode.bind(row);
        return vi.spyOn(row, 'cloneNode').mockImplementation((deep) => {
          const result = original(deep);
          const copy = result.cloneNode.bind(result);
          vi.spyOn(result, 'cloneNode').mockImplementation((templateDeep) => {
            templates();
            return copy(templateDeep);
          });
          return result;
        });
      });
      plugin.afterRender();
      queueMicrotask(() => {
        for (const index of [0, 1, 2]) live(index).firstElementChild!.textContent = `updated-${index}`;
      });
      await settle();
      expect({
        live: captures.map((capture) => capture.mock.calls.length),
        templates: templates.mock.calls.length,
      }).toEqual({ live: [1, 1, 1], templates: 3 });
      expect(clone(0)?.textContent).toBe('updated-0');
      expect(clone(1)?.textContent).toBe('updated-1');

      // Once the live slots leave, the freshly captured owners must survive in cache.
      for (const index of [0, 1, 2]) live(index).remove();
      plugin.onScroll(scrollEvent(0));
      plugin.onScroll(scrollEvent(1));
      expect(clone(0)?.textContent).toBe('updated-0');
      expect(clone(1)?.textContent).toBe('updated-1');
      plugin.onScroll(scrollEvent(100));
      expect(clone(2)?.textContent).toBe('updated-2');
      plugin.detach();
    });

    it('captures a later displayed row after an earlier connected replacement mutates it', async () => {
      const { plugin, rows, live, clone } = stackFixture();
      plugin.afterRender();
      await settle();
      const first = clone(0)!;
      const replace = first.replaceWith.bind(first);
      const order: string[] = [];
      vi.spyOn(first, 'replaceWith').mockImplementation((...nodes) => {
        order.push('replace-0');
        replace(...nodes);
        rows[1] = { flag: true };
        Object.assign(live(1), { __rowDataRef: rows[1] });
        live(1).firstElementChild!.textContent = 'changed-during-replacement';
      });
      const later = live(1);
      const capture = later.cloneNode.bind(later);
      vi.spyOn(later, 'cloneNode').mockImplementation((deep) => {
        order.push('capture-1');
        return capture(deep);
      });
      plugin.afterRender();
      await settle();
      expect(order).toEqual(['replace-0', 'capture-1']);
      expect(clone(1)?.textContent).toBe('changed-during-replacement');
      live(1).remove();
      plugin.afterRender();
      await settle();
      expect(clone(1)?.textContent).toBe('changed-during-replacement');
      plugin.detach();
    });

    it('uses the final live offset when replacement makes another cached row qualify', async () => {
      const { plugin, live, clone, scroll } = stackFixture();
      plugin.afterRender();
      await settle();
      const first = clone(0)!;
      const replace = first.replaceWith.bind(first);
      vi.spyOn(first, 'replaceWith').mockImplementation((...nodes) => {
        replace(...nodes);
        scroll.scrollTop = 100;
        // The newly qualified row was primed this pass before leaving the window.
        live(2).remove();
      });
      plugin.afterRender();
      queueMicrotask(() => {
        live(2).firstElementChild!.textContent = 'newly-qualified';
      });
      await settle();
      expect(clone(0)).toBeNull();
      expect(clone(1)?.textContent).toBe('R1C0');
      expect(clone(2)?.textContent).toBe('newly-qualified');
      plugin.detach();
    });

    it('cancels both settlement stages on detach and never captures a predecessor after reattach', async () => {
      const first = fixture();
      first.plugin.afterRender();
      await Promise.resolve();
      first.plugin.detach();
      const second = createMockGrid({ rows: [{ flag: true }], renderedIndices: [0] });
      first.plugin.attach(second);
      first.plugin.afterRender();
      const oldCapture = vi.spyOn(first.cell.parentElement!, 'cloneNode');
      await settle();
      expect(oldCapture).not.toHaveBeenCalled();
      expect(first.grid.querySelector('.tbw-sticky-rows')).toBeNull();
      first.plugin.onScroll(scrollEvent(10));
      expect(second.querySelector('.tbw-sticky-row')).not.toBeNull();
      first.plugin.detach();
    });

    it('invalidates same-index snapshots for a successor row before pending capture', async () => {
      const { plugin, rows, cell, text, grid } = fixture();
      plugin.afterRender();
      await settle();
      expect(text()).toBe('R0C0');
      rows[0] = { flag: true, name: 'successor' };
      // The old slot still carries index 0 but belongs to the predecessor.
      plugin.afterRender();
      await settle();
      expect(grid.querySelector('.tbw-sticky-row')).toBeNull();
      Object.assign(cell.parentElement!, { __rowDataRef: rows[0] });
      cell.textContent = 'successor';
      plugin.afterRender();
      await settle();
      expect(text()).toBe('successor');
      plugin.detach();
    });

    it('excludes nested indexed cells and removed live slots from scheduled captures', async () => {
      const { plugin, cell, text } = fixture();
      plugin.afterRender();
      await settle();
      expect(text()).toBe('R0C0');
      const row = cell.parentElement!;
      cell.removeAttribute('data-row');
      const nested = document.createElement('div');
      nested.innerHTML =
        '<div class="rows"><div class="data-grid-row"><div class="cell" data-row="0">foreign</div></div></div>';
      cell.append(nested);
      plugin.afterRender();
      await settle();
      expect(text()).toBe('R0C0');
      plugin.afterRender();
      row.remove();
      await settle();
      expect(text()).toBe('R0C0');
      plugin.detach();
    });
  });

  // #region vertical scroll offsets (WCAG 2.2 SC 2.4.11)

  describe('getVerticalScrollOffsets (#449)', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ flag: i === 3 || i === 8 }));
    const rendered = Array.from({ length: 20 }, (_, i) => i);

    /** happy-dom reports 0 for every layout box, so fake the overlay height. */
    function stubOverlayHeight(grid: HTMLElement, height: number): void {
      const container = grid.querySelector('.tbw-sticky-rows') as HTMLElement;
      Object.defineProperty(container, 'offsetHeight', { value: height, configurable: true });
    }

    it('reports nothing before the container exists', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      expect(plugin.getVerticalScrollOffsets()).toBeUndefined();
    });

    it('reports nothing while no row is stuck', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(0));
      expect(plugin.getVerticalScrollOffsets()).toBeUndefined();
    });

    it('reports the overlay height as obscured space at the top', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(5 * 28 + 1)); // row 3 is stuck
      stubOverlayHeight(grid, 28);

      expect(plugin.getVerticalScrollOffsets(10)).toEqual({ top: 28, bottom: 0 });
    });

    it('asks the grid to skip scrolling when the focused row is itself a clone', () => {
      const plugin = new StickyRowsPlugin({ isSticky: 'flag', mode: 'push' });
      const grid = createMockGrid({ rows, renderedIndices: rendered });
      plugin.attach(grid);
      plugin.afterRender();
      plugin.onScroll(scrollEvent(5 * 28 + 1)); // row 3 is stuck
      stubOverlayHeight(grid, 28);

      // Row 3 is pinned in view already — scrolling to it would only push the
      // row it is stuck above out of reach.
      expect(plugin.getVerticalScrollOffsets(3)).toEqual({ top: 0, bottom: 0, skipScroll: true });
    });
  });

  // #endregion
});
