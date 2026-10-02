import type { ColumnConfig, GridHost } from '../../../core/types';
import type { CellEditablePredicate } from '../../../core/plugin/types';

/** @internal */
export interface CellEditRequest {
  rowIndex: number;
  field: string;
  event?: MouseEvent | KeyboardEvent;
}

/** Native controls own their keys, including descendants inside a shadow root. */
export function isCellEntryTarget(event: Event, grid: HTMLElement): boolean {
  for (const node of event.composedPath()) {
    if (node === grid) return true;
    if (!(node instanceof Element)) continue;
    if (node.matches('[data-col][data-row]')) continue;
    if (
      node.matches(
        'input,select,textarea,button,a[href],label,[contenteditable]:not([contenteditable="false"]),[tabindex], [role="button"],[role="checkbox"],[role="combobox"],[inert]',
      ) ||
      node.matches('tbw-grid,[data-tbw-grid]')
    ) {
      return false;
    }
  }
  return false;
}

/** @internal */
export function isEntryCell<T>(column: ColumnConfig<T>, row: T): boolean {
  return !column.utility && !(row && typeof row === 'object' && '__loading' in row && row.__loading);
}

/** Re-resolve coordinates after consumer callbacks; never edit the replacement at a stale index. */
export function findEntryCell<T>(grid: GridHost<T>, row: T | undefined, field: string) {
  const rowIndex = row ? grid._rows.indexOf(row) : -1;
  const colIndex = grid._visibleColumns.findIndex((column) => column.field === field);
  const column = grid._visibleColumns[colIndex];
  const editable = grid.query?.<CellEditablePredicate>('getCellEditableResolver')[0];
  if (rowIndex < 0 || !column || !row || !isEntryCell(column, row) || !editable?.(field, row)) return undefined;
  return { rowIndex, colIndex };
}

/** @internal */
export function nextEditCell<T>(
  grid: GridHost<T>,
  rowIndex: number,
  colIndex: number,
  forward: boolean,
  editable: (column: ColumnConfig<T>, row: T) => boolean,
): CellEditRequest | undefined {
  const columns = grid._visibleColumns;
  const width = columns.length;
  const step = forward ? 1 : -1;
  for (let i = rowIndex * width + colIndex + step; i >= 0 && i < grid._rows.length * width; i += step) {
    const row = Math.floor(i / width);
    const column = columns[i % width];
    const data = grid._rows[row];
    if (data && isEntryCell(column, data) && editable(column, data)) return { rowIndex: row, field: column.field };
  }
  return undefined;
}

/**
 * Keep the host as the browser's sequential-focus origin, excluding its contents
 * for this Tab only. The browser, not a hand-built list of page controls, chooses
 * the next target (including shadow roots, radio groups and positive tabindex).
 */
export function leaveCellEditing(grid: HTMLElement): void {
  const children = Array.from(grid.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  const restored = children.map((child) => child.inert);
  children.forEach((child) => (child.inert = true));
  grid.focus({ preventScroll: true });
  setTimeout(() => children.forEach((child, i) => (child.inert = restored[i])), 0);
}
