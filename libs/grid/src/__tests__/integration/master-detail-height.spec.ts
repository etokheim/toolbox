import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../lib/core/grid';
import { getTotalHeight } from '../../lib/core/internal/virtualization';
import type { GridConfig } from '../../lib/core/types';
import { MasterDetailPlugin } from '../../lib/plugins/master-detail';

interface Row {
  id: number;
  height?: number;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function fixture(count: number, rowHeight?: GridConfig<Row>['rowHeight']) {
  if (!customElements.get('tbw-grid')) customElements.define('tbw-grid', DataGridElement);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('rows-viewport') ? 120 : 148;
  });
  const plugin = new MasterDetailPlugin({
    animation: false,
    detailHeight: 109,
    detailRenderer: () => document.createElement('div'),
  });
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  grid.gridConfig = { columns: [{ field: 'id' }], getRowId: (row) => String(row.id), rowHeight, plugins: [plugin] };
  grid.rows = Array.from({ length: count }, (_, id) => ({ id, height: id === 0 ? 56 : 36 }));
  document.body.append(grid);
  await customElements.whenDefined('tbw-grid');
  await grid.ready();
  await frame();
  await frame();
  return { grid, plugin };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('MasterDetail base and detail height accounting', () => {
  it.each([4, 40])('uses occurrence callback heights in the %i-row position cache and spacer', async (count) => {
    const callback = vi.fn((row: Row, index: number) => row.height! + index);
    const { grid, plugin } = await fixture(count, callback);
    plugin.expand(0);
    await frame();
    grid.refreshVirtualWindow(true);
    expect(plugin.getRowHeight(grid.rows[0], 0)).toBe(165);
    expect(callback).toHaveBeenCalledWith(grid.rows[0], 0);
    const state = grid._virtualization;
    expect(state.positionCache?.[0].height).toBe(165);
    expect(state.positionCache?.[1].offset).toBe(165);
    expect(state.positionCache?.[2].offset).toBe(202);
    const total = 165 + (count - 1) * 36 + (count * (count - 1)) / 2;
    expect(getTotalHeight(state.positionCache!)).toBe(total);
    expect(state.scrollMapping.rawContentHeight).toBe(total);
    expect(parseFloat(state.totalHeightEl!.style.height)).toBeGreaterThanOrEqual(total);
    expect(plugin.adjustVirtualStart(1, 164, 28)).toBe(0);
    expect(plugin.adjustVirtualStart(1, 165, 28)).toBe(1);
    expect(grid.querySelector<HTMLElement>('.rows > .data-grid-row')?.style.getPropertyValue('--tbw-row-height')).toBe(
      '56px',
    );
  });

  it.each([56, undefined, () => undefined, () => 0, () => -1])(
    'preserves numeric and default fallback precedence (%s)',
    async (rowHeight) => {
      const { grid, plugin } = await fixture(4, rowHeight);
      plugin.expand(0);
      await frame();
      const base = typeof rowHeight === 'number' ? rowHeight : grid.defaultRowHeight;
      expect(plugin.getRowHeight(grid.rows[0], 0)).toBe(base + 109);
      grid.invalidateRowHeight(0, 211);
      expect(grid._virtualization.positionCache?.[0].height).toBe(211);
      grid.invalidateRowHeight(0);
      expect(grid._virtualization.positionCache?.[0].height).toBe(base + 109);
    },
  );

  it('re-resolves configured bases on open density changes and collapse invalidation', async () => {
    const { grid, plugin } = await fixture(4, (row) => row.height);
    plugin.expand(0);
    await frame();
    grid.gridConfig = { ...grid.gridConfig, rowHeight: (_row: Row, index: number) => 64 + index };
    await frame();
    expect(plugin.getRowHeight(grid.rows[0], 0)).toBe(173);
    await vi.waitFor(() => expect(grid._virtualization.positionCache?.[1].offset).toBe(173));
    plugin.collapse(0);
    grid.invalidateRowHeight(0);
    expect(plugin.getRowHeight(grid.rows[0], 0)).toBeUndefined();
    expect(grid._virtualization.positionCache?.[0].height).toBe(64);
    expect(grid._virtualization.positionCache?.[1].offset).toBe(64);
    await frame();
    plugin.expand(0);
    await frame();
    expect(grid._virtualization.positionCache?.[0].height).toBe(173);
    grid.gridConfig = { ...grid.gridConfig, rowHeight: 72 };
    await frame();
    expect(plugin.getRowHeight(grid.rows[0], 0)).toBe(181);
    await vi.waitFor(() => expect(grid._virtualization.positionCache?.[1].offset).toBe(181));
  });

  it('uses settled measured growth once and retains occurrence identity after reordering', async () => {
    const { grid, plugin } = await fixture(4, (row) => row.height);
    const original = grid.rows[0];
    plugin.expand(0);
    await frame();
    const detail = grid.querySelector<HTMLElement>('.master-detail-row')!;
    expect(detail).not.toBeNull();
    Object.defineProperty(detail, 'offsetHeight', { configurable: true, value: 151 });
    grid.invalidateRowHeight(0);
    expect(plugin.getRowHeight(original, 0)).toBe(207);
    expect(grid._virtualization.positionCache?.[1].offset).toBe(207);
    grid.refreshVirtualWindow(true);
    expect(grid._virtualization.positionCache?.[0].height).toBe(207);
    grid.rows = [...grid.rows].reverse();
    await frame();
    grid.refreshVirtualWindow(true);
    expect(plugin.getRowHeight(grid.rows[0], 0)).toBeUndefined();
    expect(plugin.getRowHeight(original, 3)).toBe(207);
    expect(grid._virtualization.positionCache?.[3]).toMatchObject({ offset: 108, height: 207 });
    grid.remove();
    expect(grid.querySelector('.master-detail-row')).toBeNull();
  });

  it('reconciles the combined cache when a height query measures detail before its scheduled settlement', async () => {
    const { grid, plugin } = await fixture(4, (row) => row.height);
    plugin.expand(0);
    await frame();
    const detail = grid.querySelector<HTMLElement>('.master-detail-row')!;
    Object.defineProperty(detail, 'offsetHeight', { configurable: true, value: 151 });
    expect(plugin.getRowHeight(grid.rows[0], 0)).toBe(207);
    await frame();
    expect(grid._virtualization.positionCache?.[0].height).toBe(207);
    expect(grid._virtualization.positionCache?.[1].offset).toBe(207);
  });
});
