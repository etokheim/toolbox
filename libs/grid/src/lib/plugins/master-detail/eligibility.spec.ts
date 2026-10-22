import { afterEach, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { GroupingRowsPlugin } from '../grouping-rows/grouping-rows-plugin';
import { TreePlugin } from '../tree/tree-plugin';
import { MasterDetailPlugin } from './master-detail-plugin';
import type { MasterDetailDisclosureContext } from './types';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

it('applies eligibility to API, native disclosures, clicks, keyboard and heights', async () => {
  const rows = [
    { id: 'yes', eligible: true },
    { id: 'no', eligible: false },
    { id: 'loading', eligible: true, __loading: true },
  ];
  const detail = new MasterDetailPlugin<(typeof rows)[number]>({
    hasDetail: (row) => row.eligible,
    animation: false,
    expandOnRowClick: true,
    detailHeight: 80,
    detailRenderer: () => document.createElement('div'),
  });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  grid.gridConfig = { columns: [{ field: 'id' }], plugins: [detail] };
  grid.rows = rows;
  document.body.append(grid);
  await grid.ready();
  await nextFrame();
  expect(grid.querySelectorAll('.master-detail-toggle')).toHaveLength(1);
  for (const index of [1, 2]) {
    detail.expand(index);
    detail.toggle(index);
    expect(detail.isExpanded(index)).toBe(false);
    expect(detail.getRowHeight(rows[index], index)).toBeUndefined();
  }
  const deniedCell = grid.querySelector<HTMLElement>('.cell[data-row="1"][data-field="id"]')!;
  deniedCell.click();
  await nextFrame();
  expect(detail.getExpandedRows()).toEqual([]);
  grid._focusRow = 1;
  grid._focusCol = 0;
  const key = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
  expect(detail.onKeyDown(key)).toBeUndefined();
  expect(key.defaultPrevented).toBe(false);
  detail.expandAll();
  await nextFrame();
  expect(detail.getExpandedRows()).toEqual([0]);
  expect(detail.getRowHeight(rows[0], 0)).toBe((grid.defaultRowHeight ?? 28) + 80);
  expect(detail.getDetailElement(0)).toBeDefined();
  rows[0].eligible = false;
  grid.requestRender();
  await nextFrame();
  expect(detail.getExpandedRows()).toEqual([]);
  expect(detail.getDetailElement(0)).toBeUndefined();
  expect(detail.getRowHeight(rows[0], 0)).toBeUndefined();
  expect(grid.querySelectorAll('.master-detail-toggle')).toHaveLength(0);
});

it('disposes newly ineligible custom controls and rejects their retained actions', async () => {
  const row = { id: 'row', eligible: true };
  const contexts: MasterDetailDisclosureContext<typeof row>[] = [];
  const dispose = vi.fn();
  const detail = new MasterDetailPlugin<typeof row>({
    hasDetail: (candidate) => candidate.eligible,
    animation: false,
    detailRenderer: () => document.createElement('div'),
    disclosureRenderer: (initial) => {
      const element = document.createElement('button');
      const update = (ctx: MasterDetailDisclosureContext<typeof row>) => {
        contexts.push(ctx);
        element.textContent = ctx.ariaLabel;
        element.onclick = () => ctx.setExpanded(!ctx.expanded);
      };
      update(initial);
      return { element, update, dispose };
    },
  });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  grid.gridConfig = { columns: [{ field: 'id' }], plugins: [detail] };
  grid.rows = [row];
  document.body.append(grid);
  await grid.ready();
  await nextFrame();
  const stale = contexts.at(-1)!;
  stale.setExpanded(true);
  await nextFrame();
  expect(detail.isExpanded(0)).toBe(true);
  row.eligible = false;
  stale.setExpanded(true);
  grid.requestRender();
  await nextFrame();
  expect(detail.isExpanded(0)).toBe(false);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(grid.querySelector('.master-detail-expander button')).toBeNull();
  row.eligible = true;
  grid.requestRender();
  await nextFrame();
  stale.setExpanded(true);
  expect(detail.isExpanded(0)).toBe(false);
  contexts.at(-1)!.setExpanded(true);
  expect(detail.isExpanded(0)).toBe(true);
});

it.each([false, true])('keeps Tree, group and detail actions independent (reverse order: %s)', async (reverse) => {
  const source = [{ id: 'parent', name: 'Parent', children: [{ id: 'child', name: 'Child', kind: 'Shared' }] }];
  const tree = new TreePlugin({ defaultExpanded: true, treeColumn: 'name' });
  const grouping = new GroupingRowsPlugin({
    groupOn: (row, { parent }) => (parent === null ? null : row.kind),
    defaultExpanded: true,
  });
  const detail = new MasterDetailPlugin({
    animation: false,
    hasDetail: (row) => typeof row === 'object' && row !== null && 'id' in row && row.id === 'parent',
    detailRenderer: () => document.createElement('div'),
  });
  const plugins = [tree, grouping, detail];
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  grid.gridConfig = { columns: [{ field: 'name' }], plugins: reverse ? plugins.reverse() : plugins };
  grid.rows = source;
  document.body.append(grid);
  await grid.ready();
  await nextFrame();
  expect(grid.querySelectorAll('.master-detail-toggle')).toHaveLength(1);
  const parent = grid.querySelector<HTMLElement>('.rows > .data-grid-row')!;
  const treeToggle = parent.querySelector<HTMLElement>('.tree-toggle')!;
  const detailToggle = parent.querySelector<HTMLElement>('.master-detail-toggle')!;
  expect(treeToggle).not.toBeNull();
  expect(detailToggle).not.toBeNull();
  expect(treeToggle.getAttribute('aria-label')).not.toBe(detailToggle.getAttribute('aria-label'));
  detailToggle.click();
  await nextFrame();
  expect(detail.isExpanded(0)).toBe(true);
  expect(tree.isExpanded('parent')).toBe(true);
  expect(parent.nextElementSibling).toBe(detail.getDetailElement(0));
  grouping.toggle(JSON.stringify(['parent', ['Shared']]));
  await nextFrame();
  expect(detail.isExpanded(0)).toBe(true);
  expect(tree.isExpanded('parent')).toBe(true);
  grid.querySelector<HTMLElement>('.rows > .data-grid-row .tree-toggle')!.click();
  await nextFrame();
  expect(tree.isExpanded('parent')).toBe(false);
  expect(detail.isExpanded(0)).toBe(true);
  expect(parent.classList.contains('tbw-row-expanded')).toBe(true);
  detail.collapse(0);
  await nextFrame();
  expect(detail.isExpanded(0)).toBe(false);
  expect(tree.isExpanded('parent')).toBe(false);
  expect(parent.classList.contains('tbw-row-expanded')).toBe(false);
  tree.expand('parent');
  detail.expand(0);
  await nextFrame();
  detail.detach();
  expect(parent.classList.contains('tbw-detail-expanded')).toBe(false);
  expect(parent.classList.contains('tbw-row-expanded')).toBe(true);
  expect(parent.querySelector('.tree-toggle')).not.toBeNull();
  expect(detail.getDetailElement(0)).toBeUndefined();
});

it('replaces eligibility callbacks through config and preserves omitted defaults', async () => {
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  const configure = (hasDetail?: (row: { id: string }) => boolean) => {
    grid.gridConfig = {
      columns: [{ field: 'id' }],
      plugins: [new MasterDetailPlugin({ hasDetail, detailRenderer: () => '<div>Detail</div>', animation: false })],
    };
  };
  configure(() => true);
  grid.rows = [{ id: 'one' }, { id: 'two' }];
  document.body.append(grid);
  await grid.ready();
  await nextFrame();
  grid.getPluginByName('masterDetail')!.expandAll();
  await nextFrame();
  configure((row) => row.id === 'two');
  await vi.waitFor(() => expect(grid.querySelectorAll('.master-detail-toggle')).toHaveLength(1));
  grid.getPluginByName('masterDetail')!.expandAll();
  expect(grid.getPluginByName('masterDetail')!.getExpandedRows()).toEqual([1]);
  configure();
  await vi.waitFor(() => expect(grid.querySelectorAll('.master-detail-toggle')).toHaveLength(2));
});

async function expandedDetail(detailHeight: number | 'auto' = 80) {
  const rows = [
    { id: 'first', eligible: true },
    { id: 'second', eligible: true },
  ];
  const detail = new MasterDetailPlugin<(typeof rows)[number]>({
    hasDetail: (row) => row.eligible,
    animation: false,
    detailHeight,
    detailRenderer: () => document.createElement('div'),
  });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  grid.gridConfig = { columns: [{ field: 'id' }], plugins: [detail] };
  grid.rows = rows;
  document.body.append(grid);
  await grid.ready();
  await nextFrame();
  detail.expand(0);
  await vi.waitFor(() => expect(detail.getDetailElement(0)?.isConnected).toBe(true));
  return { grid, detail, rows };
}

it.each([false, true])(
  'rejects stale eligibility in virtual-start calculation (position cache: %s)',
  async (cached) => {
    const { grid, detail, rows } = await expandedDetail();
    const height = grid.defaultRowHeight;
    // happy-dom has no layout; supply the position cache consumed by this public hook.
    grid._virtualization.positionCache = cached
      ? [
          { offset: 0, height: height + 80, measured: true },
          { offset: height + 80, height, measured: true },
        ]
      : [];
    expect(detail.adjustVirtualStart(1, height + 20, height)).toBe(0);
    expect(detail.adjustVirtualStart(1, height + 81, height)).toBe(1);
    rows[0].eligible = false;
    expect(detail.adjustVirtualStart(1, height + 20, height)).toBe(1);
    expect(detail.getRowHeight(rows[0], 0)).toBeUndefined();
    grid.requestRender();
    await vi.waitFor(() => expect(grid.querySelector('.master-detail-row')).toBeNull());
    expect(detail.getExpandedRows()).toEqual([]);
  },
);

it.each([false, true])('retires measured-height-only eligibility (row removed: %s)', async (removed) => {
  const { grid, detail, rows } = await expandedDetail('auto');
  const original = detail.getDetailElement(0)!;
  const unmeasuredHeight = detail.getRowHeight(rows[0], 0);
  Object.defineProperty(original, 'offsetHeight', { value: 240, configurable: true });
  expect(detail.getRowHeight(rows[0], 0)).toBe(grid.defaultRowHeight + 240);
  detail.collapse(0);
  await vi.waitFor(() => expect(original.isConnected).toBe(false));
  expect(detail.getExpandedRows()).toEqual([]);
  const invalidate = vi.spyOn(grid, 'invalidateRowHeight');
  rows[0].eligible = false;
  if (removed) grid.rows = [rows[1]];
  grid.requestRender();
  await nextFrame();
  await nextFrame();
  expect(invalidate).not.toHaveBeenCalledWith(-1);
  if (!removed) expect(invalidate).toHaveBeenCalledWith(0);

  rows[0].eligible = true;
  grid.rows = rows;
  await vi.waitFor(() => expect(grid.querySelector('.cell[data-row="0"][data-field="id"]')?.textContent).toBe('first'));
  detail.expand(0);
  await vi.waitFor(() => expect(detail.getDetailElement(0)?.isConnected).toBe(true));
  expect(detail.getDetailElement(0)).not.toBe(original);
  expect(detail.getRowHeight(rows[0], 0)).toBe(unmeasuredHeight);
});

it('prunes detail DOM in the click microtask before eligibility reconciliation', async () => {
  const { grid, detail, rows } = await expandedDetail();
  const element = detail.getDetailElement(0)!;
  const afterRender = vi.spyOn(detail, 'afterRender');
  const onScrollRender = vi.spyOn(detail, 'onScrollRender');
  const cell = grid.querySelector<HTMLElement>('.cell[data-row="0"][data-field="id"]')!;
  cell.click();
  afterRender.mockClear();
  onScrollRender.mockClear();
  rows[0].eligible = false;
  await Promise.resolve();
  expect(afterRender).not.toHaveBeenCalled();
  expect(onScrollRender).not.toHaveBeenCalled();
  expect(element.isConnected).toBe(false);
  expect(cell.closest('.data-grid-row')?.classList.contains('tbw-detail-expanded')).toBe(false);
  expect(detail.getRowHeight(rows[0], 0)).toBeUndefined();
  grid.requestRender();
  await vi.waitFor(() => expect(grid.querySelector('.cell[data-row="0"] .master-detail-toggle')).toBeNull());
});
