import { expect, test } from '@playwright/test';
import type { DataGridElement } from '@toolbox-web/grid';
import { resolve } from 'node:path';

// The bounded fixture is bundled against the paired emitted packages before this test.
const bundle = process.env['GROUPING_DISCLOSURE_BUNDLE'];
test.skip(!bundle, 'Set GROUPING_DISCLOSURE_BUNDLE to the built grouping-disclosures.tsx fixture.');

for (const custom of [false, true]) {
  for (const explicitConfig of [false, true]) {
    test(`Grouping removal — custom=${custom}, explicitConfig=${explicitConfig}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent('<style>tbw-grid{display:block;width:700px}</style><div id="react"></div>');
      await page.addScriptTag({ path: resolve(bundle!), type: 'module' });
      await expect(page.locator('#react [data-group="A"]')).toBeVisible();
      await page.evaluate(
        ({ custom, explicitConfig }) => {
          (
            window as typeof window & {
              groupingProof: { mountRemoval(custom: boolean, explicitConfig: boolean): void };
            }
          ).groupingProof.mountRemoval(custom, explicitConfig);
        },
        { custom, explicitConfig },
      );
      const grid = page.locator('#react tbw-grid');
      const mode = page.getByRole('combobox', { name: 'Grouping mode' });
      const disclosure = grid.locator(custom ? '[data-group="A"]' : '.group-toggle').first();
      for (let cycle = 0; cycle < 2; cycle++) {
        await expect(disclosure).toBeVisible();
        await expect(grid.locator('.data-grid-row:not(.group-row)')).toHaveCount(12);
        await disclosure.click();
        await expect(grid.locator('.data-grid-row:not(.group-row)')).toHaveCount(6);
        await disclosure.click();
        await expect(grid.locator('.data-grid-row:not(.group-row)')).toHaveCount(12);
        await mode.selectOption('false');
        await expect(grid.locator('.group-row')).toHaveCount(0);
        await expect(grid.locator('.data-grid-row')).toHaveCount(12);
        await expect(grid.locator('.rows-body')).toHaveAttribute('role', 'grid');
        await expect(
          grid.locator(
            '.data-grid-row[aria-expanded], .data-grid-row[aria-level], .data-grid-row[aria-setsize], .data-grid-row[aria-posinset], .data-grid-row[data-group-depth]',
          ),
        ).toHaveCount(0);
        await expect(grid.locator('.header-cell[data-field="category"]')).toHaveCount(0);
        expect(
          await grid
            .locator('.data-grid-row')
            .evaluateAll((elements) =>
              elements.every((element) => !(element as HTMLElement).style.getPropertyValue('--tbw-group-depth')),
            ),
        ).toBe(true);
        expect(await grid.locator('.data-grid-row .cell').allTextContents()).toEqual(
          Array.from({ length: 12 }, (_, index) => `Item ${index}`),
        );
        const bounds = await grid.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return [...element.querySelectorAll('.data-grid-row')].every(
            (row) => row.getBoundingClientRect().bottom <= rect.bottom + 1,
          );
        });
        expect(bounds).toBe(true);
        if (cycle === 0) await mode.selectOption('true');
      }
      const counts = await page.evaluate(() => {
        const proof = (
          window as typeof window & {
            groupingProof: { counts: { mounted: number; disposed: number }; unmount(): void };
          }
        ).groupingProof;
        proof.unmount();
        return proof.counts;
      });
      expect(counts.disposed).toBe(counts.mounted);
      expect(errors).toEqual([]);
    });
  }
}

test('Grouping disclosure — supported nested control keeps native targets, activation, rows and focus', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.setContent(
    '<style>tbw-grid{display:block;width:700px;margin:24px}button{cursor:pointer}</style><div id="react"></div>',
  );
  await page.addScriptTag({ path: resolve(bundle!), type: 'module' });
  const custom = page.locator('#react tbw-grid');
  const button = custom.locator('[data-group="A"]');
  await expect(button).toHaveAttribute('data-theme', 'grouping-proof');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(custom.locator('.data-grid-row:not(.group-row)')).toHaveCount(12);
  await custom.evaluate((element) => {
    element.setAttribute('data-toggles', '0');
    element.setAttribute('data-selections', '0');
    element.addEventListener('group-toggle', () =>
      element.setAttribute('data-toggles', String(Number(element.getAttribute('data-toggles')) + 1)),
    );
    element.addEventListener('selection-change', () =>
      element.setAttribute('data-selections', String(Number(element.getAttribute('data-selections')) + 1)),
    );
  });
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
  for (let i = 0; i < 6; i++) {
    if (i % 3 === 0) await button.locator('svg').click();
    else await button.press(i % 3 === 1 ? 'Space' : 'Enter');
    await expect(button).toHaveAttribute('aria-expanded', String(i % 2 !== 0));
    await expect(custom).toHaveAttribute('data-toggles', String(i + 1));
    await expect(custom).toHaveAttribute('data-selections', '0');
    await expect(button).toBeFocused();
    await expect(custom.locator('.data-grid-row:not(.group-row)')).toHaveCount(i % 2 === 0 ? 6 : 12);
    await expect
      .poll(() =>
        custom.evaluate((grid) => {
          const bounds = grid.getBoundingClientRect();
          return [...grid.querySelectorAll('.data-grid-row')].every((row) => {
            const rect = row.getBoundingClientRect();
            return rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1;
          });
        }),
      )
      .toBe(true);
  }
  await custom.evaluate((element) => (element as DataGridElement).getPluginByName('groupingRows')!.collapseAll());
  await expect(custom.locator('.data-grid-row:not(.group-row)')).toHaveCount(0);
  await button.click();
  await expect(custom.locator('.data-grid-row:not(.group-row)')).toHaveCount(6);
  await button.press('ArrowDown');
  await expect(button).not.toBeFocused();
  await expect(custom.locator('.cell-focus')).toHaveCount(1);

  const native = page.locator('#native');
  const nativeButton = native.locator('.group-toggle').first();
  const target = await nativeButton.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { width: parseFloat(style.inlineSize), height: parseFloat(style.blockSize), tag: element.tagName };
  });
  expect(target).toEqual({ width: 24, height: 24, tag: 'BUTTON' });
  await nativeButton.click();
  await expect(native.locator('.data-grid-row:not(.group-row)')).toHaveCount(6);
  await nativeButton.click();
  await expect(native.locator('.data-grid-row:not(.group-row)')).toHaveCount(12);
  await custom.locator('.data-grid-row:not(.group-row) .cell').first().click();
  await expect(custom.locator('.data-grid-row.selected')).toHaveCount(1);

  const lifecycle = await page.evaluate(() => {
    const proof = (
      window as typeof window & { groupingProof: { counts: { mounted: number; disposed: number }; unmount(): void } }
    ).groupingProof;
    proof.unmount();
    return proof.counts;
  });
  expect(lifecycle.disposed).toBe(lifecycle.mounted);
  expect(errors).toEqual([]);
});

test('Grouping disclosure — bounded native/custom update comparison', async ({ page }, testInfo) => {
  await page.setContent('<div id="react"></div>');
  await page.addScriptTag({ path: resolve(bundle!), type: 'module' });
  await expect(page.locator('#react [data-group="A"]')).toBeVisible();
  const timings = await page.evaluate(async () => {
    const native = document.getElementById('native') as DataGridElement;
    const custom = document.querySelector('#react tbw-grid') as DataGridElement;
    const proof = (
      window as typeof window & {
        groupingProof: {
          counts: { mounted: number; disposed: number; updates: number };
          refresh(grid: DataGridElement): Promise<void>;
        };
      }
    ).groupingProof;
    const before = { ...proof.counts };
    const measure = async (grid: DataGridElement) => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) await proof.refresh(grid);
      return (performance.now() - start) / 100;
    };
    const samples: { native: number; custom: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const left = await measure(i % 2 === 0 ? native : custom);
      const right = await measure(i % 2 === 0 ? custom : native);
      samples.push(i % 2 === 0 ? { native: left, custom: right } : { native: right, custom: left });
      await new Promise(requestAnimationFrame);
    }
    return { samples, before, after: { ...proof.counts } };
  });
  expect(timings.samples).toHaveLength(10);
  expect(timings.after.mounted).toBe(timings.before.mounted);
  expect(timings.after.disposed).toBe(timings.before.disposed);
  expect(timings.after.updates - timings.before.updates).toBeGreaterThanOrEqual(2000);
  for (const sample of timings.samples) {
    expect(sample.custom).toBeLessThan(4);
    expect(sample.native).toBeLessThan(1);
  }
  await testInfo.attach('grouping-update-timings', { body: JSON.stringify(timings), contentType: 'application/json' });
});
