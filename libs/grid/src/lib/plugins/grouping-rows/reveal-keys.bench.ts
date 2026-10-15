import { bench, describe } from 'vitest';
import { collectVisibleRowKeys } from './grouping-rows';
import type { RenderRow } from './types';

describe('group reveal occurrence comparison', () => {
  for (const count of [1_000, 10_000]) {
    const expanded: RenderRow[] = Array.from({ length: count }, (_, rowIndex) => ({
      kind: 'data',
      row: { id: `parent/item-${rowIndex}` },
      rowIndex,
    }));
    const collapsed = expanded.slice(count / 2);
    const keyOf = (item: RenderRow) => (item.kind === 'data' ? item.row.id : item.key);
    const pending = new Set<unknown>();
    const visible = collectVisibleRowKeys(expanded, new Set(), pending, keyOf);
    const survivors = collectVisibleRowKeys(collapsed, visible, pending, keyOf);
    if (pending.size !== 0) throw new Error('Collapse must not reveal survivors');
    bench(`${count} occurrences — collapse and re-expand`, () => {
      collectVisibleRowKeys(collapsed, visible, pending, keyOf);
      collectVisibleRowKeys(expanded, survivors, pending, keyOf);
      if (pending.size !== count / 2) throw new Error('Every invocation must reveal removed occurrences');
    });
  }
});
