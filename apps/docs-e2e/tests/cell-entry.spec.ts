import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { cell, grid, openDemo } from './utils';
import type { DataGridElement } from '@toolbox-web/grid';

test.beforeEach(async ({ page }) => {
  await openDemo(page, 'cell-entry/CellEntryDefaultDemo');
});

test('CellEntryDefaultDemo — click, commit, reverse Tab and read-only row skipping', async ({ page }) => {
  await cell(page, 0, 0).click();
  await expect(cell(page, 0, 0).getByRole('textbox')).toBeFocused();
  await cell(page, 0, 0).getByRole('textbox').fill('Alicia');
  await page.keyboard.press('Tab');
  await expect(cell(page, 0, 1).getByRole('textbox')).toBeFocused();
  await expect(cell(page, 0, 0)).toHaveText('Alicia');
  await expect(grid(page).locator('.cell.editing')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(cell(page, 2, 0).getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cell(page, 0, 1).getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(grid(page).getByRole('textbox')).toHaveCount(0);
});

test('CellEntryDefaultDemo — boundary Tab exits rather than trapping or wrapping', async ({ page }) => {
  await cell(page, 0, 0).click();
  await expect(cell(page, 0, 0).getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#cell-entry-before')).toBeFocused();
  await cell(page, 2, 1).click();
  await expect(cell(page, 2, 1).getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#cell-entry-after')).toBeFocused();
  await expect(grid(page).getByRole('textbox')).toHaveCount(0);
});

test('CellEntryDefaultDemo — drag and modified click select without an editor', async ({ page }) => {
  const start = await cell(page, 0, 0).boundingBox();
  const end = await cell(page, 2, 1).boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  await page.mouse.move(start!.x + 25, start!.y + 12);
  await page.mouse.down();
  await page.mouse.move(end!.x + 25, end!.y + 12, { steps: 10 });
  await page.mouse.up();
  await expect(grid(page).locator('.cell.selected')).toHaveCount(6);
  await expect(grid(page).getByRole('textbox')).toHaveCount(0);
  await cell(page, 0, 0).click({ modifiers: ['Shift'] });
  await expect(grid(page).getByRole('textbox')).toHaveCount(0);
});

test('CellEntryDefaultDemo — F2/Enter access and WCAG 2.2 AA editor semantics', async ({ page }) => {
  await cell(page, 0, 0).click({ modifiers: ['Shift'] });
  await page.keyboard.press('F2');
  await expect(cell(page, 0, 0).getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(cell(page, 0, 0).getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('CellEntryDefaultDemo — touch tap enters while long-press stays selection-only', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const bounds = await cell(page, 0, 0).boundingBox();
  expect(bounds).not.toBeNull();
  const point = { x: bounds!.x + 30, y: bounds!.y + 12 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(grid(page).getByRole('textbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(cell(page, 0, 0).getByRole('textbox')).toBeFocused();
  await cdp.detach();
});

test('CellEntryDefaultDemo — continuation materializes virtual rows without accumulating editors', async ({ page }) => {
  await grid(page).evaluate((element) => {
    const host = element as DataGridElement;
    host.style.height = '200px';
    host.rows = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, team: 'Test' }));
  });
  await cell(page, 0, 0).click();
  for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
  const target = grid(page).locator('[role="gridcell"][data-row="15"][data-col="0"]').getByRole('textbox');
  await expect(target).toBeFocused();
  await expect(grid(page).locator('.cell.editing')).toHaveCount(1);
  const renderedRows = await grid(page).locator('.rows-body [role="row"]').count();
  expect(renderedRows).toBeGreaterThan(0);
  expect(renderedRows).toBeLessThan(100);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
  }
  await expect(target).toBeFocused();
  await expect(grid(page).getByRole('textbox')).toHaveCount(1);
});
