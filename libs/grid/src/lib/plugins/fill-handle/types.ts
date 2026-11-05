import type { ColumnConfig } from '../../core/types';
import type { CellRange } from '../selection/types';

/** Fill direction relative to the source range. @since 3.11.0 */
export type FillDirection = 'up' | 'down';

/**
 * `auto` infers numeric, calendar and timestamp series; `copy` repeats the source.
 * @since 3.11.0
 */
export type FillMode = 'auto' | 'copy';

/**
 * Vertical fill request in processed (displayed) row/visible-column indices.
 * `targetRow` below the source fills down; above it fills up; inside it is a no-op.
 * @since 3.11.0
 */
export interface FillRequest {
  source: CellRange;
  targetRow: number;
}

/** Input to {@link FillHandleConfig.fillValue}. @since 3.11.0 */
export interface FillValueContext<TRow = unknown> {
  row: TRow;
  rowIndex: number;
  field: string;
  column: ColumnConfig<TRow>;
  /** Source values for this column, top to bottom. */
  sourceValues: readonly unknown[];
  direction: FillDirection;
  /** 1-based distance from the source edge, counted over data rows. */
  offset: number;
  oldValue: unknown;
  /** Value inferred by `mode`. */
  proposedValue: unknown;
}

/** Replacement value, or a rejection reported for this cell. @since 3.11.0 */
export type FillValueDecision = { value: unknown } | { reject: string };

/** FillHandle options. Requires range Selection, Editing and UndoRedo. @since 3.11.0 */
export interface FillHandleConfig<TRow = unknown> {
  /**
   * Series inference.
   * @default 'auto'
   */
  mode?: FillMode;
  /** Per-cell override or veto, called after inference for eligible targets. */
  fillValue?: (context: FillValueContext<TRow>) => FillValueDecision;
}

/** Per-target outcome; `rowIndex` describes the row order at gesture start. @since 3.11.0 */
export interface FillCellResult<TRow = unknown> {
  row: TRow;
  rowIndex: number;
  field: string;
  status: 'filled' | 'skipped' | 'rejected';
  reason?: 'readonly' | 'unavailable' | 'out-of-range' | 'unchanged' | 'conflict' | 'rule' | 'validation';
  message?: string;
}

/** Cancelable `fill-start` detail. @since 3.11.0 */
export interface FillStartDetail {
  request: FillRequest;
  direction: FillDirection;
}

/** `fill-complete` outcome. @since 3.11.0 */
export interface FillCompleteDetail<TRow = unknown> extends FillStartDetail {
  /** Empty when canceled or when the 10,000-target-cell limit is exceeded. */
  cells: FillCellResult<TRow>[];
  limitExceeded: boolean;
  /** `fill-start` was prevented, or rows/columns changed since the gesture started. */
  canceled: boolean;
}

declare module '../../core/types' {
  interface UpdateSourceMap {
    /** FillHandle series writes. @since 3.11.0 */
    fill: true;
  }

  interface DataGridEventMap<TRow> {
    /** Before a fill writes; `preventDefault()` cancels it. @since 3.11.0 */
    'fill-start': FillStartDetail;
    /** Filled/skipped/rejected outcomes, cancellation or oversize rejection. @since 3.11.0 */
    'fill-complete': FillCompleteDetail<TRow>;
  }
}
