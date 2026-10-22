import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../lib/core/grid';
import { getCachedHeight, toVirtualScrollTop } from '../../lib/core/internal/virtualization';
import type { GridConfig } from '../../lib/core/types';

interface Row {
  id: string;
}

const comfortable = (_row: Row, index: number) => [56, 24, 40][index % 3];
const compact = (_row: Row, index: number) => [32, 16, 24][index % 3];

async function fixture(rowHeight: GridConfig<Row>['rowHeight'] = comfortable, count = 90) {
  if (!customElements.get('tbw-grid')) customElements.define('tbw-grid', DataGridElement);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  grid.gridConfig = { columns: [{ field: 'id' }], getRowId: (row) => row.id, rowHeight };
  grid.rows = Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }));
  document.body.append(grid);
  await grid.ready();
  await grid.forceLayout();
  return grid;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('rowHeight replacement anchoring', () => {
  it.each([12, 90])('preserves the authoritative occurrence and suffix cache with %i rows', async (count) => {
    const grid = await fixture(comfortable, count);
    const index = count === 12 ? 3 : 30;
    grid.scrollToRow(index, { align: 'start' });
    grid._virtualization.container!.scrollTop += 7;
    grid.gridConfig = { ...grid.gridConfig, rowHeight: compact };
    await grid.forceLayout();
    expect(grid._virtualization.positionCache?.[index].offset).toBe(index * 24);
    expect(grid._virtualization.container!.scrollTop).toBe(index * 24 + 7);
    expect(grid._virtualization.scrollMapping.rawContentHeight).toBe(count * 24);
  });

  it.each([56, comfortable])('preserves position when switching numeric/callback modes from %s', async (height) => {
    const grid = await fixture(height);
    grid.scrollToRow(30, { align: 'start' });
    grid.gridConfig = { ...grid.gridConfig, rowHeight: typeof height === 'number' ? compact : 32 };
    await grid.forceLayout();
    expect(grid._virtualization.container!.scrollTop).toBe(typeof height === 'number' ? 720 : 960);
  });

  it('uses the final coalesced configuration and clamps an oversized intra-row offset', async () => {
    const grid = await fixture();
    grid.scrollToRow(30, { align: 'start' });
    grid._virtualization.container!.scrollTop += 55;
    grid.gridConfig = { ...grid.gridConfig, rowHeight: 42 };
    await Promise.resolve();
    grid.gridConfig = { ...grid.gridConfig, rowHeight: compact };
    await grid.forceLayout();
    expect(grid._virtualization.container!.scrollTop).toBe(751);
  });

  it('does not revive an occurrence removed before the new row model is rendered', async () => {
    const grid = await fixture();
    grid.scrollToRow(30, { align: 'start' });
    grid.gridConfig = { ...grid.gridConfig, rowHeight: compact };
    grid.sourceRows.splice(30, 1);
    await grid.forceLayout();
    expect(grid.getRow('row-30')).toBeUndefined();
    expect(grid._virtualization.container!.scrollTop).toBe(1200);
  });

  it.each(['before', 'after'] as const)('excludes source replacement %s the config setter', async (order) => {
    const grid = await fixture();
    grid.scrollToRow(30, { align: 'start' });
    if (order === 'before') grid.rows = [...grid.sourceRows];
    grid.gridConfig = { ...grid.gridConfig, rowHeight: compact };
    if (order === 'after') grid.rows = [...grid.sourceRows];
    await grid.forceLayout();
    expect(grid._virtualization.container!.scrollTop).toBe(1200);
  });

  it.each(['id', 'index', 'pixel'] as const)('gives newer explicit %s scrolling priority', async (intent) => {
    const grid = await fixture();
    grid.scrollToRow(30, { align: 'start' });
    grid.gridConfig = { ...grid.gridConfig, rowHeight: compact };
    if (intent === 'id') grid.scrollToRowById('row-30', { align: 'start' });
    if (intent === 'index') grid.scrollToRow(30, { align: 'start' });
    if (intent === 'pixel') grid._virtualization.container!.scrollTop = 1000;
    await grid.forceLayout();
    expect(grid._virtualization.container!.scrollTop).toBe(intent === 'pixel' ? 1000 : 1200);
  });

  it('keeps undefined callback results on the existing default fallback', async () => {
    const grid = await fixture();
    grid.scrollToRow(30, { align: 'start' });
    const fallback = grid.defaultRowHeight;
    const expected =
      getCachedHeight(grid._virtualization.heightCache, grid.rows[30], grid.gridConfig.getRowId) ?? fallback;
    grid.gridConfig = { ...grid.gridConfig, rowHeight: () => undefined };
    await grid.forceLayout();
    // Persisted measurements retain precedence over the fallback estimate.
    expect(grid._virtualization.positionCache?.[30].height).toBe(expected);
    expect(grid.defaultRowHeight).toBe(fallback);
    expect(grid._virtualization.container!.scrollTop).toBe(grid._virtualization.positionCache?.[30].offset);
  });

  it('maps the preserved occurrence through capped scroll coordinates', async () => {
    const grid = await fixture(500_000);
    grid.scrollToRow(30, { align: 'start' });
    expect(grid._virtualization.scrollMapping.capped).toBe(true);
    grid.gridConfig = { ...grid.gridConfig, rowHeight: 1_000_000 };
    await grid.forceLayout();
    expect(
      toVirtualScrollTop(grid._virtualization.container!.scrollTop, grid._virtualization.scrollMapping),
    ).toBeCloseTo(30_000_000);
  });

  it('drops pending restoration on teardown', async () => {
    const grid = await fixture();
    grid.scrollToRow(30, { align: 'start' });
    grid.gridConfig = { ...grid.gridConfig, rowHeight: compact };
    const scrollbar = grid._virtualization.container!;
    grid.remove();
    await Promise.resolve();
    expect(scrollbar.scrollTop).toBe(1200);
  });
});
