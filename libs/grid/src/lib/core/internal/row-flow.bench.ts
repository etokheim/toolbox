import { bench, describe } from 'vitest';
import { applyRowFlow, type RowFlow } from './row-flow';
import { createHeightCache, getTotalHeight, rebuildPositionCache } from './virtualization';

const flow: RowFlow = {
  prepare: () => undefined,
  layout: () => undefined,
  bottom: () => 40,
  emptyHeight: () => 0,
  after: (index) => (index % 20 === 19 ? 40 : 0),
};

describe('non-data extent rebuild', () => {
  for (const count of [1_000, 10_000]) {
    const rows = Array.from({ length: count }, (_, id) => ({ id }));
    const heights = createHeightCache();
    bench(`${count} rows with scoped gaps`, () => {
      const cache = rebuildPositionCache(rows, heights, 24, {});
      applyRowFlow(cache, flow);
      if (getTotalHeight(cache) !== count * 26) throw new Error('Missing non-data extents');
    });
    bench(`${count} rows without scoped gaps`, () => {
      const cache = rebuildPositionCache(rows, heights, 24, {});
      if (getTotalHeight(cache) !== count * 24) throw new Error('Incorrect data extents');
    });
  }
});
