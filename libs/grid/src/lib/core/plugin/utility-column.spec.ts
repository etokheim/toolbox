import { describe, expect, it, vi } from 'vitest';
import { mergeColumns } from '../internal/columns';
import type { ColumnConfig } from '../types';
import {
  createExpanderColumnConfig,
  createUtilityColumn,
  EXPANDER_COLUMN_FIELD,
  getUtilityColumnOwner,
  isExpanderColumn,
  isUtilityColumn,
  removeOrphanedUtilityColumns,
  removeUtilityColumn,
  upsertUtilityColumn,
} from './utility-column';

describe('utility columns', () => {
  const owner = { name: 'test' };
  const field = '__test';
  const create = () => createUtilityColumn(field, 32, owner);

  it('constructs locked, non-data columns without publishing ownership in JSON', () => {
    const column = create();
    expect(column).toMatchObject({
      field,
      header: '',
      width: 32,
      resizable: false,
      sortable: false,
      filterable: false,
      lockPosition: true,
      utility: true,
    });
    expect(getUtilityColumnOwner(column)).toBe(owner);
    expect(JSON.parse(JSON.stringify(column))).not.toHaveProperty('owner');
    expect(isUtilityColumn(column)).toBe(true);
    expect(getUtilityColumnOwner({ field, utility: true })).toBeUndefined();
  });

  it('preserves ownership through column spreads and the real DOM/programmatic merge', () => {
    const column = { ...create(), width: 61, hidden: true };
    const [merged] = mergeColumns([column], [{ field, header: 'Utility' }]);
    expect(getUtilityColumnOwner(merged)).toBe(owner);
    expect(merged.width).toBe(61);
    expect(merged.hidden).toBe(true);
    expect(removeOrphanedUtilityColumns([merged], [])).toEqual([]);
  });

  it('recognizes ownership across independently evaluated helper modules', async () => {
    const column = create();
    vi.resetModules();
    const independent = await import('./utility-column');
    expect(independent.getUtilityColumnOwner(column)).toBe(owner);
    expect(independent.removeOrphanedUtilityColumns([column], [])).toEqual([]);
  });

  it('keeps the legacy expander identity and metadata', () => {
    const column = createExpanderColumnConfig(owner);
    expect(column).toMatchObject({
      field: EXPANDER_COLUMN_FIELD,
      width: 32,
      meta: { expanderColumn: true, expanderPlugin: 'test' },
    });
    expect(isExpanderColumn(column)).toBe(true);
    expect(isExpanderColumn({ field: 'name' })).toBe(false);
    expect(isUtilityColumn({ field: 'name' })).toBe(false);
  });

  it.each([
    ['start', [field, 'name', 'age']],
    ['end', ['name', 'age', field]],
    [{ after: 'name' }, ['name', field, 'age']],
    [{ after: 'missing' }, [field, 'name', 'age']],
  ] as const)('inserts at %j without mutating the source', (position, expected) => {
    const columns = [{ field: 'name' }, { field: 'age' }];
    const result = upsertUtilityColumn(columns, field, create, position);
    expect(result.map((column) => column.field)).toEqual(expected);
    expect(columns.map((column) => column.field)).toEqual(['name', 'age']);
  });

  it('retains existing state and position without recreating a utility', () => {
    const column = { ...create(), width: 57, hidden: true };
    const columns = [{ field: 'name' }, column];
    const factory = vi.fn(create);
    const result = upsertUtilityColumn(columns, field, factory, 'start');
    expect(result).toEqual(columns);
    expect(result[1]).toBe(column);
    expect(factory).not.toHaveBeenCalled();
    expect(upsertUtilityColumn(result, field, factory, 'end')).toEqual(result);
  });

  it('does not adopt or remove a consumer column with a reserved field', () => {
    const column: ColumnConfig = { field, utility: true, meta: { owner: 'test' } };
    const result = upsertUtilityColumn([column], field, create, 'start');
    expect(result).toEqual([column]);
    expect(getUtilityColumnOwner(result[0])).toBeUndefined();
    expect(removeUtilityColumn(result, owner)).toEqual([column]);
    expect(removeOrphanedUtilityColumns(result, [])).toEqual([column]);
  });

  it('removes only columns belonging to a disabled or detached owner', () => {
    const other = { name: 'other' };
    const columns = [create(), createUtilityColumn('__other', 40, other), { field: 'actions', utility: true }];
    expect(removeUtilityColumn(columns, owner)).toEqual(columns.slice(1));
    expect(removeOrphanedUtilityColumns(columns, [other])).toEqual(columns.slice(1));
    expect(removeOrphanedUtilityColumns(columns, [owner, other])).toEqual(columns);
    expect(removeOrphanedUtilityColumns(columns, [{ name: 'test' }, other])).toEqual(columns.slice(1));
  });
});
