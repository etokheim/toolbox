import type { DataGridElement } from '@toolbox-web/grid';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { openDemo } from './utils';

test('CellEntry — metadata-only host and SVG preserve native handlers before plugin dispatch', async ({ page }) => {
  await openDemo(page, 'cell-entry/CellEntryDefaultDemo');
  const grid = page.locator('tbw-grid').first();
  await grid.evaluate(
    async (element, moduleUrl) => {
      const { markControlBoundary }: typeof import('../../../libs/grid/src/lib/core/internal/control-lifecycle') =
        await import(moduleUrl);
      const host = element as DataGridElement;
      const cell = host.querySelector<HTMLElement>('.cell[data-row="0"][data-col="0"]')!;
      const control = document.createElement('span');
      control.dataset.control = 'metadata';
      control.textContent = 'Metadata control';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '18');
      control.append(svg);
      markControlBoundary(control, host);
      const increment = (key: string) => (host.dataset[key] = String(Number(host.dataset[key] ?? 0) + 1));
      control.addEventListener('click', () => increment('handled'));
      control.addEventListener('keydown', () => increment('handled'));
      host.addEventListener('cell-activate', () => increment('activated'));
      host.addEventListener('cell-click', () => increment('clicked'));
      host.focusCell(0, 0);
      cell.append(control);
    },
    `/@fs/${resolve('libs/grid/src/lib/core/internal/control-lifecycle.ts')}`,
  );
  let count = 0;
  for (const selector of ['[data-control="metadata"]', '[data-control="metadata"] svg']) {
    const control = grid.locator(selector);
    await control.click();
    for (const key of ['Enter', ' ']) {
      await control.dispatchEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
    }
    count += 3;
    await expect(grid).toHaveAttribute('data-handled', String(count));
    await expect(grid.locator('.cell.editing')).toHaveCount(0);
    expect(await grid.getAttribute('data-activated')).toBeNull();
    expect(await grid.getAttribute('data-clicked')).toBeNull();
  }
});

test('CellEntry — React disclosure controls retain native activation and actual-cell navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDemo(page, 'tree/TreeDisclosureControlsDemo');
  await page.evaluate(
    async (url) => {
      const { mount }: typeof import('../fixtures/cell-entry-controls') = await import(url);
      mount();
    },
    `/@fs/${resolve('apps/docs-e2e/fixtures/cell-entry-controls.tsx')}`,
  );
  const grid = page.locator('#integrated-react tbw-grid');
  await expect(grid.locator('.cell')).not.toHaveCount(0);
  await grid.evaluate(async (element) => {
    const host = element as DataGridElement;
    for (const [event, key] of [
      ['tree-expand', 'tree'],
      ['detail-expand', 'detail'],
      ['cell-activate', 'activated'],
    ]) {
      host.addEventListener(event, () => {
        host.dataset[key] = String(Number(host.dataset[key] ?? 0) + 1);
      });
    }
    await host.ready();
  });
  const tree = grid.getByRole('button', { name: 'Children of Parent 0', exact: true });
  const detail = grid.locator('[data-disclosure="detail"]').first();
  await expect(tree).toHaveAttribute('data-theme', 'integrated');
  await tree.locator('path').click();
  await expect(tree).toHaveAttribute('aria-expanded', 'true');
  await expect(grid).toHaveAttribute('data-tree', '1');
  await tree.press('Space');
  await expect(tree).toHaveAttribute('aria-expanded', 'false');
  await expect(grid).toHaveAttribute('data-tree', '2');
  await tree.press('Enter');
  await expect(tree).toHaveAttribute('aria-expanded', 'true');
  await expect(grid).toHaveAttribute('data-tree', '3');
  await detail.locator('path').click();
  await expect(detail).toHaveAttribute('aria-expanded', 'true');
  await expect(grid).toHaveAttribute('data-detail', '1');
  await detail.press('Space');
  await expect(detail).toHaveAttribute('aria-expanded', 'false');
  await expect(grid).toHaveAttribute('data-detail', '2');
  await detail.press('Enter');
  await expect(detail).toHaveAttribute('aria-expanded', 'true');
  await expect(grid).toHaveAttribute('data-detail', '3');
  await expect(grid.locator('.cell.editing')).toHaveCount(0);
  expect(await grid.getAttribute('data-activated')).toBeNull();
  await expect(grid.locator('[data-name="parent-0"]')).toHaveAttribute('data-theme', 'integrated');
  for (const control of [tree, detail]) {
    const col = await control.evaluate((element) => Number(element.closest<HTMLElement>('.cell')!.dataset.col));
    await grid.evaluate((element) => (element as DataGridElement).focusCell(1, 'value'));
    await control.press('ArrowRight');
    await expect.poll(() => grid.evaluate((element) => (element as DataGridElement)._focusCol)).toBe(col + 1);
    await expect.poll(() => grid.evaluate((element) => (element as DataGridElement)._focusRow)).toBe(0);
  }
  for (const key of ['Enter', 'F2']) {
    await grid.evaluate((element) => (element as DataGridElement).focusCell(0, 'value'));
    await page.keyboard.press(key);
    await expect(grid.locator('.cell.editing')).toHaveCount(1);
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});
