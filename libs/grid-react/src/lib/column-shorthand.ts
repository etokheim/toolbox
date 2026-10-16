/**
 * Column shorthand parsing for `@toolbox-web/grid-react`.
 *
 * Intentionally duplicated across the React, Vue, and Angular adapters so each
 * adapter has zero shared-runtime dependency. Do not extract into a shared
 * package: the helpers are tiny (~100 lines), the duplication keeps each
 * adapter independently tree-shakeable, and a shared package would force
 * consumers to install an extra dep just to import shorthand support.
 *
 * The string-parsing / header-generation logic lives in `@toolbox-web/grid`
 * core (issue #276); these wrappers re-parameterize it with React's widened
 * `ColumnConfig` (JSX `renderer`/`editor`) so mixed shorthand + full column
 * arrays keep their React types.
 */
import {
  parseColumnShorthand as parseColumnShorthandCore,
  type ColumnConfig as NativeColumnConfig,
} from '@toolbox-web/grid';
import type { ColumnConfig } from './react-column-config';

/**
 * Type for column shorthand notation.
 *
 * Supports:
 * - Simple string: `'name'` → `{ field: 'name', header: 'Name' }`
 * - With type: `'salary:number'` → `{ field: 'salary', header: 'Salary', type: 'number' }`
 * - Full config object: `{ field: 'id', header: 'ID', width: 80 }` (passed through)
 * - Native DOM column configs, including DOM-returning renderers and headers.
 *   JSX callbacks need `gridConfig.columns` or a matching `GridColumn` child;
 *   shorthand normalization itself does not wrap renderers.
 *
 * @example
 * ```tsx
 * // All equivalent:
 * columns={['id', 'name', 'email']}
 * columns={['id:number', 'name:string', 'email']}
 * columns={[{ field: 'id' }, { field: 'name' }, { field: 'email' }]}
 * ```
 * @since 0.7.0
 */
export type ColumnShorthand<TRow = unknown> = string | ColumnConfig<TRow> | NativeColumnConfig<TRow>;

/**
 * Parse a column shorthand string into a React `ColumnConfig`.
 *
 * Delegates parsing to `@toolbox-web/grid` core (issue #276). The result only
 * ever carries `field`/`header`/`type`, so it satisfies React's widened column
 * type without a cast.
 *
 * @param shorthand - The shorthand string (e.g., 'name', 'salary:number')
 * @returns A ColumnConfig object
 *
 * @example
 * parseColumnShorthand('name') → { field: 'name', header: 'Name' }
 * parseColumnShorthand('salary:number') → { field: 'salary', header: 'Salary', type: 'number' }
 * @since 0.7.0
 */
export function parseColumnShorthand<TRow = unknown>(shorthand: string): ColumnConfig<TRow> {
  const { field, header, type } = parseColumnShorthandCore<TRow>(shorthand);
  return type === undefined ? { field, header } : { field, header, type };
}

/**
 * Normalize an array of column shorthands to ColumnConfig objects.
 *
 * @param columns - Array of column shorthands (strings or ColumnConfig objects)
 * @returns Array of ColumnConfig objects
 *
 * @example
 * ```tsx
 * normalizeColumns(['id:number', 'name', { field: 'email', width: 200 }])
 * // Returns:
 * // [
 * //   { field: 'id', header: 'ID', type: 'number' },
 * //   { field: 'name', header: 'Name' },
 * //   { field: 'email', width: 200 }
 * // ]
 * ```
 * @since 0.7.0
 */
export function normalizeColumns<TRow = unknown>(columns: (string | ColumnConfig<TRow>)[]): ColumnConfig<TRow>[];
export function normalizeColumns<TRow = unknown>(
  columns: (string | NativeColumnConfig<TRow>)[],
): NativeColumnConfig<TRow>[];
export function normalizeColumns<TRow = unknown>(
  columns: ColumnShorthand<TRow>[],
): (ColumnConfig<TRow> | NativeColumnConfig<TRow>)[];
export function normalizeColumns<TRow = unknown>(
  columns: ColumnShorthand<TRow>[],
): (ColumnConfig<TRow> | NativeColumnConfig<TRow>)[] {
  return columns.map((col) => {
    if (typeof col === 'string') {
      return parseColumnShorthand<TRow>(col);
    }
    return col;
  });
}

/**
 * Apply column defaults to a list of columns. Individual column properties
 * override defaults — the per-column value always wins over the default.
 *
 * @param columns - Normalized columns to merge defaults into
 * @param defaults - Partial column config applied as a baseline; pass `undefined` to no-op
 * @returns A new array with the defaults merged in (input is not mutated)
 *
 * @example
 * ```tsx
 * applyColumnDefaults(
 *   [{ field: 'id' }, { field: 'name', sortable: false }],
 *   { sortable: true, resizable: true },
 * );
 * // [
 * //   { field: 'id',   sortable: true,  resizable: true },
 * //   { field: 'name', sortable: false, resizable: true },
 * // ]
 * ```
 * @since 1.5.0
 */
export function applyColumnDefaults<TRow = unknown>(
  columns: ColumnConfig<TRow>[],
  defaults: Partial<ColumnConfig<TRow>> | undefined,
): ColumnConfig<TRow>[];
export function applyColumnDefaults<TRow = unknown>(
  columns: (ColumnConfig<TRow> | NativeColumnConfig<TRow>)[],
  defaults: Partial<ColumnConfig<TRow>> | undefined,
): (ColumnConfig<TRow> | NativeColumnConfig<TRow>)[];
export function applyColumnDefaults<TRow = unknown>(
  columns: (ColumnConfig<TRow> | NativeColumnConfig<TRow>)[],
  defaults: Partial<ColumnConfig<TRow>> | undefined,
) {
  if (!defaults) return columns;
  return columns.map((col) => ({ ...defaults, ...col }));
}

/**
 * Check if an array of columns contains any shorthand strings.
 *
 * @param columns - Array to check
 * @returns True if any element is a string shorthand
 * @since 0.7.0
 */
export function hasColumnShorthands<TRow>(columns: ColumnShorthand<TRow>[]): boolean {
  return columns.some((col) => typeof col === 'string');
}
