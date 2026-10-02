import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { releaseCell } from '../../core/internal/control-lifecycle';
import type { ControlView } from '../../core/types';
import { MasterDetailPlugin } from '../master-detail/master-detail-plugin';
import type { MasterDetailDisclosureContext } from '../master-detail/types';
import { TreePlugin } from './tree-plugin';
import type { TreeConfig, TreeDisclosureContext } from './types';

type Row = { id: string; name: string; children?: Row[] | boolean };
type Context = TreeDisclosureContext<Row> | MasterDetailDisclosureContext<Row>;

function view<C extends Context>(contexts: C[], dispose = vi.fn()) {
  return (initial: C): ControlView<C> => {
    const element = document.createElement('button');
    let current = initial;
    const update = (context: C) => {
      current = context;
      contexts.push(context);
      element.setAttribute(
        'aria-label',
        'ariaLabel' in context ? context.ariaLabel : `Children of ${context.row.name}`,
      );
      element.setAttribute('aria-expanded', String(context.expanded));
      element.disabled = context.disabled;
    };
    element.onclick = () => current.setExpanded(!current.expanded);
    update(initial);
    return { element, update, dispose };
  };
}

async function setup(config: TreeConfig<Row> = {}, reverse = false, detailDispose = vi.fn(), expandOnRowClick = true) {
  const contexts: MasterDetailDisclosureContext<Row>[] = [];
  const detail = new MasterDetailPlugin<Row>({
    animation: false,
    detailRenderer: (row) => String(row['name']),
    disclosureRenderer: view(contexts, detailDispose),
    expandOnRowClick,
  });
  const tree = new TreePlugin<Row>({ treeColumn: 'name', animation: false, ...config });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  grid.gridConfig = {
    columns: [{ field: 'name' }],
    plugins: reverse ? [detail, tree] : [tree, detail],
  };
  grid.rows = [{ id: 'a', name: 'Parent', children: [{ id: 'b', name: 'Child' }] }];
  document.body.append(grid);
  await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
  await grid.ready();
  await vi.waitFor(() => expect(grid.querySelector('.rows .cell[data-field="name"]')?.textContent).toBe('Parent'));
  return { grid, tree, detail, detailContexts: contexts };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('tree disclosure controls', () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'preserves default placement and independent cleanup (reverse: %s, custom Tree: %s)',
    async (reverse, customTree) => {
      const treeContexts: TreeDisclosureContext<Row>[] = [];
      const treeDispose = vi.fn();
      const detailDispose = vi.fn();
      const { grid, tree, detail, detailContexts } = await setup(
        {
          treeColumn: undefined,
          disclosureRenderer: customTree ? view(treeContexts, treeDispose) : undefined,
        },
        reverse,
        detailDispose,
        false,
      );
      const detailButton = grid.querySelector<HTMLButtonElement>('.master-detail-expander button')!;
      expect(detailButton).not.toBeNull();
      const wrapper = grid.querySelector<HTMLElement>('.tree-cell-wrapper')!;
      expect(wrapper.closest('.cell')?.getAttribute('data-field')).toBe(reverse ? '__tbw_expander' : 'name');
      const treeEvents = vi.fn();
      const detailEvents = vi.fn();
      grid.addEventListener('tree-expand', treeEvents);
      grid.addEventListener('detail-expand', detailEvents);
      detail.afterRender();
      tree.afterRender();
      expect(detailButton.isConnected).toBe(true);
      expect(detailDispose).not.toHaveBeenCalled();
      expect(treeDispose).not.toHaveBeenCalled();

      detailButton.click();
      await vi.waitFor(() => expect(detailButton.getAttribute('aria-expanded')).toBe('true'));
      expect(detailEvents).toHaveBeenCalledTimes(1);
      expect(treeEvents).not.toHaveBeenCalled();
      wrapper.querySelector<HTMLElement>(customTree ? ':scope > span > button' : '.tree-toggle')!.click();
      await vi.waitFor(() => expect(grid.querySelectorAll('.tree-content')).toHaveLength(2));
      expect(treeEvents).toHaveBeenCalledTimes(1);
      expect(detail.isExpanded(0)).toBe(true);
      expect(grid.querySelector('.master-detail-expander button')).toBe(detailButton);
      detailButton.click();
      await vi.waitFor(() => expect(detailButton.getAttribute('aria-expanded')).toBe('false'));
      expect(treeEvents).toHaveBeenCalledTimes(1);

      const mountedDetails = grid.querySelectorAll('.master-detail-expander button').length;
      expect(detailDispose).not.toHaveBeenCalled();
      expect(treeDispose).not.toHaveBeenCalled();
      for (const cell of grid.querySelectorAll<HTMLElement>('.rows .cell')) {
        releaseCell(grid, cell);
        releaseCell(grid, cell);
      }
      expect(detailDispose).toHaveBeenCalledTimes(mountedDetails);
      expect(treeDispose).toHaveBeenCalledTimes(customTree ? 1 : 0);
      detailContexts[0].setExpanded(true);
      treeContexts[0]?.setExpanded(false);
      expect(detail.isExpanded(0)).toBe(false);
      expect(tree.isExpanded('a')).toBe(true);
      grid.remove();
      expect(detailDispose).toHaveBeenCalledTimes(mountedDetails);
      expect(treeDispose).toHaveBeenCalledTimes(customTree ? 1 : 0);
    },
  );

  it('releases a removed nested MD control without invalidating the Tree sibling', async () => {
    const contexts: TreeDisclosureContext<Row>[] = [];
    const treeDispose = vi.fn();
    const detailDispose = vi.fn();
    const { grid, tree, detail, detailContexts } = await setup(
      { treeColumn: undefined, disclosureRenderer: view(contexts, treeDispose) },
      true,
      detailDispose,
    );
    const staleDetail = detailContexts[0];
    grid.querySelector('.master-detail-expander')!.remove();
    detail.afterRender();
    expect(detailDispose).toHaveBeenCalledTimes(1);
    expect(treeDispose).not.toHaveBeenCalled();
    staleDetail.setExpanded(true);
    expect(detail.isExpanded(0)).toBe(false);
    contexts[0].setExpanded(true);
    await vi.waitFor(() => expect(tree.isExpanded('a')).toBe(true));
    expect(treeDispose).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps slots, focus and independent expansion (reverse order: %s)', async (reverse) => {
    const contexts: TreeDisclosureContext<Row>[] = [];
    const dispose = vi.fn();
    const { grid, tree, detail } = await setup({ disclosureRenderer: view(contexts, dispose) }, reverse);
    const button = grid.querySelector<HTMLButtonElement>('.tree-cell-wrapper button')!;
    const wrapper = button.closest('.tree-cell-wrapper');
    const content = wrapper!.querySelector('.tree-content');
    const changed = vi.fn();
    const details = vi.fn();
    grid.addEventListener('tree-expand', changed);
    grid.addEventListener('detail-expand', details);
    button.focus();
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(details).not.toHaveBeenCalled();
    expect(detail.isExpanded(0)).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(grid.querySelector('.tree-cell-wrapper')).toBe(wrapper);
    expect(wrapper!.querySelector('.tree-content')).toBe(content);
    expect(dispose).not.toHaveBeenCalled();
    contexts.at(-1)!.setExpanded(true);
    expect(changed).toHaveBeenCalledTimes(1);
    grid.querySelector<HTMLButtonElement>('.master-detail-expander button')!.click();
    await vi.waitFor(() => expect(detail.isExpanded(0)).toBe(true));
    expect(details).toHaveBeenCalledTimes(1);
    expect(tree.isExpanded(contexts[0].key)).toBe(true);
  });

  it('replaces just the disclosure and restores the default without losing expansion', async () => {
    const contexts: TreeDisclosureContext<Row>[] = [];
    const dispose = vi.fn();
    const { grid, tree } = await setup({ disclosureRenderer: view(contexts, dispose) });
    const old = contexts[0];
    old.setExpanded(true);
    await vi.waitFor(() => expect(grid.querySelectorAll('.tree-content')).toHaveLength(2));
    const content = grid.querySelector('.tree-content');
    grid.querySelector<HTMLButtonElement>('.tree-cell-wrapper button')!.focus();
    tree.setDisclosureRenderer(() => null);
    await vi.waitFor(() => expect(grid.querySelector('.tree-cell-wrapper button')).toBeNull());
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(grid);
    old.setExpanded(false);
    expect(tree.isExpanded(old.key)).toBe(true);
    expect(grid.querySelector('.tree-content')).toBe(content);
    tree.setDisclosureRenderer(undefined);
    await vi.waitFor(() => expect(grid.querySelector('.tree-toggle.expanded')).not.toBeNull());
    expect(grid.querySelector('.tree-content')).toBe(content);
  });

  it('invalidates actions before recycled cells, wrapper rebuild and disconnect', async () => {
    const contexts: TreeDisclosureContext<Row>[] = [];
    const dispose = vi.fn();
    const { grid, tree } = await setup({ disclosureRenderer: view(contexts, dispose) });
    const old = contexts[0];
    const cell = grid.querySelector<HTMLElement>('.rows .cell[data-field="name"]')!;
    releaseCell(grid, cell);
    cell.replaceChildren();
    releaseCell(grid, cell);
    old.setExpanded(true);
    expect(tree.isExpanded(old.key)).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    grid.rows = [{ id: 'c', name: 'Next', children: [{ id: 'd', name: 'Next child' }] }];
    await vi.waitFor(() => expect(grid.querySelector('.tree-content')?.textContent).toBe('Next'));
    old.setExpanded(true);
    expect(tree.getExpandedKeys()).toEqual([]);
    const current = contexts.at(-1)!;
    grid.remove();
    current.setExpanded(true);
    expect(tree.getExpandedKeys()).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('reports loading, disables reentry, and preserves the host through lazy completion', async () => {
    const contexts: TreeDisclosureContext<Row>[] = [];
    let resolve!: (rows: Row[]) => void;
    const load = vi.fn(
      () =>
        new Promise<Row[]>((done) => {
          resolve = done;
        }),
    );
    const { grid, tree } = await setup({ disclosureRenderer: view(contexts), loadChildren: load });
    grid.rows = [{ id: 'lazy', name: 'Lazy', children: true }];
    await vi.waitFor(() => expect(contexts.at(-1)?.row.id).toBe('lazy'));
    const button = grid.querySelector<HTMLButtonElement>('.tree-cell-wrapper button')!;
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    expect(contexts.at(-1)?.loading).toBe(true);
    const current = contexts.at(-1)!;
    current.setExpanded(false);
    expect(tree.isExpanded(current.key)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    resolve([{ id: 'loaded', name: 'Loaded' }]);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(grid.querySelector('.tree-cell-wrapper button')).toBe(button);
  });

  it('invalidates both plugin actions when features are removed from a connected grid', async () => {
    const contexts: TreeDisclosureContext<Row>[] = [];
    const { grid, tree, detail, detailContexts } = await setup({ disclosureRenderer: view(contexts) });
    const treeAction = contexts.at(-1)!;
    const detailAction = detailContexts.at(-1)!;
    grid.gridConfig = { columns: [{ field: 'name' }], plugins: [] };
    await grid.ready();
    await vi.waitFor(() => expect(grid.getPluginByName('tree')).toBeUndefined());
    treeAction.setExpanded(true);
    detailAction.setExpanded(true);
    expect(tree.getExpandedKeys()).toEqual([]);
    expect(detail.isExpanded(0)).toBe(false);
    expect(grid.querySelector('.tree-cell-wrapper button')).toBeNull();
    expect(grid.querySelector('.master-detail-expander button')).toBeNull();
  });

  it('suppresses custom leaves/hidden icons and retains the existing default markup', async () => {
    const renderer = vi.fn(() => document.createElement('button'));
    const { grid, tree } = await setup({ showExpandIcons: false, disclosureRenderer: renderer });
    expect(renderer).not.toHaveBeenCalled();
    expect(grid.querySelector('.tree-toggle')).toBeNull();
    tree.expandAll();
    await vi.waitFor(() => expect(grid.querySelectorAll('.tree-content')).toHaveLength(2));
    expect(renderer).not.toHaveBeenCalled();
  });

  it('routes disclosure navigation from its actual cell without dispatching expansion keys', async () => {
    const contexts: TreeDisclosureContext<Row>[] = [];
    const { grid } = await setup({ disclosureRenderer: view(contexts) });
    const button = grid.querySelector<HTMLButtonElement>('.tree-cell-wrapper button')!;
    button.click();
    await vi.waitFor(() => expect(grid.querySelectorAll('.tree-content')).toHaveLength(2));
    const events = vi.fn();
    grid.addEventListener('tree-expand', events);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(grid._focusRow).toBe(1);
    expect(grid._focusCol).toBe(1);
    expect(events).not.toHaveBeenCalled();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(events).not.toHaveBeenCalled();
  });

  it.each(['renderer', 'viewRenderer'] as const)(
    'keeps one wrapper for %s through column rebuilds and clears null content',
    async (alias) => {
      const { grid, tree, detail } = await setup();
      let empty = false;
      const renderer = vi.fn(() => (empty ? null : 'Rendered name'));
      for (let i = 0; i < 3; i++) {
        grid.gridConfig = {
          columns: [{ field: 'name', [alias]: renderer }],
          plugins: [tree, detail],
          sortable: i % 2 === 0,
        };
        await grid.ready();
        await vi.waitFor(() => expect(grid.querySelector('.tree-content')?.textContent).toBe('Rendered name'));
        expect(grid.querySelectorAll('.tree-cell-wrapper')).toHaveLength(1);
      }
      empty = true;
      grid.rows = [...grid.rows];
      await grid.ready();
      await vi.waitFor(() => expect(grid.querySelector('.tree-content')?.textContent).toBe(''));
      expect(grid.querySelector('.tree-cell-wrapper .tree-cell-wrapper')).toBeNull();
    },
  );
});
