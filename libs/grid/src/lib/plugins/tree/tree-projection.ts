import { builtInSort } from '../../core/internal/sorting';
import type { ColumnConfig, GridHost, SortHandler } from '../../core/types';
import type { HierarchyNode } from '../hierarchy';
import { applySorts } from '../multi-sort/multi-sort';
import type { SortModel } from '../multi-sort/types';
import type { FlattenedTreeRow, TreeRow } from './types';

/** Row-preserving projection helpers; the plugin owns each generation and its metadata. */
export class TreeProjection {
  keyOf(row: TreeRow): string {
    return this.context.rowKeys.get(row) ?? String(row.id ?? '?');
  }

  constructor(
    private readonly context: {
      grid: () => GridHost;
      columns: () => ColumnConfig[];
      getRowId: () => ((row: TreeRow) => string) | undefined;
      rowKeys: WeakMap<object, string>;
      priorRowMeta: () => WeakMap<object, FlattenedTreeRow> | undefined;
      multiSort: () => SortModel[] | undefined;
      sort: () => { field: string; direction: 1 | -1 } | null;
    },
  ) {}

  keyFor(row: TreeRow, index: number, parentKey: string | null): string {
    const resolveId = this.context.getRowId();
    if (resolveId) {
      const key = resolveId(row);
      this.context.rowKeys.set(row as object, key);
      return key;
    }
    if (row.id !== undefined) {
      const key = String(row.id);
      this.context.rowKeys.set(row as object, key);
      return key;
    }
    const cached = this.context.rowKeys.get(row as object);
    if (cached !== undefined) return cached;
    const key = parentKey ? `${parentKey}-${index}` : String(index);
    this.context.rowKeys.set(row as object, key);
    return key;
  }

  /** Order a sibling list's nodes by their rows via {@link #sortLevel}. */
  sortNodes(nodes: HierarchyNode[], parentKey: string | null): HierarchyNode[] {
    const byRow = new Map<unknown, HierarchyNode>();
    for (const node of nodes) byRow.set(node.row, node);
    const sorted = this.sortRows(
      nodes.map((node) => node.row as TreeRow),
      parentKey,
    );
    return sorted.map((row) => byRow.get(row) ?? { row });
  }

  sortRows(rows: TreeRow[], parentKey: string | null): TreeRow[] {
    const grid = this.context.grid();
    if (!grid?._isGridEditMode && typeof grid?._activeEditRows === 'number' && grid._activeEditRows !== -1) {
      const previous = new Array<TreeRow>(rows.length);
      for (const row of rows) {
        const meta = this.context.priorRowMeta()?.get(row);
        if (!meta || meta.parentKey !== parentKey || meta.setSize !== rows.length) break;
        previous[meta.posInSet - 1] = row;
      }
      if (previous.filter(Boolean).length === rows.length) return previous;
    }
    const multiSort = this.context.multiSort();
    const sort = this.context.sort();
    return multiSort
      ? applySorts(rows, multiSort, this.context.columns())
      : sort
        ? this.#sortLevel(rows, sort.field, sort.direction)
        : rows;
  }

  /**
   * Sort rows at a single level, returning a new array of the SAME row references
   * in sorted order. Never clones row objects, and never mutates the input array
   * (children arrays are user-owned for tree rows — we always pass a shallow copy
   * to the handler so a custom in-place sortHandler can't corrupt user data).
   *
   * Delegates to the same handler chain core uses: `gridConfig.sortHandler` when
   * provided, otherwise `builtInSort` (which honors per-column `sortComparator`
   * and `valueAccessor`). Async handlers cannot be awaited inside the synchronous
   * tree flatten — fall back to `builtInSort` when one is detected, and swallow
   * any rejection so it doesn't surface as an unhandled promise rejection.
   */
  #sortLevel(rows: readonly TreeRow[], field: string, dir: 1 | -1): TreeRow[] {
    const host = this.context.grid();
    const columns = (host?._columns ?? []) as ColumnConfig<TreeRow>[];
    const handler: SortHandler<TreeRow> = host?.effectiveConfig?.sortHandler ?? builtInSort;
    const sortState = { field, direction: dir };
    // Always pass a shallow copy: `rows` may be a user-owned `row.children`
    // array, and a non-defensive sortHandler could otherwise mutate it.
    const input = [...rows] as TreeRow[];
    const result = handler(input, sortState, columns);
    if (result && typeof (result as Promise<unknown[]>).then === 'function') {
      void (result as Promise<unknown[]>).catch(() => undefined);
      return builtInSort(input, sortState, columns);
    }
    return result as TreeRow[];
  }
}
