import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { GroupingRowsPlugin } from '../grouping-rows/grouping-rows-plugin';
import { TreePlugin } from './tree-plugin';

type Row = {
  id: string;
  section?: string;
  children?: Row[];
};

afterEach(() => document.body.replaceChildren());

async function fixture(reverse: boolean, custom: boolean) {
  const tree = new TreePlugin({ defaultExpanded: false, animation: false });
  const grouping = new GroupingRowsPlugin({
    groupOn: (row: Row, { parent }) => (parent ? row.section : null),
    defaultExpanded: true,
    childGroupsCollapsible: false,
    animation: false,
    ...(custom
      ? {
          groupRowRenderer: ({ value }: { value: unknown }) => {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.textContent = String(value);
            return cell;
          },
        }
      : {}),
  });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  grid.gridConfig = {
    columns: [{ field: 'id' }],
    getRowId: (row) => row.id,
    plugins: reverse ? [grouping, tree] : [tree, grouping],
  };
  grid.rows = ['Beta', 'Alpha'].map((id) => ({
    id,
    children: ['Primary', 'Secondary'].map((section) => ({ id: `${id}/${section}`, section })),
  }));
  document.body.append(grid);
  await grid.ready();
  const rendered = () => [...grid.querySelectorAll<HTMLElement>('.rows > .data-grid-row')];
  return { grid, tree, grouping, rendered };
}

describe.each([false, true])('Tree row metadata ownership, reversed=%s', (reverse) => {
  it.each([false, true])('retires Tree ARIA through fixed-group and reverse reuse, custom=%s', async (custom) => {
    const f = await fixture(reverse, custom);
    expect(f.grid.rows.map((row) => row.id)).toEqual(['Beta', 'Alpha']);
    const alphaSlot = f.rendered()[1];
    expect(alphaSlot.textContent).toContain('Alpha');
    expect(alphaSlot.getAttribute('aria-expanded')).toBe('false');

    for (let cycle = 0; cycle < 2; cycle++) {
      f.tree.expand('Beta');
      await vi.waitFor(() => expect(f.rendered()[1].classList.contains('group-row')).toBe(true));
      expect(f.rendered()[1]).toBe(alphaSlot);
      expect(alphaSlot.querySelector('.cell')?.getAttribute('data-row')).toBe('1');
      expect(alphaSlot.getAttribute('aria-rowindex')).toBe('3');
      expect(alphaSlot.getAttribute('aria-level')).toBe('2');
      expect(alphaSlot.getAttribute('aria-posinset')).toBe('1');
      expect(alphaSlot.getAttribute('aria-setsize')).toBe('2');
      expect(alphaSlot.hasAttribute('aria-expanded')).toBe(false);
      expect(alphaSlot.hasAttribute('aria-busy')).toBe(false);
      expect(alphaSlot.querySelector('button, [aria-expanded]')).toBeNull();
      const group = f.grouping.getFlattenedRows()[1];
      expect(group.kind).toBe('group');
      if (group.kind === 'group') {
        expect(group.collapsible).toBe(false);
        expect(group.expanded).toBe(true);
      }
      f.tree.collapse('Beta');
      await vi.waitFor(() => expect(f.grid.rows).toHaveLength(2));
      expect(f.rendered()[1]).toBe(alphaSlot);
      expect(alphaSlot.textContent).toContain('Alpha');
      expect(alphaSlot.getAttribute('aria-expanded')).toBe('false');
      expect(alphaSlot.getAttribute('aria-level')).toBe('1');
      expect(alphaSlot.getAttribute('aria-posinset')).toBe('2');
    }
  });

  it('preserves a successor group lease instead of restoring the retired Tree value', async () => {
    const f = await fixture(reverse, false);
    const betaSlot = f.rendered()[0];
    expect(betaSlot.getAttribute('aria-expanded')).toBe('false');
    f.grouping.setGroupOn((row: Row, { parent }) => (parent ? row.section : row.id), true);
    await vi.waitFor(() => expect(betaSlot.classList.contains('group-row')).toBe(true));
    expect(betaSlot.getAttribute('aria-expanded')).toBe('true');
    const root = f.grouping.getFlattenedRows()[0];
    expect(root.kind).toBe('group');
    if (root.kind !== 'group') throw new Error('Missing root group');
    f.grouping.collapse(root.key);
    await vi.waitFor(() => expect(betaSlot.getAttribute('aria-expanded')).toBe('false'));
    f.grouping.setGroupOn((row: Row, { parent }) => (parent ? row.section : null), true);
    await vi.waitFor(() => expect(f.grid.rows).toHaveLength(2));
    expect(betaSlot.classList.contains('group-row')).toBe(false);
    expect(betaSlot.getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves external replacement on retirement and clears owned ARIA on Tree removal', async () => {
    const f = await fixture(reverse, false);
    const [betaSlot, alphaSlot] = f.rendered();
    alphaSlot.setAttribute('aria-expanded', 'true');
    alphaSlot.setAttribute('aria-label', 'External label');
    f.tree.expand('Beta');
    await vi.waitFor(() => expect(alphaSlot.classList.contains('group-row')).toBe(true));
    expect(alphaSlot.getAttribute('aria-expanded')).toBe('true');
    expect(alphaSlot.getAttribute('aria-label')).toBe('External label');
    f.grid.gridConfig = { ...f.grid.gridConfig, plugins: [f.grouping] };
    await vi.waitFor(() => expect(f.grid.getPluginByName('tree')).toBeUndefined());
    await vi.waitFor(() => expect(f.grid.rows).toHaveLength(2));
    expect(betaSlot.hasAttribute('aria-expanded')).toBe(false);
    expect(alphaSlot.getAttribute('aria-expanded')).toBe('true');
    expect(alphaSlot.getAttribute('aria-label')).toBe('External label');
  });

  it('retires busy ARIA from the reused slot while the real parent is still loading', async () => {
    const f = await fixture(reverse, false);
    let finish!: (rows: Row[]) => void;
    const children = new Promise<Row[]>((resolve) => {
      finish = resolve;
    });
    const tree = new TreePlugin<Row>({
      defaultExpanded: false,
      animation: false,
      hasChildren: (row) => row.id === 'Alpha' || (Array.isArray(row.children) && row.children.length > 0),
      loadChildren: () => children,
    });
    f.grid.rows = [f.grid.rows[0], { id: 'Alpha' }];
    f.grid.gridConfig = { ...f.grid.gridConfig, plugins: reverse ? [f.grouping, tree] : [tree, f.grouping] };
    await vi.waitFor(() => expect(f.grid.getPluginByName('tree')).toBe(tree));
    const alphaSlot = f.rendered()[1];
    try {
      tree.expand('Alpha');
      await vi.waitFor(() => expect(alphaSlot.getAttribute('aria-busy')).toBe('true'));
      tree.expand('Beta');
      await vi.waitFor(() => expect(alphaSlot.classList.contains('group-row')).toBe(true));
      expect(alphaSlot.hasAttribute('aria-busy')).toBe(false);
      expect(alphaSlot.hasAttribute('aria-expanded')).toBe(false);
      const alpha = f.rendered().find((row) => row.textContent?.includes('Alpha'))!;
      expect(alpha).not.toBe(alphaSlot);
      expect(alpha.getAttribute('aria-busy')).toBe('true');
      finish([]);
      await vi.waitFor(() => expect(alpha.hasAttribute('aria-busy')).toBe(false));
    } finally {
      finish([]);
    }
  });
});
