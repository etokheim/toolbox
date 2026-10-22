import { afterEach, describe, expect, it } from 'vitest';
import { DataGridElement } from '../../lib/core/grid';
import { GroupingRowsPlugin } from '../../lib/plugins/grouping-rows/grouping-rows-plugin';
import { StickyRowsPlugin } from '../../lib/plugins/sticky-rows/sticky-rows-plugin';
import { TreePlugin } from '../../lib/plugins/tree/tree-plugin';

interface Row {
  id: string;
  section?: string;
  children?: Row[];
}

const revealClasses = ['tbw-tree-slide-in', 'tbw-tree-fade-in', 'tbw-group-slide-in', 'tbw-group-fade-in'];
const revealing = (el: Element) => revealClasses.some((name) => el.classList.contains(name));
const bodyRows = (grid: DataGridElement<Row>) =>
  Array.from(grid.querySelectorAll<HTMLElement>('.rows > .data-grid-row'));
function finish(grid: DataGridElement<Row>) {
  for (const row of bodyRows(grid)) {
    row.dispatchEvent(Object.assign(new Event('animationend'), { animationName: 'tbw-group-slide-in' }));
  }
}
async function render(grid: DataGridElement<Row>) {
  await grid.forceLayout();
  await Promise.resolve();
  await Promise.resolve();
}

async function fixture(reverse: boolean, virtualized: boolean, enabled = true) {
  const rows: Row[] = ['a', 'b'].map((id) => ({
    id,
    children: [
      { id: `${id}/cargo`, section: 'Cargos', children: [{ id: `${id}/move` }] },
      { id: `${id}/deal`, section: 'Deals' },
    ],
  }));
  if (virtualized) rows.push(...Array.from({ length: 28 }, (_, i) => ({ id: `filler-${i}` })));
  const tree = new TreePlugin({ treeColumn: 'id', animation: 'slide' });
  const grouping = new GroupingRowsPlugin({
    groupOn: (row: Row, { parent }) => (parent ? (row.section ?? null) : null),
    defaultExpanded: true,
    childGroupsCollapsible: false,
    animation: 'slide',
  });
  const sticky = new StickyRowsPlugin({
    isSticky: (_row, index) => grouping.getFlattenedRows()[index]?.kind === 'group',
  });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  Object.defineProperty(grid, 'clientHeight', { value: 150 });
  Object.defineProperty(grid, 'clientWidth', { value: 800 });
  grid.gridConfig = {
    columns: [{ field: 'id' }],
    getRowId: (row) => row.id,
    rowHeight: 28,
    animation: { mode: enabled ? 'on' : 'off' },
    plugins: [...(reverse ? [grouping, tree] : [tree, grouping]), sticky],
  };
  grid.rows = rows;
  document.body.append(grid);
  await grid.ready();
  await render(grid);
  finish(grid);
  return { grid, rows, tree, grouping, sticky };
}

afterEach(() => document.body.replaceChildren());

describe.each([false, true])('native hierarchy reveals, reversed=%s', (reverse) => {
  it.each([false, true])('does not animate shifted survivors on collapse (virtualized=%s)', async (virtualized) => {
    const { grid, tree } = await fixture(reverse, virtualized);
    tree.expandAll();
    await render(grid);
    if (virtualized) expect(bodyRows(grid).length).toBeLessThan(grid.rows.length);
    finish(grid);
    tree.collapse('a');
    await render(grid);
    expect(
      bodyRows(grid)
        .filter(revealing)
        .map((row) => row.textContent),
    ).toEqual([]);
  });

  it('animates newly revealed live fixed sections as well as real descendants, not existing roots', async () => {
    const { grid, tree } = await fixture(reverse, false);
    tree.expandAll();
    await render(grid);
    const sections = bodyRows(grid).filter((el) => el.classList.contains('group-row'));
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every(revealing)).toBe(true);
    for (const el of bodyRows(grid).filter((el) => !el.classList.contains('group-row'))) {
      const index = Number(el.querySelector(':scope > .cell')?.getAttribute('data-row'));
      expect(revealing(el)).toBe(grid.rows[index].id.includes('/'));
    }
  });

  it('cleans active reveals on recycled slots even before animation completion', async () => {
    const { grid, tree } = await fixture(reverse, false);
    tree.expandAll();
    await render(grid);
    tree.collapse('a');
    await render(grid);
    const rootB = bodyRows(grid).find((el) => el.querySelector('.cell')?.textContent?.includes('b'));
    expect(rootB).toBeDefined();
    expect(revealing(rootB!)).toBe(false);
    tree.collapseAll();
    await render(grid);
    expect(bodyRows(grid).some(revealing)).toBe(false);
  });

  it('never caches reveal state for later decorative sticky promotion', async () => {
    const { grid, tree, sticky } = await fixture(reverse, false);
    tree.expandAll();
    await render(grid);
    sticky.onScroll({
      scrollTop: 85,
      scrollLeft: 0,
      scrollHeight: 400,
      scrollWidth: 800,
      clientHeight: 150,
      clientWidth: 800,
    });
    const clone = grid.querySelector('.tbw-sticky-row');
    expect(clone).not.toBeNull();
    expect(revealing(clone!)).toBe(false);
  });

  it('respects disabled animations', async () => {
    const { grid, tree } = await fixture(reverse, false, false);
    tree.expandAll();
    await render(grid);
    expect(bodyRows(grid).some(revealing)).toBe(false);
  });

  it('respects the reduced-motion CSS signal in the default animation mode', async () => {
    const { grid, tree } = await fixture(reverse, false);
    grid.gridConfig = { ...grid.gridConfig, animation: { mode: 'reduced-motion' } };
    await render(grid);
    grid.style.setProperty('--tbw-animation-enabled', '0');
    tree.expandAll();
    await render(grid);
    expect(bodyRows(grid).some(revealing)).toBe(false);
  });
});

describe('standalone grouping reveal identity', () => {
  it('does not replay moved or replaced occurrences and reveals nested group headers', async () => {
    const grouping = new GroupingRowsPlugin({
      groupOn: (row: Row) => [row.section, 'Nested'],
      defaultExpanded: true,
      animation: 'slide',
    });
    const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
    grid.gridConfig = {
      columns: [{ field: 'id' }],
      getRowId: (row) => row.id,
      animation: { mode: 'on' },
      plugins: [grouping],
    };
    grid.rows = [
      { id: 'a/item', section: 'A' },
      { id: 'b/item', section: 'B' },
    ];
    document.body.append(grid);
    await grid.ready();
    finish(grid);
    const root = grouping.getFlattenedRows().find((item) => item.kind === 'group' && item.value === 'A')!;
    expect(root.kind).toBe('group');
    if (root.kind !== 'group') throw new Error('Missing group');
    grouping.collapse(root.key);
    await render(grid);
    expect(bodyRows(grid).some(revealing)).toBe(false);
    grid.rows = [
      { id: 'b/item', section: 'B' },
      { id: 'a/item', section: 'A' },
    ];
    await render(grid);
    expect(bodyRows(grid).some(revealing)).toBe(false);
    grouping.expand(root.key);
    await render(grid);
    const nested = bodyRows(grid).find(
      (el) => el.classList.contains('group-row') && el.textContent?.includes('Nested') && revealing(el),
    );
    expect(nested).toBeDefined();
    finish(grid);
    await render(grid);
    expect(bodyRows(grid).some(revealing)).toBe(false);
  });
});
