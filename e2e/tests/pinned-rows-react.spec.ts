import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';

let fixture: string;
test.beforeAll(async () => {
  const grid = resolve(process.env['TBW_ANCESTOR_PACKAGE'] ?? 'dist/libs/grid');
  const react = resolve(process.env['TBW_ANCESTOR_REACT_PACKAGE'] ?? 'dist/libs/grid-react');
  const result = await build({
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: 'react', replacement: resolve('node_modules/react') },
        { find: 'react-dom', replacement: resolve('node_modules/react-dom') },
        { find: /^@toolbox-web\/grid-react$/, replacement: `${react}/index.js` },
        { find: '@toolbox-web/grid-react/features', replacement: `${react}/features` },
        { find: /^@toolbox-web\/grid$/, replacement: `${grid}/index.js` },
        { find: '@toolbox-web/grid/plugins', replacement: `${grid}/lib/plugins` },
        { find: '@toolbox-web/grid/features', replacement: `${grid}/lib/features` },
      ],
    },
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('e2e/fixtures/pinned-rows-react.tsx'), formats: ['es'], fileName: 'fixture' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing fixture chunk');
  fixture = chunk.code;
});

for (const surface of ['props', 'canonical'] as const) {
  test(`${surface}: inline pinned callbacks preserve native paste/Undo, menu and editor owners`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://pinned-react.test/fixture.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: fixture }),
    );
    await page.route('http://pinned-react.test/', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
    );
    await page.goto('http://pinned-react.test/');
    await page.evaluate(async (surface) => {
      const url = 'http://pinned-react.test/fixture.js';
      const { mount }: typeof import('../fixtures/pinned-rows-react') = await import(url);
      window.pinnedReact = await mount(surface);
    }, surface);
    await page.locator('#panel').click();
    await expect(page.getByRole('menuitem')).toHaveText('Current 0');
    const cell = page.locator('.data-grid-row .cell[data-field="quantity"]');
    await cell.click();
    await cell.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', '11');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(cell).toHaveText('11');
    await expect(page.locator('.tbw-footer')).toContainText('Total 1: 11');
    const committed = await page.evaluate(() => window.pinnedReact.measure());
    await info.attach('after-paste', { body: JSON.stringify(committed), contentType: 'application/json' });
    expect(committed).toMatchObject({ samePlugins: true, detaches: 0, undo: 1, value: '11' });
    await expect(page.getByRole('menuitem')).toHaveText('Current 1');
    await cell.press('Control+z');
    await expect(cell).toHaveText('10');
    await expect.poll(() => page.evaluate(() => window.pinnedReact.measure().redo)).toBe(1);
    await cell.dblclick();
    const editor = cell.locator('input');
    await expect(editor).toBeFocused();
    await editor.fill('23');
    await page.evaluate(() => {
      window.pinnedReact.rememberEditor();
      window.pinnedReact.rerender();
    });
    await expect(page.locator('.tbw-footer')).toContainText('Label 2');
    await expect(editor).toHaveValue('23');
    await expect(editor).toBeFocused();
    const editing = await page.evaluate(() => window.pinnedReact.measure());
    await info.attach('active-editor', { body: JSON.stringify(editing), contentType: 'application/json' });
    expect(editing).toMatchObject({ samePlugins: true, detaches: 0, sameEditor: true, focusedEditor: true });
    await page.screenshot({ path: info.outputPath('pinned-live-owner.png') });
    await editor.press('Escape');
    await page.evaluate(() => window.pinnedReact.dispose());
    expect(errors).toEqual([]);
  });
}
