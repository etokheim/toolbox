import { expect, test } from '@playwright/test';
import { openDemo } from './utils';

test('HierarchyTreeGroupingDemo keeps parent groups and mixed disclosures independent', async ({ page }) => {
  await openDemo(page, 'hierarchy/HierarchyTreeGroupingDemo');
  const grid = page.locator('#hierarchy-tree-grouping-demo tbw-grid');
  const rows = grid.locator('.rows > .data-grid-row');
  await expect(rows).toHaveCount(7);
  const groups = grid.locator('.rows > .group-row');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('Shared');
  await expect(groups.nth(1)).toContainText('Shared');
  await expect(groups.nth(0)).toContainText('(1)');
  await expect(groups.nth(1)).toContainText('(1)');
  await expect(grid.locator('.rows-body')).toHaveAttribute('role', 'treegrid');
  const alpha = rows.filter({ has: page.locator('.cell[data-field="name"]', { hasText: /^Alpha$/ }) });
  await alpha.getByRole('button', { name: 'Expand details' }).click();
  await expect(grid.locator('.master-detail-row')).toContainText('Alpha parent details');
  await groups.nth(0).getByRole('button').click();
  await expect(rows).toHaveCount(6);
  await expect(grid.locator('.rows')).toContainText('Beta item');
  await expect(grid.locator('.rows')).not.toContainText('Alpha item');
  await expect(grid.locator('.master-detail-row')).toContainText('Alpha parent details');
  await alpha.locator('.tree-toggle').click();
  await expect(groups).toHaveCount(1);
  await expect(grid.locator('.master-detail-row')).toContainText('Alpha parent details');
  await expect(grid.locator('.rows')).toContainText('Empty destination');
});
