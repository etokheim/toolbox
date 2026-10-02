import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { DataGridElement } from '@toolbox-web/grid';
import type { MasterDetailDisclosureContext, MasterDetailPlugin } from '@toolbox-web/grid/plugins/master-detail';
import type { TreeDisclosureContext, TreePlugin } from '@toolbox-web/grid/plugins/tree';
import { openDemo } from './utils';

for (const detailFirst of [false, true]) {
  for (const customTree of [false, true]) {
    test(`TreeDisclosureControlsDemo — omitted treeColumn (MD first: ${detailFirst}, custom Tree: ${customTree})`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openDemo(page, 'tree/TreeDisclosureControlsDemo');
      const grid = page.locator('#disclosure-dom');
      await grid.evaluate(
        async (element, options) => {
          type Row = { id: string; name: string; children?: Row[] };
          type Context = TreeDisclosureContext<Row> | MasterDetailDisclosureContext<Row>;
          const host = element as DataGridElement<Row>;
          const Tree = host.getPluginByName('tree')!.constructor as typeof TreePlugin;
          const Detail = host.getPluginByName('masterDetail')!.constructor as typeof MasterDetailPlugin;
          const count = (key: string) => (host.dataset[key] = String(Number(host.dataset[key] ?? 0) + 1));
          const renderer = (initial: Context) => {
            const button = document.createElement('button');
            let context = initial;
            count('created');
            const update = (next: Context) => {
              context = next;
              button.textContent = next.expanded ? '-' : '+';
              button.setAttribute('aria-expanded', String(next.expanded));
              button.setAttribute('aria-label', 'ariaLabel' in next ? next.ariaLabel : `Children of ${next.row.name}`);
            };
            button.onclick = () => context.setExpanded(!context.expanded);
            update(initial);
            return { element: button, update, dispose: () => count('disposed') };
          };
          const tree = new Tree<Row>({
            animation: false,
            disclosureRenderer: options.customTree ? renderer : undefined,
          });
          const detail = new Detail<Row>({
            animation: false,
            disclosureRenderer: renderer,
            detailRenderer: () => 'Nested details',
          });
          host.dataset.created = '0';
          host.dataset.disposed = '0';
          host.dataset.treeEvents = '0';
          host.dataset.detailEvents = '0';
          host.addEventListener('tree-expand', () => count('treeEvents'));
          host.addEventListener('detail-expand', () => count('detailEvents'));
          host.gridConfig = {
            columns: [{ field: 'name' }],
            plugins: options.detailFirst ? [detail, tree] : [tree, detail],
          };
          host.rows = [{ id: 'root', name: 'Parent', children: [{ id: 'child', name: 'Child' }] }];
          await host.ready();
        },
        { detailFirst, customTree },
      );
      const detail = grid.locator('.master-detail-expander button').first();
      const wrapper = grid.locator('.tree-cell-wrapper').first();
      await expect(wrapper.locator('xpath=..')).toHaveAttribute('data-field', detailFirst ? '__tbw_expander' : 'name');
      await expect(detail).toBeVisible();
      await expect(grid).toHaveAttribute('data-disposed', '0');
      await detail.press('Space');
      await expect(detail).toHaveAttribute('aria-expanded', 'true');
      await expect(grid).toHaveAttribute('data-detail-events', '1');
      await expect(grid).toHaveAttribute('data-tree-events', '0');
      await wrapper.locator(customTree ? ':scope > span > button' : '.tree-toggle').click();
      await expect(grid.locator('.tree-content')).toHaveCount(2);
      await expect(detail).toHaveAttribute('aria-expanded', 'true');
      await expect(grid).toHaveAttribute('data-tree-events', '1');
      await detail.press('Enter');
      await expect(detail).toHaveAttribute('aria-expanded', 'false');
      await expect(grid).toHaveAttribute('data-detail-events', '2');
      await expect(grid).toHaveAttribute('data-tree-events', '1');
      await expect(grid).toHaveAttribute('data-disposed', '0');
      const created = await grid.getAttribute('data-created');
      await grid.evaluate(async (element) => {
        const host = element as DataGridElement;
        host.gridConfig = { columns: [{ field: 'name' }], plugins: [] };
        await host.ready();
      });
      await expect(grid).toHaveAttribute('data-disposed', created!);
      await expect(grid.locator('button')).toHaveCount(0);
      const disposed = await grid.evaluate((element) => {
        element.remove();
        return (element as HTMLElement).dataset.disposed;
      });
      expect(disposed).toBe(created);
      expect(errors).toEqual([]);
    });
  }
}

test('TreeDisclosureControlsDemo — native activation, independent slots, providers and navigation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDemo(page, 'tree/TreeDisclosureControlsDemo');
  const host = page.locator('#disclosure-react tbw-grid');
  const tree = host.getByRole('button', { name: 'Children of Parent 0', exact: true });
  const detail = host.getByRole('button', { name: 'Expand details', exact: true }).first();
  const name = host.locator('[data-name="parent-0"]');
  const log = page.locator('[data-event-log]');
  await expect(tree).toHaveAttribute('data-theme', 'disclosure-react');
  await expect(name).toHaveAttribute('data-theme', 'disclosure-react');
  const box = await tree.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(24);
  expect(box?.height).toBeGreaterThanOrEqual(24);
  await tree.locator('path').click();
  await expect(tree).toHaveAttribute('aria-expanded', 'true');
  await expect(log).toHaveText('Tree: 1; details: 0; links: 0');
  await expect(name).toBeVisible();
  await expect(tree).toBeFocused();
  await tree.press('Space');
  await expect(tree).toHaveAttribute('aria-expanded', 'false');
  await expect(log).toHaveText('Tree: 2; details: 0; links: 0');
  await tree.press('Enter');
  await expect(log).toHaveText('Tree: 3; details: 0; links: 0');
  await detail.click();
  await expect(host.locator('[data-detail]')).toHaveAttribute('data-detail', 'disclosure-react');
  await expect(log).toHaveText('Tree: 3; details: 1; links: 0');
  await host.getByRole('button', { name: 'Collapse details' }).press('Space');
  await expect(log).toHaveText('Tree: 3; details: 2; links: 0');
  await name.click();
  await expect(log).toContainText('links: 1');
  const other = page.locator('#disclosure-react-second tbw-grid');
  await other.getByRole('button', { name: 'Expand details', exact: true }).first().press('Enter');
  await expect(other.locator('[data-detail]')).toHaveAttribute('data-detail', 'disclosure-react-second');
  await tree.focus();
  await tree.press('ArrowDown');
  await expect.poll(() => host.evaluate((element) => (element as DataGridElement)._focusRow)).toBe(1);
  const accessibility = await new AxeBuilder({ page })
    .include('#disclosure-react')
    .withRules(['button-name', 'aria-allowed-attr', 'aria-valid-attr-value', 'aria-required-attr'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('TreeDisclosureControlsDemo — 100 expansion/recycle cycles keep independent slots bounded', async ({ page }) => {
  test.setTimeout(90000);
  await openDemo(page, 'tree/TreeDisclosureControlsDemo');
  const host = page.locator('#disclosure-react tbw-grid');
  const tree = host.getByRole('button', { name: 'Children of Parent 0', exact: true });
  const counts = () =>
    host.evaluate((element) => ({
      rows: element.querySelectorAll('.rows .data-grid-row').length,
      controls: element.querySelectorAll('[data-disclosure]').length,
      names: element.querySelectorAll('[data-name]').length,
      wrappers: element.querySelectorAll('.tree-cell-wrapper').length,
      nested: element.querySelectorAll('.tree-cell-wrapper .tree-cell-wrapper').length,
    }));
  await expect(tree).toBeVisible();
  const baseline = await counts();
  for (let i = 0; i < 100; i++) {
    await tree.click();
    await expect(tree).toHaveAttribute('aria-expanded', 'true');
    await host.evaluate((element) => (element as DataGridElement).scrollToRow(50));
    await expect(host.locator('[data-name="parent-20"]')).toBeVisible();
    await host.evaluate((element) => (element as DataGridElement).scrollToRow(0));
    await expect(tree).toBeVisible();
    await tree.click();
    await expect(tree).toHaveAttribute('aria-expanded', 'false');
  }
  await expect.poll(counts).toEqual(baseline);
});
