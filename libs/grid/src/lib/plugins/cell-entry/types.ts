import type { ColumnConfig } from '../../core/types';

/** Opt-in single-cell activation. Requires Editing in manual row mode and cell/range Selection.
 * @since 3.9.0
 */
export interface CellEntryConfig {
  /**
   * A plain primary click selects and edits one cell. Modified clicks, range
   * drags, long presses and interactive controls remain selection/native actions.
   * Keyboard Enter/F2 entry is available whenever CellEntry is enabled.
   * @default false
   * @since 3.9.0
   */
  singleClick?: boolean;

  /**
   * Delete/Backspace clears the selected cell ranges through Editing.
   * Requires UndoRedo. Unmodified keys only; native controls keep their keys.
   * @default false
   * @since 3.10.0
   */
  clearOnDelete?: boolean;
}

/** Input to a column's explicit clear-value rule. @since 3.10.0 */
export interface CellClearContext<TRow = unknown> {
  row: TRow;
  rowIndex: number;
  field: string;
  column: ColumnConfig<TRow>;
  value: unknown;
}

/** Explicit replacement, or a consumer rejection with a reason. @since 3.10.0 */
export type CellClearValue = { value: unknown } | { reject: string };

/** Per-cell outcome; coordinates describe the initial selection. @since 3.10.0 */
export interface CellClearResult<TRow = unknown> {
  row: TRow;
  rowIndex: number;
  field: string;
  status: 'cleared' | 'skipped' | 'rejected';
  reason?: 'readonly' | 'unavailable' | 'unsupported-type' | 'unchanged' | 'rule' | 'validation';
  message?: string;
}

/** Result of one bounded selected-cell clearing action. @since 3.10.0 */
export interface CellClearDetail<TRow = unknown> {
  /** Empty when the 10,000-unique-cell limit is exceeded; nothing is written. */
  cells: CellClearResult<TRow>[];
  limitExceeded: boolean;
}

declare module '../../core/types' {
  interface ColumnConfig<TRow> {
    /**
     * Overrides nullable/text clear defaults. Return a replacement or rejection.
     * Called only for eligible selected cells when `clearOnDelete` is enabled.
     * @since 3.10.0
     */
    clearValue?: (context: CellClearContext<TRow>) => CellClearValue;
  }

  interface UpdateSourceMap {
    /** Selected-cell Delete/Backspace. @since 3.10.0 */
    clear: true;
  }

  interface DataGridEventMap<TRow> {
    /** Accepted/skipped/rejected outcomes, or oversize rejection. @since 3.10.0 */
    'cell-clear': CellClearDetail<TRow>;
  }
}
