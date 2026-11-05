import { emitCellChange, queryCellCommit } from '../../core/internal/cell-commit';
import { CONFIG_RULE_ERROR, ROW_NOT_FOUND, throwDiagnostic, warnDiagnostic } from '../../core/internal/diagnostics';
import { RenderPhase } from '../../core/internal/render-scheduler';
import { captureEditTarget, type EditTarget, resolveEditTarget } from '../../core/internal/row-identity';
import { invalidateCellCache } from '../../core/internal/rows';
import { readCellField } from '../../core/internal/value-accessor';
import type { GridElement } from '../../core/plugin/base-plugin';
import type { CellEditablePredicate, CommitCellValueContext } from '../../core/plugin/types';
import type { ColumnConfig } from '../../core/types';
import { isEntryCell } from '../editing/internal/single-cell-entry';
import type { UndoRedoPlugin } from '../undo-redo';
import { fillPosition, inferFillSeries, NO_FILL_VALUE } from './fill-series';
import type { FillCellResult, FillDirection, FillHandleConfig, FillRequest } from './types';

/** Whole-action bound on target cells, matching selected-cell clearing. */
export const FILL_CELL_LIMIT = 10_000;

/** Group headers, pivot aggregates and loading placeholders are not consumer data. */
export function isStructuralRow(row: unknown): boolean {
  if (row == null || typeof row !== 'object') return true;
  const flags = row as Record<string, unknown>;
  return (
    flags.__isGroupRow === true ||
    flags.__loading === true ||
    flags.__pivotIsGrandTotal === true ||
    flags.__pivotRowKey !== undefined
  );
}

interface PlannedRow {
  index: number;
  row: unknown;
}

interface PlannedTarget extends PlannedRow {
  offset: number;
  target: EditTarget<unknown>;
  /** Field values when the gesture started; later differences are conflicts. */
  values: unknown[];
}

/** Rows, columns and values frozen when the gesture starts. */
export interface FillPlan {
  request: FillRequest;
  direction: FillDirection;
  fields: string[];
  /** Visible column fields at gesture start, used to detect column changes. */
  layout: string;
  sources: PlannedRow[];
  seeds: unknown[][];
  targets: PlannedTarget[];
  limitExceeded: boolean;
}

/** Normalized processed-row bounds of a request, clamped to the grid. */
export function fillBounds(request: FillRequest, rowCount: number, columnCount: number) {
  const { from, to } = request.source;
  const clamp = (value: number, size: number) => Math.min(size - 1, Math.max(0, value));
  return {
    firstRow: clamp(Math.min(from.row, to.row), rowCount),
    lastRow: clamp(Math.max(from.row, to.row), rowCount),
    firstCol: clamp(Math.min(from.col, to.col), columnCount),
    lastCol: clamp(Math.max(from.col, to.col), columnCount),
    targetRow: clamp(request.targetRow, rowCount),
  };
}

const layoutOf = (grid: GridElement) => JSON.stringify(grid._visibleColumns.map((column) => column.field));

/**
 * Freeze a fill request. Returns `undefined` when there is nothing to fill:
 * the target lies inside the source, or the source has no data rows.
 */
export function planFill(grid: GridElement, request: FillRequest): FillPlan | undefined {
  const rows = grid.rows as unknown[];
  const columns = grid._visibleColumns;
  if (!rows.length || !columns.length) return undefined;
  const bounds = fillBounds(request, rows.length, columns.length);
  const direction: FillDirection | undefined =
    bounds.targetRow > bounds.lastRow ? 'down' : bounds.targetRow < bounds.firstRow ? 'up' : undefined;
  if (!direction) return undefined;
  const fields = columns.slice(bounds.firstCol, bounds.lastCol + 1).map((column) => column.field);
  const sources: PlannedRow[] = [];
  for (let index = bounds.firstRow; index <= bounds.lastRow; index++) {
    if (!isStructuralRow(rows[index])) sources.push({ index, row: rows[index] });
  }
  if (!sources.length) return undefined;
  const plan: FillPlan = {
    request,
    direction,
    fields,
    layout: layoutOf(grid),
    sources,
    seeds: fields.map((field) => sources.map(({ row }) => readCellField(row, field))),
    targets: [],
    limitExceeded: false,
  };
  const step = direction === 'down' ? 1 : -1;
  const start = direction === 'down' ? bounds.lastRow + 1 : bounds.firstRow - 1;
  for (let index = start; index !== bounds.targetRow + step; index += step) {
    const row = rows[index];
    if (isStructuralRow(row)) continue;
    if ((plan.targets.length + 1) * fields.length > FILL_CELL_LIMIT) {
      plan.limitExceeded = true;
      plan.targets = [];
      break;
    }
    plan.targets.push({
      index,
      row,
      offset: plan.targets.length + 1,
      target: captureEditTarget(grid, row),
      values: fields.map((field) => readCellField(row, field)),
    });
  }
  return plan;
}

/** The plan's frozen rows, columns and seeds still describe the grid. */
export function isPlanCurrent(grid: GridElement, plan: FillPlan): boolean {
  const rows = grid.rows as unknown[];
  return (
    !grid._pendingSourceUpdate &&
    layoutOf(grid) === plan.layout &&
    plan.sources.every(
      ({ index, row }, source) =>
        rows[index] === row &&
        plan.fields.every((field, col) => Object.is(readCellField(row, field), plan.seeds[col][source])),
    ) &&
    plan.targets.every(({ index, row }) => rows[index] === row)
  );
}

const sameValue = (a: unknown, b: unknown) =>
  Object.is(a, b) || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());

export interface FillExecution {
  cells: FillCellResult[];
  canceled: boolean;
}

/**
 * Apply a frozen plan through Editing's strict bulk-commit policy as one undo step.
 * Editing owns writes/validation/history; this operation owns inference and reporting.
 */
export function executeFill(
  grid: GridElement,
  plan: FillPlan,
  undo: UndoRedoPlugin,
  config: Pick<FillHandleConfig, 'mode' | 'fillValue'>,
): FillExecution {
  if (!isPlanCurrent(grid, plan)) return { cells: [], canceled: true };
  const series = plan.seeds.map((seeds) => inferFillSeries(seeds, config.mode ?? 'auto'));
  const rule = config.fillValue;
  if (rule !== undefined && typeof rule !== 'function') {
    throwDiagnostic(CONFIG_RULE_ERROR, 'fillValue must be a function.', grid.id, 'fillHandle');
  }
  const cells: FillCellResult[] = [];
  let changed = false;
  undo.beginTransaction();
  try {
    for (const planned of plan.targets) {
      for (let col = 0; col < plan.fields.length; col++) {
        const field = plan.fields[col];
        const result: FillCellResult = { row: planned.row, rowIndex: planned.index, field, status: 'skipped' };
        cells.push(result);
        const resolve = () => {
          if (grid._pendingSourceUpdate) return undefined;
          const owner = resolveEditTarget(grid, planned.target);
          const column = grid._visibleColumns.find((candidate) => candidate.field === field);
          const rowIndex = owner ? grid.rows.indexOf(owner.row) : -1;
          return owner && column && rowIndex >= 0 ? { ...owner, column, rowIndex } : undefined;
        };
        const unavailable = () => {
          result.reason = 'unavailable';
          warnDiagnostic(
            ROW_NOT_FOUND,
            `Cannot fill field "${field}": the target owner or column is unavailable or ambiguous. Skipping this cell.`,
            grid.id,
            'fillHandle',
          );
        };
        const conflicted = (row: unknown) => {
          if (sameValue(readCellField(row, field), planned.values[col])) return false;
          result.status = 'rejected';
          result.reason = 'conflict';
          return true;
        };
        let current = resolve();
        if (!current) {
          unavailable();
          continue;
        }
        if (!isFillable(grid, undo, current.column, current.row, current.rowIndex)) {
          result.reason = 'readonly';
          continue;
        }
        const afterEditable = resolve();
        if (!afterEditable || afterEditable.row !== current.row || afterEditable.column !== current.column) {
          unavailable();
          continue;
        }
        current = afterEditable;
        if (conflicted(current.row)) continue;
        const proposedValue = series[col].valueAt(fillPosition(plan.sources.length, plan.direction, planned.offset));
        if (proposedValue === NO_FILL_VALUE) {
          result.reason = 'out-of-range';
          continue;
        }
        let value = proposedValue;
        if (rule) {
          const decision = rule({
            row: current.row,
            rowIndex: current.rowIndex,
            field,
            column: current.column as ColumnConfig<unknown>,
            sourceValues: plan.seeds[col],
            direction: plan.direction,
            offset: planned.offset,
            oldValue: readCellField(current.row, field),
            proposedValue,
          });
          if (!decision || typeof decision !== 'object' || (!('value' in decision) && !('reject' in decision))) {
            throwDiagnostic(CONFIG_RULE_ERROR, 'fillValue must return { value } or { reject }.', grid.id, 'fillHandle');
          }
          if ('reject' in decision) {
            result.status = 'rejected';
            result.reason = 'rule';
            result.message = decision.reject;
            continue;
          }
          value = decision.value;
          const afterRule = resolve();
          if (!afterRule || afterRule.row !== current.row || afterRule.column !== current.column) {
            unavailable();
            continue;
          }
          current = afterRule;
          if (conflicted(current.row)) continue;
        }
        const oldValue = readCellField(current.row, field);
        if (sameValue(oldValue, value)) {
          result.reason = 'unchanged';
          continue;
        }
        const context: CommitCellValueContext = {
          row: current.row,
          rowId: current.rowId,
          rowIndex: current.rowIndex,
          field,
          oldValue,
          newValue: value,
          source: 'fill',
        };
        if (queryCellCommit(grid, context) !== true) {
          result.status = 'rejected';
          result.reason = 'validation';
          continue;
        }
        result.status = 'filled';
        result.row = current.row;
        changed = true;
        grid._invalidateRowContent(current.row);
        emitCellChange(grid, {
          row: current.row,
          rowId: current.rowId ?? '',
          rowIndex: grid.rows.indexOf(current.row),
          field,
          oldValue,
          newValue: context.newValue,
          changes: { [field]: context.newValue },
          source: 'fill',
          operationId: context.operationId,
        });
      }
    }
  } finally {
    try {
      undo.endTransaction();
    } finally {
      if (changed) {
        invalidateCellCache(grid);
        grid._requestSchedulerPhase(RenderPhase.VIRTUALIZATION, 'fill');
        grid._emitDataChange();
      }
    }
  }
  return { cells, canceled: false };
}

/** Editing, Selection and UndoRedo all still admit a write to this cell. */
function isFillable(
  grid: GridElement,
  undo: UndoRedoPlugin,
  column: ColumnConfig<unknown>,
  row: unknown,
  rowIndex: number,
): boolean {
  const editable = grid.query<CellEditablePredicate>('getCellEditableResolver')[0];
  const selectable = grid.getPluginByName('selection')?.resolvedConfig.isSelectable;
  return (
    isEntryCell(column, row) &&
    (!selectable || selectable(row, rowIndex, column, grid._visibleColumns.indexOf(column))) &&
    !!editable?.(column.field, row) &&
    grid.getPluginByName('editing')?.resolvedConfig.editOn !== false &&
    grid.getPluginByName('undoRedo') === undo
  );
}

/**
 * Gesture-start snapshot: processed row order, visible columns and the values of
 * source rows plus every target row as it first enters the preview.
 */
export interface FillBaseline {
  rows: readonly unknown[];
  layout: string;
  values: Map<unknown, unknown[]>;
}

const rowValues = (grid: GridElement, row: unknown, request: FillRequest) => {
  const { firstCol, lastCol } = fillBounds(request, 1, grid._visibleColumns.length);
  return grid._visibleColumns.slice(firstCol, lastCol + 1).map((column) => readCellField(row, column.field));
};

/** Snapshot the source rows; call {@link extendFillBaseline} as the preview grows. */
export function createFillBaseline(grid: GridElement, request: FillRequest): FillBaseline {
  const baseline: FillBaseline = { rows: [...grid.rows], layout: layoutOf(grid), values: new Map() };
  const { firstRow, lastRow } = fillBounds(request, baseline.rows.length, grid._visibleColumns.length);
  for (let index = firstRow; index <= lastRow; index++) {
    const row = baseline.rows[index];
    if (!isStructuralRow(row)) baseline.values.set(row, rowValues(grid, row, request));
  }
  return baseline;
}

/** Record values for previewed targets not seen before (bounded by the cell limit). */
export function extendFillBaseline(grid: GridElement, baseline: FillBaseline, request: FillRequest): void {
  if (layoutOf(grid) !== baseline.layout) return;
  const rows = grid.rows as unknown[];
  const bounds = fillBounds(request, rows.length, grid._visibleColumns.length);
  const width = bounds.lastCol - bounds.firstCol + 1;
  const [from, to] =
    bounds.targetRow > bounds.lastRow
      ? [bounds.lastRow + 1, bounds.targetRow]
      : [bounds.targetRow, bounds.firstRow - 1];
  for (let index = from; index <= to && baseline.values.size * width <= FILL_CELL_LIMIT * 2; index++) {
    const row = rows[index];
    if (row !== baseline.rows[index] || isStructuralRow(row) || baseline.values.has(row)) continue;
    baseline.values.set(row, rowValues(grid, row, request));
  }
}

/**
 * Rebase a freshly planned fill onto its gesture baseline. Returns `false` when
 * rows, columns or source values changed (the operation is stale); target values
 * captured at preview time replace current ones so later edits become conflicts.
 */
export function rebaseFillPlan(plan: FillPlan, baseline: FillBaseline): boolean {
  if (plan.layout !== baseline.layout) return false;
  const sameRow = ({ index, row }: PlannedRow) => baseline.rows[index] === row;
  if (!plan.sources.every(sameRow) || !plan.targets.every(sameRow)) return false;
  for (let source = 0; source < plan.sources.length; source++) {
    const values = baseline.values.get(plan.sources[source].row);
    if (!values || !values.every((value, col) => Object.is(value, plan.seeds[col][source]))) return false;
  }
  for (const target of plan.targets) target.values = baseline.values.get(target.row) ?? target.values;
  return true;
}
