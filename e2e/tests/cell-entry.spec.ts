import type { DataGridElement } from '@toolbox-web/grid';
import type { EditingConfig } from '@toolbox-web/grid/plugins/editing';
import { expect, test } from '@playwright/test';
import { DEMOS, waitForGridReady } from './utils';

test('React — F2 Tab continuation preserves controlled editors and overlay vetoes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(DEMOS.react);
  await waitForGridReady(page);
  const grid = page.locator('tbw-grid').first();
  await grid.evaluate((element) => {
    const host = element as DataGridElement;
    host.gridConfig = {
      ...host.gridConfig,
      features: {
        ...host.gridConfig.features,
        editing: { editOn: 'manual', tabToEdit: true } satisfies EditingConfig,
      },
    };
  });
  const status = grid.locator('[role="gridcell"][data-row="0"][data-field="status"]');
  await status.click();
  await page.keyboard.press('F2');
  const select = status.locator('select');
  await expect(select).toBeFocused();
  await select.selectOption('Remote');

  // A managed control may keep Tab for its own open overlay.
  await select.evaluate((element) =>
    element.addEventListener('keydown', (event) => event.preventDefault(), { once: true }),
  );
  await page.keyboard.press('Tab');
  await expect(select).toBeFocused();
  await page.keyboard.press('Tab');
  const date = grid.locator('[role="gridcell"][data-row="0"][data-field="hireDate"] input[type="date"]');
  await expect(date).toBeFocused();
  await expect(status).toContainText('Remote');
  await expect(grid.locator('.cell.editing')).toHaveCount(1);
  await page.keyboard.press('Shift+Tab');
  await expect(select).toBeFocused();
  await expect(select).toHaveValue('Remote');
  await page.keyboard.press('Escape');
  await expect(grid.locator('.cell.editing')).toHaveCount(0);
  expect(errors).toEqual([]);
});
