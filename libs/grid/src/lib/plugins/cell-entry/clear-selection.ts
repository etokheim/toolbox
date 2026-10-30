import { CONFIG_RULE_ERROR, ROW_NOT_FOUND, throwDiagnostic, warnDiagnostic } from '../../core/internal/diagnostics';
import { RenderPhase } from '../../core/internal/render-scheduler';
import { captureEditTarget, resolveEditTarget } from '../../core/internal/row-identity';
import { invalidateCellCache } from '../../core/internal/rows';
import { readCellField } from '../../core/internal/value-accessor';
import type { GridElement } from '../../core/plugin/base-plugin';
import type { CellEditablePredicate } from '../../core/plugin/types';
import { isEntryCell } from '../editing/internal/single-cell-entry';
import type { CellRange } from '../selection/types';
import type { UndoRedoPlugin } from '../undo-redo';
import type { CellClearDetail, CellClearResult } from './types';

const CELL_LIMIT = 10_000;

/** Count/dedupe the bounded visible selection before invoking any consumer code. */
export function selectedCoordinates(ranges: CellRange[], rows: number, columns: number) {
  const cells = new Set<number>();
  for (const { from, to } of ranges) {
    const firstRow = Math.max(0, Math.min(from.row, to.row));
    const lastRow = Math.min(rows - 1, Math.max(from.row, to.row));
    const firstCol = Math.max(0, Math.min(from.col, to.col));
    const lastCol = Math.min(columns - 1, Math.max(from.col, to.col));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        cells.add(row * columns + col);
        if (cells.size > CELL_LIMIT) return undefined;
      }
    }
  }
  return [...cells].map((cell) => ({ row: Math.floor(cell / columns), col: cell % columns }));
}

/** Editing owns writes/validation/history; this operation owns selection bounds and reporting. */
export function clearSelectedCells(grid: GridElement, ranges: CellRange[], undo: UndoRedoPlugin): CellClearDetail {
  const rows = [...grid.rows];
  const columns = [...grid._visibleColumns];
  const coordinates = selectedCoordinates(ranges, rows.length, columns.length);
  if (!coordinates) return { cells: [], limitExceeded: true };
  const selected = coordinates.map(({ row, col }) => ({
    row: rows[row],
    rowIndex: row,
    field: columns[col].field,
    target: captureEditTarget(grid, rows[row]),
  }));
  const cells: CellClearResult[] = [];
  let changed = false;
  undo.beginTransaction();
  try {
    for (const selectedCell of selected) {
      const { target, field } = selectedCell;
      const result: CellClearResult = {
        row: selectedCell.row,
        rowIndex: selectedCell.rowIndex,
        field,
        status: 'skipped',
      };
      cells.push(result);
      const resolve = () => {
        if (grid._pendingSourceUpdate) return undefined;
        const owner = resolveEditTarget(grid, target);
        const column = grid._visibleColumns.find((candidate) => candidate.field === field);
        const rowIndex = owner ? grid.rows.indexOf(owner.row) : -1;
        return owner && column && rowIndex >= 0 ? { ...owner, column, rowIndex } : undefined;
      };
      const unavailable = () => {
        result.reason = 'unavailable';
        warnDiagnostic(
          ROW_NOT_FOUND,
          `Cannot clear field "${field}": the selected owner or column is unavailable or ambiguous. Skipping this cell.`,
          grid.id,
          'cellEntry',
        );
      };
      let current = resolve();
      if (!current) {
        unavailable();
        continue;
      }
      const editable = grid.query<CellEditablePredicate>('getCellEditableResolver')[0];
      const selectable = grid.getPluginByName('selection')?.resolvedConfig.isSelectable;
      if (
        !isEntryCell(current.column, current.row) ||
        (selectable &&
          !selectable(current.row, current.rowIndex, current.column, grid._visibleColumns.indexOf(current.column))) ||
        !editable?.(field, current.row) ||
        grid.getPluginByName('editing')?.resolvedConfig.editOn === false ||
        grid.getPluginByName('undoRedo') !== undo ||
        !grid.getPluginByName('cellEntry')?.resolvedConfig.clearOnDelete
      ) {
        result.reason = 'readonly';
        continue;
      }
      const afterEditable = resolve();
      if (!afterEditable || afterEditable.row !== current.row || afterEditable.column !== current.column) {
        unavailable();
        continue;
      }
      current = afterEditable;
      let oldValue = readCellField(current.row, field);
      const rule = current.column.clearValue;
      if (rule !== undefined && typeof rule !== 'function') {
        throwDiagnostic(CONFIG_RULE_ERROR, `clearValue for "${field}" must be a function.`, grid.id, 'cellEntry');
      }
      const replacement = rule
        ? rule({ row: current.row, rowIndex: current.rowIndex, column: current.column, field, value: oldValue })
        : current.column.nullable === true
          ? { value: null }
          : current.column.type === 'string' || (!current.column.type && typeof oldValue === 'string')
            ? { value: '' }
            : undefined;
      if (
        rule &&
        (!replacement || typeof replacement !== 'object' || (!('value' in replacement) && !('reject' in replacement)))
      ) {
        throwDiagnostic(
          CONFIG_RULE_ERROR,
          `clearValue for "${field}" must return { value } or { reject }.`,
          grid.id,
          'cellEntry',
        );
      }
      if (!replacement) {
        result.reason = 'unsupported-type';
        continue;
      }
      if ('reject' in replacement) {
        result.status = 'rejected';
        result.reason = 'rule';
        result.message = replacement.reject;
        continue;
      }
      const afterRule = resolve();
      if (!afterRule || afterRule.row !== current.row || afterRule.column !== current.column) {
        unavailable();
        continue;
      }
      current = afterRule;
      oldValue = readCellField(current.row, field);
      if (Object.is(oldValue, replacement.value)) {
        result.reason = 'unchanged';
        continue;
      }
      const responses = grid.query<boolean>('commitCellValue', {
        row: current.row,
        rowId: current.rowId,
        rowIndex: current.rowIndex,
        field,
        oldValue,
        newValue: replacement.value,
        source: 'clear',
      });
      if (responses.includes(false) || !responses.includes(true)) {
        result.status = 'rejected';
        result.reason = 'validation';
        continue;
      }
      result.status = 'cleared';
      result.row = current.row;
      changed = true;
      grid._invalidateRowContent(current.row);
      grid.dispatchEvent(
        new CustomEvent('cell-change', {
          bubbles: true,
          composed: true,
          detail: {
            row: current.row,
            rowId: current.rowId ?? '',
            rowIndex: grid.rows.indexOf(current.row),
            field,
            oldValue,
            newValue: replacement.value,
            changes: { [field]: replacement.value },
            source: 'clear',
          },
        }),
      );
    }
  } finally {
    undo.endTransaction();
    if (changed) {
      invalidateCellCache(grid);
      grid._requestSchedulerPhase(RenderPhase.VIRTUALIZATION, 'clearSelection');
      grid._emitDataChange();
    }
  }
  return { cells, limitExceeded: false };
}
