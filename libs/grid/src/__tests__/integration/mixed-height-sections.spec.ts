import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../lib/core/grid';
import type { RowElementInternal } from '../../lib/core/types';
import { GroupingRowsPlugin } from '../../lib/plugins/grouping-rows';
import { StickyRowsPlugin } from '../../lib/plugins/sticky-rows';
import { TreePlugin } from '../../lib/plugins/tree';

interface Row {
  id: string;
  height?: number;
  section?: string;
  children?: Row[];
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function fixture(cargos: number, nested?: HTMLElement) {
  if (!customElements.get('tbw-grid')) customElements.define('tbw-grid', DataGridElement);
  const events: string[] = [];
  const heights = new Map<string, number>();
  const reads = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('data-grid-row')) return 0;
    events.push('measure');
    const row = (this as RowElementInternal).__rowDataRef as Row | undefined;
    return (row && heights.get(row.id)) ?? row?.height ?? 49;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    events.push('geometry');
    return this.classList.contains('rows-viewport') ? 68 : 100;
  });
  const tree = new TreePlugin({ defaultExpanded: true, animation: false });
  const grouping = new GroupingRowsPlugin({
    groupOn: (row: Row, { parent }) => (parent ? row.section : null),
    defaultExpanded: true,
    childGroupsCollapsible: false,
    groupOrder: ({ parent }) => (parent ? ['Cargos', 'Movements', 'Deals'] : undefined),
    animation: false,
    groupRowRenderer: nested
      ? (context) => {
          const cell = document.createElement('div');
          cell.className = 'cell';
          cell.textContent = String(context.value);
          if (context.value === 'Cargos') cell.append(nested);
          return cell;
        }
      : undefined,
  });
  const sticky = new StickyRowsPlugin({
    mode: 'push',
    isSticky: (_row, index) => grouping.getFlattenedRows()[index]?.kind === 'group',
  });
  const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
  grid.gridConfig = { columns: [{ field: 'id' }], getRowId: (row) => row.id, plugins: [tree, grouping, sticky] };
  const roots: Row[] = ['Alpha', 'Beta'].map((id) => ({
    id,
    height: id === 'Alpha' ? 67 : 49,
    children: ['Cargos', 'Movements', 'Deals'].flatMap((section) =>
      Array.from({ length: id === 'Beta' && section === 'Cargos' ? cargos : 1 }, (_, index) => ({
        id: `${id}/${section}/${index}`,
        section,
      })),
    ),
  }));
  grid.rows = roots;
  document.body.append(grid);
  await grid.ready();
  await frame();
  await frame();
  await frame();
  return { grid, grouping, tree, events, heights, reads, roots };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('production mixed-height section measurement', () => {
  it.each([10, 12])('measures owned production cells with %i cargo rows (bypass and virtualized)', async (cargos) => {
    const { grid, grouping } = await fixture(cargos);
    const state = grid._virtualization;
    const rendered = grid.querySelectorAll<HTMLElement>('.rows > .data-grid-row');
    expect(state.variableHeights).toBe(true);
    expect(grouping.getFlattenedRows()).toHaveLength(cargos + 13);
    expect(rendered.length > 1).toBe(true);
    for (const element of rendered) {
      expect(element.hasAttribute('data-row-index')).toBe(false);
      const index = Number(element.querySelector(':scope > .cell')?.getAttribute('data-row'));
      expect(state.positionCache?.[index]).toMatchObject({ height: index === 0 ? 67 : 49, measured: true });
      expect(state.positionCache?.[index].offset).toBe(index === 0 ? 0 : 67 + (index - 1) * 49);
    }
    expect(state.positionCache?.[1].offset).toBe(67);
    if (cargos === 10) expect(state.positionCache?.[8].offset).toBe(410);
  });

  it('keeps measurements through invalidation, rebuilding and both threshold transitions', async () => {
    const { grid, tree, roots, heights } = await fixture(12);
    expect(grid.rows).toHaveLength(25);
    heights.set('Alpha/Cargos/0', 83);
    grid.invalidateRowHeight(2);
    grid.refreshVirtualWindow(true);
    await vi.waitFor(() =>
      expect(grid._virtualization.positionCache?.[2]).toMatchObject({ height: 83, measured: true }),
    );
    tree.collapse('Alpha');
    await vi.waitFor(() => expect(grid.rows).toHaveLength(19));
    expect(grid._virtualization.positionCache?.[2]).toMatchObject({ height: 49, measured: true });
    tree.expand('Alpha');
    await vi.waitFor(() => expect(grid.rows).toHaveLength(25));
    expect(grid._virtualization.positionCache?.[2]).toMatchObject({ height: 83, measured: true });
    grid.rows = [...roots].reverse();
    await vi.waitFor(() => expect(grid.rows[0].id).toBe('Beta'));
    expect(grid._virtualization.positionCache?.[0]).toMatchObject({ height: 49, measured: true });
  });

  it('does not measure a nested grid sharing an outer row reference inside a custom group header', async () => {
    const nested = document.createElement('tbw-grid') as DataGridElement<Row>;
    const { grid, roots } = await fixture(10, nested);
    nested.columns = [{ field: 'id' }];
    nested.rows = [roots[0]];
    await nested.ready();
    await vi.waitFor(() => expect(nested.querySelector('.rows > .data-grid-row')).not.toBeNull());
    const foreignRow = nested.querySelector<HTMLElement>('.rows > .data-grid-row')!;
    const foreignHeader = nested.querySelector<HTMLElement>('.header .cell')!;
    expect(foreignHeader.hasAttribute('data-row')).toBe(false);
    Object.defineProperty(foreignRow, 'offsetHeight', { value: 999, configurable: true });
    grid.refreshVirtualWindow(true);
    expect(foreignRow.querySelector('.cell')?.getAttribute('data-row')).toBe('0');
    expect(foreignHeader.hasAttribute('data-row')).toBe(false);
    expect(grid._virtualization.positionCache?.[0]).toMatchObject({ height: 67, measured: true });
    expect(grid._virtualization.positionCache?.some((position) => position.height === 999)).toBe(false);
  });

  it('preserves explicit numeric and callback heights instead of replacing them with intrinsic DOM heights', async () => {
    const { grid } = await fixture(10);
    grid.gridConfig = { ...grid.gridConfig, rowHeight: 55 };
    await vi.waitFor(() => expect(grid.effectiveConfig.rowHeight).toBe(55));
    expect(grid._virtualization.positionCache?.every((position) => position.height === 55)).toBe(true);
    grid.gridConfig = { ...grid.gridConfig, rowHeight: (row: Row) => (row.id === 'Alpha' ? 81 : undefined) };
    await vi.waitFor(() => expect(typeof grid.effectiveConfig.rowHeight).toBe('function'));
    expect(grid._virtualization.positionCache?.[0]).toMatchObject({ height: 81, measured: true });
    expect(grid._virtualization.positionCache?.[2]).toMatchObject({ height: 49, measured: true });
  });

  it('collects bypass height and geometry reads before spacer/transform writes, not on ordinary scroll', async () => {
    const { grid, events, reads } = await fixture(10);
    const spacer = grid.querySelector<HTMLElement>('.faux-vscroll-spacer')!;
    const body = grid.querySelector<HTMLElement>('.rows')!;
    for (const [style, property] of [
      [spacer.style, 'height'],
      [body.style, 'transform'],
    ] as const) {
      const setProperty = style.setProperty.bind(style);
      vi.spyOn(style, 'setProperty').mockImplementation((name, value, priority) => {
        if (name === property) events.push(property);
        setProperty(name, value, priority);
      });
    }
    events.length = 0;
    grid.refreshVirtualWindow(true);
    expect(events.filter((event) => event === 'measure')).toHaveLength(23);
    expect(events.indexOf('height')).toBeGreaterThan(events.lastIndexOf('measure'));
    expect(events.indexOf('height')).toBeGreaterThan(events.lastIndexOf('geometry'));
    expect(events.indexOf('transform')).toBeGreaterThan(events.indexOf('height'));
    const count = reads.mock.calls.length;
    grid.refreshVirtualWindow(false);
    expect(reads.mock.calls).toHaveLength(count);
  });
});
