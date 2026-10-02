/**
 * Selection feature for @toolbox-web/grid-react
 *
 * Import this module to enable the `selection` prop on DataGrid.
 * Also exports `useGridSelection()` hook for programmatic selection control.
 *
 * @example
 * ```tsx
 * import '@toolbox-web/grid-react/features/selection';
 *
 * <DataGrid selection="range" />
 * ```
 *
 * @example Using the hook
 * ```tsx
 * import { useGridSelection } from '@toolbox-web/grid-react/features/selection';
 *
 * function MyComponent() {
 *   const { selectAll, clearSelection, getSelection } = useGridSelection();
 *
 *   return (
 *     <button onClick={selectAll}>Select All</button>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

import type { CellRenderContext, DataGridElement } from '@toolbox-web/grid';
import {
  type CellRange,
  type SelectionChangeDetail,
  type SelectionPlugin,
  type SelectionResult,
  type SelectionRowCheckboxBinding,
  type SelectionRowCheckboxContext,
} from '@toolbox-web/grid/plugins/selection';
import {
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { GridElementContext } from '../lib/grid-element-context';
import { createControlBridge } from '../lib/control-bridge';
import { registerFeatureRendererBridge } from '../lib/feature-renderers';
import type { SelectionConfig } from '../lib/feature-props';
import type { SelectionConfig as CoreSelectionConfig } from '@toolbox-web/grid/plugins/selection';

export type { SelectionConfig } from '../lib/feature-props';
export type {
  SelectionCheckboxModifiers,
  SelectionHeaderCheckboxContext,
  SelectionRowCheckboxContext,
  SelectionRowCheckboxBinding,
} from '@toolbox-web/grid/plugins/selection';

/** Props for a checkbox embedded in an existing React cell renderer. @since 2.7.0 */
export interface SelectionCheckboxProps<TRow> {
  /** Forward the entire owning cell renderer context without reading its internals. */
  context: CellRenderContext<TRow>;
  /** Native checkbox/button presentation; descendants retain Name-local providers. */
  children: (context: SelectionRowCheckboxContext<TRow>) => ReactNode;
}

/**
 * Selection-owned row checkbox inside an existing Name (or other body-cell) portal.
 * Requires row-mode selection; works with `checkbox: false`. No extra portal/root.
 * Initially empty and inert until the committed binding publishes its first state.
 * Forward click modifiers to `setChecked`; leave native keyboard activation alone.
 * @category Component
 * @since 2.7.0
 */
export function SelectionCheckbox<TRow>({ context, children }: SelectionCheckboxProps<TRow>): ReactNode {
  const owner = useContext(GridElementContext);
  const host = useRef<HTMLSpanElement>(null);
  const update = useRef<((next: CellRenderContext<TRow>) => void) | null>(null);
  const latest = useRef(context);
  latest.current = context;
  const [state, setState] = useState<SelectionRowCheckboxContext<TRow> | null>(null);
  // The renderer context supplies the row type for this grid's registered plugin.
  const selection = context.grid?.getPluginByName?.('selection') as SelectionPlugin<TRow> | undefined;

  useLayoutEffect(() => {
    if (!selection || !host.current || owner?.current !== context.grid) {
      throw new Error('SelectionCheckbox requires its owning DataGrid and row-mode Selection plugin.');
    }
    const element = host.current;
    let mounted = true;
    let generation = 0;
    const bind = (nextContext: CellRenderContext<TRow>): SelectionRowCheckboxBinding<TRow> => {
      const version = ++generation;
      return selection.bindRowCheckbox(nextContext, element, (next) => {
        if (mounted && generation === version) setState(next);
      });
    };
    let current = bind(latest.current);
    update.current = (next) => {
      if (!current.update(next)) current = bind(next);
    };
    return () => {
      mounted = false;
      update.current = null;
      current.dispose();
    };
  }, [selection, owner, context.grid, context.cellEl]);

  useLayoutEffect(() => update.current?.(context), [context]);

  return createElement('span', { ref: host, style: { display: 'contents' } }, state ? children(state) : null);
}

const rowRenderers = new WeakMap<
  NonNullable<SelectionConfig['rowCheckboxRenderer']>,
  NonNullable<CoreSelectionConfig['rowCheckboxRenderer']>
>();
const headerRenderers = new WeakMap<
  NonNullable<SelectionConfig['headerCheckboxRenderer']>,
  NonNullable<CoreSelectionConfig['headerCheckboxRenderer']>
>();

function normalizeCheckboxes(config: Record<string, unknown>): CoreSelectionConfig {
  const selection = config as Partial<SelectionConfig>;
  const row = selection.rowCheckboxRenderer;
  const header = selection.headerCheckboxRenderer;
  if (row && !rowRenderers.has(row)) rowRenderers.set(row, createControlBridge(row));
  if (header && !headerRenderers.has(header)) headerRenderers.set(header, createControlBridge(header));
  return {
    ...config,
    mode: selection.mode ?? 'cell',
    rowCheckboxRenderer: row ? rowRenderers.get(row) : undefined,
    headerCheckboxRenderer: header ? headerRenderers.get(header) : undefined,
  };
}

registerFeatureRendererBridge('selection', {
  keys: ['rowCheckboxRenderer', 'headerCheckboxRenderer'],
  normalize: (config) => ({ ...normalizeCheckboxes(config) }),
  update(grid, config) {
    grid.getPluginByName('selection')?.setCheckboxRenderers(normalizeCheckboxes(config));
  },
});

// Delegate to core feature registration
import '@toolbox-web/grid/features/selection';
// Named type re-export surfaces the core `FeatureConfig` augmentation to dist
// consumers — a bare side-effect import alone is stripped from the emitted
// `.d.ts`. See `.github/knowledge/adapters.md`.
export type { _Augmentation as _SelectionAugmentation } from '@toolbox-web/grid/features/selection';

/**
 * Selection methods returned from useGridSelection.
 *
 * Uses React context to access the grid ref - works reliably regardless of
 * when the grid mounts or conditional rendering.
 */
export interface SelectionMethods<TRow = unknown> {
  /**
   * Select all rows (row mode) or all cells (range mode).
   */
  selectAll: () => void;

  /**
   * Clear all selection.
   */
  clearSelection: () => void;

  /**
   * Get the current selection state.
   * Use this to derive selected rows, indices, etc.
   */
  getSelection: () => SelectionResult | null;

  /**
   * Check if a specific cell is selected.
   */
  isCellSelected: (row: number, col: number) => boolean;

  /**
   * Set selection ranges programmatically.
   */
  setRanges: (ranges: CellRange[]) => void;

  /**
   * Get actual row objects for the current selection.
   * Works in all selection modes (row, cell, range) — resolves indices
   * against the grid's processed (sorted/filtered) rows.
   *
   * This is the recommended way to get selected rows. Unlike manual
   * index mapping, it correctly resolves rows even when the grid is
   * sorted or filtered.
   *
   * For reactive selected rows, use `selectedRows` instead.
   */
  getSelectedRows: () => TRow[];

  /**
   * Reactive selection state. Re-renders the component whenever the selection
   * changes. `null` when no SelectionPlugin is active or nothing is selected.
   *
   * @since 2.5.0
   */
  selection: SelectionResult | null;

  /**
   * Reactive selected row indices (sorted ascending). Empty in cell/range
   * modes or when nothing is selected.
   *
   * **Prefer `selectedRows`** for getting actual row objects — it handles
   * index-to-object resolution correctly regardless of sorting/filtering.
   *
   * @since 2.5.0
   */
  selectedRowIndices: number[];

  /**
   * Reactive selected row objects. Works in all selection modes.
   *
   * @since 2.5.0
   */
  selectedRows: TRow[];

  /**
   * Whether the grid has finished its first render and the selection plugin
   * has been discovered.
   *
   * @since 2.5.0
   */
  isReady: boolean;
}

/**
 * Hook for programmatic selection control.
 *
 * Must be used within a DataGrid component tree with the selection feature enabled.
 * Uses React context, so it works reliably regardless of when the grid mounts.
 *
 * @example
 * ```tsx
 * import { useGridSelection } from '@toolbox-web/grid-react/features/selection';
 *
 * function ExportSelectedButton() {
 *   const { getSelection, clearSelection } = useGridSelection();
 *
 *   const handleExport = () => {
 *     const selection = getSelection();
 *     if (!selection) return;
 *     // Derive rows from selection.ranges and grid.rows
 *     clearSelection();
 *   };
 *
 *   return <button onClick={handleExport}>Export Selected</button>;
 * }
 * ```
 * @param selector - Optional CSS selector to target a specific grid element via
 *   DOM query instead of using React context. Use when the component contains
 *   multiple grids, e.g. `'tbw-grid.primary'` or `'#my-grid'`.
 */
export function useGridSelection<TRow = unknown>(selector?: string): SelectionMethods<TRow> {
  const gridRef = useContext(GridElementContext);

  const getGrid = useCallback((): DataGridElement<TRow> | null => {
    return (selector ? document.querySelector(selector) : gridRef?.current) as DataGridElement<TRow> | null;
  }, [gridRef, selector]);

  const getPlugin = useCallback((): SelectionPlugin | undefined => {
    return getGrid()?.getPluginByName('selection');
  }, [getGrid]);

  // ── Reactive state (parity with Angular's selection signals) ──────────
  const [isReady, setIsReady] = useState(false);
  const [selection, setSelection] = useState<SelectionResult | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<number[]>([]);
  const [selectedRows, setSelectedRows] = useState<TRow[]>([]);

  useEffect(() => {
    let disposed = false;
    const grid = getGrid();
    if (!grid) return;

    // `mode` may be a single mode or an array (multi-mode selection).
    const sync = (mode?: SelectionChangeDetail['mode']) => {
      const plugin = grid.getPluginByName('selection') as SelectionPlugin | undefined;
      if (!plugin || disposed) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolvedMode = mode ?? ((plugin as any).config?.mode as SelectionChangeDetail['mode'] | undefined);
      const isRowMode = Array.isArray(resolvedMode) ? resolvedMode.includes('row') : resolvedMode === 'row';
      setSelection(plugin.getSelection());
      setSelectedRowIndices(isRowMode ? plugin.getSelectedRowIndices() : []);
      setSelectedRows(plugin.getSelectedRows<TRow>());
    };

    const unsub = grid.on?.('selection-change', (detail: unknown) => {
      sync((detail as SelectionChangeDetail).mode);
    });

    // `ready` is optional on the element type and genuinely absent until the
    // custom element upgrades, so unwrap through `Promise.resolve`.
    Promise.resolve(grid.ready?.()).then(() => {
      if (disposed) return;
      setIsReady(true);
      sync();
    });

    return () => {
      disposed = true;
      unsub?.();
    };
  }, [getGrid]);

  const selectAll = useCallback(() => {
    const plugin = getPlugin();
    if (!plugin) {
      console.warn(
        `[tbw-grid:selection] SelectionPlugin not found.\n\n` +
          `  → Enable selection on the grid:\n` +
          `    <DataGrid selection="range" />`,
      );
      return;
    }
    const grid = getGrid();
    // Cast to any to access protected config
    const mode = (plugin as any).config?.mode;

    if (mode === 'row') {
      const rowCount = grid?.rows?.length ?? 0;
      const allIndices = new Set<number>();
      for (let i = 0; i < rowCount; i++) allIndices.add(i);
      (plugin as any).selected = allIndices;
      (plugin as any).requestAfterRender?.();
    } else if (mode === 'range') {
      const rowCount = grid?.rows?.length ?? 0;
      const colCount = (grid as any)?._columns?.length ?? 0;
      if (rowCount > 0 && colCount > 0) {
        plugin.setRanges([{ from: { row: 0, col: 0 }, to: { row: rowCount - 1, col: colCount - 1 } }]);
      }
    }
  }, [getPlugin, getGrid]);

  const clearSelection = useCallback(() => {
    getPlugin()?.clearSelection();
  }, [getPlugin]);

  const getSelection = useCallback((): SelectionResult | null => {
    return getPlugin()?.getSelection() ?? null;
  }, [getPlugin]);

  const isCellSelected = useCallback(
    (row: number, col: number): boolean => {
      return getPlugin()?.isCellSelected(row, col) ?? false;
    },
    [getPlugin],
  );

  const setRanges = useCallback(
    (ranges: CellRange[]) => {
      getPlugin()?.setRanges(ranges);
    },
    [getPlugin],
  );

  const getSelectedRows = useCallback((): TRow[] => {
    return getPlugin()?.getSelectedRows<TRow>() ?? [];
  }, [getPlugin]);

  return {
    selectAll,
    clearSelection,
    getSelection,
    isCellSelected,
    setRanges,
    getSelectedRows,
    selection,
    selectedRowIndices,
    selectedRows,
    isReady,
  };
}
