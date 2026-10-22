import { describe, expect, it, vi } from 'vitest';
import { applyRowFlow, type RowFlow } from './row-flow';
import { getTotalHeight, updateRowHeight, updateRowHeights } from './virtualization';

describe('non-data row flow extents', () => {
  it('retains data surface heights and gaps through single and batched measurements', () => {
    const cache = [0, 1, 2].map((index) => ({ offset: index * 24, height: 24, measured: false }));
    const flow: RowFlow = {
      prepare: vi.fn(),
      layout: vi.fn(),
      bottom: () => 0,
      emptyHeight: () => 0,
      after: (index) => (index === 0 ? 40 : index === 2 ? 24 : 0),
    };
    applyRowFlow(cache, flow);
    expect(cache.map((entry) => entry.offset)).toEqual([0, 64, 88]);
    expect(getTotalHeight(cache)).toBe(136);
    updateRowHeight(cache, 0, 32);
    updateRowHeights(cache, [{ index: 1, height: 40 }]);
    expect(cache.map((entry) => entry.offset)).toEqual([0, 72, 112]);
    expect(getTotalHeight(cache)).toBe(160);
    expect(cache.map((entry) => entry.height)).toEqual([32, 40, 24]);
  });
});
