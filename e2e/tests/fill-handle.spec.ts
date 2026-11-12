import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';

let fixture: string;
test.beforeAll(async () => {
  const grid = resolve(process.env['TBW_FILL_PACKAGE'] ?? 'dist/libs/grid');
  const result = await build({
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: /^@toolbox-web\/grid$/, replacement: `${grid}/index.js` },
        { find: '@toolbox-web/grid/features', replacement: `${grid}/lib/features` },
        { find: '@toolbox-web/grid/plugins', replacement: `${grid}/lib/plugins` },
      ],
    },
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/fill-handle.ts'), formats: ['es'], fileName: 'fixture' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Expected fill fixture build output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing fill browser fixture');
  fixture = chunk.code;
});

test.beforeEach(async ({ page }) => {
  await page.route('http://fill-handle.test/fixture.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: fixture }),
  );
  await page.route('http://fill-handle.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto('http://fill-handle.test/');
  await page.evaluate(async () => {
    const url = 'http://fill-handle.test/fixture.js';
    const { mount }: typeof import('../fixtures/fill-handle') = await import(url);
    window.fillFixture = await mount();
  });
});

const state = (page: Page) =>
  page.evaluate(() => ({
    rows: window.fillFixture.rows.map(({ qty, due }) => [qty, due]),
    reports: window.fillFixture.reports.length,
    actions: window.fillFixture.grid.getPluginByName('undoRedo')!.getUndoStack().length,
  }));

async function selectSource(page: Page) {
  await page.locator('.cell[data-row="0"][data-field="qty"]').click();
  await page.locator('.cell[data-row="1"][data-field="due"]').click({ modifiers: ['Shift'] });
}

const filled = [
  [1, '2024-01-31'],
  [2, '2024-02-29'],
  [3, '2024-03-31'],
  [4, '2024-04-30'],
  [0, ''],
  [0, ''],
];

test('dragging the corner handle fills a series once and Undo restores it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await selectSource(page);
  const handle = page.locator('.tbw-fill-handle');
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAccessibleName(/fill/i);
  const box = (await handle.boundingBox())!;
  const target = (await page.locator('.cell[data-row="3"][data-field="due"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
  await expect(page.locator('.tbw-fill-preview')).toBeVisible();
  await page.mouse.up();
  expect(await state(page)).toEqual({ rows: filled, reports: 1, actions: 1 });
  await page.keyboard.press('ControlOrMeta+z');
  expect((await state(page)).rows.slice(2)).toEqual(Array(4).fill([0, '']));
  expect(errors).toEqual([]);
});

test('Alt+ArrowDown, ArrowDown and Enter fill without a pointer; Escape cancels', async ({ page }) => {
  await selectSource(page);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.tbw-fill-handle')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await state(page)).toMatchObject({ reports: 0, actions: 0 });
  await selectSource(page);
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect(await state(page)).toEqual({ rows: filled, reports: 1, actions: 1 });
});

test('tapping the handle arms it and tapping a target cell applies', async ({ page }) => {
  await selectSource(page);
  const handle = page.locator('.tbw-fill-handle');
  await handle.click();
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.cell[data-row="3"][data-field="qty"]').click();
  expect(await state(page)).toEqual({ rows: filled, reports: 1, actions: 1 });
});

async function dragHandleTo(page: Page, row: number, field: string) {
  const box = (await page.locator('.tbw-fill-handle').boundingBox())!;
  const target = (await page.locator(`.cell[data-row="${row}"][data-field="${field}"]`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('dragging the handle during an edit commits the pending value and fills from it', async ({ page }) => {
  const cell = page.locator('.cell[data-row="0"][data-field="qty"]');
  await cell.dblclick();
  const input = cell.locator('input');
  await expect(input).toBeFocused();
  await input.fill('5');
  await expect(page.locator('.tbw-fill-handle')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('edit-mode-handle.png') });
  await dragHandleTo(page, 3, 'qty');
  expect((await state(page)).rows.map(([qty]) => qty)).toEqual([5, 5, 5, 5, 0, 0]);
  expect(await page.evaluate(() => window.fillFixture.grid.query<boolean>('isEditing').some(Boolean))).toBe(false);
});

test('Escape during an edit still cancels it when no fill was started', async ({ page }) => {
  const cell = page.locator('.cell[data-row="0"][data-field="qty"]');
  await cell.dblclick();
  await cell.locator('input').fill('9');
  await page.keyboard.press('Escape');
  await expect(cell.locator('input')).toHaveCount(0);
  expect((await state(page)).rows[0]).toEqual([1, '2024-01-31']);
});

test('an outside press clears the range and hides the handle; overlays do not', async ({ page }) => {
  await selectSource(page);
  const handle = page.locator('.tbw-fill-handle');
  await expect(handle).toBeVisible();
  await page.locator('#overlay').click();
  await expect(handle).toBeVisible();
  await expect(page.locator('.cell.selected')).not.toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('before-outside-click.png') });
  await page.locator('#outside').click();
  await expect(handle).toBeHidden();
  await expect(page.locator('.cell.selected')).toHaveCount(0);
  await expect(page.locator('tbw-grid')).not.toHaveAttribute('data-has-focus');
  await page.screenshot({ path: test.info().outputPath('after-outside-click.png') });
});
