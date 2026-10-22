/** @vitest-environment happy-dom */
import { DataGridElement } from '@toolbox-web/grid';
import type { TreeDisclosureContext } from '@toolbox-web/grid/plugins/tree';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import type { GridConfig } from '../lib/react-column-config';
import './sticky-rows';
import './tree';

type Row = { id: string; name: string; children?: Row[] };
const roots: Root[] = [];
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function settle() {
  await frame();
  await frame();
  await frame();
}

const disclosure = (ctx: TreeDisclosureContext<Row>) => (
  <span data-disclosure={ctx.row.id} style={{ display: 'inline-flex', width: 32, minWidth: 32 }}>
    <button aria-expanded={ctx.expanded} onClick={() => ctx.setExpanded(!ctx.expanded)}>
      Toggle
    </button>
  </span>
);

async function mount(count: number, ancestors = false) {
  const output = { mode: 'jsx' as 'jsx' | 'null' | 'native' };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const rows: Row[] = [
    {
      id: 'parent',
      name: 'Parent',
      children: Array.from({ length: count - 1 }, (_, i) => ({ id: `child-${i}`, name: `Child ${i}` })),
    },
  ];
  const config: GridConfig<Row> = {
    getRowId: (row) => row.id,
    rowHeight: 48,
    columns: [{ field: 'name', renderer: ({ row }) => <span data-name={row.id}>{row.name}</span> }],
    features: {
      tree: {
        treeColumn: 'name',
        defaultExpanded: true,
        animation: false,
        disclosureRenderer: (ctx) => {
          if (output.mode === 'null') return null;
          if (output.mode === 'jsx') return disclosure(ctx);
          const button = document.createElement('button');
          button.dataset['nativeDisclosure'] = '';
          button.textContent = 'Native';
          return button;
        },
      },
      stickyRows: { isSticky: (_row, index) => index === 0, mode: ancestors ? 'ancestors' : 'push' },
    },
  };
  // Normal portal microtask ordering, not act's deferred commit queue.
  root.render(<DataGrid rows={rows} gridConfig={config} />);
  await vi.waitFor(() => expect(host.querySelector('[data-disclosure="parent"]')).not.toBeNull());
  const grid = host.querySelector(DataGridElement.activeTag) as DataGridElement<Row>;
  await grid.ready();
  await settle();
  const liveDisclosure = grid.querySelector<HTMLButtonElement>('.rows [data-disclosure="parent"] button')!;
  const scroll = grid.querySelector<HTMLElement>('.faux-vscroll')!;
  scroll.scrollTop = 60;
  scroll.dispatchEvent(new Event('scroll'));
  const selector = ancestors
    ? '.tbw-ancestor-live [data-disclosure="parent"]'
    : '.tbw-sticky-row [data-disclosure="parent"]';
  await vi.waitFor(() => expect(grid.querySelector(selector)).not.toBeNull());
  return { grid, root, scroll, output, liveDisclosure };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(160);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
});

afterEach(async () => {
  for (const root of roots.splice(0)) root.unmount();
  await settle();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('sticky React disclosure snapshots', () => {
  it.each([8, 40])('settles forceLayout snapshots with %i processed rows without recurring renders', async (count) => {
    const { grid } = await mount(count);
    expect(grid.rows).toHaveLength(count);
    expect(grid._virtualization.end - grid._virtualization.start < count).toBe(count > 24);
    const renders = vi.fn();
    grid.addEventListener('render', renders);
    for (let i = 0; i < 3; i++) {
      await grid.forceLayout();
      await settle();
      expect(grid.querySelector('.rows [data-disclosure="parent"]')).not.toBeNull();
      expect(grid.querySelector('.tbw-sticky-row [data-disclosure="parent"]')).not.toBeNull();
      expect(grid.querySelector('.tbw-sticky-row [data-name="parent"]')?.textContent).toBe('Parent');
    }
    const settledRenders = renders.mock.calls.length;
    await settle();
    expect(renders).toHaveBeenCalledTimes(settledRenders);
    expect(settledRenders).toBeLessThanOrEqual(6);
  });

  it('retains one live React disclosure portal through ancestor scrolling and canonical collapse', async () => {
    const { grid, scroll, liveDisclosure } = await mount(80, true);
    liveDisclosure.focus();
    for (const offset of [120, 600, 1200, 60]) {
      scroll.scrollTop = offset;
      scroll.dispatchEvent(new Event('scroll'));
      await settle();
      expect(grid.querySelector('.rows [data-disclosure="parent"] button')).toBe(liveDisclosure);
      expect(document.activeElement).toBe(liveDisclosure);
      expect(grid.querySelectorAll('[data-disclosure="parent"]')).toHaveLength(1);
      expect(grid.querySelectorAll('[data-name="parent"]')).toHaveLength(1);
      const state = grid._virtualization;
      expect(grid._bodyEl.querySelectorAll(':scope > .data-grid-row').length).toBeLessThanOrEqual(
        state.end - state.start + 1,
      );
    }
    liveDisclosure.click();
    await vi.waitFor(() => expect(grid.rows).toHaveLength(1));
    await settle();
    expect(grid.querySelector('[data-disclosure="parent"] button')?.getAttribute('aria-expanded')).toBe('false');
    expect(grid.querySelector('.tbw-sticky-row')).toBeNull();
    expect(grid.querySelectorAll('[data-name]')).toHaveLength(1);
  });

  it('settles JSX to null to native to JSX instead of retaining last-good content', async () => {
    const { grid, output } = await mount(8);
    output.mode = 'null';
    await grid.forceLayout();
    await settle();
    expect(grid.querySelector('.rows [data-disclosure]')).toBeNull();
    expect(grid.querySelector('.tbw-sticky-row [data-disclosure]')).toBeNull();
    output.mode = 'native';
    await grid.forceLayout();
    await settle();
    expect(grid.querySelector('.tbw-sticky-row [data-native-disclosure]')?.textContent).toBe('Native');
    output.mode = 'jsx';
    await grid.forceLayout();
    await settle();
    expect(grid.querySelector('.tbw-sticky-row [data-disclosure="parent"]')).not.toBeNull();
    expect(grid.querySelector('.tbw-sticky-row [data-native-disclosure]')).toBeNull();
  });

  it('keeps ordinary scroll snapshots and cancels pending capture on detach', async () => {
    const { grid, root, scroll } = await mount(40);
    for (const offset of [120, 600, 120, 60]) {
      scroll.scrollTop = offset;
      scroll.dispatchEvent(new Event('scroll'));
      await settle();
      expect(grid.querySelector('.tbw-sticky-row [data-disclosure="parent"]')).not.toBeNull();
      expect(grid.querySelector('.tbw-sticky-row [data-name="parent"]')?.textContent).toBe('Parent');
    }
    const sticky = grid.getPluginByName('stickyRows')!;
    if (!sticky.afterRender) throw new Error('Missing StickyRows render hook');
    sticky.afterRender();
    sticky.detach();
    await settle();
    expect(grid.querySelector('.tbw-sticky-rows')).toBeNull();
    root.unmount();
    roots.splice(roots.indexOf(root), 1);
  });
});
