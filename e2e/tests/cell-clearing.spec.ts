import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';

let fixture: string;
test.beforeAll(async () => {
  const grid = resolve(process.env['TBW_CLEAR_PACKAGE'] ?? 'dist/libs/grid');
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
      lib: { entry: resolve('e2e/fixtures/cell-clearing.ts'), formats: ['es'], fileName: 'fixture' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Expected clearing fixture build output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing clearing browser fixture');
  fixture = chunk.code;
});

test.beforeEach(async ({ page }) => {
  await page.route('http://cell-clearing.test/fixture.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: fixture }),
  );
  await page.route('http://cell-clearing.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto('http://cell-clearing.test/');
  await page.evaluate(async () => {
    const url = 'http://cell-clearing.test/fixture.js';
    const { mount }: typeof import('../fixtures/cell-clearing') = await import(url);
    window.clearFixture = await mount();
  });
});

for (const key of ['Delete', 'Backspace']) {
  test(`${key} clears the selected range once and native Undo restores it`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const first = page.locator('.cell[data-row="0"][data-field="text"]');
    const last = page.locator('.cell[data-row="1"][data-field="amount"]');
    const derived = page.locator('.cell[data-row="0"][data-field="derived"]');
    await expect(derived).toHaveText('Alpha-derived');
    await first.click();
    await last.click({ modifiers: ['Shift'] });
    await page.keyboard.press(key);
    await expect(first).toHaveText('');
    await expect(last).toHaveText('');
    await expect(derived).toHaveText('-derived');
    expect(
      await page.evaluate(() => ({
        rows: window.clearFixture.rows.map(({ text, amount }) => ({ text, amount })),
        outcomes: window.clearFixture.reports[0].cells.map((cell) => cell.status),
        actions: window.clearFixture.grid.getPluginByName('undoRedo')!.getUndoStack().length,
      })),
    ).toEqual({
      rows: [
        { text: '', amount: null },
        { text: '', amount: null },
      ],
      outcomes: ['cleared', 'cleared', 'cleared', 'cleared'],
      actions: 1,
    });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(first).toHaveText('Alpha');
    await expect(last).toHaveText('8');
    await expect(derived).toHaveText('Alpha-derived');
    expect(errors).toEqual([]);
  });
}

test('ID-less clear and Undo invalidate independently bundled core derived values', async ({ page }) => {
  await page.evaluate(async () => {
    window.clearFixture.grid.remove();
    const url = 'http://cell-clearing.test/fixture.js';
    const { mount }: typeof import('../fixtures/cell-clearing') = await import(url);
    window.clearFixture = await mount({ noId: true });
  });
  const first = page.locator('.cell[data-row="0"][data-field="text"]');
  const derived = page.locator('.cell[data-row="0"][data-field="derived"]');
  await expect(derived).toHaveText('Alpha-derived');
  await first.click();
  await page.keyboard.press('Delete');
  await expect(first).toHaveText('');
  await expect(derived).toHaveText('-derived');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(first).toHaveText('Alpha');
  await expect(derived).toHaveText('Alpha-derived');
  await expect(page.locator('tbw-grid')).toBeFocused();
  await expect(first).toHaveClass(/cell-focus/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cell[data-row="0"][data-field="amount"]')).toHaveClass(/cell-focus/);
});

test('native input, contenteditable and active editor retain destructive keys', async ({ page }) => {
  const input = page.locator('[data-native]').first();
  await input.focus();
  await input.press('End');
  await input.press('Backspace');
  await expect(input).toHaveValue('Nativ');
  const content = page.locator('[data-editable]').first();
  await content.focus();
  await content.press('End');
  await content.press('Backspace');
  await expect(content).toHaveText('Conten');
  await page.locator('.cell[data-row="0"][data-field="text"]').click();
  await page.keyboard.press('F2');
  const editor = page.locator('.cell.editing input');
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.press('Backspace');
  await expect(editor).toHaveValue('Alph');
  expect(await page.evaluate(() => window.clearFixture.reports.length)).toBe(0);
});
