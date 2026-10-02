import { afterEach, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../core/grid';
import { MasterDetailPlugin } from './master-detail-plugin';
import type { MasterDetailDisclosureContext } from './types';

afterEach(() => {
  document.body.innerHTML = '';
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
