import { afterEach, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { MasterDetailPlugin } from './master-detail-plugin';
import type { MasterDetailDisclosureContext } from './types';
import { waitUpgrade } from '../../../../test/helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

async function disclosureFixture(configuredId = false) {
  const contexts: MasterDetailDisclosureContext[] = [];
  const dispose = vi.fn();
  const renderer = vi.fn((initial: MasterDetailDisclosureContext) => {
    const element = document.createElement('button');
    const update = (ctx: MasterDetailDisclosureContext) => {
      contexts.push(ctx);
      element.textContent = ctx.ariaLabel;
      element.onclick = () => ctx.setExpanded(!ctx.expanded);
    };
    update(initial);
    return { element, update, dispose };
  });
  const plugin = new MasterDetailPlugin({
    animation: false,
    detailRenderer: () => document.createElement('div'),
    disclosureRenderer: renderer,
  });
  const grid = document.createElement('tbw-grid') as DataGridElement;
  const row = { id: 'a', name: 'A' };
  const config = {
    columns: [{ field: 'name' }],
    plugins: [plugin],
    getRowId: configuredId ? (value: { id: string }) => value.id : undefined,
  };
  grid.gridConfig = config;
  grid.rows = [row];
  document.body.append(grid);
  await waitUpgrade(grid);
  const button = grid.querySelector<HTMLButtonElement>('.master-detail-expander button')!;
  return { grid, row, plugin, config, button, contexts, renderer, dispose };
}

it.each(['columns', 'config', 'sibling-callbacks'])(
  'keeps the same disclosure owner attached across benign %s refresh',
  async (kind) => {
    const { grid, row, plugin, config, button, renderer, dispose, contexts } = await disclosureFixture();
    button.focus();
    const changed = vi.fn();
    grid.addEventListener('detail-expand', changed);
    button.click();
    await waitUpgrade(grid);
    if (kind === 'sibling-callbacks')
      grid.columns = config.columns.map((col) => ({
        ...col,
        renderer: () => 'Refreshed sibling',
        headerRenderer: () => {
          const label = document.createElement('span');
          label.textContent = 'Refreshed header';
          return label;
        },
      }));
    else if (kind === 'columns') grid.columns = [...config.columns];
    else grid.gridConfig = { ...config };
    await waitUpgrade(grid);
    expect(grid.rows[0]).toBe(row);
    expect(grid.querySelector('.master-detail-expander button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(renderer).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(contexts.at(-1)?.expanded).toBe(true);
    if (kind === 'sibling-callbacks') {
      expect(grid.querySelector('.rows .cell[data-field="name"]')?.textContent).toBe('Refreshed sibling');
      expect(grid.querySelector('.header')?.textContent).toContain('Refreshed header');
    }
    button.click();
    await waitUpgrade(grid);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(plugin.isExpanded(0)).toBe(false);
    grid.remove();
    expect(dispose).toHaveBeenCalledOnce();
  },
);

it.each([
  'id',
  'configured-id',
  'resolver',
  'replacement',
  'removal',
  'renderer',
  'column-renderer',
  'width',
  'meta',
  'nested',
  'column-removal',
  'detach',
  'disconnect',
])('retires the retained disclosure and its actions on %s', async (change) => {
  const f = await disclosureFixture(change === 'configured-id');
  f.button.focus();
  f.grid.columns = [...f.config.columns];
  await waitUpgrade(f.grid);
  expect(f.grid.querySelector('.master-detail-expander button')).toBe(f.button);
  expect(document.activeElement).toBe(f.button);
  const stale = f.contexts.at(-1)!;
  const events = vi.fn();
  f.grid.addEventListener('detail-expand', events);
  if (change === 'id' || change === 'configured-id') {
    f.row.id = 'b';
    stale.setExpanded(true);
    expect(events).not.toHaveBeenCalled();
  }
  if (change === 'resolver') f.grid.gridConfig = { ...f.config, getRowId: (row: { id: string }) => row.id };
  if (change === 'replacement') f.grid.rows = [{ ...f.row }];
  if (change === 'removal') f.grid.rows = [];
  if (change === 'renderer') f.plugin.setDisclosureRenderer(() => document.createElement('button'));
  if (change === 'width' || change === 'meta' || change === 'nested' || change === 'column-renderer') {
    f.grid.columns = f.grid.columns.map((col) =>
      col.field !== '__tbw_expander'
        ? col
        : {
            ...col,
            ...(change === 'column-renderer'
              ? { renderer: () => document.createElement('button') }
              : change === 'width'
                ? { width: 64 }
                : { meta: change === 'meta' ? { changed: true } : { nested: {} } }),
          },
    );
  } else if (change === 'column-removal') {
    f.grid.gridConfig = { columns: f.config.columns, plugins: [new MasterDetailPlugin({ showExpandColumn: false })] };
  } else if (change === 'detach') {
    f.grid.gridConfig = { columns: f.config.columns, plugins: [] };
  } else if (change === 'disconnect') f.grid.remove();
  else f.grid.columns = [...f.grid.columns];
  if (change !== 'disconnect') await waitUpgrade(f.grid);
  expect(f.button.isConnected).toBe(false);
  expect(f.dispose).toHaveBeenCalledOnce();
  if (change !== 'disconnect') expect(document.activeElement).toBe(f.grid);
  stale.setExpanded(true);
  expect(events).not.toHaveBeenCalled();
});

it('keeps HTMLElement outputs on their existing replace-on-update lifecycle', async () => {
  const f = await disclosureFixture();
  f.plugin.setDisclosureRenderer(() => document.createElement('button'));
  await waitUpgrade(f.grid);
  const element = f.grid.querySelector<HTMLButtonElement>('.master-detail-expander button')!;
  element.focus();
  f.grid.columns = [...f.grid.columns];
  await waitUpgrade(f.grid);
  expect(element.isConnected).toBe(false);
  expect(document.activeElement).toBe(f.grid);
  expect(f.grid.querySelector('.master-detail-expander button')).not.toBe(element);
});

it('retires an identity-changing STYLE update without losing its successor cleanup', async () => {
  const f = await disclosureFixture();
  f.button.focus();
  const stale = f.contexts.at(-1)!;
  f.row.id = 'b';
  f.plugin.afterRender();
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(f.grid);
  const next = f.grid.querySelector<HTMLButtonElement>('.master-detail-expander button')!;
  expect(next).not.toBe(f.button);
  next.focus();
  f.grid.columns = [...f.grid.columns];
  await waitUpgrade(f.grid);
  expect(f.grid.querySelector('.master-detail-expander button')).toBe(next);
  expect(document.activeElement).toBe(next);
  stale.setExpanded(true);
  expect(f.plugin.isExpanded(0)).toBe(false);
  f.grid.rows = [];
  await waitUpgrade(f.grid);
  expect(f.dispose).toHaveBeenCalledTimes(2);
});

it('retains reference identity, default labels and guarded idempotent detail actions', async () => {
  const contexts: MasterDetailDisclosureContext[] = [];
  const dispose = vi.fn();
  const plugin = new MasterDetailPlugin({
    animation: false,
    detailRenderer: () => document.createElement('div'),
    disclosureRenderer: (initial) => {
      const element = document.createElement('button');
      const update = (ctx: MasterDetailDisclosureContext) => {
        contexts.push(ctx);
        element.setAttribute('aria-label', ctx.ariaLabel);
        element.setAttribute('aria-expanded', String(ctx.expanded));
        element.onclick = () => ctx.setExpanded(!ctx.expanded);
      };
      update(initial);
      return { element, update, dispose };
    },
  });
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement;
  const row = { id: 'same', name: 'First' };
  grid.gridConfig = { columns: [{ field: 'name' }], plugins: [plugin] };
  grid.rows = [row];
  document.body.append(grid);
  await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
  await grid.ready();
  await vi.waitFor(() => expect(contexts.length).toBeGreaterThan(0));
  const changed = vi.fn();
  grid.addEventListener('detail-expand', changed);
  const stale = contexts[0];
  expect(stale.ariaLabel).toBe('Expand details');
  stale.setExpanded(true);
  stale.setExpanded(true);
  await vi.waitFor(() => expect(contexts.at(-1)?.ariaLabel).toBe('Collapse details'));
  expect(changed).toHaveBeenCalledTimes(1);
  grid.rows = [{ ...row, name: 'Replacement' }];
  await vi.waitFor(() => expect(grid.querySelector('.rows .cell[data-field="name"]')?.textContent).toBe('Replacement'));
  expect(plugin.isExpanded(0)).toBe(false);
  stale.setExpanded(true);
  expect(plugin.isExpanded(0)).toBe(false);
  expect(dispose).toHaveBeenCalledTimes(1);
  const replacement = contexts.at(-1)!;
  grid.querySelector<HTMLButtonElement>('.master-detail-expander button')!.focus();
  plugin.setDisclosureRenderer(undefined);
  await vi.waitFor(() =>
    expect(grid.querySelector('.master-detail-toggle')?.getAttribute('aria-label')).toBe('Expand details'),
  );
  expect(dispose).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(grid);
  replacement.setExpanded(true);
  expect(plugin.isExpanded(0)).toBe(false);
});
