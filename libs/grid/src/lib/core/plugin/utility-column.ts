import type { ColumnConfig } from '../types';

// Plugin entries are bundled independently. A registry symbol survives those
// module boundaries and column spreads without leaking ownership into JSON state.
const UTILITY_COLUMN_OWNER = Symbol.for('tbw.grid.utility-column-owner');

type ManagedColumn = ColumnConfig & { [UTILITY_COLUMN_OWNER]?: object };
type UtilityColumnPosition = 'start' | 'end' | { after: string };

export const EXPANDER_COLUMN_FIELD = '__tbw_expander';
export const EXPANDER_COLUMN_WIDTH = 32;

/** Internal ownership is distinct from the public, consumer-settable utility flag. */
export function getUtilityColumnOwner(column: ColumnConfig): object | undefined {
  return (column as ManagedColumn)[UTILITY_COLUMN_OWNER];
}

export function isUtilityColumn(column: ColumnConfig): boolean {
  return column.utility === true;
}

export function isExpanderColumn(column: ColumnConfig): boolean {
  return column.field === EXPANDER_COLUMN_FIELD;
}

export function createUtilityColumn(field: string, width: number, owner: object): ColumnConfig {
  const column: ManagedColumn = {
    field,
    header: '',
    width,
    resizable: false,
    sortable: false,
    filterable: false,
    lockPosition: true,
    utility: true,
    [UTILITY_COLUMN_OWNER]: owner,
  };
  return column;
}

/** Retain the expander's legacy metadata for existing plugin/CSS integrations. */
export function createExpanderColumnConfig(owner: { name: string }): ColumnConfig {
  return {
    ...createUtilityColumn(EXPANDER_COLUMN_FIELD, EXPANDER_COLUMN_WIDTH, owner),
    meta: { expanderColumn: true, expanderPlugin: owner.name },
  };
}

/** Preserve an existing column and its runtime state; only new columns get placed. */
export function upsertUtilityColumn(
  columns: readonly ColumnConfig[],
  field: string,
  create: () => ColumnConfig,
  position: UtilityColumnPosition,
): ColumnConfig[] {
  const result = columns.slice();
  if (result.some((column) => column.field === field)) return result;

  const index =
    position === 'end'
      ? result.length
      : position === 'start'
        ? 0
        : result.findIndex((column) => column.field === position.after) + 1;
  result.splice(index, 0, create());
  return result;
}

export function removeUtilityColumn(columns: readonly ColumnConfig[], owner: object): ColumnConfig[] {
  return columns.filter((column) => getUtilityColumnOwner(column) !== owner);
}

/** Runs before hidden columns are separated, including when no producer remains. */
export function removeOrphanedUtilityColumns<T extends ColumnConfig>(
  columns: readonly T[],
  activeOwners: readonly object[],
): T[] {
  return columns.filter((column) => {
    const owner = getUtilityColumnOwner(column);
    return !owner || activeOwners.includes(owner);
  });
}
