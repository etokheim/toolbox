import { bench, describe } from 'vitest';
import type { ColumnConfig } from '../types';
import { createUtilityColumn, removeOrphanedUtilityColumns, upsertUtilityColumn } from './utility-column';

describe('utility columns (200 data columns)', () => {
  const columns: ColumnConfig[] = Array.from({ length: 200 }, (_, index) => ({
    field: `field${index}`,
    width: 100,
    hidden: index % 5 === 0,
  }));
  const owners = [{}, {}, {}];
  const fields = ['__expander', '__checkbox', '__drag'];
  const factories = fields.map((field, index) => () => createUtilityColumn(field, 32, owners[index]));
  const managed = [factories[0](), factories[1](), ...columns, factories[2]()];

  bench('construct and insert leading, anchored and trailing utilities', () => {
    let result = upsertUtilityColumn(columns, fields[0], factories[0], 'start');
    result = upsertUtilityColumn(result, fields[1], factories[1], { after: fields[0] });
    upsertUtilityColumn(result, fields[2], factories[2], 'end');
  });

  bench('reprocess existing utilities without recreating them', () => {
    let result = removeOrphanedUtilityColumns(managed, owners);
    for (let index = 0; index < fields.length; index++) {
      result = upsertUtilityColumn(result, fields[index], factories[index], 'start');
    }
  });

  bench('prune detached utility owners', () => {
    removeOrphanedUtilityColumns(managed, []);
  });
});
