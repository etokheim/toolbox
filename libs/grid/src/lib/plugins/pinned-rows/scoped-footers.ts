import { getRowFlow, setRowFlow, type RowFlow, type RowFlowPoint } from '../../core/internal/row-flow';
import { markControlBoundary } from '../../core/internal/control-lifecycle';
import { getRowWindow } from '../../core/internal/row-window';
import {
  getRowCacheKey,
  getRowIndexAtOffset,
  getTotalHeight,
  toVirtualScrollTop,
} from '../../core/internal/virtualization';
import { CONFIG_RULE_WARN, warnDiagnostic } from '../../core/internal/diagnostics';
import type { GridElement } from '../../core/plugin/base-plugin';
import { ControlSlot } from '../../core/plugin/control-view';
import { buildAncestorIndex } from '../sticky-rows/ancestor-index';
import type { FooterContext, FooterScope, PinnedRowsConfig, ScopedFooter } from './types';

interface Footer<TRow> {
  scope: FooterScope<TRow>;
  definition: ScopedFooter<TRow>;
  start: number;
  end: number;
  depth: number;
  ownerDepth: number;
  collapsible?: boolean;
  inset: number;
  slot?: ControlSlot<FooterContext<TRow>>;
}

/** @internal A single live owner per admitted scope; no synthetic data rows. */
export class ScopedFooters<TRow = unknown> implements RowFlow {
  #footers = new Map<string | object, Footer<TRow>>();
  #gaps = new Map<number, number>();
  #endingAt = new Map<number, Footer<TRow>[]>();
  #rows: readonly unknown[] | undefined;
  #epoch = -1;
  #callback: PinnedRowsConfig<TRow>['scopedFooters'];
  #rowId: GridElement['effectiveConfig']['getRowId'];
  #disposed = false;
  #exhausted = false;

  constructor(
    readonly grid: GridElement,
    readonly config: () => PinnedRowsConfig<TRow>,
  ) {
    setRowFlow(grid, this);
  }

  prepare(): void {
    const grid = this.grid;
    const callback = this.config().scopedFooters;
    const rowId = grid.effectiveConfig.getRowId;
    if (
      this.#rows === grid._rows &&
      this.#epoch === grid.__rowRenderEpoch &&
      callback === this.#callback &&
      rowId === this.#rowId
    )
      return;
    if (rowId !== this.#rowId) {
      for (const footer of this.#footers.values()) this.#release(footer);
      this.#rowId = rowId;
    }
    this.#rows = grid._rows;
    this.#epoch = grid.__rowRenderEpoch;
    this.#callback = callback;
    const hierarchy = grid.getPluginByName('hierarchy');
    const model = hierarchy?.getRowModel();
    const index = buildAncestorIndex(model?.rows ?? grid._rows, (row) => hierarchy?.getRowMeta(row), grid._rows);
    const next = new Map<string | object, Footer<TRow>>();
    const add = (
      scope: FooterScope<TRow>,
      start: number,
      end: number,
      depth: number,
      ownerDepth = 0,
      collapsible?: boolean,
    ) => {
      const definition = callback?.(scope);
      if (definition === null || !callback) return;
      if (!definition) throw new TypeError('scopedFooters must return a footer definition or null');
      if (!Number.isFinite(definition.height) || definition.height <= 0) {
        throw new RangeError('scopedFooters height must be a positive finite number');
      }
      const previous = this.#footers.get(scope.key);
      if (previous && previous.definition.render !== definition.render) this.#release(previous);
      next.set(scope.key, {
        scope,
        definition,
        start,
        end,
        depth,
        ownerDepth,
        collapsible,
        inset: 0,
        slot: previous?.slot,
      });
    };
    add({ kind: 'grid', key: 'grid' }, 0, grid._rows.length, -1);
    const keys = new Map<string | object, number>();
    for (const row of grid._rows) {
      if (!row || typeof row !== 'object') continue;
      const key = getRowCacheKey(row, grid.effectiveConfig.getRowId);
      keys.set(key, (keys.get(key) ?? 0) + 1);
    }
    for (let i = 0; i < grid._rows.length; i++) {
      const row = grid._rows[i];
      if (!row || typeof row !== 'object') continue;
      const depth = hierarchy?.getRowMeta(row)?.level ?? 0;
      if ('__isGroupRow' in row && row.__isGroupRow === true) {
        if (!('__groupExpanded' in row) || !row.__groupExpanded) continue;
        const path: string[] = [];
        let parent: unknown = null;
        for (let at = i; at !== -1; at = index.parents[at]) {
          const ancestor = grid._rows[at];
          if (ancestor && typeof ancestor === 'object' && '__groupValue' in ancestor) {
            path.unshift(String(ancestor.__groupValue ?? '∅'));
          } else {
            parent = ancestor;
            break;
          }
        }
        const key = getRowCacheKey(row);
        if (typeof key !== 'string') throw new Error('Group scope is missing its native occurrence key');
        const ownerDepth = '__groupDepth' in row && typeof row.__groupDepth === 'number' ? row.__groupDepth : 0;
        const collapsible = !('__groupCollapsible' in row && row.__groupCollapsible === false);
        add(
          { kind: 'group', key, parent: parent as TRow | null, path },
          i,
          index.subtreeEnds[i],
          depth,
          ownerDepth,
          collapsible,
        );
      } else {
        const meta = grid.getPluginByName('tree')?.getRowMeta(row);
        if (!meta?.hasChildren || !meta.isExpanded) continue;
        const candidate = getRowCacheKey(row, grid.effectiveConfig.getRowId);
        const key = keys.get(candidate) === 1 ? candidate : row;
        add({ kind: 'row', key, row: row as TRow }, i, index.subtreeEnds[i], depth, meta.depth);
      }
    }
    for (const [key, footer] of this.#footers) if (!next.has(key)) this.#release(footer);
    this.#footers = next;
    this.#gaps.clear();
    this.#endingAt.clear();
    const ordered = [...next.values()].sort((a, b) => a.end - b.end || b.depth - a.depth);
    for (const footer of ordered) {
      const after = footer.end - 1;
      footer.inset = this.#gaps.get(after) ?? 0;
      this.#gaps.set(after, footer.inset + footer.definition.height);
      const endings = this.#endingAt.get(after);
      if (endings) endings.push(footer);
      else this.#endingAt.set(after, [footer]);
    }
  }

  after(index: number): number {
    return this.#gaps.get(index) ?? 0;
  }

  emptyHeight(): number {
    return this.after(-1);
  }

  scopeAt(offset: number): RowFlowPoint | undefined {
    const cache = this.grid._virtualization.positionCache;
    if (!cache?.length) return { owner: -1, surface: -1 };
    if (offset >= getTotalHeight(cache)) return { owner: -1, surface: -1 };
    let surface = getRowIndexAtOffset(cache, offset);
    // Navigation intentionally chooses the next row in a gap. Scope ownership
    // instead comes from the individual footer segment preceding that row.
    if (offset < cache[surface].offset) surface--;
    const position = cache[surface];
    if (!position || offset < position.offset + position.height) return;
    const gapStart = position.offset + position.height;
    for (const footer of this.#endingAt.get(surface) ?? []) {
      if (offset < gapStart + footer.inset + footer.definition.height) {
        return { owner: footer.scope.kind === 'grid' ? -1 : footer.start, surface };
      }
    }
    return;
  }

  scopeEnd(index: number, end: number): number {
    const endings = this.#endingAt.get(end - 1);
    if (!endings) return this.#offset(end);
    let extent = 0;
    for (const footer of endings) {
      if (footer.scope.kind === 'grid' || footer.start < index) break;
      extent = footer.inset + footer.definition.height;
    }
    return this.#offset(end) - this.after(end - 1) + extent;
  }

  #offset(index: number): number {
    const state = this.grid._virtualization;
    if (!this.grid._rows.length) return this.emptyHeight();
    if (state.positionCache?.[index]) return state.positionCache[index].offset;
    if (index === this.grid._rows.length && state.positionCache) return getTotalHeight(state.positionCache);
    return index * state.rowHeight;
  }

  #natural(footer: Footer<TRow>): number {
    return this.#offset(footer.end) - this.after(footer.end - 1) + footer.inset;
  }

  #viewport(): { top: number; height: number } {
    const state = this.grid._virtualization;
    const external = getRowWindow(this.grid)?.viewport?.();
    return {
      top: external?.scrollTop ?? toVirtualScrollTop(state.container?.scrollTop ?? 0, state.scrollMapping),
      height: external?.height ?? state.viewportEl?.clientHeight ?? 0,
    };
  }

  #active(top: number, height: number): Footer<TRow> | undefined {
    let active: Footer<TRow> | undefined;
    for (const footer of this.#footers.values()) {
      const start = footer.scope.kind === 'grid' ? 0 : this.#offset(footer.start);
      const end = this.#natural(footer) + footer.definition.height;
      if (start >= top + height || end <= top) continue;
      if (
        !active ||
        footer.depth > active.depth ||
        (footer.depth === active.depth && start < this.#offset(active.start))
      ) {
        active = footer;
      }
    }
    return active;
  }

  bottom(): number {
    this.prepare();
    const { top, height } = this.#viewport();
    const active = this.#active(top, height);
    return active &&
      !this.#insufficient(active, top, height) &&
      this.#natural(active) > top + height - active.definition.height
      ? active.definition.height
      : 0;
  }

  exhausted(): boolean {
    this.prepare();
    const { top, height } = this.#viewport();
    const active = this.#active(top, height);
    return !!active && this.#insufficient(active, top, height);
  }

  #insufficient(footer: Footer<TRow>, top: number, height: number): boolean {
    const state = this.grid._virtualization;
    const cache = state.positionCache;
    const index = this.scopeAt(top)?.surface ?? (cache ? getRowIndexAtOffset(cache, top) : 0);
    const surface = index >= 0 && this.grid._rows.length ? (cache?.[index]?.height ?? state.rowHeight) : 0;
    return height < footer.definition.height + surface;
  }

  layout(): void {
    if (this.#disposed) return;
    this.prepare();
    const grid = this.grid;
    const state = grid._virtualization;
    const body = grid._bodyEl;
    if (!body) return;
    const window = getRowWindow(grid);
    for (let i = 0; i < grid._rowPool.length; i++) {
      const index = window?.indices[i] ?? state.start + i;
      const extent = index >= state.start && index < state.end ? this.after(index) : 0;
      grid._rowPool[i].style.marginBottom = extent ? `${extent}px` : '';
    }
    if (!grid._rows.length) body.style.minHeight = `${this.emptyHeight()}px`;
    else body.style.removeProperty('min-height');
    const { top, height } = this.#viewport();
    const active = this.#active(top, height);
    const exhausted = !!active && this.#insufficient(active, top, height);
    if (exhausted && !this.#exhausted) {
      warnDiagnostic(
        CONFIG_RULE_WARN,
        'Insufficient space for scoped footer and data surface; footer remains in normal flow.',
        grid.id,
        'pinnedRows',
      );
    }
    this.#exhausted = exhausted;
    const origin = grid._rows.length ? this.#offset(state.start) : 0;
    for (const footer of this.#footers.values()) {
      const natural = this.#natural(footer);
      const y = footer === active && !exhausted ? Math.min(natural, top + height - footer.definition.height) : natural;
      const visible = height > 0 && y + footer.definition.height > top && y < top + height;
      if (!visible) {
        this.#release(footer);
        continue;
      }
      if (!footer.slot) {
        const host = body.ownerDocument.createElement('div');
        host.className = 'tbw-scoped-footer';
        host.setAttribute('role', 'group');
        markControlBoundary(host, grid);
        host.addEventListener('paste', (event) => event.stopPropagation());
        footer.slot = new ControlSlot(host, footer.definition.render, grid);
      }
      const host = footer.slot.host;
      if (host.parentNode !== body) body.append(host);
      host.style.top = `${y - origin}px`;
      host.style.height = `${footer.definition.height}px`;
      host.dataset.stuck = String(y < natural);
      footer.slot.update({ scope: footer.scope, grid, depth: footer.ownerDepth, collapsible: footer.collapsible });
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const footer of this.#footers.values()) this.#release(footer);
    for (const row of this.grid._rowPool) row.style.removeProperty('margin-bottom');
    this.grid._bodyEl?.style.removeProperty('min-height');
    if (getRowFlow(this.grid) === this) setRowFlow(this.grid, undefined);
    this.#footers.clear();
    this.#gaps.clear();
    this.#endingAt.clear();
  }

  #release(footer: Footer<TRow>): void {
    footer.slot?.dispose();
    footer.slot?.host.remove();
    footer.slot = undefined;
  }
}
