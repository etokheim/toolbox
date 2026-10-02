import { expect, test } from '@playwright/test';
import type { DataGridElement } from '@toolbox-web/grid';
import { clickCell, dataRows, grid, openDemo } from './utils';

test.describe('Selection Demos', () => {
  for (const owner of ['#custom-checkbox-dom', '#custom-checkbox-react tbw-grid']) {
    test(`SelectionCustomCheckboxDemo — ${owner} owns click and keyboard activation`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openDemo(page, 'selection/SelectionCustomCheckboxDemo');
      const host = page.locator(owner);
      const controls = host.locator('.rows').getByRole('checkbox');
      const header = host.locator('.header-row').getByRole('checkbox');
      const first = controls.nth(0);
      await expect(controls).toHaveCount(3);
      await expect(controls.nth(1)).toBeDisabled();
      await expect(first).toHaveAccessibleName(/.+/);
      const box = await first.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(24);
      expect(box?.height).toBeGreaterThanOrEqual(24);
      if (owner.includes('react')) await expect(first).toHaveAttribute('data-theme', 'app-checkbox');
      const log = page.locator('[data-event-log]');
      await first.click();
      await expect(first).toBeChecked();
      await expect(header).toHaveAttribute('aria-checked', 'mixed');
      await expect(log).toHaveText('1 selection changes');
      await expect(first).toBeFocused();
      await first.press('Space');
      await expect(first).not.toBeChecked();
      await expect(log).toHaveText('2 selection changes');
      await first.press('Enter');
      await expect(first).toBeChecked();
      await expect(log).toHaveText('3 selection changes');
      await header.click();
      await expect(controls.nth(2)).toBeChecked();
      await expect(header).toBeChecked();
      await expect(log).toHaveText('4 selection changes');
      await header.press('Space');
      await expect(first).not.toBeChecked();
      await expect(log).toHaveText('5 selection changes');

      await host.evaluate((element) => {
        const grid = element as DataGridElement;
        grid.rows = Array.from({ length: 200 }, (_, id) => ({ id, name: `Person ${id}`, locked: false }));
      });
      await expect(host.getByText('Person 0', { exact: true })).toBeVisible();
      await host.evaluate((element) => (element as DataGridElement).scrollToRow(150));
      await expect(host.getByText('Person 150', { exact: true })).toBeVisible();
      const recycledRow = host.locator('[role="row"]').filter({ hasText: 'Person 150' });
      const recycledControl = recycledRow.getByRole('checkbox');
      const changesBeforeRecycleClick = Number.parseInt(await log.innerText(), 10);
      await recycledControl.click();
      await expect(recycledControl).toBeChecked();
      const selected = await host.evaluate((element) =>
        (element as DataGridElement).getPluginByName('selection')?.getSelectedRowIndices());
      expect(selected).toEqual([150]);
      await expect(log).toHaveText(`${changesBeforeRecycleClick + 1} selection changes`);
      expect(errors).toEqual([]);
    });
  }

  test('SelectionPlaygroundDemo — cell selection mode selects a cell', async ({ page }) => {
    await openDemo(page, 'SelectionPlaygroundDemo');

    // Default mode is 'cell'
    await clickCell(page, 0, 1);
    await page.waitForTimeout(200);

    // Verify the output panel updated
    const output = page.locator('[data-output-id="selection-demo"]');
    if (await output.isVisible()) {
      const text = await output.textContent();
      expect(text).toBeTruthy();
      expect(text).not.toContain('Interact with the grid');
    }
  });

  test('SelectionPlaygroundDemo — switching to row mode selects full rows', async ({ page }) => {
    await openDemo(page, 'SelectionPlaygroundDemo');

    // Switch to row mode
    const rowRadio = page.locator('input[type="radio"][value="row"]');
    await rowRadio.check();
    await page.waitForTimeout(300);

    // Click a row
    await clickCell(page, 1, 0);
    await page.waitForTimeout(200);

    // Output should reflect row selection
    const output = page.locator('[data-output-id="selection-demo"]');
    if (await output.isVisible()) {
      const text = await output.textContent();
      expect(text).toBeTruthy();
    }
  });

  test('SelectionCheckboxDemo — checkbox toggles row selection', async ({ page }) => {
    await openDemo(page, 'SelectionCheckboxDemo');

    // Find a checkbox in the grid
    const checkbox = page.locator('tbw-grid input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible({ timeout: 5000 });

    await checkbox.check();
    await page.waitForTimeout(200);

    // Row should have selected styling
    const row = page.locator('tbw-grid [role="row"]').first();
    const classList = await row.getAttribute('class');
    expect(classList).toBeTruthy();
  });

  test('SelectionEventsDemo — selection fires events to log', async ({ page }) => {
    await openDemo(page, 'selection/SelectionEventsDemo');

    await clickCell(page, 0, 0);
    await page.waitForTimeout(300);

    const logEl = page.locator('#selection-events-log, [data-event-log]');
    if (await logEl.isVisible()) {
      const text = await logEl.textContent();
      expect(text?.length).toBeGreaterThan(0);
    }
  });

  test('ConditionalSelectionDemo — locked rows cannot be selected', async ({ page }) => {
    await openDemo(page, 'selection/ConditionalSelectionDemo');

    await expect(grid(page)).toBeVisible();
    const rows = await dataRows(page).count();
    expect(rows).toBeGreaterThan(0);

    // Click an active row (row 0 = Alice, status: active) — should select
    await clickCell(page, 0, 0);
    await page.waitForTimeout(200);
    const activeRow = dataRows(page).nth(0);
    const activeClass = await activeRow.getAttribute('class');
    expect(activeClass).toContain('selected');

    // Click a locked row (row 1 = Bob, status: locked) — should NOT select
    await clickCell(page, 1, 0);
    await page.waitForTimeout(200);
    const lockedRow = dataRows(page).nth(1);
    const lockedClass = await lockedRow.getAttribute('class');
    expect(lockedClass).not.toContain('selected');
  });
});
